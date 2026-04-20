/**
 * 示例：两个 LLM Agent 完成一篇文章的 review-refine 协作。
 *
 * 运行方式：
 *   bun run examples/review-refine.ts
 */

import { Runtime } from "../src/runtime.ts"
import { OpenAIClient } from "../src/model/index.ts"
import { reviewRefine } from "../src/patterns/review-refine.ts"

const provider = new OpenAIClient({
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "ark-bc9c8ec1-5c70-4b6b-8b4e-8ad1c5d0cac4-bdf15",
  model: "doubao-seed-2-0-code-preview-260215",
})

const runtime = new Runtime({ provider })

// Author Agent：负责写作
const author = runtime.createAgent({
  name: "Author",
  systemPrompt:
    "You are a skilled technical writer. Your job is to write clear, concise, and well-structured content. When given feedback, revise your work thoughtfully.",
})

// Reviewer Agent：负责评审
const reviewer = runtime.createAgent({
  name: "Reviewer",
  systemPrompt:
    "You are a strict but constructive editor. Review the given content critically. If the content meets a high standard of clarity, accuracy, and structure, reply starting with 'APPROVED'. Otherwise, provide specific, actionable feedback for improvement. Be concise.",
})

const task =
  "Write a short introduction (3-4 sentences) explaining what an AI agent is and why multi-agent systems are useful."

console.log("Task:", task)
console.log("---")

const result = await reviewRefine({
  runtime,
  authorId: author.id,
  reviewerId: reviewer.id,
  task,
  maxRounds: 5,
})

console.log("---")
console.log(`Rounds: ${result.rounds} | Approved: ${result.approved}`)
console.log("\nFinal result:\n")
console.log(result.result)

runtime.stop()
