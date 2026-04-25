# Bao Agent

从 0 开始构建一个高度自主的 Agent。这个项目把模型视为最内层智能，围绕模型逐步补齐工具、循环、配置和入口能力，也就是一层层加上可控的 harness。

## 当前能力

- `chat`：向模型发送单轮消息
- `agent-loop`：启动带内置工具的交互式 agent loop
- 内置工具：`bash`、`read_file`、`write_file`、`edit_file`
- TOML 配置加载：支持显式配置文件与默认配置文件
- 环境变量覆盖：敏感信息优先通过环境变量注入

## 项目结构

- `src/model`：模型与 provider 适配
- `src/agent`：agent loop、工具调用与 bash 能力
- `src/entry`：CLI 与配置加载入口
- `config/`：配置样例

## 环境要求

- [Bun](https://bun.sh/)

安装依赖：

```bash
bun install
```

## 快速开始

1. 准备配置文件：

```bash
cp config/example.toml config/.local.toml
```

2. 填入 `model.provider`、`model.apiKey`，必要时补充 `baseURL`、`model` 与 `maxTokens`

3. 运行单轮对话：

```bash
bun run cli chat "你好"
```

4. 启动交互式 agent loop：

```bash
bun run cli agent-loop
```

查看帮助：

```bash
bun run cli --help
```

## CLI 用法

```bash
bun run cli [--config <path>] [--model-log <path>] <command> [args]
```

命令：

- `chat <message>`：向模型发送一条消息
- `agent-loop`：启动交互式 agent loop，提供 `bash`、`read_file`、`write_file`、`edit_file`

选项：

- `-c, --config <path>`：指定配置文件路径
- `--model-log <path>`：把每次模型调用的输入/输出核心内容以 JSONL 追加到指定文件

如果 `chat` 没有传入消息，CLI 会从标准输入读取内容。

## 配置

配置优先级：

```text
环境变量 > --config 指定文件 > 当前目录默认配置文件
```

默认配置文件名：

- `config/.local.toml`

环境变量：

- `MODEL_PROVIDER`：模型协议，支持 `openai`、`anthropic`、`gemini`
- `MODEL_API_KEY`：模型 API Key
- `MODEL_BASE_URL`：模型 API 端点
- `MODEL_NAME`：模型名称
- `MODEL_MAX_TOKENS`：最大输出 token 数
日志示例：

```bash
bun run cli --model-log ./logs/model-io.jsonl chat "你好"
```

当前支持的 provider：

- `openai`：OpenAI Chat Completions 兼容协议，也可接火山引擎、Together、Ollama 等兼容端点
- `anthropic`：Anthropic Messages API，支持 Claude 工具调用
- `gemini`：Google Gemini `generateContent` API，支持 function calling

示例配置见 [config/example.toml](/Users/dotcink/GitHub/baogent/config/example.toml)。
Langfuse 文件配置示例见 [config/langfuse.example.toml](/Users/dotcink/GitHub/baogent/config/langfuse.example.toml)。

## 开发

启动 CLI：

```bash
bun run cli
```

类型检查：

```bash
bun run typecheck
```

## 约定

- 修改 CLI 用法、配置格式、默认文件名或环境变量时，同步更新代码注释、帮助文本、示例配置和本文档
- 保持分层边界：`src/model` 不依赖 `src/agent` 或 `src/entry`；`src/agent` 不依赖 `src/entry`
