import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type {
  ChatMessage,
  ChatResponse,
  LLMProvider,
  ModelProvider,
  ToolCall,
  ToolDefinition,
} from "./provider.ts"

export interface LoggingLLMProviderOptions {
  path: string
  provider: ModelProvider
  model: string
}

interface SerializedMessage {
  role: ChatMessage["role"]
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
}

function serializeMessages(messages: ChatMessage[]): SerializedMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: message.content,
        ...(message.tool_calls?.length ? { toolCalls: message.tool_calls } : {}),
      }
    }

    if (message.role === "tool") {
      return {
        role: message.role,
        content: message.content,
        toolCallId: message.tool_call_id,
      }
    }

    return {
      role: message.role,
      content: message.content,
    }
  })
}

async function appendJSONLine(path: string, record: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}

/** 把模型输入输出的核心内容按 JSONL 追加到日志文件。 */
export class LoggingLLMProvider implements LLMProvider {
  private readonly inner: LLMProvider
  private readonly options: LoggingLLMProviderOptions

  constructor(inner: LLMProvider, options: LoggingLLMProviderOptions) {
    this.inner = inner
    this.options = options
  }

  async chat(
    messages: ChatMessage[],
    options?: { maxTokens?: number; tools?: ToolDefinition[] },
  ): Promise<ChatResponse> {
    const requestId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const request = {
      requestId,
      startedAt,
      provider: this.options.provider,
      model: this.options.model,
      input: {
        messages: serializeMessages(messages),
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options?.tools?.length ? { tools: options.tools.map((tool) => tool.name) } : {}),
      },
    }

    try {
      const response = await this.inner.chat(messages, options)
      await appendJSONLine(this.options.path, {
        ...request,
        finishedAt: new Date().toISOString(),
        output: {
          content: response.content,
          toolCalls: response.toolCalls,
        },
      })
      return response
    } catch (error) {
      await appendJSONLine(this.options.path, {
        ...request,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
