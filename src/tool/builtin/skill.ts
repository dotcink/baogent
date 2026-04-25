import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import type { ParsedToolCall, ToolDefinition } from "../tool.ts"

export interface SkillManifest {
  name: string
  description: string
  path: string
}

export interface SkillDocument {
  manifest: SkillManifest
  body: string
}

export class SkillRegistry {
  public readonly documents: Record<string, SkillDocument> = {}
  private readonly skillsDir: string

  constructor(skillsDir: string) {
    this.skillsDir = resolve(process.cwd(), skillsDir)
    this.loadAll()
  }

  private loadAll(): void {
    if (!existsSync(this.skillsDir)) {
      return
    }

    const files = this.walk(this.skillsDir).filter((file) => file.endsWith("SKILL.md"))

    for (const path of files) {
      const content = readFileSync(path, "utf8")
      const { meta, body } = this.parseFrontmatter(content)
      const parentDirName = basename(dirname(path))
      const name = meta.name || parentDirName
      const description = meta.description || "No description"
      const manifest: SkillManifest = { name, description, path }
      this.documents[name] = { manifest, body: body.trim() }
    }
  }

  private walk(dir: string): string[] {
    let results: string[] = []
    const list = readdirSync(dir)
    for (const file of list) {
      const filePath = join(dir, file)
      const stat = statSync(filePath)
      if (stat && stat.isDirectory()) {
        results = results.concat(this.walk(filePath))
      } else {
        results.push(filePath)
      }
    }
    return results
  }

  private parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = /^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)\r?\n([\s\S]*)$/.exec(text)
    if (!match) {
      return { meta: {}, body: text }
    }

    const meta: Record<string, string> = {}
    const lines = match[1]!.trim().split("\n")
    for (const line of lines) {
      if (!line.includes(":")) {
        continue
      }
      const [key, ...valueParts] = line.split(":")
      if (!key) {
        continue
      }
      meta[key.trim()] = valueParts.join(":").trim()
    }

    return { meta, body: match[2]! }
  }

  public describeAvailable(): string {
    const keys = Object.keys(this.documents).sort()
    if (keys.length === 0) {
      return "(no skills available)"
    }

    return keys
      .map((name) => {
        const doc = this.documents[name]
        if (!doc) return ""
        const manifest = doc.manifest
        return `- ${manifest.name}: ${manifest.description}`
      })
      .join("\n")
  }

  public loadFullText(name: string): string {
    const document = this.documents[name]
    if (!document) {
      const known = Object.keys(this.documents).sort().join(", ") || "(none)"
      return `Error: Unknown skill '${name}'. Available skills: ${known}`
    }

    return `<skill name="${document.manifest.name}">\n${document.body}\n</skill>`
  }
}

export const loadSkillTool: ToolDefinition = {
  name: "load_skill",
  description: "Load the full body of a named skill into the current context.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
}

export function createExecuteLoadSkillTool(registry: SkillRegistry) {
  return function executeLoadSkillTool(toolCall: ParsedToolCall): string {
    if (toolCall.name !== loadSkillTool.name) {
      return `Error: Unsupported tool \`${toolCall.name}\``
    }

    const name = typeof toolCall.input.name === "string" ? toolCall.input.name : ""
    if (!name) {
      return "Error: Missing required string field `name`"
    }

    return registry.loadFullText(name)
  }
}
