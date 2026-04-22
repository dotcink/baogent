import type { ChatMessage, ToolCall, ToolDefinition } from "../../model/provider.ts"

export type { ToolCall, ToolDefinition } from "../../model/provider.ts"

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

function mergeTextContent(left: string | null, right: string | null): string | null {
  const parts = [left, right].filter((value): value is string => Boolean(value && value.length))
  if (parts.length === 0) {
    return null
  }

  return parts.join("\n\n")
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

/**
 * 在消息发给模型前，先把历史归一化。
 *
 * 这里主要做三件事：
 * - 合并连续的 `system` 或 `user` 消息
 * - 合并连续的纯文本 assistant 消息，但前提是两边都不带 tool calls
 * - 如果 assistant 发起了 tool call，却没有对应的 tool result，就补一个占位结果
 *
 * 目标是把发给 provider 的消息历史整理成稳定形状，同时不改变 agent loop 原本的回合语义。
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  const existingResults = new Set(
    messages
      .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
      .map((message) => message.tool_call_id),
  )

  const normalized: ChatMessage[] = []

  for (const message of messages) {
    const previous = normalized[normalized.length - 1]
    const isMergeableUserOrSystem =
      previous &&
      (message.role === "user" || message.role === "system") &&
      previous.role === message.role

    if (isMergeableUserOrSystem) {
      previous.content = `${previous.content}\n\n${message.content}`
      continue
    }

    const isMergeableAssistant =
      previous &&
      previous.role === "assistant" &&
      message.role === "assistant" &&
      previous.tool_calls === undefined &&
      message.tool_calls === undefined

    if (isMergeableAssistant) {
      previous.content = mergeTextContent(previous.content, message.content)
      continue
    }

    normalized.push({ ...message })

    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue
    }

    for (const toolCall of message.tool_calls) {
      if (existingResults.has(toolCall.id)) {
        continue
      }

      normalized.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: "(cancelled)",
      })
    }
  }

  return normalized
}
