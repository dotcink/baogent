import type { ChatMessage } from "../provider.ts"

export interface SplitMessagesResult {
  systemPrompt?: string
  messages: Exclude<ChatMessage, { role: "system" }>[]
}

export function splitSystemMessages(messages: ChatMessage[]): SplitMessagesResult {
  const systemParts: string[] = []
  const rest: Exclude<ChatMessage, { role: "system" }>[] = []

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content)
      continue
    }

    rest.push(message)
  }

  return {
    ...(systemParts.length ? { systemPrompt: systemParts.join("\n\n") } : {}),
    messages: rest,
  }
}

export function joinTextParts(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")
}
