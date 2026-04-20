---
name: baogent-code-review
description: Use when reviewing code changes in this repository, including PR review, patch review, commit review, regression review, style review, naming review, or when the user asks to "review" code. Focus on bugs, behavior regressions, style inconsistencies, naming problems, protocol mismatches, architecture violations, and missing validation in this Bun/TypeScript agent project.
---

# BaoGent Code Review

Review 以发现缺陷、回归风险、风格不一致和命名问题为主，优先输出 findings。

## Scope

This skill is for code review in the `baogent` repository. Prefer it when reviewing:

- local uncommitted changes
- a commit or commit range
- a specific file or module change
- a PR-style diff

Do not use it for general explanation or implementation unless the user explicitly wants a review.

## Workflow

1. Inspect the review scope first with git metadata.
   Use `git status --short`, `git diff --stat`, `git diff`, `git show`, `git log --oneline` as needed.
2. Read the touched files and the surrounding interfaces.
3. Review against repository constraints before commenting on style.
4. If validation exists, run the narrowest useful check.
   For this repo, prefer `bun run typecheck` when relevant.
5. Report findings ordered by severity with file/line references.

## What To Look For

- Correctness bugs and behavior regressions
- Style inconsistencies
  Check whether the change breaks existing repository style, naming, or file/module conventions
- Naming problems
  Watch for vague, redundant, misleading, or inconsistent names across types, functions, files, and commands
- OpenAI tool-calling protocol mismatches
  Check `tools`, `tool_calls`, `tool` messages, argument parsing, and message history shape
- Interface bloat
  This repo values minimal interfaces and avoiding redundant types
- Layering violations
  Keep dependencies one-way and preserve clear boundaries between `model`, `agent`, and `entry`
- Modular design regressions
  Shared logic should not be duplicated across CLI, loop, and tool modules
- CLI or config breakage
  Check command behavior, env var usage, and config loading compatibility
- Validation gaps
  Missing type checks, unsafe assumptions, or missing handling for malformed tool arguments
- Safety issues
  Especially around shell execution, dangerous commands, timeouts, and output truncation

## Repository-Specific Rules

- Follow `AGENT.md`
  Prioritize simplicity, modularity, and layered architecture
- Prefer reuse of existing `model` definitions when possible
- Avoid custom ad-hoc protocols when the project already chose a standard protocol
- Do not spend review budget on low-value style nits unless they hide a real maintenance risk
- Still call out style or naming issues when they create inconsistency, confusion, or future maintenance cost
- Mention missing tests or missing `typecheck` coverage when they materially affect confidence

## Output Format

Findings first. Keep them concrete.

- Start with a flat list of findings, ordered by severity
- Each finding should include:
  file path
  line reference when available
  the concrete risk or regression
  why it matters
- After findings, add:
  `Open questions` if needed
  `Residual risk` if no findings or validation was limited

If there are no findings, say that explicitly and note any remaining uncertainty.
