import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

const MAX_OUTPUT_CHARS = 50_000

function resolveWorkspacePath(path: string): string {
  const workspace = process.cwd()
  const fullPath = resolve(workspace, path)
  const relativePath = relative(workspace, fullPath)

  if (relativePath.startsWith("..") || relativePath === "") {
    if (relativePath === "") {
      return fullPath
    }

    throw new Error(`Path escapes workspace: ${path}`)
  }

  return fullPath
}

function truncateOutput(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text
}

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file from the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["path"],
  },
}

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
}

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Replace exact text once in a file in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  },
}

export function executeReadFileTool(toolCall: ParsedToolCall): string {
  if (toolCall.name !== readFileTool.name) {
    return `Error: Unsupported tool \`${toolCall.name}\``
  }

  const path = typeof toolCall.input.path === "string" ? toolCall.input.path : ""
  const limit = typeof toolCall.input.limit === "number" ? toolCall.input.limit : undefined
  if (!path) {
    return "Error: Missing required string field `path`"
  }

  try {
    const content = readFileSync(resolveWorkspacePath(path), "utf8")
    const lines = content.split("\n")
    if (limit !== undefined && Number.isInteger(limit) && limit >= 0 && limit < lines.length) {
      return truncateOutput(
        `${lines.slice(0, limit).join("\n")}\n... (${lines.length - limit} more lines)`,
      )
    }

    return truncateOutput(content)
  } catch (error) {
    return `Error: ${(error as Error).message}`
  }
}

export function executeWriteFileTool(toolCall: ParsedToolCall): string {
  if (toolCall.name !== writeFileTool.name) {
    return `Error: Unsupported tool \`${toolCall.name}\``
  }

  const path = typeof toolCall.input.path === "string" ? toolCall.input.path : ""
  const content = typeof toolCall.input.content === "string" ? toolCall.input.content : null
  if (!path) {
    return "Error: Missing required string field `path`"
  }
  if (content === null) {
    return "Error: Missing required string field `content`"
  }

  try {
    const fullPath = resolveWorkspacePath(path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, "utf8")
    return `Wrote ${content.length} bytes to ${path}`
  } catch (error) {
    return `Error: ${(error as Error).message}`
  }
}

export function executeEditFileTool(toolCall: ParsedToolCall): string {
  if (toolCall.name !== editFileTool.name) {
    return `Error: Unsupported tool \`${toolCall.name}\``
  }

  const path = typeof toolCall.input.path === "string" ? toolCall.input.path : ""
  const oldText = typeof toolCall.input.old_text === "string" ? toolCall.input.old_text : null
  const newText = typeof toolCall.input.new_text === "string" ? toolCall.input.new_text : null
  if (!path) {
    return "Error: Missing required string field `path`"
  }
  if (oldText === null) {
    return "Error: Missing required string field `old_text`"
  }
  if (newText === null) {
    return "Error: Missing required string field `new_text`"
  }
  if (!oldText) {
    return "Error: Field `old_text` must not be empty"
  }

  try {
    const fullPath = resolveWorkspacePath(path)
    const content = readFileSync(fullPath, "utf8")
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${path}`
    }

    writeFileSync(fullPath, content.replace(oldText, newText), "utf8")
    return `Edited ${path}`
  } catch (error) {
    return `Error: ${(error as Error).message}`
  }
}
