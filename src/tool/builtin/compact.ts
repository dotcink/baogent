import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

export const compactTool: ToolDefinition = {
  name: "compact",
  description: "Summarize earlier conversation so work can continue in a smaller context.",
  inputSchema: {
    type: "object",
    properties: {
      focus: { type: "string" },
    },
  },
}

export function createExecuteCompactTool(onCompact?: (focus?: string) => void) {
  return (toolCall: ParsedToolCall): string => {
    const focus = typeof toolCall.input.focus === "string" ? toolCall.input.focus : undefined
    if (onCompact) {
      onCompact(focus)
    }
    return "Compacting conversation..."
  }
}
