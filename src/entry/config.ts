import type {
  AnthropicConfig,
  GeminiConfig,
  ModelProvider,
  OpenAIConfig,
} from "../model/index.ts"

export type ModelConfig =
  | ({ provider: "openai" } & OpenAIConfig)
  | ({ provider: "anthropic" } & AnthropicConfig)
  | ({ provider: "gemini" } & GeminiConfig)

export interface Config {
  model: ModelConfig
}

export interface LangfuseConfig {
  secretKey: string
  publicKey: string
  baseUrl?: string
}

export const CONFIG_FILENAMES = ["config/.local.toml"] as const
export const LANGFUSE_CONFIG_FILENAME = "config/langfuse.toml" as const

async function parseTOML<T>(path: string): Promise<Partial<T>> {
  const text = await Bun.file(path).text()
  return Bun.TOML.parse(text) as Partial<T>
}

async function readParsedTOML<T>(path: string): Promise<Partial<T>> {
  try {
    return await parseTOML<T>(path)
  } catch {
    console.error(`Error: failed to parse config file: ${path}`)
    process.exit(1)
  }
}

/** 从文件路径加载配置，解析失败则报错退出 */
export async function loadConfigFile(path: string): Promise<Partial<Config>> {
  if (!(await Bun.file(path).exists())) {
    console.error(`Error: config file not found: ${path}`)
    process.exit(1)
  }

  return await readParsedTOML<Config>(path)
}

/** 在当前目录按默认文件名查找配置，找不到返回 {} */
export async function findDefaultConfig(): Promise<Partial<Config>> {
  for (const name of CONFIG_FILENAMES) {
    const file = Bun.file(name)
    if (await file.exists()) {
      return await readParsedTOML<Config>(name)
    }
  }
  return {}
}

async function readOptionalTOML<T>(path: string): Promise<Partial<T>> {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}
  return await readParsedTOML<T>(path)
}

/**
 * 合并配置，优先级：env vars > config file
 * apiKey 必填，否则报错退出
 */
export function resolveModelConfig(file: Partial<Config>): ModelConfig {
  const provider = (process.env["MODEL_PROVIDER"] ?? file.model?.provider ?? "openai") as ModelProvider
  const apiKey = process.env["MODEL_API_KEY"] ?? file.model?.apiKey
  if (!apiKey) {
    console.error("Error: model apiKey is required (MODEL_API_KEY or config file)")
    process.exit(1)
  }

  const baseURL = process.env["MODEL_BASE_URL"] ?? file.model?.baseURL
  const model = process.env["MODEL_NAME"] ?? file.model?.model ?? "gpt-4o"
  const maxTokens =
    process.env["MODEL_MAX_TOKENS"] !== undefined
      ? Number(process.env["MODEL_MAX_TOKENS"])
      : file.model?.maxTokens

  if (!["openai", "anthropic", "gemini"].includes(provider)) {
    console.error(`Error: unsupported model provider: ${provider}`)
    process.exit(1)
  }

  if (maxTokens !== undefined && !Number.isFinite(maxTokens)) {
    console.error("Error: MODEL_MAX_TOKENS must be a finite number")
    process.exit(1)
  }

  const baseConfig = {
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  }

  if (provider === "anthropic") {
    return {
      provider,
      ...baseConfig,
    }
  }

  if (provider === "gemini") {
    return {
      provider,
      ...baseConfig,
    }
  }

  return {
    provider: "openai",
    ...baseConfig,
  }
}

/** 从 config/langfuse.toml 加载 Langfuse 配置，缺少必填字段时返回 null。 */
export async function loadLangfuseConfig(): Promise<LangfuseConfig | null> {
  const file = await readOptionalTOML<LangfuseConfig>(LANGFUSE_CONFIG_FILENAME)
  const { secretKey, publicKey, baseUrl } = file
  if (!secretKey || !publicKey) return null
  return {
    secretKey,
    publicKey,
    ...(baseUrl ? { baseUrl } : {}),
  }
}
