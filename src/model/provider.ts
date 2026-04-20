export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<string>
}
