import { joinTextParts, parseJSONObject, splitSystemMessages } from "./utils/index.ts"
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
  ToolCall,
} from "./provider.ts"

export interface GeminiConfig {
  apiKey: string
  model: string
  baseURL?: string
  maxTokens?: number
}

interface GeminiTextPart {
  text: string
}

interface GeminiFunctionCallPart {
  functionCall: {
    id?: string
    name: string
    args: Record<string, unknown>
  }
  // Gemini 文档里的 JSON / JS 示例都使用 `thoughtSignature`，并要求按收到的内容原样回传。
  thoughtSignature?: string
}

interface GeminiFunctionResponsePart {
  functionResponse: {
    id?: string
    name: string
    response: {
      result: string
    }
  }
}

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart

interface GeminiContent {
  role: "user" | "model"
  parts: GeminiPart[]
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

function toGeminiContents(messages: ChatMessage[]): {
  systemPrompt?: string
  contents: GeminiContent[]
} {
  const { systemPrompt, messages: rest } = splitSystemMessages(messages)
  const toolNames = new Map<string, string>()
  const contents: GeminiContent[] = []

  for (const message of rest) {
    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content }],
      })
      continue
    }

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: message.tool_call_id,
              name: toolNames.get(message.tool_call_id) ?? "unknown_tool",
              response: {
                result: message.content,
              },
            },
          },
        ],
      })
      continue
    }

    if (message.role !== "assistant") {
      throw new Error(`Unsupported message role for Gemini: ${message.role}`)
    }

    const parts: GeminiPart[] = []

    if (message.content) {
      parts.push({ text: message.content })
    }

    for (const toolCall of message.tool_calls ?? []) {
      toolNames.set(toolCall.id, toolCall.function.name)
      parts.push({
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: parseJSONObject(toolCall.function.arguments),
        },
        ...(toolCall.thoughtSignature
          ? {
              thoughtSignature: toolCall.thoughtSignature,
            }
          : {}),
      })
    }

    if (parts.length === 0) {
      continue
    }

    contents.push({
      role: "model",
      parts,
    })
  }

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    contents,
  }
}

function fromGeminiResponse(parts: GeminiPart[]): ChatResponse {
  const textParts: string[] = []
  const toolCalls: ToolCall[] = []

  for (const part of parts) {
    if ("text" in part) {
      textParts.push(part.text)
      continue
    }

    if ("functionCall" in part) {
      const thoughtSignature =
        typeof part.thoughtSignature === "string" ? part.thoughtSignature : undefined

      toolCalls.push({
        id: part.functionCall.id ?? crypto.randomUUID(),
        type: "function",
        ...(thoughtSignature ? { thoughtSignature } : {}),
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      })
    }
  }

  return {
    content: joinTextParts(textParts),
    toolCalls,
  }
}

export class GeminiClient implements LLMProvider {
  private readonly baseURL: string
  private readonly config: GeminiConfig

  constructor(config: GeminiConfig) {
    this.config = config
    this.baseURL = config.baseURL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const payload = toGeminiContents(messages)
    const endpoint = `${this.baseURL}/models/${this.config.model}:generateContent`

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.config.apiKey,
      },
      body: JSON.stringify({
        contents: payload.contents,
        ...(payload.systemPrompt
          ? {
              system_instruction: {
                parts: [{ text: payload.systemPrompt }],
              },
            }
          : {}),
        ...(options?.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: options.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 8192,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: GeminiPart[]
        }
      }>
    }

    return fromGeminiResponse(data.candidates?.[0]?.content?.parts ?? [])
  }
}
