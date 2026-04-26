import type { ChatMessage, LLMProvider } from "../model/provider.ts"
import { TodoManager, isTodoToolCall } from "../tool/builtin/todo.ts"
import {
  buildToolResultMessages,
  executeToolCalls,
  normalizeMessages,
  parseToolCalls,
} from "../tool/tool.ts"
import type { ParsedToolCall, ToolDefinition } from "../tool/tool.ts"
import {
  autoCompactIfNeeded,
  handleManualCompaction,
  persistToolResults,
} from "./compact.ts"
import { type PermissionManager, createPermissionAwareExecutor } from "./permission.ts"
import { type HookManager, createHookAwareExecutor } from "./hooks.ts"

export interface AgentLoopOptions {
  systemPrompt?: string
  tools?: ToolDefinition[]
  maxTokens?: number
  generationName?: string
  todoManager?: TodoManager
  executeToolCall: (toolCall: ParsedToolCall) => Promise<string> | string
  messages?: ChatMessage[]
  workspaceDir?: string
  permissionManager?: PermissionManager
  hookManager?: HookManager
  askUser?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean | "always">
}

export interface AgentLoopState {
  messages: ChatMessage[]
  turnCount: number
  transitionReason: string | null
}

const TOOL_LOG_PREVIEW_LIMIT = 200

function truncateForLog(text: string, limit = TOOL_LOG_PREVIEW_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function formatToolInput(input?: Record<string, unknown>): string {
  if (!input) {
    return ""
  }

  const serialized = JSON.stringify(input)
  return serialized === undefined ? "" : truncateForLog(serialized)
}

function logToolCall(toolCall: { name: string; input?: Record<string, unknown>; error?: string }): void {
  if (toolCall.error) {
    console.log(`\x1b[33m> ${toolCall.name}: Error: ${toolCall.error}\x1b[0m`)
    return
  }

  const inputPreview = formatToolInput(toolCall.input)
  console.log(`\x1b[33m> ${toolCall.name}${inputPreview ? ` ${inputPreview}` : ""}\x1b[0m`)
}

function logToolResult(result: { content: string }): void {
  console.log(truncateForLog(result.content))
}

export class AgentLoop {
  private readonly model: LLMProvider
  private readonly options: AgentLoopOptions
  private messages: ChatMessage[]
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
    const workspaceDir = this.options.workspaceDir || process.cwd()
    this.messages = await autoCompactIfNeeded(this.messages, workspaceDir, this.model)

    const systemMessages = this.options.systemPrompt
      ? ([{ role: "system", content: this.options.systemPrompt }] satisfies ChatMessage[])
      : []
    const reminder = this.options.todoManager?.reminder()
    const reminderMessages = reminder
      ? ([{ role: "user", content: reminder }] satisfies ChatMessage[])
      : []

    const response = await this.model.chat(
      normalizeMessages([
        ...systemMessages,
        ...this.messages,
        ...reminderMessages,
      ]),
      {
        ...(this.options.maxTokens ? { maxTokens: this.options.maxTokens } : {}),
        ...(this.options.generationName ? { generationName: this.options.generationName } : {}),
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

    const permissionAwareExecuteToolCall = createPermissionAwareExecutor({
      executeToolCall: this.options.executeToolCall,
      permissionManager: this.options.permissionManager,
      askUser: this.options.askUser,
    })

    const hookAwareExecuteToolCall = createHookAwareExecutor({
      executeToolCall: permissionAwareExecuteToolCall,
      hookManager: this.options.hookManager,
    })

    const results = await executeToolCalls(toolCalls, hookAwareExecuteToolCall, {
      onToolCall: logToolCall,
      onToolResult: (_toolCall, result) => {
        logToolResult(result)
      },
    })

    await persistToolResults(results, workspaceDir)

    if (this.options.todoManager) {
      if (toolCalls.some(isTodoToolCall)) {
        this.options.todoManager.resetRoundCounter()
      } else {
        this.options.todoManager.noteRoundWithoutUpdate()
      }
    }
    this.messages.push(...buildToolResultMessages(results))

    this.messages = await handleManualCompaction(this.messages, toolCalls, workspaceDir, this.model)

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
