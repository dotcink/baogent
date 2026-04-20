// ── ID ──────────────────────────────────────────────────────────────────────

declare const __agentId: unique symbol
export type AgentId = string & { readonly [__agentId]: true }

export function agentId(id: string): AgentId {
  return id as AgentId
}

export function newAgentId(): AgentId {
  return crypto.randomUUID() as AgentId
}

// ── Message ──────────────────────────────────────────────────────────────────

export type MessageType = "request" | "response" | "notify" | "system"

export interface Message {
  id: string
  type: MessageType
  from: AgentId
  to: AgentId | "broadcast"
  content: string
  correlationId?: string  // 关联某个 request 的 id，用于实现请求-响应
  replyTo?: AgentId       // 期望回复发往的 AgentId
  metadata?: Record<string, unknown>
  timestamp: number
}

// ── Context ──────────────────────────────────────────────────────────────────

export type TurnRole = "user" | "assistant" | "system"

export interface Turn {
  role: TurnRole
  content: string
  timestamp: number
}

export interface Context {
  agentId: AgentId
  turns: Turn[]
  memory: Map<string, unknown>
}

export function newContext(id: AgentId): Context {
  return { agentId: id, turns: [], memory: new Map() }
}

// ── Executor ─────────────────────────────────────────────────────────────────

export interface ExecutorResult {
  content: string
  outgoing?: Array<Omit<Message, "id" | "from" | "timestamp">>
}

// ── Agent ────────────────────────────────────────────────────────────────────

export type ExecutionMode = "llm" | "human" | "hybrid"

export interface AgentConfig {
  id?: AgentId
  name: string
  systemPrompt?: string
  executionMode?: ExecutionMode
}

export interface AgentHandle {
  readonly id: AgentId
  readonly name: string
  send(message: Omit<Message, "id" | "from" | "timestamp">): void
}
