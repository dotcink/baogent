import { Langfuse } from "langfuse"
import type { LangfuseTraceClient } from "langfuse-core"
import type {
  ChatMessage,
  ChatResponse,
  LLMProvider,
  ToolDefinition,
} from "./provider.ts"

export interface LangfuseLLMProviderOptions {
  model: string
  publicKey: string
  secretKey: string
  baseUrl?: string
  sessionId?: string
  userId?: string
  traceName?: string
  environment?: string
}

export class LangfuseLLMProvider implements LLMProvider {
  private readonly inner: LLMProvider
  private readonly client: Langfuse
  private readonly model: string
  private readonly trace: LangfuseTraceClient

  constructor(inner: LLMProvider, options: LangfuseLLMProviderOptions) {
    this.inner = inner
    this.model = options.model
    this.client = new Langfuse({
      publicKey: options.publicKey,
      secretKey: options.secretKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    })
    this.client.on("error", (err) => console.error("[langfuse]", err))
    this.trace = this.client.trace({
      name: options.traceName ?? "agent-session",
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    })
  }

  async chat(
    messages: ChatMessage[],
    options?: { maxTokens?: number; tools?: ToolDefinition[] },
  ): Promise<ChatResponse> {
    const startTime = new Date()
    const generation = this.trace.generation({
      name: "llm-generation",
      model: this.model,
      input: messages,
      startTime,
    })

    try {
      const response = await this.inner.chat(messages, options)
      generation.end({
        output:
          response.toolCalls.length > 0
            ? { content: response.content, toolCalls: response.toolCalls }
            : response.content,
      })
      return response
    } catch (error) {
      generation.end({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async flush(): Promise<void> {
    await this.client.flushAsync()
  }
}
