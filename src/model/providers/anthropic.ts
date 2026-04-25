import { joinTextParts, parseJSONObject, splitSystemMessages } from "../utils/index.ts"
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
  ToolCall,
} from "../provider.ts"

export interface AnthropicConfig {
  apiKey: string
  model: string
  baseURL?: string
  maxTokens?: number
}

interface AnthropicTextBlock {
  type: "text"
  text: string
}

interface AnthropicToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

interface AnthropicToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicContentBlock[]
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01"

function toAnthropicMessages(messages: ChatMessage[]): {
  systemPrompt?: string
  messages: AnthropicMessage[]
} {
  const { systemPrompt, messages: rest } = splitSystemMessages(messages)
  const converted: AnthropicMessage[] = []

  for (const message of rest) {
    if (message.role === "user") {
      converted.push({
        role: "user",
        content: [{ type: "text", text: message.content }],
      })
      continue
    }

    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: message.content,
          },
        ],
      })
      continue
    }

    if (message.role !== "assistant") {
      throw new Error(`Unsupported message role for Anthropic: ${message.role}`)
    }

    const content: AnthropicContentBlock[] = []

    if (message.content) {
      content.push({ type: "text", text: message.content })
    }

    for (const toolCall of message.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseJSONObject(toolCall.function.arguments),
      })
    }

    if (content.length === 0) {
      continue
    }

    converted.push({
      role: "assistant",
      content,
    })
  }

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: converted,
  }
}

function fromAnthropicResponse(content: AnthropicContentBlock[]): ChatResponse {
  const textParts: string[] = []
  const toolCalls: ToolCall[] = []

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text)
      continue
    }

    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      })
    }
  }

  return {
    content: joinTextParts(textParts),
    toolCalls,
  }
}

export class AnthropicClient implements LLMProvider {
  private readonly baseURL: string
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
    this.baseURL = config.baseURL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const payload = toAnthropicMessages(messages)
    const res = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: payload.messages,
        ...(payload.systemPrompt ? { system: payload.systemPrompt } : {}),
        ...(options?.tools?.length
          ? {
              tools: options.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              })),
            }
          : {}),
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      content?: AnthropicContentBlock[]
    }

    return fromAnthropicResponse(data.content ?? [])
  }
}
