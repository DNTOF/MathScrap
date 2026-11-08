/**
 * Decide whether an AI proxy target is safe to open.
 * Link-local and metadata addresses are always refused.
 * Loopback and private ranges are refused unless the process opts in
 * with MATHSCRAP_AI_ALLOW_PRIVATE=1. That switch does not allow metadata.
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

export function allowPrivateAi(): boolean {
  return process.env.MATHSCRAP_AI_ALLOW_PRIVATE === '1'
}

export function isBlockedAddress(address: string, allowPrivate = false): boolean {
  for (const form of expandAddress(address)) {
    if (form.family === 4) {
      if (linkLocal4.check(form.address, 'ipv4')) return true
      if (!allowPrivate && private4.check(form.address, 'ipv4')) return true
    } else if (isIP(form.address) === 6) {
      if (linkLocal6.check(form.address, 'ipv6')) return true
      if (!allowPrivate && private6.check(form.address, 'ipv6')) return true
    } else {
      return true
    }
  }
  return false
}

export function isBlockedHostname(hostname: string, allowPrivate = false): boolean {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (METADATA_HOSTS.has(host) || (host.endsWith('.internal') && host.includes('metadata'))) return true
  const literal = literalAddresses(host)
  if (literal.length) return literal.some((item) => isBlockedAddress(item.address, allowPrivate))
  return false
}

export async function resolveAndCheck(hostname: string, lookupFn: LookupFn = defaultLookup, allowPrivate = allowPrivateAi()): Promise<Addr[]> {
  if (isBlockedHostname(hostname, allowPrivate)) throw new Error('blocked')
  const host = stripBrackets(hostname).toLowerCase()
  const literal = literalAddresses(host)
  const found = literal.length ? literal : await lookupFn(host)
  if (!found.length) throw new Error('blocked')
  if (found.some((item) => isBlockedAddress(item.address, allowPrivate) || isBlockedHostname(item.address, allowPrivate))) throw new Error('blocked')
  return found
}

export function defaultLookup(hostname: string): Promise<Addr[]> {
  return lookup(hostname, { all: true, verbatim: true })
}

export function literalAddresses(host: string): Addr[] {
  const bare = stripBrackets(host).toLowerCase()
  if (isIP(bare) === 4) return [{ address: bare, family: 4 }]
  if (isIP(bare) === 6) return [{ address: bare, family: 6 }]
  const dword = dwordToIpv4(bare)
  if (dword) return [{ address: dword, family: 4 }]
  const dotted = dottedToIpv4(bare)
  if (dotted) return [{ address: dotted, family: 4 }]
  return []
}

function expandAddress(address: string): Addr[] {
  const bare = stripBrackets(address).toLowerCase()
  const out: Addr[] = []
  if (isIP(bare) === 4) out.push({ address: bare, family: 4 })
  if (isIP(bare) === 6) {
    out.push({ address: bare, family: 6 })
    const mapped = mappedIpv4(bare)
    if (mapped) out.push({ address: mapped, family: 4 })
  }
  const dword = dwordToIpv4(bare)
  if (dword) out.push({ address: dword, family: 4 })
  return out.length ? out : [{ address: bare, family: 0 }]
}

function mappedIpv4(ipv6: string): string | null {
  const hex = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    if (hi > 0xffff || lo > 0xffff) return null
    const n = ((hi << 16) | lo) >>> 0
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  }
  const dotted = ipv6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  return dotted && isIP(dotted[1]) === 4 ? dotted[1] : null
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
