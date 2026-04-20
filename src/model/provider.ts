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

export interface LLMProvider {
  chat(
    messages: ChatMessage[],
    options?: { maxTokens?: number; tools?: ToolDefinition[] },
  ): Promise<ChatResponse>
}
