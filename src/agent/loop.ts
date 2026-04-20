import type { ChatMessage, LLMProvider } from "../model/provider.ts"
import {
  buildToolResultMessages,
  executeToolCalls,
  parseToolCalls,
} from "./tool.ts"
import type { ParsedToolCall, ToolDefinition } from "./tool.ts"

export interface AgentLoopOptions {
  systemPrompt?: string
  tools?: ToolDefinition[]
  maxTokens?: number
  executeToolCall: (toolCall: ParsedToolCall) => Promise<string> | string
  messages?: ChatMessage[]
}

export interface AgentLoopState {
  messages: ChatMessage[]
  turnCount: number
  transitionReason: string | null
}

export class AgentLoop {
  private readonly model: LLMProvider
  private readonly options: AgentLoopOptions
  private readonly messages: ChatMessage[]
  private turnCount = 1
  private transitionReason: string | null = null

  constructor(model: LLMProvider, options: AgentLoopOptions) {
    this.model = model
    this.options = options
    this.messages = [...(options.messages ?? [])]
  }

  get state(): AgentLoopState {
    return {
      messages: [...this.messages],
      turnCount: this.turnCount,
      transitionReason: this.transitionReason,
    }
  }

  addUserMessage(content: string): void {
    this.messages.push({
      role: "user",
      content,
    })
  }

  async runOneTurn(): Promise<string | null> {
    const systemMessages = this.options.systemPrompt
      ? ([{ role: "system", content: this.options.systemPrompt }] satisfies ChatMessage[])
      : []

    const response = await this.model.chat(
      [
        ...systemMessages,
        ...this.messages,
      ],
      {
        ...(this.options.maxTokens ? { maxTokens: this.options.maxTokens } : {}),
        ...(this.options.tools ? { tools: this.options.tools } : {}),
      },
    )

    this.messages.push({
      role: "assistant",
      content: response.content || null,
      ...(response.toolCalls.length ? { tool_calls: response.toolCalls } : {}),
    })

    if (response.toolCalls.length === 0) {
      this.transitionReason = null
      return response.content
    }

    const toolCalls = parseToolCalls(response.toolCalls)
    const results = await executeToolCalls(toolCalls, this.options.executeToolCall)
    this.messages.push(...buildToolResultMessages(results))
    this.turnCount += 1
    this.transitionReason = "tool_result"
    return null
  }

  async run(): Promise<string> {
    while (true) {
      const output = await this.runOneTurn()
      if (output !== null) {
        return output
      }
    }
  }
}
