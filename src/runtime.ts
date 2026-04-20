import type { AgentConfig, AgentHandle, AgentId, Message } from "./types.ts"
import { agentId } from "./types.ts"
import { MessageBus } from "./bus.ts"
import { Agent } from "./agent.ts"
import { LLMExecutor } from "./executor.ts"
import type { LLMProvider } from "./model/provider.ts"

export interface RuntimeConfig {
  /** 默认 LLM Provider，createAgent 时若未指定则使用此 Provider */
  provider: LLMProvider
}

export class Runtime {
  private bus = new MessageBus()
  private agents = new Map<AgentId, Agent>()
  private loops: Promise<void>[] = []
  private defaultProvider: LLMProvider

  /** 系统自身的 AgentId，用于发起请求 */
  readonly systemId: AgentId = agentId("__system__")

  constructor(config: RuntimeConfig) {
    this.defaultProvider = config.provider
    // 注册系统邮箱（用于接收 response）
    this.bus.register(this.systemId)
  }

  /**
   * 创建并启动一个 Agent，返回其 Handle。
   */
  createAgent(config: AgentConfig & { provider?: LLMProvider }): AgentHandle {
    const provider = config.provider ?? this.defaultProvider
    const executor = new LLMExecutor(provider)
    const agent = new Agent(config, executor, this.bus)
    this.agents.set(agent.id, agent)

    // 启动 Agent 消费循环（不 await，让它在后台跑）
    this.loops.push(agent.run())

    return agent.handle()
  }

  /**
   * 向目标 Agent 发送 request，等待 response，超时则 reject。
   */
  async request(
    to: AgentId,
    content: string,
    options: { timeoutMs?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<string> {
    const message: Message = {
      id: crypto.randomUUID(),
      type: "request",
      from: this.systemId,
      to,
      content,
      replyTo: this.systemId,
      ...(options.metadata ? { metadata: options.metadata } : {}),
      timestamp: Date.now(),
    }

    const response = await this.bus.request(message, options.timeoutMs)
    return response.content
  }

  /**
   * 等待所有 Agent 运行循环（通常不会返回，除非所有 Agent 都停止）。
   */
  async waitAll(): Promise<void> {
    await Promise.all(this.loops)
  }

  stop(): void {
    for (const agent of this.agents.values()) {
      agent.stop()
    }
    this.agents.clear()
  }
}
