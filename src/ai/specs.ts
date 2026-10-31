/**
 * MCP-shaped tool list shared by the in-page bridge and the Node MCP server.
 * Keep this file free of app imports so `mcp/server.ts` can load it directly.
 */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
  }
  status: 'local' | 'planned'
}

const numPair = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'page_read',
    description: '读取当前这张纸：写在纸上的所有公式（原文、位置）以及笔迹数量。',
    inputSchema: { type: 'object', properties: {} },
    status: 'local',
  },
  {
    name: 'page_add_formula',
    description: '在纸上写一个公式（不传 x/y 时写在视野左侧的下一行）。text 使用本应用的 ASCII 数学写法，例如 "y = x^2 - 2" 或 "△ABC: a=3, b=4, C=90°"。向量必须写成粗体加等号，例如 "**b** = (1, 2)"。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['text'],
    },
    status: 'local',
  },
  {
    name: 'page_update_formula',
    description: '改写纸上某个公式的文本。向量必须写成粗体加等号，例如 "**b** = (1, 2)"。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['id', 'text'],
    },
    status: 'local',
  },
  {
    name: 'solve_analyze',
    description: '对一组公式 / 几何条件做推导：解未知量、求交点、解三角形等，返回结构化结果（由 Rust/WASM 计算）。',
    inputSchema: {
      type: 'object',
      properties: {
        texts: { type: 'array', items: { type: 'string' } },
      },
      required: ['texts'],
    },
    status: 'local',
  },
  {
    name: 'plot_open',
    description: '打开这张纸共享的坐标系：纸上所有式子画在同一套坐标轴上并联立推导。传 id 时按该式子决定先看平面还是空间。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    status: 'local',
  },
  {
    name: 'plot_set_view',
    description: '修改坐标系：坐标范围、3D 相机角度、叠加哪些对象。未打开坐标系时会先打开。x/y 为 [min, max]。only 只保留这些公式 id，hide 暂时拿掉，show 放回。fit 为 true 时回到自动框住图形的视野。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { ...numPair, description: 'x 轴范围 [min, max]' },
        y: { ...numPair, description: 'y 轴范围 [min, max]' },
        z: { ...numPair, description: 'z 轴范围 [min, max]（空间）' },
        camera: {
          type: 'object',
          description: '3D 相机。eye / center / up 均为 {x, y, z}',
          properties: {
            eye: { type: 'object' },
            center: { type: 'object' },
            up: { type: 'object' },
          },
        },
        mode: { type: 'number', description: '2 平面，3 空间' },
        only: { type: 'array', items: { type: 'string' }, description: '只叠加这些公式 id' },
        show: { type: 'array', items: { type: 'string' }, description: '把这些公式放回坐标系' },
        hide: { type: 'array', items: { type: 'string' }, description: '把这些公式暂时从坐标系拿掉' },
        fit: { type: 'boolean', description: '回到自动框住所有图形的视野' },
      },
    },
    status: 'local',
  },
  {
    name: 'ink_read',
    description: '读取手写笔迹（点序列）供识别模型使用。since 为 createdAt 毫秒时间戳，只返回该时间之后的笔迹；省略则从最早的开始。pts 为 [x, y, pressure, ...]。',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number', description: '只返回 createdAt 大于该值的笔迹' },
        limit: { type: 'number', description: '最多返回多少条，默认 40，最大 200' },
      },
    },
    status: 'local',
  },
]
