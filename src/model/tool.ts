export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: { type: string }
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}
