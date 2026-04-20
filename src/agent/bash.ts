import { spawnSync } from "node:child_process"
import type { ParsedToolCall, ToolDefinition } from "./tool.ts"

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Run a shell command in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
  },
}

export function executeBashTool(toolCall: ParsedToolCall): string {
  if (toolCall.name !== bashTool.name) {
    return `Error: Unsupported tool \`${toolCall.name}\``
  }

  const command = typeof toolCall.input.command === "string" ? toolCall.input.command : ""
  if (!command) {
    return "Error: Missing required string field `command`"
  }

  if (BLOCKED_PATTERNS.some((pattern) => command.includes(pattern))) {
    return "Error: Dangerous command blocked"
  }

  console.log(`\x1b[33m$ ${command}\x1b[0m`)

  const result = spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  })

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === "ETIMEDOUT") {
      return "Error: Timeout (120s)"
    }

    return `Error: ${result.error.message}`
  }

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  const output = combined ? combined.slice(0, 50_000) : "(no output)"
  console.log(output.slice(0, 200))
  return output
}
