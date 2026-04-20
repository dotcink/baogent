import type { ChatMessage, LLMProvider } from "./provider.ts"
import type { ToolDefinition } from "./tool.ts"

export interface OpenAIConfig {
  apiKey: string
  model: string
  baseURL?: string   // 默认 OpenAI，可换火山引擎、本地 Ollama 等任意兼容端点
  maxTokens?: number
}

// OpenAI /chat/completions 原始响应结构
export interface RawChoice {
  finish_reason: string
  message: {
    role: "assistant"
    content: string | null
    tool_calls?: Array<{
      id: string
      type: "function"
      function: { name: string; arguments: string }
    }>
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1"

/** OpenAI Chat Completions 格式，兼容火山引擎、Together、Ollama 等 */
export class OpenAIClient implements LLMProvider {
  private baseURL: string
  readonly config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
    this.baseURL = config.baseURL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL
  }

  /** 基础对话，返回文本 */
  async chat(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<string> {
    const choice = await this.complete(messages, options?.maxTokens ? { maxTokens: options.maxTokens } : {})
    return choice.message.content ?? ""
  }

  /** 底层调用，返回完整 choice（含 tool_calls、finish_reason） */
  async complete(
    messages: unknown[],
    options: { maxTokens?: number; tools?: ToolDefinition[] } = {}
  ): Promise<RawChoice> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
    }

    if (options.tools && options.tools.length > 0) {
      body["tools"] = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as { choices: RawChoice[] }
    const choice = data.choices[0]
    if (!choice) throw new Error("LLM API returned empty choices")
    return choice
  }
}
