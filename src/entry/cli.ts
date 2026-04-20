#!/usr/bin/env bun
/**
 * baogent CLI
 *
 * 用法：
 *   bun run cli chat "你好"
 *   bun run cli agent                # 进入 agent REPL（内置 bash 工具）
 *   bun run cli -c config/local.toml agent
 *
 * 配置优先级：env vars > -c/--config 文件 > 当前目录 baogent.toml
 *
 * 环境变量：
 *   MODEL_API_KEY     API Key
 *   MODEL_BASE_URL    API 端点
 *   MODEL_NAME        模型名称
 */

import { OpenAIClient } from "../model/index.ts"
import { loadConfigFile, findDefaultConfig, resolveModelConfig } from "./config.ts"
import { AgentLoop } from "../loop.ts"

// ── 解析参数 ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2)

function usage(): never {
  console.error("Usage: baogent [-c <config>] <command> [args]")
  console.error("")
  console.error("Commands:")
  console.error("  chat <message>   Single-turn chat")
  console.error("  agent            Interactive agent REPL with bash tool")
  console.error("")
  console.error("Options:")
  console.error("  -c, --config <path>  Config file (default: baogent.toml)")
  process.exit(1)
}

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

const fileConfig = configPath ? await loadConfigFile(configPath) : await findDefaultConfig()
const client = new OpenAIClient(resolveModelConfig(fileConfig))

// ── 命令：chat ────────────────────────────────────────────────────────────────

if (command === "chat") {
  let message = rest.join(" ").trim()

  // 没有传参数时从 stdin 读取
  if (!message) {
    process.stdout.write("You: ")
    message = (await Bun.stdin.text()).trim()
  }

  if (!message) {
    console.error("Error: message is empty")
    process.exit(1)
  }

  const reply = await client.chat([{ role: "user", content: message }])
  console.log(reply)

// ── 命令：agent ───────────────────────────────────────────────────────────────

} else if (command === "agent") {
  const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to inspect and change the workspace. Act first, then report clearly.`

  const TOOLS = [{
    name: "bash",
    description: "Run a shell command in the current workspace.",
    parameters: {
      type: "object" as const,
      properties: { command: { type: "string", description: "Shell command to run" } },
      required: ["command"],
    },
  }]

  const DANGEROUS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]

  async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name !== "bash") return `Error: unknown tool "${name}"`
    const cmd = String(args["command"] ?? "")
    if (DANGEROUS.some((d) => cmd.includes(d))) return "Error: dangerous command blocked"

    process.stdout.write(`\x1b[33m$ ${cmd}\x1b[0m\n`)

    const proc = Bun.spawn(["bash", "-c", cmd], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    await proc.exited

    const output = (stdout + stderr).trim() || "(no output)"
    const truncated = output.slice(0, 50_000)
    console.log(truncated.slice(0, 200))
    return truncated
  }

  // REPL
  const agent = new AgentLoop({ client, tools: TOOLS, callTool, systemPrompt: SYSTEM })
  process.stdout.write("\x1b[36mbaogent agent >> \x1b[0m")

  for await (const line of console) {
    const query = line.trim()
    if (!query || query === "q" || query === "exit") break

    const result = await agent.loop(query)
    if (result.content) console.log(`\n${result.content}`)
    console.log()

    process.stdout.write("\x1b[36mbaogent agent >> \x1b[0m")
  }

} else {
  console.error(`Unknown command: ${command}`)
  usage()
}
