import type { ChatMessage, ChatOptions, ChatResponse, LLMProvider } from "../provider.ts"

export interface OpenAIConfig {
  apiKey: string
  model: string
  baseURL?: string   // 默认 OpenAI，可换火山引擎、本地 Ollama 等任意兼容端点
  maxTokens?: number
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

/** OpenAI Chat Completions 格式，兼容火山引擎、Together、Ollama 等 */
export class OpenAIClient implements LLMProvider {
  private baseURL: string
  private config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
    this.baseURL = config.baseURL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        ...(options?.tools?.length
          ? {
              tools: options.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
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
      choices: Array<{
        message: {
          content: string | null
          tool_calls?: Array<{
            id: string
            type: "function"
            function: {
              name: string
              arguments: string
            }
          }>
        }
      }>
    }

    const message = data.choices[0]?.message

    return {
      content: message?.content ?? "",
      toolCalls: message?.tool_calls ?? [],
    }
  }
}
