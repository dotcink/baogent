import type { AgentConfig, AgentHandle, AgentId, Message } from "./types.ts"
import { newAgentId, newContext } from "./types.ts"
import type { Executor } from "./executor.ts"
import type { MessageBus } from "./bus.ts"
import type { Mailbox } from "./mailbox.ts"

export class Agent {
  readonly id: AgentId
  readonly name: string

  private config: AgentConfig
  private executor: Executor
  private bus: MessageBus
  private mailbox: Mailbox

  constructor(config: AgentConfig, executor: Executor, bus: MessageBus) {
    this.id = config.id ?? newAgentId()
    this.name = config.name
    this.config = config
    this.executor = executor
    this.bus = bus
    this.mailbox = bus.register(this.id)
  }

  /** 对外唯一的通信接口 */
  send(partial: Omit<Message, "id" | "from" | "timestamp">): void {
    const message: Message = {
      ...partial,
      id: crypto.randomUUID(),
      from: this.id,
      timestamp: Date.now(),
    }
    this.bus.send(message)
  }

  /** 启动消息消费循环（异步，持续运行） */
  async run(): Promise<void> {
    const context = newContext(this.id)

    // 注入 system prompt
    if (this.config.systemPrompt) {
      context.turns.push({
        role: "system",
        content: this.config.systemPrompt,
        timestamp: Date.now(),
      })
    }

    for await (const envelope of this.mailbox) {
      const { message } = envelope

      try {
        const result = await this.executor.execute(context, message)

        // 将本轮对话追加到上下文
        context.turns.push({
          role: "user",
          content: message.content,
          timestamp: message.timestamp,
        })
        context.turns.push({
          role: "assistant",
          content: result.content,
          timestamp: Date.now(),
        })

        // 如果来源消息是 request 类型，自动发回 response
        if (message.type === "request") {
          const replyTo = message.replyTo ?? message.from
          this.send({
            type: "response",
            to: replyTo,
            content: result.content,
            correlationId: message.id,
          })
        }

        // 发送执行器额外指定的消息
        for (const outgoing of result.outgoing ?? []) {
          this.send(outgoing)
        }
      } catch (err) {
        console.error(`[Agent:${this.name}] error processing message:`, err)
        // 如果是 request，需要发回错误 response，否则调用方会一直等到超时
        if (message.type === "request") {
          const replyTo = message.replyTo ?? message.from
          this.send({
            type: "response",
            to: replyTo,
            content: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            correlationId: message.id,
          })
        }
      }
    }
  }

  stop(): void {
    this.bus.unregister(this.id)
  }

  handle(): AgentHandle {
    return {
      id: this.id,
      name: this.name,
      send: (partial) => this.send(partial),
    }
  }
}
