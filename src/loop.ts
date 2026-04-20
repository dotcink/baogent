import type { OpenAIClient, RawChoice } from "./model/openai.ts"
import type { ToolDefinition } from "./model/tool.ts"

// ── 消息类型 ──────────────────────────────────────────────────────────────────

export type AgentMessage =
  | { role: "system";    content: string }
  | { role: "user";      content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool";      tool_call_id: string; content: string }

interface RawToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<string>

// ── Loop State ────────────────────────────────────────────────────────────────

interface LoopState {
  messages: AgentMessage[]
  turnCount: number
  transitionReason: "tool_result" | null
}

// ── AgentLoop ─────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  client: OpenAIClient
  tools?: ToolDefinition[]
  callTool: CallTool
  maxIterations?: number
  systemPrompt?: string
}

export interface LoopResult {
  content: string
  messages: AgentMessage[]
  turns: number
}

export class AgentLoop {
  private client: OpenAIClient
  private tools: ToolDefinition[]
  private callTool: CallTool
  private maxIterations: number
  private messages: AgentMessage[]

  constructor(opts: AgentLoopOptions) {
    this.client = opts.client
    this.tools = opts.tools ?? []
    this.callTool = opts.callTool
    this.maxIterations = opts.maxIterations ?? 20
    this.messages = opts.systemPrompt
      ? [{ role: "system", content: opts.systemPrompt }]
      : []
  }

  /** 追加用户消息并运行 loop，返回最终文本。历史自动保留供下次调用。 */
  async loop(userMessage: string): Promise<LoopResult> {
    this.messages.push({ role: "user", content: userMessage })

    const state: LoopState = {
      messages: this.messages,
      turnCount: 1,
      transitionReason: null,
    }

    for (let i = 0; i < this.maxIterations; i++) {
      const shouldContinue = await this.runOneTurn(state)
      if (!shouldContinue) break
    }

    const content = this.extractText()
    return { content, messages: [...this.messages], turns: state.turnCount }
  }

  private async runOneTurn(state: LoopState): Promise<boolean> {
    const choice = await this.client.complete(state.messages, { tools: this.tools })
    const { finish_reason, message } = choice

    state.messages.push({
      role: "assistant",
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    })

    if (finish_reason !== "tool_calls" || !message.tool_calls?.length) {
      state.transitionReason = null
      return false
    }

    for (const r of await this.executeToolCalls(choice)) {
      state.messages.push({ role: "tool", tool_call_id: r.id, content: r.output })
    }

    state.turnCount++
    state.transitionReason = "tool_result"
    return true
  }

  private async executeToolCalls(
    choice: RawChoice
  ): Promise<Array<{ id: string; output: string }>> {
    const results = []
    for (const tc of choice.message.tool_calls ?? []) {
      let output: string
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
        output = await this.callTool(tc.function.name, args)
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`
      }
      results.push({ id: tc.id, output })
    }
    return results
  }

  private extractText(): string {
    const last = this.messages.at(-1)
    if (!last || last.role !== "assistant") return ""
    return typeof last.content === "string" ? last.content : ""
  }
}
