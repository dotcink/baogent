import { mkdir, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import type { ChatMessage, LLMProvider } from "../model/provider.ts"
import type { ResolvedToolCall, ToolResult } from "../tool/tool.ts"

export const CONTEXT_LIMIT = 50000
export const KEEP_RECENT_TOOL_RESULTS = 3
export const PERSIST_THRESHOLD = 30000
export const PREVIEW_CHARS = 2000
export const PRESERVE_RESULT_TOOLS = new Set(["read_file"])

export function estimateContextSize(messages: ChatMessage[]): number {
  return JSON.stringify(messages).length
}

export function microCompact(messages: ChatMessage[]): ChatMessage[] {
  const toolNameMap = new Map<string, string>()
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        toolNameMap.set(call.id, call.function.name)
      }
    }
  }

  const toolResults = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => {
      if (msg.role !== "tool") return false
      const toolName = toolNameMap.get(msg.tool_call_id)
      return !toolName || !PRESERVE_RESULT_TOOLS.has(toolName)
    })

  if (toolResults.length <= KEEP_RECENT_TOOL_RESULTS) {
    return messages
  }

  const result = [...messages]
  const toCompact = toolResults.slice(0, -KEEP_RECENT_TOOL_RESULTS)

  for (const { msg, index } of toCompact) {

    if (typeof msg.content === "string" && msg.content.length > 120) {
      result[index] = {
        ...msg,
        content: "[Earlier tool result compacted. Re-run the tool if you need full detail.]",
      }
    }
  }

  return result
}

export async function writeTranscript(messages: ChatMessage[], workspaceDir: string): Promise<string> {
  const transcriptDir = join(workspaceDir, ".transcripts")
  await mkdir(transcriptDir, { recursive: true })

  const path = join(transcriptDir, `transcript_${Date.now()}.jsonl`)

  // JSONL format
  const content = messages.map(m => JSON.stringify(m)).join("\n")
  await writeFile(path, content, "utf-8")

  return path
}

export async function summarizeHistory(messages: ChatMessage[], model: LLMProvider): Promise<string> {
  const conversation = JSON.stringify(messages).slice(0, 80000)
  const prompt = [
    "Summarize this coding-agent conversation so work can continue.",
    "Preserve:",
    "1. The current goal",
    "2. Important findings and decisions",
    "3. Files read or changed",
    "4. Remaining work",
    "5. User constraints and preferences",
    "Be compact but concrete.\n",
    conversation
  ].join("\n")

  const response = await model.chat([
    { role: "user", content: prompt }
  ], {
    maxTokens: 2000,
    generationName: "compact_history"
  })

  return response.content || "Failed to summarize history."
}

export async function compactHistory(
  messages: ChatMessage[],
  workspaceDir: string,
  model: LLMProvider,
  focus?: string
): Promise<ChatMessage[]> {
  const transcriptPath = await writeTranscript(messages, workspaceDir)
  console.log(`[transcript saved: ${transcriptPath}]`)

  let summary = await summarizeHistory(messages, model)
  if (focus) {
    summary += `\n\nFocus to preserve next: ${focus}`
  }

  return [{
    role: "user",
    content: `This conversation was compacted so the agent can continue working.\n\n${summary}`
  }]
}

export async function persistLargeOutput(
  toolUseId: string,
  output: string,
  workspaceDir: string
): Promise<string> {
  if (output.length <= PERSIST_THRESHOLD) {
    return output
  }

  const resultsDir = join(workspaceDir, ".task_outputs", "tool-results")
  await mkdir(resultsDir, { recursive: true })

  const storedPath = join(resultsDir, `${toolUseId}.txt`)
  await writeFile(storedPath, output, "utf-8")

  const preview = output.slice(0, PREVIEW_CHARS)
  const relPath = relative(workspaceDir, storedPath)

  return [
    "<persisted-output>",
    `Full output saved to: ${relPath}`,
    "Preview:",
    preview,
    "</persisted-output>"
  ].join("\n")
}

export async function autoCompactIfNeeded(
  messages: ChatMessage[],
  workspaceDir: string,
  model: LLMProvider
): Promise<ChatMessage[]> {
  let newMessages = microCompact(messages)
  if (estimateContextSize(newMessages) > CONTEXT_LIMIT) {
    console.log("[auto compact]")
    newMessages = await compactHistory(newMessages, workspaceDir, model)
  }
  return newMessages
}

export async function handleManualCompaction(
  messages: ChatMessage[],
  toolCalls: ResolvedToolCall[],
  workspaceDir: string,
  model: LLMProvider
): Promise<ChatMessage[]> {
  let manualCompact = false
  let compactFocus: string | undefined

  for (const toolCall of toolCalls) {
    if (toolCall.name === "compact") {
      manualCompact = true
      compactFocus = typeof toolCall.input?.focus === "string" ? toolCall.input.focus : undefined
    }
  }

  if (manualCompact) {
    console.log("[manual compact]")
    return await compactHistory(messages, workspaceDir, model, compactFocus)
  }

  return messages
}

export async function persistToolResults(
  results: ToolResult[],
  workspaceDir: string
): Promise<void> {
  for (const result of results) {
    result.content = await persistLargeOutput(result.toolCallId, result.content, workspaceDir)
  }
}
