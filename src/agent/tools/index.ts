import { bashTool, executeBashTool } from "./bash.ts"
import {
  editFileTool,
  executeEditFileTool,
  executeReadFileTool,
  executeWriteFileTool,
  readFileTool,
  writeFileTool,
} from "./file.ts"
import type { ParsedToolCall, ToolDefinition } from "./tool.ts"

export { bashTool, executeBashTool } from "./bash.ts"
export {
  editFileTool,
  executeEditFileTool,
  executeReadFileTool,
  executeWriteFileTool,
  readFileTool,
  writeFileTool,
} from "./file.ts"
export {
  buildToolResultMessages,
  executeToolCalls,
  normalizeMessages,
  parseToolCalls,
} from "./tool.ts"
export type { ParsedToolCall, ToolCall, ToolDefinition, ToolResult } from "./tool.ts"

type ToolHandler = (toolCall: ParsedToolCall) => string

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  [bashTool.name]: executeBashTool,
  [readFileTool.name]: executeReadFileTool,
  [writeFileTool.name]: executeWriteFileTool,
  [editFileTool.name]: executeEditFileTool,
}

export const builtInTools: ToolDefinition[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
]

export function executeBuiltInToolCall(toolCall: ParsedToolCall): string {
  const handler = TOOL_HANDLERS[toolCall.name]
  if (!handler) {
    return `Error: Unknown tool: ${toolCall.name}`
  }

  return handler(toolCall)
}
