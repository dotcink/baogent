import type { AgentId, Message } from "./types.ts"
import { Mailbox } from "./mailbox.ts"

type PendingRequest = {
  resolve: (msg: Message) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 进程内消息路由器。
 * Agent 之间不直接持有引用，所有通信经由 MessageBus。
 */
export class MessageBus {
  private mailboxes = new Map<AgentId, Mailbox>()
  private pending = new Map<string, PendingRequest>()  // correlationId → PendingRequest

  register(id: AgentId): Mailbox {
    const mailbox = new Mailbox()
    this.mailboxes.set(id, mailbox)
    return mailbox
  }

  unregister(id: AgentId): void {
    const mailbox = this.mailboxes.get(id)
    if (mailbox) {
      mailbox.close()
      this.mailboxes.delete(id)
    }
  }

  send(message: Message): void {
    // 如果是 response，先看是否有等待中的 request
    if (message.type === "response" && message.correlationId) {
      const pending = this.pending.get(message.correlationId)
      if (pending) {
        this.pending.delete(message.correlationId)
        clearTimeout(pending.timer)
        pending.resolve(message)
        return
      }
    }

    if (message.to === "broadcast") {
      for (const [id, mailbox] of this.mailboxes) {
        if (id !== message.from) {
          mailbox.push(message)
        }
      }
    } else {
      const mailbox = this.mailboxes.get(message.to)
      if (mailbox) {
        mailbox.push(message)
      }
    }
  }

  /**
   * 发送 request 并等待匹配的 response，超时则 reject。
   */
  request(message: Message, timeoutMs = 30_000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error(`Request timeout: ${message.id} to ${message.to}`))
      }, timeoutMs)

      this.pending.set(message.id, { resolve, reject, timer })
      this.send(message)
    })
  }
}
