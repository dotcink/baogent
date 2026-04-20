import type { OpenAIConfig } from "../model/index.ts"

export interface Config {
  model: OpenAIConfig
}

const CONFIG_FILENAMES = ["baogent.toml", ".baogentrc.toml"]

async function parseTOML(path: string): Promise<Partial<Config>> {
  const text = await Bun.file(path).text()
  return Bun.TOML.parse(text) as Partial<Config>
}

/** 从文件路径加载配置，解析失败则报错退出 */
export async function loadConfigFile(path: string): Promise<Partial<Config>> {
  if (!(await Bun.file(path).exists())) {
    console.error(`Error: config file not found: ${path}`)
    process.exit(1)
  }
  try {
    return await parseTOML(path)
  } catch {
    console.error(`Error: failed to parse config file: ${path}`)
    process.exit(1)
  }
}

/** 在当前目录按默认文件名查找配置，找不到返回 {} */
export async function findDefaultConfig(): Promise<Partial<Config>> {
  for (const name of CONFIG_FILENAMES) {
    const file = Bun.file(name)
    if (await file.exists()) return await parseTOML(name)
  }
  return {}
}

/**
 * 合并配置，优先级：env vars > config file
 * apiKey 必填，否则报错退出
 */
export function resolveModelConfig(file: Partial<Config>): OpenAIConfig {
  const apiKey = process.env["MODEL_API_KEY"] ?? file.model?.apiKey
  if (!apiKey) {
    console.error("Error: model apiKey is required (MODEL_API_KEY or config file)")
    process.exit(1)
  }

  const baseURL = process.env["MODEL_BASE_URL"] ?? file.model?.baseURL
  const model = process.env["MODEL_NAME"] ?? file.model?.model ?? "gpt-4o"

  return {
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(file.model?.maxTokens ? { maxTokens: file.model.maxTokens } : {}),
  }
}
