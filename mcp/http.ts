import type { IncomingMessage, ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (headers) for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(payload)
}

export function sendEmpty(res: ServerResponse, status: number, headers?: Record<string, string>) {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  if (headers) for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end()
}

export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
