import type { ParsedToolCall } from "../tool/tool.ts"

export const MODES = ["default", "plan", "auto"] as const
export type PermissionMode = typeof MODES[number]

export interface PermissionRule {
  tool?: string
  path?: string
  content?: string
  behavior: "allow" | "deny" | "ask"
}

export const DEFAULT_RULES: PermissionRule[] = [
  { tool: "bash", content: "rm -rf /*", behavior: "deny" },
  { tool: "bash", content: "sudo *", behavior: "deny" },
  { tool: "read_file", path: "*", behavior: "allow" },
]

const WRITE_TOOLS = ["write_file", "edit_file", "bash", "multi_replace_file_content", "replace_file_content"]
const READ_ONLY_TOOLS = ["list_dir", "grep_search", "view_file", "read_file"]

export class BashSecurityValidator {
  private static VALIDATORS: [string, RegExp][] = [
    ["shell_metachar", /[;&|`$]/],
    ["sudo", /\bsudo\b/],
    ["rm_rf", /\brm\s+(-[a-zA-Z]*)?r/],
    ["cmd_substitution", /\$\(/],
    ["ifs_injection", /\bIFS\s*=/],
  ]

  validate(command: string): [string, RegExp][] {
    const failures: [string, RegExp][] = []
    for (const [name, pattern] of BashSecurityValidator.VALIDATORS) {
      if (pattern.test(command)) {
        failures.push([name, pattern])
      }
    }
    return failures
  }

  isSafe(command: string): boolean {
    return this.validate(command).length === 0
  }

  describeFailures(command: string): string {
    const failures = this.validate(command)
    if (!failures.length) return "No issues detected"
    const parts = failures.map(([name, pattern]) => `${name} (pattern: ${pattern.source})`)
    return "Security flags: " + parts.join(", ")
  }
}

const bashValidator = new BashSecurityValidator()

export interface PermissionDecision {
  behavior: "allow" | "deny" | "ask"
  reason: string
}

function fnmatch(str: string, pattern: string): boolean {
  if (pattern === "*") return true
  const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${regexPattern}$`).test(str)
}

export class PermissionManager {
  mode: PermissionMode
  rules: PermissionRule[]
  consecutiveDenials = 0
  maxConsecutiveDenials = 3

  constructor(mode: PermissionMode = "default", rules?: PermissionRule[]) {
    this.mode = mode
    this.rules = rules ? [...rules] : [...DEFAULT_RULES]
  }

  check(toolName: string, toolInput: Record<string, unknown>): PermissionDecision {
    if (toolName === "bash") {
      const command = (toolInput.command as string) || ""
      const failures = bashValidator.validate(command)
      if (failures.length > 0) {
        const severe = new Set(["sudo", "rm_rf"])
        const severeHits = failures.filter(([name]) => severe.has(name))
        if (severeHits.length > 0) {
          return { behavior: "deny", reason: `Bash validator: ${bashValidator.describeFailures(command)}` }
        }
        return { behavior: "ask", reason: `Bash validator flagged: ${bashValidator.describeFailures(command)}` }
      }
    }

    for (const rule of this.rules) {
      if (rule.behavior !== "deny") continue
      if (this.matches(rule, toolName, toolInput)) {
        return { behavior: "deny", reason: `Blocked by deny rule: ${JSON.stringify(rule)}` }
      }
    }

    if (this.mode === "plan") {
      if (WRITE_TOOLS.includes(toolName)) {
        return { behavior: "deny", reason: "Plan mode: write operations are blocked" }
      }
      return { behavior: "allow", reason: "Plan mode: read-only allowed" }
    }

    if (this.mode === "auto") {
      if (READ_ONLY_TOOLS.includes(toolName) || toolName === "read_file") {
        return { behavior: "allow", reason: "Auto mode: read-only tool auto-approved" }
      }
    }

    for (const rule of this.rules) {
      if (rule.behavior !== "allow") continue
      if (this.matches(rule, toolName, toolInput)) {
        this.consecutiveDenials = 0
        return { behavior: "allow", reason: `Matched allow rule: ${JSON.stringify(rule)}` }
      }
    }

    return { behavior: "ask", reason: `No rule matched for ${toolName}, asking user` }
  }

  matches(rule: PermissionRule, toolName: string, toolInput: Record<string, unknown>): boolean {
    if (rule.tool && rule.tool !== "*") {
      if (rule.tool !== toolName) return false
    }
    if (rule.path !== undefined && rule.path !== "*") {
      const path = (toolInput.path as string) || ""
      if (!fnmatch(path, rule.path)) return false
    }
    if (rule.content !== undefined) {
      const command = (toolInput.command as string) || ""
      if (!fnmatch(command, rule.content)) return false
    }
    return true
  }
}

export interface PermissionAwareExecutorOptions {
  executeToolCall: (toolCall: ParsedToolCall) => Promise<string> | string
  permissionManager?: PermissionManager | undefined
  askUser?: ((toolName: string, toolInput: Record<string, unknown>) => Promise<boolean | "always">) | undefined
}

export function createPermissionAwareExecutor(
  options: PermissionAwareExecutorOptions
): (toolCall: ParsedToolCall) => Promise<string> {
  return async (toolCall: ParsedToolCall): Promise<string> => {
    if (!options.permissionManager) {
      return options.executeToolCall(toolCall)
    }

    const decision = options.permissionManager.check(toolCall.name, toolCall.input)
    if (decision.behavior === "deny") {
      console.log(`\x1b[31m  [DENIED] ${toolCall.name}: ${decision.reason}\x1b[0m`)
      return `Permission denied: ${decision.reason}`
    } else if (decision.behavior === "ask") {
      if (options.askUser) {
        const answer = await options.askUser(toolCall.name, toolCall.input)
        if (answer === "always") {
          options.permissionManager.rules.push({ tool: toolCall.name, path: "*", behavior: "allow" })
          options.permissionManager.consecutiveDenials = 0
          return options.executeToolCall(toolCall)
        } else if (answer === true) {
          options.permissionManager.consecutiveDenials = 0
          return options.executeToolCall(toolCall)
        } else {
          options.permissionManager.consecutiveDenials++
          if (options.permissionManager.consecutiveDenials >= options.permissionManager.maxConsecutiveDenials) {
            console.log(`\x1b[33m  [${options.permissionManager.consecutiveDenials} consecutive denials -- consider switching to plan mode]\x1b[0m`)
          }
          console.log(`\x1b[31m  [USER DENIED] ${toolCall.name}\x1b[0m`)
          return `Permission denied by user for ${toolCall.name}`
        }
      } else {
        console.log(`\x1b[31m  [DENIED] ${toolCall.name}: ${decision.reason} (interactive approval required)\x1b[0m`)
        return `Permission denied: ${decision.reason} (interactive approval required)`
      }
    } else {
      return options.executeToolCall(toolCall)
    }
  }
}
