export interface ToolDefinition {
  name: string
  description?: string
  inputSchema: {
    type: "object"
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolCall {
  id: string
  type: "function"
  thoughtSignature?: string
  function: {
    name: string
    arguments: string
  }
}

export type ChatMessage =
  | {
      role: "system" | "user"
      content: string
    }
  | {
      role: "assistant"
      content: string | null
      tool_calls?: ToolCall[]
    }
  | {
      role: "tool"
      content: string
      tool_call_id: string
    }

export interface ChatResponse {
  content: string
  toolCalls: ToolCall[]
}

export interface ChatOptions {
  maxTokens?: number
  tools?: ToolDefinition[]
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>
  flush?(): Promise<void>
}

export type ModelProvider = "openai" | "anthropic" | "gemini"
