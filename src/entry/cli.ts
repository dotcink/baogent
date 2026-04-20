#!/usr/bin/env bun
/**
 * baogent CLI
 *
 * 用法：
 *   bun run cli chat "你好"
 *   bun run cli --config ./my.json chat "你好"
 *   bun run cli chat              # 从 stdin 读取
 *   bun run cli agent-loop
 *
 * 配置优先级：env vars > --config 文件 > 当前目录默认文件（baogent.json）
 *
 * 环境变量：
 *   MODEL_API_KEY     API Key
 *   MODEL_BASE_URL    API 端点
 *   MODEL_NAME        模型名称
 */

import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { AgentLoop, bashTool, executeBashTool } from "../agent/index.ts"
import { OpenAIClient } from "../model/index.ts"
import { loadConfigFile, findDefaultConfig, resolveModelConfig } from "./config.ts"

// ── 解析参数 ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2)

function usage(): never {
  console.error("Usage: baogent [--config <path>] <command> [args]")
  console.error("")
  console.error("Commands:")
  console.error("  chat <message>   Send a message to the model")
  console.error("  agent-loop       Start an interactive agent loop with bash tool")
  console.error("")
  console.error("Options:")
  console.error("  -c, --config <path>  Path to config file (default: baogent.toml)")
  process.exit(1)
}

// 提取 --config 选项
let configPath: string | undefined
const cmdArgs: string[] = []

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config" || args[i] === "-c") {
    configPath = args[++i]
  } else {
    cmdArgs.push(args[i]!)
  }
}

const [command, ...rest] = cmdArgs
if (!command) usage()

// ── 加载配置 ──────────────────────────────────────────────────────────────────

const fileConfig = configPath
  ? await loadConfigFile(configPath)
  : await findDefaultConfig()

const modelConfig = resolveModelConfig(fileConfig)
const client = new OpenAIClient(modelConfig)

// ── 命令处理 ──────────────────────────────────────────────────────────────────

if (command === "chat") {
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
} else if (command === "agent-loop") {
  const loop = new AgentLoop(client, {
    systemPrompt: [
      `You are a coding agent at ${process.cwd()}.`,
      "Use the provided tools to inspect and change the workspace.",
      "Act first, then report clearly.",
    ].join(" "),
    tools: [bashTool],
    executeToolCall: executeBashTool,
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
} else {
  console.error(`Unknown command: ${command}`)
  usage()
}
