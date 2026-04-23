import { bashTool, executeBashTool } from "./bash.ts"
import {
  editFileTool,
  executeEditFileTool,
  executeReadFileTool,
  executeWriteFileTool,
  readFileTool,
  writeFileTool,
} from "./file.ts"
import { TodoManager, todoTool } from "./todo.ts"
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
export { TodoManager, todoTool } from "./todo.ts"
export {
  buildToolResultMessages,
  executeToolCalls,
  normalizeMessages,
  parseToolCalls,
} from "./tool.ts"
export type { ParsedToolCall, ToolCall, ToolDefinition, ToolResult } from "./tool.ts"

type ToolHandler = (toolCall: ParsedToolCall) => string

const STATIC_TOOL_HANDLERS: Record<string, ToolHandler> = {
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
  todoTool,
]

export function createBuiltInToolExecutor(todoManager: TodoManager): (toolCall: ParsedToolCall) => string {
  return (toolCall: ParsedToolCall): string => {
    const handler =
      toolCall.name === todoTool.name
        ? (currentToolCall: ParsedToolCall) => todoManager.executeToolCall(currentToolCall)
        : STATIC_TOOL_HANDLERS[toolCall.name]

    if (!handler) {
      return `Error: Unknown tool: ${toolCall.name}`
    }

    return handler(toolCall)
  }
}

export function isTodoToolCall(toolCall: { name: string }): boolean {
  return toolCall.name === todoTool.name
}

export function executeBuiltInToolCall(toolCall: ParsedToolCall): string {
  const handler = STATIC_TOOL_HANDLERS[toolCall.name]
  if (!handler) {
    return `Error: Unknown tool: ${toolCall.name}`
  }

  return handler(toolCall)
}
