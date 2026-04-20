import type { ChatMessage, ToolCall, ToolDefinition } from "../model/provider.ts"

export type { ToolCall, ToolDefinition } from "../model/provider.ts"

export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ResolvedToolCall {
  id: string
  name: string
  input?: Record<string, unknown>
  error?: string
}

export interface ToolResult {
  toolCallId: string
  content: string
}

export function parseToolCalls(toolCalls: ToolCall[]): ResolvedToolCall[] {
  return toolCalls.map((toolCall): ResolvedToolCall => {
    if (toolCall.type !== "function") {
      return {
        id: toolCall.id,
        name: "unknown",
        error: `Unsupported tool call type: ${toolCall.type}`,
      }
    }

    try {
      const parsed = JSON.parse(toolCall.function.arguments) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          id: toolCall.id,
          name: toolCall.function.name,
          error: "Invalid tool arguments: expected a JSON object",
        }
      }

      return {
        id: toolCall.id,
        name: toolCall.function.name,
        input: parsed as Record<string, unknown>,
      }
    } catch {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        error: "Invalid tool arguments: failed to parse JSON",
      }
    }
  })
}

export async function executeToolCalls(
  toolCalls: ResolvedToolCall[],
  executeToolCall: (toolCall: ParsedToolCall) => Promise<string> | string,
): Promise<ToolResult[]> {
  const results: ToolResult[] = []

  for (const toolCall of toolCalls) {
    const content = toolCall.error
      ? `Error: ${toolCall.error}`
      : await executeToolCall({
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input ?? {},
        })

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
