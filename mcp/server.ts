/**
 * MathScrap MCP server (stdio).
 * Tool calls are forwarded to the Vite dev bridge at MATHSCRAP_BRIDGE
 * (default http://127.0.0.1:47321). The open page executes them.
 * stdout is reserved for MCP JSON-RPC. Do not log here — and never log API keys
 * (this process does not receive them).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_SPECS } from '../src/ai/specs.ts'

const bridgeUrl = (process.env.MATHSCRAP_BRIDGE ?? 'http://127.0.0.1:47321').replace(/\/+$/, '')

async function bridgeCall(name: string, args: Record<string, unknown>) {
  let res: Response
  try {
    res = await fetch(`${bridgeUrl}/__mathscrap/bridge/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error(`连不上 MathScrap（${bridgeUrl}）。先在本机运行 npm run dev，并打开页面。`)
  }
  const text = await res.text()
  let data: { ok?: boolean; result?: unknown; error?: string } = {}
  try {
    data = JSON.parse(text) as typeof data
  } catch {
    throw new Error(`桥接返回的不是 JSON（HTTP ${res.status}）`)
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `桥接失败 HTTP ${res.status}`)
  return data.result
}

const server = new Server({ name: 'mathscrap', version: '0.1.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SPECS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const result = await bridgeCall(req.params.name, req.params.arguments ?? {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  } catch (e) {
    return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : '工具调用失败' }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
