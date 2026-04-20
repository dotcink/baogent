import type { AgentId } from "../types.ts"
import type { Runtime } from "../runtime.ts"

export interface ReviewRefineOptions {
  runtime: Runtime
  authorId: AgentId
  reviewerId: AgentId
  task: string
  maxRounds?: number
  timeoutMs?: number
  onRound?: (round: number, draft: string, feedback?: string) => void
}

export interface ReviewRefineResult {
  result: string
  rounds: number
  approved: boolean
  history: Array<{ draft: string; feedback?: string }>
}

const APPROVED_PREFIX = "APPROVED"

/**
 * 多轮对抗式 review-refine 协作。
 *
 * - Author 负责产出/修改内容
 * - Reviewer 负责评审，回复以 "APPROVED" 开头表示通过，否则给出修改意见
 * - 达到 maxRounds 后强制结束，approved=false
 */
export async function reviewRefine(
  opts: ReviewRefineOptions
): Promise<ReviewRefineResult> {
  const {
    runtime,
    authorId,
    reviewerId,
    task,
    maxRounds = 5,
    timeoutMs = 120_000,
    onRound,
  } = opts

  const history: Array<{ draft: string; feedback?: string }> = []
  let draft = ""
  let feedback: string | undefined = undefined

  for (let round = 1; round <= maxRounds; round++) {
    // 1. Author 产出/修改内容
    const authorPrompt =
      round === 1
        ? task
        : `Here is the reviewer's feedback:\n\n${feedback}\n\nPlease revise your work accordingly.`

    console.log(`[Round ${round}] Author drafting...`)
    draft = await runtime.request(authorId, authorPrompt, { timeoutMs })

    // 2. Reviewer 评审
    const reviewerPrompt = `Please review the following work. If it is satisfactory, reply starting with "${APPROVED_PREFIX}". Otherwise, provide specific feedback for improvement.\n\nWork to review:\n\n${draft}`

    console.log(`[Round ${round}] Reviewer reviewing...`)
    const verdict = await runtime.request(reviewerId, reviewerPrompt, {
      timeoutMs,
    })

    if (verdict.startsWith(APPROVED_PREFIX)) {
      history.push({ draft })
      onRound?.(round, draft)
      console.log(`[Round ${round}] APPROVED`)
      return { result: draft, rounds: round, approved: true, history }
    }

    feedback = verdict
    history.push({ draft, feedback })
    onRound?.(round, draft, feedback)
    console.log(`[Round ${round}] Needs revision`)
  }

  return { result: draft, rounds: maxRounds, approved: false, history }
}
