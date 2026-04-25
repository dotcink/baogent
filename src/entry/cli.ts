#!/usr/bin/env bun
/**
 * baogent CLI
 *
 * 用法：
 *   bun run cli chat "你好"
 *   bun run cli --config ./my.toml chat "你好"
 *   bun run cli --model-log ./logs/model-io.jsonl chat "你好"
 *   bun run cli chat              # 从 stdin 读取
 *   bun run cli agent-loop
 *
 * 配置优先级：env vars > --config 文件 > 默认文件（config/.local.toml）
 *
 * 环境变量：
 *   MODEL_PROVIDER        协议提供方（openai | anthropic | gemini）
 *   MODEL_API_KEY         API Key
 *   MODEL_BASE_URL        API 端点
 *   MODEL_NAME            模型名称
 *   MODEL_MAX_TOKENS      最大输出 token
 */

import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { AgentLoop } from "../agent/index.ts"
import {
  builtInTools,
  createBuiltInToolExecutor,
  TodoManager,
} from "../agent/tools/index.ts"
import {
  AnthropicClient,
  GeminiClient,
  OpenAIClient,
  LoggingLLMProvider,
  LangfuseLLMProvider,
  type LLMProvider,
} from "../model/index.ts"
import {
  CONFIG_FILENAMES,
  loadConfigFile,
  findDefaultConfig,
  loadLangfuseConfig,
  resolveModelConfig,
} from "./config.ts"

// ── 解析参数 ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2)

function usage(exitCode = 1): never {
  console.error("Usage: baogent [--config <path>] [--model-log <path>] <command> [args]")
  console.error("")
  console.error("Commands:")
  console.error("  chat <message>   Send a message to the model")
  console.error("  agent-loop       Start an interactive agent loop with built-in tools")
  console.error("")
  console.error("Options:")
  console.error(`  -c, --config <path>  Path to config file (default: ${CONFIG_FILENAMES.join(", ")})`)
  console.error("  --model-log <path>  Append model input/output JSONL logs to file")
  console.error("  -h, --help           Show this help")
  console.error("")
  console.error("Env:")
  console.error("  MODEL_PROVIDER       openai | anthropic | gemini")
  console.error("  MODEL_API_KEY        API key")
  console.error("  MODEL_BASE_URL       Override API endpoint")
  console.error("  MODEL_NAME           Override model name")
  console.error("  MODEL_MAX_TOKENS     Override max output tokens")
  process.exit(exitCode)
}

// 提取全局选项
let configPath: string | undefined
let modelIOLogPath: string | undefined
const cmdArgs: string[] = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]

  if (arg === "--help" || arg === "-h") {
    usage(0)
  }

  if (arg === "--config" || arg === "-c") {
    const next = args[i + 1]
    if (!next) {
      console.error("Error: missing value for --config")
      usage()
    }

    configPath = next
    i += 1
    continue
  }

  if (arg === "--model-log") {
    const next = args[i + 1]
    if (!next) {
      console.error("Error: missing value for --model-log")
      usage()
    }

    if (!next.trim()) {
      console.error("Error: --model-log must not be empty")
      process.exit(1)
    }

    modelIOLogPath = next
    i += 1
    continue
  }

  cmdArgs.push(arg!)
}

const [command, ...rest] = cmdArgs
if (!command) usage()

// ── 命令处理 ──────────────────────────────────────────────────────────────────

async function createClient(opts?: { sessionId?: string; traceName?: string }) {
  const fileConfig = configPath
    ? await loadConfigFile(configPath)
    : await findDefaultConfig()

  const modelConfig = resolveModelConfig(fileConfig)

  let client: LLMProvider =
    modelConfig.provider === "anthropic"
      ? new AnthropicClient(modelConfig)
      : modelConfig.provider === "gemini"
        ? new GeminiClient(modelConfig)
        : new OpenAIClient(modelConfig)

  if (modelIOLogPath) {
    client = new LoggingLLMProvider(client, {
      path: modelIOLogPath,
      provider: modelConfig.provider,
      model: modelConfig.model,
    })
  }

  const langfuseConfig = await loadLangfuseConfig()
  if (langfuseConfig) {
    client = new LangfuseLLMProvider(client, {
      model: modelConfig.model,
      ...langfuseConfig,
      ...(opts?.traceName ? { traceName: opts.traceName } : {}),
      ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
    })
  }

  return client
}

async function flushClient(client: LLMProvider): Promise<void> {
  if (client instanceof LangfuseLLMProvider) {
    await client.flush()
  }
}

if (command === "chat") {
  const client = await createClient({ traceName: "chat" })
  let message = rest.join(" ").trim()

  if (!message) {
    process.stdout.write("You: ")
    message = (await Bun.stdin.text()).trim()
  }

  if (!message) {
    console.error("Error: message is empty")
    process.exit(1)
  }

  const reply = await client.chat([{ role: "user", content: message }])
  console.log(reply.content)
  await flushClient(client)
} else if (command === "agent-loop") {
  const sessionId = crypto.randomUUID()
  const client = await createClient({ traceName: "agent-loop", sessionId })
  const todoManager = new TodoManager()
  const loop = new AgentLoop(client, {
    systemPrompt: [
      `You are a coding agent at ${process.cwd()}.`,
      "Use the todo tool for multi-step work.",
      "Keep exactly one step in_progress when a task has multiple steps.",
      "Refresh the plan as work advances. Prefer tools over prose.",
    ].join(" "),
    tools: builtInTools,
    todoManager,
    executeToolCall: createBuiltInToolExecutor(todoManager),
  })

  const rl = createInterface({ input, output })

  while (true) {
    let message = ""

    try {
      message = await rl.question("\x1b[36magent >> \x1b[0m")
    } catch {
      break
    }

    if (!message.trim() || ["q", "exit"].includes(message.trim().toLowerCase())) {
      break
    }

    loop.addUserMessage(message)
    const reply = await loop.run()
    if (reply) {
      console.log(reply)
    }
    console.log("")
  }

  rl.close()
  await flushClient(client)
} else {
  console.error(`Unknown command: ${command}`)
  usage()
}
