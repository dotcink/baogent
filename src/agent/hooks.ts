import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { spawnSync } from "child_process"

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "SessionStart"] as const
export type HookEvent = typeof HOOK_EVENTS[number]

export interface HookContext {
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: unknown
}

export interface HookResult {
  blocked: boolean
  block_reason?: string
  messages: string[]
  permission_override?: string
}

export class HookManager {
  private hooks: Record<HookEvent, any[]> = {
    PreToolUse: [],
    PostToolUse: [],
    SessionStart: [],
  }
  private sdkMode: boolean
  private workspaceDir: string
  private readonly hookTimeout = 30000

  constructor(workspaceDir: string, configPath?: string, sdkMode = false) {
    this.workspaceDir = workspaceDir
    this.sdkMode = sdkMode
    const path = configPath || join(workspaceDir, ".hooks.json")
    
    if (existsSync(path)) {
      try {
        const config = JSON.parse(readFileSync(path, "utf-8"))
        for (const event of HOOK_EVENTS) {
          this.hooks[event] = config?.hooks?.[event] || []
        }
        console.log(`[Hooks loaded from ${path}]`)
      } catch (e) {
        console.log(`[Hook config error: ${e instanceof Error ? e.message : e}]`)
      }
    }
  }

  private checkWorkspaceTrust(): boolean {
    if (this.sdkMode) return true
    return existsSync(join(this.workspaceDir, ".agents", ".baogent_trusted"))
  }

  runHooks(event: HookEvent, context?: HookContext): HookResult {
    const result: HookResult = { blocked: false, messages: [] }
    
    if (!this.checkWorkspaceTrust()) {
      return result
    }

    const hooks = this.hooks[event] || []
    for (const hookDef of hooks) {
      const matcher = hookDef.matcher
      if (matcher && context) {
        const toolName = context.tool_name || ""
        if (matcher !== "*" && matcher !== toolName) {
          continue
        }
      }

      const command = hookDef.command
      if (!command) continue

      const env: Record<string, string> = { ...process.env } as Record<string, string>
      if (context) {
        env.HOOK_EVENT = event
        env.HOOK_TOOL_NAME = context.tool_name || ""
        env.HOOK_TOOL_INPUT = JSON.stringify(context.tool_input || {}).substring(0, 10000)
        if ("tool_output" in context) {
          const outStr = typeof context.tool_output === "string" 
            ? context.tool_output 
            : JSON.stringify(context.tool_output)
          env.HOOK_TOOL_OUTPUT = (outStr || "").substring(0, 10000)
        }
      }

      try {
        const r = spawnSync(command, {
          cwd: this.workspaceDir,
          env,
          shell: true,
          timeout: this.hookTimeout,
          encoding: "utf-8",
        })

        if (r.error) {
           if ((r.error as any).code === "ETIMEDOUT") {
             console.log(`  [hook:${event}] Timeout (${this.hookTimeout / 1000}s)`)
           } else {
             console.log(`  [hook:${event}] Error: ${r.error.message}`)
           }
           continue
        }

        if (r.status === 0) {
          if (r.stdout && r.stdout.trim()) {
             console.log(`  [hook:${event}] ${r.stdout.trim().substring(0, 100)}`)
          }
          try {
            const hookOutput = JSON.parse(r.stdout)
            if (hookOutput.updatedInput && context) {
              context.tool_input = hookOutput.updatedInput
            }
            if (hookOutput.additionalContext) {
              result.messages.push(hookOutput.additionalContext)
            }
            if (hookOutput.permissionDecision) {
              result.permission_override = hookOutput.permissionDecision
            }
          } catch {
            // ignore JSON decode error
          }
        } else if (r.status === 1) {
          result.blocked = true
          const reason = (r.stderr || "").trim() || "Blocked by hook"
          result.block_reason = reason
          console.log(`  [hook:${event}] BLOCKED: ${reason.substring(0, 200)}`)
        } else if (r.status === 2) {
          const msg = (r.stderr || "").trim()
          if (msg) {
            result.messages.push(msg)
            console.log(`  [hook:${event}] INJECT: ${msg.substring(0, 200)}`)
          }
        }
      } catch (e) {
         console.log(`  [hook:${event}] Error: ${e instanceof Error ? e.message : e}`)
      }
    }

    return result
  }
}

export function createHookAwareExecutor({
  executeToolCall,
  hookManager,
}: {
  executeToolCall: (toolCall: any) => Promise<string> | string
  hookManager?: HookManager | undefined
}): (toolCall: any) => Promise<string> {
  return async (toolCall: any) => {
    if (!hookManager) return executeToolCall(toolCall)

    const ctx: HookContext = {
      tool_name: toolCall.name,
      tool_input: toolCall.input || {},
    }

    const preResult = hookManager.runHooks("PreToolUse", ctx)
    let output = ""

    for (const msg of preResult.messages) {
      output += `[Hook message]: ${msg}\n`
    }

    if (preResult.blocked) {
      const reason = preResult.block_reason || "Blocked by hook"
      output += `Tool blocked by PreToolUse hook: ${reason}`
      return output
    }

    try {
      const execResult = await executeToolCall({
        ...toolCall,
        input: ctx.tool_input, // Pass updated input from PreToolUse hook
      })
      output += execResult
    } catch (e) {
      output += `Error: ${e instanceof Error ? e.message : e}`
    }

    ctx.tool_output = output
    const postResult = hookManager.runHooks("PostToolUse", ctx)

    for (const msg of postResult.messages) {
      output += `\n[Hook note]: ${msg}`
    }

    return output
  }
}
