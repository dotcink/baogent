# Baogent 设计文档

> 最后更新：2026-04-20

## 定位

通用多 Agent AI 框架，模拟人类协作方式。同时支持：
- 个人开发工具（本地运行）
- 嵌入其他产品的 SDK
- 实验性多 Agent 研究平台

---

## 需求细节

### Agent 能力

- 每个 Agent 能力对等，无层级关系
- 有自己的上下文和记忆，状态可持久化
- 对外只有一个通信接口（`send(message)`）

### 执行模式

支持三种模式，运行时可切换：

| 模式 | 说明 |
|------|------|
| `llm` | LLM 自动执行 |
| `human` | 人工介入，三种子模式：审批关卡 / 完全接管 / 旁观+随时打断 |
| `hybrid` | 混合，按场景切换 |

Agent 携带 Skills 和 MCP tools 等工具，LLM 通过 tool-use 循环调用。

### 任务模型

- **单主任务**：单个 Agent 内串行处理，不并行执行多个主任务
- **并行靠新 Agent**：需要并行时创建新 Agent 实现
- **决策子任务**：允许小且快的子任务，不占主任务槽

### 事件与打断

收到外部消息时，Agent 可选择：

| 决策 | 行为 |
|------|------|
| `ignore` | 丢弃消息 |
| `queue` | 当前任务完成后再处理 |
| `switch` | 中止当前任务，立即处理新消息 |

打断策略支持内部配置，也支持运行时外部注入（`agent.setInterruptStrategy()`）。

### 通信

- Agent 间不直接调用，通过消息通信（Actor 模型）
- 支持两种语义：
  - **fire-and-forget**（`notify` 类型）：发出不等回复
  - **请求-响应**（`request`/`response` 类型）：携带 `correlationId`，等待回复，支持超时
- `runtime.request(agentId, message, timeout?)` 封装请求-响应，对调用方透明

### 记忆分层

| 层级 | 范围 | 格式 |
|------|------|------|
| Agent 私有记忆 | 跨任务持久化，每个 Agent 独立 | JSON |
| 对话历史 | append-only 流水账 | JSONL |
| 全局共享记忆 | 所有 Agent 可读写的知识库 | JSON |

### 持久化

文件系统落盘，无数据库依赖：
- JSON：结构化状态（Agent 配置、记忆 KV、全局共享）
- JSONL：流水账（对话历史、事件日志）

Runtime 统一管理检查点，每次消息处理后落盘，启动时恢复。

### 多 Agent 协作

支持多轮对抗式 review-refine 循环：
- Author 产出内容 → Reviewer 评审 → Author 修改 → 循环
- 以 `APPROVED` 开头表示通过，否则给出具体反馈
- 支持配置最大轮次

### 入口层

三种入口共享同一套核心逻辑：

| 入口 | 用途 |
|------|------|
| CLI | 本地交互，`-c` 指定配置文件 |
| HTTP/WS | 外部系统调用 + 本地 Web UI + 跨进程 Agent 互联 |
| SDK | `import { Runtime, Agent } from "baogent"` 编程接入 |

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  入口层                                                  │
│  CLI (bun run)  │  HTTP/WS (Bun.serve)  │  SDK (import) │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Runtime                                                 │
│  · Agent 生命周期  · MessageBus  · 全局共享记忆          │
└────┬───────────────────────────────────┬────────────────┘
     │                                   │
┌────▼──────────────────────┐    ┌───────▼───────────────┐
│  Agent A                  │    │  Agent B              │
│  Mailbox (async queue)    │    │  Mailbox              │
│  Executor (LLM/Human)     │    │  Executor             │
│  AgentLoop (tool-use)     │    │  AgentLoop            │
│  Context + Memory         │    │  Context + Memory     │
└───────────────────────────┘    └───────────────────────┘
```

**MessageBus**：进程内路由器（`Map<AgentId, Mailbox>`），Agent 之间不持有互相引用。

---

## 模块结构

```
src/
├── model/              # LLM 接入层（已实现）
│   ├── provider.ts     # LLMProvider 接口
│   ├── openai.ts       # OpenAIClient（OpenAI 兼容格式）
│   ├── tool.ts         # ToolDefinition 类型
│   └── index.ts
├── loop.ts             # AgentLoop：agentic tool-use 循环（已实现）
├── entry/              # 入口层（CLI 已实现）
│   ├── cli.ts
│   └── config.ts
├── types.ts            # 核心类型（待提交）
├── mailbox.ts          # 异步消息队列（待提交）
├── bus.ts              # MessageBus（待提交）
├── executor.ts         # Executor 接口 + LLMExecutor（待提交）
├── agent.ts            # Agent 类（待提交）
├── runtime.ts          # Runtime 编排器（待提交）
└── patterns/
    └── review-refine.ts  # 协作模式（待提交）
```

---

## 已实现模块详细设计

### model/

**LLMProvider 接口**

```typescript
interface LLMProvider {
  chat(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<string>
}
```

**OpenAIClient**

`baseURL` 可配，兼容任意 OpenAI Chat Completions 格式端点：

```typescript
new OpenAIClient({ apiKey, model, baseURL? })
// baseURL 示例：
// 火山引擎：https://ark.cn-beijing.volces.com/api/v3
// Ollama：  http://localhost:11434/v1
// 默认：    https://api.openai.com/v1
```

两个方法：
- `chat()` — 基础对话，返回文本
- `complete()` — 底层调用，返回完整 choice（含 `tool_calls`、`finish_reason`）

### AgentLoop（loop.ts）

单 Agent agentic loop，封装 tool-use 循环：

```
用户输入 → 请求模型（携带 tools）
  → finish_reason === "tool_calls"？
      是 → 执行工具 → 结果追加 messages → 继续
      否 → 返回最终文本
```

```typescript
class AgentLoop {
  constructor(opts: { client, tools?, callTool, systemPrompt?, maxIterations? })
  loop(userMessage: string): Promise<{ content, messages, turns }>
}
```

历史消息实例内自动保留，多轮对话连续调用 `loop()` 即可。

### CLI

```bash
bun run cli [-c <config>] chat "消息"   # 单次对话
bun run cli [-c <config>] agent         # 交互式 agent REPL（内置 bash 工具）
```

**配置文件（TOML）**，加载优先级：`-c` > `baogent.toml` > `.baogentrc.toml` > 环境变量：

```toml
[model]
apiKey  = "..."
baseURL = "https://ark.cn-beijing.volces.com/api/v3"
model   = "doubao-seed-2-0-code-preview-260215"
```

---

## 待实现

| 阶段 | 内容 |
|------|------|
| 多 Agent 核心 | `types.ts`、`mailbox.ts`、`bus.ts`、`agent.ts`、`runtime.ts` |
| 通信协议 | fire-and-forget + 请求-响应（correlationId + timeout）|
| 执行模式 | Human executor、Hybrid executor、运行时切换 |
| 打断机制 | ignore / queue / switch，InterruptStrategy 可外部注入 |
| 协作模式 | `patterns/review-refine.ts` |
| 记忆分层 | Agent 私有（JSON）+ 对话历史（JSONL）+ 全局共享（JSON）|
| 持久化 | Runtime 管理检查点，启动时恢复 |
| MCP 工具 | stdio/sse 传输，工具发现与调用 |
| HTTP/WS | REST API + WebSocket 流式 + 跨进程互联 |
| SDK 入口 | `src/index.ts` 公共 API 导出 |
