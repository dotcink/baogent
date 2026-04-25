import type { LLMProvider } from "../../model/provider.ts"
import { bashTool, executeBashTool } from "./bash.ts"
import {
  editFileTool,
  executeEditFileTool,
  executeReadFileTool,
  executeWriteFileTool,
  readFileTool,
  writeFileTool,
} from "./file.ts"
import { createTaskToolHandler, taskTool } from "./task.ts"
import { TodoManager, isTodoToolCall, todoTool } from "./todo.ts"
import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

export { bashTool, executeBashTool } from "./bash.ts"
export {
  editFileTool,
  executeEditFileTool,
  executeReadFileTool,
  executeWriteFileTool,
  readFileTool,
  writeFileTool,
} from "./file.ts"
export { createTaskToolHandler, parseTaskToolInput, taskTool } from "./task.ts"
export type { TaskToolHandlerOptions, TaskToolInput } from "./task.ts"
export { TodoManager, isTodoToolCall, todoTool } from "./todo.ts"
export {
  buildToolResultMessages,
  executeToolCalls,
  normalizeMessages,
  parseToolCalls,
} from "../tool.ts"
export type { ParsedToolCall, ToolCall, ToolDefinition, ToolResult } from "../tool.ts"

export type ToolHandler = (toolCall: ParsedToolCall) => Promise<string> | string

interface ToolExecutorOptions {
  todoManager: TodoManager
  subagent?: {
    model: LLMProvider
    defaultSystemPrompt: string
    generationName?: string
  }
}

type ToolHandlerFactory = (options: ToolExecutorOptions) => ToolHandler | null

interface RegisteredTool {
  definition: ToolDefinition
  createHandler: ToolHandlerFactory
}

export const TOOL_REGISTRY: Record<string, RegisteredTool> = {
  [bashTool.name]: {
    definition: bashTool,
    createHandler: () => executeBashTool,
  },
  [readFileTool.name]: {
    definition: readFileTool,
    createHandler: () => executeReadFileTool,
  },
  [writeFileTool.name]: {
    definition: writeFileTool,
    createHandler: () => executeWriteFileTool,
  },
  [editFileTool.name]: {
    definition: editFileTool,
    createHandler: () => executeEditFileTool,
  },
  [todoTool.name]: {
    definition: todoTool,
    createHandler: (options) => (toolCall) => options.todoManager.executeToolCall(toolCall),
  },
  [taskTool.name]: {
    definition: taskTool,
    createHandler: (options) =>
      options.subagent
        ? createTaskToolHandler({
            model: options.subagent.model,
            defaultSystemPrompt: options.subagent.defaultSystemPrompt,
            subagentToolNames: filterToolNamesByBlacklist(parentToolNames, [taskTool.name, todoTool.name]),
            getToolsByNames,
            createToolExecutor: (toolNames, executorOptions) =>
              createToolExecutor(toolNames, executorOptions),
            ...(options.subagent.generationName
              ? { generationName: options.subagent.generationName }
              : {}),
          })
        : null,
  },
}

export const builtInToolNames = [
  bashTool.name,
  readFileTool.name,
  writeFileTool.name,
  editFileTool.name,
  todoTool.name,
] as const

export const parentToolNames = [...builtInToolNames, taskTool.name] as const

export function getToolsByNames(toolNames: readonly string[]): ToolDefinition[] {
  return toolNames.flatMap((name) => {
    const tool = TOOL_REGISTRY[name]
    return tool ? [tool.definition] : []
  })
}

export function filterToolNamesByBlacklist(
  toolNames: readonly string[],
  disallowedToolNames: readonly string[],
): string[] {
  const blacklist = new Set(disallowedToolNames)
  return toolNames.filter((name) => !blacklist.has(name))
}

export function createToolExecutor(
  toolNames: readonly string[],
  options: ToolExecutorOptions,
): (toolCall: ParsedToolCall) => Promise<string> | string {
  const handlers = new Map<string, ToolHandler>()

  for (const name of toolNames) {
    const tool = TOOL_REGISTRY[name]
    if (!tool) {
      continue
    }

    const handler = tool.createHandler(options)
    if (handler) {
      handlers.set(name, handler)
    }
  }

  return (toolCall: ParsedToolCall): Promise<string> | string => {
    const handler = handlers.get(toolCall.name)
    if (!handler) {
      return `Error: Unknown tool: ${toolCall.name}`
    }

    return handler(toolCall)
  }
}
