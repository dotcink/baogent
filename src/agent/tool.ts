import type { ChatMessage, ToolCall, ToolDefinition } from "../model/provider.ts"

export type { ToolCall, ToolDefinition } from "../model/provider.ts"

export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string
}

export function parseToolCalls(toolCalls: ToolCall[]): ParsedToolCall[] {
  return toolCalls.flatMap((toolCall) => {
    if (toolCall.type !== "function") {
      return []
    }

    try {
      const parsed = JSON.parse(toolCall.function.arguments) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return []
      }

      return [
        {
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsed as Record<string, unknown>,
        },
      ]
    } catch {
      return []
    }
  })
}

export async function executeToolCalls(
  toolCalls: ParsedToolCall[],
  executeToolCall: (toolCall: ParsedToolCall) => Promise<string> | string,
): Promise<ToolResult[]> {
  const results: ToolResult[] = []

  for (const toolCall of toolCalls) {
    const content = await executeToolCall(toolCall)
    results.push({
      toolCallId: toolCall.id,
      content,
    })
  }

  return results
}

export function buildToolResultMessages(results: ToolResult[]): ChatMessage[] {
  return results.map((result) => ({
    role: "tool",
    tool_call_id: result.toolCallId,
    content: result.content,
  }))
}
