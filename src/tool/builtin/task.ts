import { AgentLoop } from "../../agent/loop.ts"
import type { LLMProvider } from "../../model/provider.ts"
import { TodoManager } from "./todo.ts"
import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

export interface TaskToolInput {
  prompt: string
  description?: string
}

export interface TaskToolHandlerOptions {
  model: LLMProvider
  defaultSystemPrompt: string
  generationName?: string
  subagentToolNames: readonly string[]
  getToolsByNames: (toolNames: readonly string[]) => ToolDefinition[]
  createToolExecutor: (
    toolNames: readonly string[],
    options: { todoManager: TodoManager },
  ) => (toolCall: ParsedToolCall) => Promise<string> | string
}

export const taskTool: ToolDefinition = {
  name: "task",
  description: "Spawn a subagent with fresh context. It shares the workspace but not the conversation history.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      description: {
        type: "string",
        description: "Short description of the delegated task.",
      },
    },
    required: ["prompt"],
  },
}

export function parseTaskToolInput(toolCall: ParsedToolCall): TaskToolInput | string {
  if (toolCall.name !== taskTool.name) {
    return `Error: Unsupported tool \`${toolCall.name}\``
  }

  const prompt = typeof toolCall.input.prompt === "string" ? toolCall.input.prompt.trim() : ""
  const description =
    typeof toolCall.input.description === "string" ? toolCall.input.description.trim() : undefined

  if (!prompt) {
    return "Error: Missing required string field `prompt`"
  }

  return {
    prompt,
    ...(description ? { description } : {}),
  }
}

export function createTaskToolHandler(
  options: TaskToolHandlerOptions,
): (toolCall: ParsedToolCall) => Promise<string> | string {
  return async (toolCall: ParsedToolCall): Promise<string> => {
    const input = parseTaskToolInput(toolCall)
    if (typeof input === "string") {
      return input
    }

    const todoManager = new TodoManager()
    const loop = new AgentLoop(options.model, {
      systemPrompt: options.defaultSystemPrompt,
      ...(options.generationName ? { generationName: options.generationName } : {}),
      tools: options.getToolsByNames(options.subagentToolNames),
      todoManager,
      executeToolCall: options.createToolExecutor(options.subagentToolNames, { todoManager }),
      messages: [{ role: "user", content: input.prompt }],
    })

    return await loop.run()
  }
}
