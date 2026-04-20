import type { LLMProvider, ChatMessage } from "./model/provider.ts"
import type { Context, ExecutorResult, Message } from "./types.ts"

export interface Executor {
  execute(context: Context, message: Message): Promise<ExecutorResult>
}

export class LLMExecutor implements Executor {
  constructor(private provider: LLMProvider) {}

  async execute(context: Context, message: Message): Promise<ExecutorResult> {
    const messages: ChatMessage[] = [
      ...context.turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: message.content },
    ]

    const content = await this.provider.chat(messages)
    return { content }
  }
}
