export type {
  ChatOptions,
  ChatMessage,
  ChatResponse,
  LLMProvider,
  ModelProvider,
  ToolCall,
  ToolDefinition,
} from "./provider.ts"

// OpenAI Chat Completions 格式（兼容火山引擎、Together、Ollama 等）
export { OpenAIClient } from "./openai.ts"
export type { OpenAIConfig } from "./openai.ts"

// 其他主流协议
export { AnthropicClient } from "./anthropic.ts"
export type { AnthropicConfig } from "./anthropic.ts"
export { GeminiClient } from "./gemini.ts"
export type { GeminiConfig } from "./gemini.ts"
export { LoggingLLMProvider } from "./logging.ts"
export type { LoggingLLMProviderOptions } from "./logging.ts"
export { LangfuseLLMProvider } from "./langfuse.ts"
export type { LangfuseLLMProviderOptions } from "./langfuse.ts"
export { parseJSONObject, joinTextParts, splitSystemMessages } from "./utils/index.ts"
export type { SplitMessagesResult } from "./utils/index.ts"

import { AnthropicClient, type AnthropicConfig } from "./anthropic.ts"
import { GeminiClient, type GeminiConfig } from "./gemini.ts"
import { OpenAIClient, type OpenAIConfig } from "./openai.ts"
import type { LLMProvider } from "./provider.ts"

export type ProviderClientConfig =
  | ({ provider: "openai" } & OpenAIConfig)
  | ({ provider: "anthropic" } & AnthropicConfig)
  | ({ provider: "gemini" } & GeminiConfig)

export function createLLMProvider(config: ProviderClientConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicClient(config)
    case "gemini":
      return new GeminiClient(config)
    case "openai":
      return new OpenAIClient(config)
  }
}
