import type { Message } from "./types.ts"

export interface Envelope {
  message: Message
  receivedAt: number
}

/**
 * 每个 Agent 的消息队列。
 * 消息到达时若 Agent 正在等待则立即 resolve，否则入队。
 */
export class Mailbox implements AsyncIterable<Envelope> {
  private queue: Envelope[] = []
  private waiting: ((env: Envelope) => void) | null = null
  private closed = false

  push(message: Message): void {
    if (this.closed) return
    const envelope: Envelope = { message, receivedAt: Date.now() }
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve(envelope)
    } else {
      this.queue.push(envelope)
    }
  }

  close(): void {
    this.closed = true
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Envelope> {
    while (!this.closed) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
      } else {
        yield await new Promise<Envelope>((resolve) => {
          this.waiting = resolve
        })
      }
    }
  }
}
