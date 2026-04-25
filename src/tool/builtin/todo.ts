import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

const MAX_PLAN_ITEMS = 12
const PLAN_REMINDER_INTERVAL = 3
const PLAN_STATUS = ["pending", "in_progress", "completed"] as const

type PlanStatus = (typeof PLAN_STATUS)[number]

export interface PlanItem {
  content: string
  status: PlanStatus
  activeForm: string
}

interface PlanningState {
  items: PlanItem[]
  roundsSinceUpdate: number
}

function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && PLAN_STATUS.includes(value as PlanStatus)
}

export const todoTool: ToolDefinition = {
  name: "todo",
  description: "Rewrite the current session plan for multi-step work.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: {
              type: "string",
              enum: [...PLAN_STATUS],
            },
            activeForm: {
              type: "string",
              description: "Optional present-continuous label.",
            },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["items"],
  },
}

export class TodoManager {
  private readonly state: PlanningState = {
    items: [],
    roundsSinceUpdate: 0,
  }

  executeToolCall(toolCall: ParsedToolCall): string {
    if (toolCall.name !== todoTool.name) {
      return `Error: Unsupported tool \`${toolCall.name}\``
    }

    const items = toolCall.input.items
    if (!Array.isArray(items)) {
      return "Error: Missing required array field `items`"
    }

    try {
      return this.update(items)
    } catch (error) {
      return `Error: ${(error as Error).message}`
    }
  }

  noteRoundWithoutUpdate(): void {
    this.state.roundsSinceUpdate += 1
  }

  resetRoundCounter(): void {
    this.state.roundsSinceUpdate = 0
  }

  reminder(): string | null {
    if (this.state.items.length === 0) {
      return null
    }

    if (this.state.roundsSinceUpdate < PLAN_REMINDER_INTERVAL) {
      return null
    }

    return "<reminder>Refresh your current plan before continuing.</reminder>"
  }

  private update(rawItems: unknown[]): string {
    if (rawItems.length > MAX_PLAN_ITEMS) {
      throw new Error(`Keep the session plan short (max ${MAX_PLAN_ITEMS} items)`)
    }

    const items: PlanItem[] = []
    let inProgressCount = 0

    rawItems.forEach((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new Error(`Item ${index}: expected an object`)
      }

      const item = rawItem as Record<string, unknown>
      const content = typeof item.content === "string" ? item.content.trim() : ""
      const status = item.status
      const activeForm = typeof item.activeForm === "string" ? item.activeForm.trim() : ""

      if (!content) {
        throw new Error(`Item ${index}: content required`)
      }

      if (!isPlanStatus(status)) {
        throw new Error(`Item ${index}: invalid status '${String(status)}'`)
      }

      if (status === "in_progress") {
        inProgressCount += 1
      }

      items.push({
        content,
        status,
        activeForm,
      })
    })

    if (inProgressCount > 1) {
      throw new Error("Only one plan item can be in_progress")
    }

    this.state.items = items
    this.state.roundsSinceUpdate = 0
    return this.render()
  }

  private render(): string {
    if (this.state.items.length === 0) {
      return "No session plan yet."
    }

    const lines = this.state.items.map((item) => {
      const marker = {
        pending: "[ ]",
        in_progress: "[>]",
        completed: "[x]",
      }[item.status]
      const line = `${marker} ${item.content}`

      if (item.status === "in_progress" && item.activeForm) {
        return `${line} (${item.activeForm})`
      }

      return line
    })

    const completedCount = this.state.items.filter((item) => item.status === "completed").length
    lines.push(`\n(${completedCount}/${this.state.items.length} completed)`)
    return lines.join("\n")
  }
}

export function isTodoToolCall(toolCall: { name: string }): boolean {
  return toolCall.name === todoTool.name
}
