import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const COOKIE = 'mathscrap_session'

let memory = ''

/** Process-local capability. Not a header the caller can invent. */
export function sessionToken(): string {
  if (!memory) memory = randomBytes(32).toString('hex')
  return memory
}

export function sessionFile(): string {
  return path.join(tmpdir(), `mathscrap-session-${process.getuid?.() ?? 'user'}`, 'session')
}

/** Mode 0600. The stdio client reads this. Do not print the value. */
export function publishSession(): void {
  const file = sessionFile()
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  chmodSync(path.dirname(file), 0o700)
  writeFileSync(file, sessionToken(), { mode: 0o600 })
  chmodSync(file, 0o600)
}

export function readPublishedSession(): string {
  return readFileSync(sessionFile(), 'utf8').trim()
}

export function sessionCookieHeader(): string {
  return `${COOKIE}=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
}

export function presentedSession(req: IncomingMessage): string {
  const raw = header(req, 'cookie')
  for (const part of raw.split(';')) {
    const text = part.trim()
    const eq = text.indexOf('=')
    if (eq <= 0) continue
    if (text.slice(0, eq) === COOKIE) return text.slice(eq + 1)
  }
  return ''
}

export function sessionMatches(value: string): boolean {
  const token = sessionToken()
  const got = Buffer.from(value)
  const want = Buffer.from(token)
  if (got.length !== want.length || got.length === 0) return false
  return timingSafeEqual(got, want)
}

/**
 * LAN sharing stays off unless the operator set a long unguessable token
 * and asked the server to listen beyond loopback. The token is not generated
 * into a log line.
 */
export function shareTokenUsable(value = process.env.MATHSCRAP_SHARE_TOKEN ?? ''): boolean {
  if (process.env.MATHSCRAP_BIND !== 'lan') return false
  if (value.length < 32 || value.length > 256) return false
  if (new Set(value).size < 8) return false
  if (/^(.)\1+$/.test(value)) return false
  if (/changeme|password|secret|mathscrap|letmein|qwerty/i.test(value)) return false
  return true
}

export function shareMatches(value: string): boolean {
  const want = process.env.MATHSCRAP_SHARE_TOKEN ?? ''
  if (!shareTokenUsable(want)) return false
  const got = Buffer.from(value)
  const expect = Buffer.from(want)
  if (got.length !== expect.length) return false
  return timingSafeEqual(got, expect)
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}
