/**
 * Decide whether an AI proxy target is safe to open.
 * Link-local and metadata addresses are always refused.
 * Loopback, private, and IPv6 ULA addresses are refused unless the exact
 * origin (scheme, host, and port) is listed in MATHSCRAP_AI_LOCAL_ORIGINS.
 * That list does not open the rest of the private network.
 */
import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const linkLocal4 = new BlockList()
const private4 = new BlockList()
const linkLocal6 = new BlockList()
const private6 = new BlockList()

linkLocal4.addSubnet('169.254.0.0', 16, 'ipv4')
linkLocal4.addSubnet('0.0.0.0', 8, 'ipv4')
private4.addSubnet('10.0.0.0', 8, 'ipv4')
private4.addSubnet('100.64.0.0', 10, 'ipv4')
private4.addSubnet('127.0.0.0', 8, 'ipv4')
private4.addSubnet('172.16.0.0', 12, 'ipv4')
private4.addSubnet('192.0.0.0', 24, 'ipv4')
private4.addSubnet('192.0.2.0', 24, 'ipv4')
private4.addSubnet('192.168.0.0', 16, 'ipv4')
private4.addSubnet('198.18.0.0', 15, 'ipv4')
private4.addSubnet('198.51.100.0', 24, 'ipv4')
private4.addSubnet('203.0.113.0', 24, 'ipv4')
private4.addSubnet('224.0.0.0', 4, 'ipv4')
private4.addSubnet('240.0.0.0', 4, 'ipv4')

linkLocal6.addSubnet('fe80::', 10, 'ipv6')
linkLocal6.addSubnet('::', 128, 'ipv6')
private6.addSubnet('::1', 128, 'ipv6')
private6.addSubnet('fc00::', 7, 'ipv6')
private6.addSubnet('ff00::', 8, 'ipv6')
private6.addSubnet('2001:db8::', 32, 'ipv6')

export type Addr = { address: string; family: number }
export type LookupFn = (hostname: string) => Promise<Addr[]>

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.google.com'])

export function localOriginsFromEnv(): URL[] {
  const raw = process.env.MATHSCRAP_AI_LOCAL_ORIGINS ?? ''
  const out: URL[] = []
  for (const part of raw.split(',')) {
    const text = part.trim()
    if (!text) continue
    try {
      const url = new URL(text)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) out.push(url)
    } catch {
      continue
    }
  }
  return out
}

export function matchesLocalOrigin(target: URL, allow: URL[]): boolean {
  const host = stripBrackets(target.hostname).toLowerCase()
  return allow.some((item) => item.protocol === target.protocol && stripBrackets(item.hostname).toLowerCase() === host && portOf(item) === portOf(target))
}

export function isLinkLocalAddress(address: string): boolean {
  return expandAddress(address).some((form) => {
    if (form.family === 4) return linkLocal4.check(form.address, 'ipv4')
    if (form.family === 6 && isIP(form.address) === 6) return linkLocal6.check(form.address, 'ipv6')
    return form.family === 0
  })
}

export function isPrivateOrLoopback(address: string): boolean {
  return expandAddress(address).some((form) => {
    if (form.family === 4) return private4.check(form.address, 'ipv4') || linkLocal4.check(form.address, 'ipv4')
    if (form.family === 6 && isIP(form.address) === 6) return private6.check(form.address, 'ipv6') || linkLocal6.check(form.address, 'ipv6')
    return true
  })
}

export function isBlockedAddress(address: string, allowPrivate = false): boolean {
  if (isLinkLocalAddress(address)) return true
  return !allowPrivate && isPrivateOrLoopback(address)
}

export function isBlockedHostname(hostname: string, allowPrivate = false): boolean {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (METADATA_HOSTS.has(host) || (host.endsWith('.internal') && host.includes('metadata'))) return true
  const literal = literalAddresses(host)
  if (literal.length) return literal.some((item) => isBlockedAddress(item.address, allowPrivate))
  return false
}

export async function resolveAndCheck(target: URL, lookupFn: LookupFn = defaultLookup, origins: URL[] = localOriginsFromEnv()): Promise<Addr[]> {
  const host = stripBrackets(target.hostname).toLowerCase().replace(/\.$/, '')
  if (!host || METADATA_HOSTS.has(host) || (host.endsWith('.internal') && host.includes('metadata'))) throw new Error('blocked')
  const literal = literalAddresses(host)
  if (literal.some((item) => isLinkLocalAddress(item.address))) throw new Error('blocked')
  const found = literal.length ? literal : await lookupFn(host)
  if (!found.length) throw new Error('blocked')
  const permitted = matchesLocalOrigin(target, origins)
  if (found.some((item) => isLinkLocalAddress(item.address))) throw new Error('blocked')
  if (found.some((item) => isPrivateOrLoopback(item.address)) && !permitted) throw new Error('blocked')
  return found
}

function portOf(url: URL) {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

export function sameAddressSet(left: Addr[], right: Addr[]): boolean {
  const key = (item: Addr) => `${item.family}:${item.address}`
  const a = [...new Set(left.map(key))].sort()
  const b = [...new Set(right.map(key))].sort()
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export function defaultLookup(hostname: string): Promise<Addr[]> {
  return lookup(hostname, { all: true, verbatim: true })
}

export function literalAddresses(host: string): Addr[] {
  const bare = stripBrackets(host).toLowerCase().split('%')[0]
  if (isIP(bare) === 4) return [{ address: bare, family: 4 }]
  if (bare.includes(':') && parseIpv6(bare)) return [{ address: bare, family: 6 }]
  const dword = dwordToIpv4(bare)
  if (dword) return [{ address: dword, family: 4 }]
  const dotted = dottedToIpv4(bare)
  if (dotted) return [{ address: dotted, family: 4 }]
  return []
}

function expandAddress(address: string): Addr[] {
  const bare = stripBrackets(address).toLowerCase().split('%')[0]
  const out: Addr[] = []
  if (isIP(bare) === 4) out.push({ address: bare, family: 4 })
  const groups = bare.includes(':') ? parseIpv6(bare) : null
  if (groups) {
    out.push({ address: bare, family: 6 })
    for (const embedded of embeddedIpv4(groups)) out.push({ address: embedded, family: 4 })
  }
  const dword = dwordToIpv4(bare)
  if (dword) out.push({ address: dword, family: 4 })
  return out.length ? out : [{ address: bare, family: 0 }]
}

function parseIpv6(input: string): number[] | null {
  let text = input.toLowerCase()
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  let v4: number[] = []
  if (dotted && dotted.index != null) {
    const parsed = ipv4ToGroups(dotted[1])
    if (!parsed) return null
    v4 = parsed
    text = text.slice(0, dotted.index).replace(/:$/, '')
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const side = (part: string) => {
    if (!part) return [] as number[]
    const bits = part.split(':')
    if (bits.some((item) => !/^[0-9a-f]{1,4}$/.test(item))) return null
    return bits.map((item) => parseInt(item, 16))
  }
  const left = side(halves[0] ?? '')
  const right = halves.length === 2 ? side(halves[1] ?? '') : []
  if (!left || !right) return null
  if (halves.length === 1) return left.length + v4.length === 8 ? [...left, ...v4] : null
  const missing = 8 - (left.length + right.length + v4.length)
  if (missing < 0) return null
  return [...left, ...Array<number>(missing).fill(0), ...right, ...v4]
}

function embeddedIpv4(groups: number[]): string[] {
  const out: string[] = []
  const zero = (count: number) => groups.slice(0, count).every((item) => item === 0)
  if (groups[0] === 0x2002) out.push(groupsToIpv4(groups[1], groups[2]))
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((item) => item === 0)) out.push(groupsToIpv4(groups[6], groups[7]))
  if (zero(5) && groups[5] === 0xffff) out.push(groupsToIpv4(groups[6], groups[7]))
  if (zero(6)) out.push(groupsToIpv4(groups[6], groups[7]))
  return out
}

function groupsToIpv4(hi: number, lo: number): string {
  const n = ((hi << 16) | lo) >>> 0
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

function ipv4ToGroups(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(parsePart)
  if (nums.some((item) => item == null)) return null
  const [a, b, c, d] = nums as number[]
  return [((a << 8) | b) & 0xffff, ((c << 8) | d) & 0xffff]
}

function dwordToIpv4(text: string): string | null {
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(text)) return null
  const n = text.startsWith('0x') || text.startsWith('0X') ? parseInt(text, 16) : Number(text)
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

function dottedToIpv4(text: string): string | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(parsePart)
  if (nums.some((n) => n == null)) return null
  return (nums as number[]).join('.')
}

function parsePart(part: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = parseInt(part, 16)
    return n >= 0 && n <= 255 ? n : null
  }
  if (!/^\d+$/.test(part)) return null
  const n = Number(part)
  return n >= 0 && n <= 255 ? n : null
}

function stripBrackets(host: string) {
  return host.replace(/^\[|\]$/g, '')
}
