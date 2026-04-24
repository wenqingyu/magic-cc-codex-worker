# Registry submission copy

Copy-paste material for the registries that can't be submitted via PR. Written to match each registry's calm, factual tone — no marketing adjectives.

---

## 1. claudecodemarketplace.net

**Submit at:** https://claudecodemarketplace.net/plugins/submit (requires free account)

### Fields (paste-ready)

| Field | Value |
|---|---|
| **Plugin name** | `magic-codex` |
| **Repository URL** | `https://github.com/wenqingyu/magic-cc-codex-worker` |
| **Homepage URL** | `https://github.com/wenqingyu/magic-cc-codex-worker` |
| **Author** | `Wenqing Yu` |
| **License** | `PolyForm Noncommercial 1.0.0` |
| **Category** | `Agents / Orchestration` (or closest equivalent) |

### Short description (for card / list view)

> Turns OpenAI Codex into a pool of parallel Claude Code agent workers. Each agent runs in an isolated git worktree. Resumable sessions, dual-model PR review, role-based specialization.

### Long description (for detail page)

> A Claude Code plugin that orchestrates OpenAI Codex as a pool of agent workers. Spawn multiple Codex agents in parallel — each in its own git worktree — to run long implementation tasks, code reviews, and planning out of Claude's main context window.
>
> **What it provides**
> - 9 slash commands under the `/magic-codex:<verb>` namespace (`spawn`, `status`, `resume`, `cancel`, `merge`, `discard`, `review-pr`, `fan-out`, `mode`).
> - 3 subagents — `implementer`, `reviewer`, `planner` — dispatchable via Claude's native `Agent` tool.
> - 9 custom MCP tools on a bundled server, plus the raw `codex` / `codex-reply` tools for the synchronous fast path.
>
> **Notable features**
> - **Dual-model PR review:** materialize a PR in a detached worktree and run a GPT reviewer alongside a Claude review.
> - **Resumable sessions:** continue a completed or failed agent across Claude Code sessions using Codex's native `thread_id` + `codex-reply`.
> - **Delegation level** (`minimal` / `balance` / `max`) tells Claude how aggressively to offload work to Codex — configurable user-global or per-project.
> - **Magic Flow integration** auto-detected in MF projects: Linear issue enrichment, MF-style branch naming, `ops/workers.json` mirror.
>
> **Engineering**
> - 62 unit tests, strict TypeScript, CI green on Node 20 and 22.
> - Self-contained single-file MCP server bundle — no `npm install` needed at install time.
>
> **Install (two slash commands)**
>
> ```
> /plugin marketplace add wenqingyu/magic-cc-codex-worker
> /plugin install magic-codex@magic-codex
> ```
>
> Then `/reload-plugins` and verify with `/magic-codex:status`.

### Tags

`codex`, `mcp`, `multi-agent`, `parallel`, `orchestration`, `claude-code`, `dual-model-review`, `worktree`

---

## 2. hesreallyhim/awesome-claude-code

**⏳ BLOCKED: repo must be ≥ 1 week old.** Current repo age: < 1 day. Earliest submission: **2026-05-01** (8 days out).

**Submit at:** https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml

> **⚠️ Submit via the web UI only — not `gh` CLI.** The bot auto-closes / bans CLI submissions.

### Pre-filled form values

| Field | Value |
|---|---|
| **Display Name** | `magic-codex` |
| **Category** | `Agent Skills` |
| **Sub-Category** | `General` (plugins fall under this) |
| **Primary Link** | `https://github.com/wenqingyu/magic-cc-codex-worker` |
| **Author Name** | `Wenqing Yu` |
| **Author Link** | `https://github.com/wenqingyu` |
| **License** | `PolyForm Noncommercial 1.0.0` |

### Description (1–3 sentences, no emojis, non-promotional)

> Orchestrates OpenAI Codex as a pool of parallel Claude Code agent workers, each running in its own git worktree. Supports resumable sessions, dual-model PR review (PR mounted in a detached worktree for the reviewer), and role-based specialization via 9 slash commands and 3 subagents.

### Validation — "Validate Claims" field

> Plugin has 62 unit tests covering the orchestrator lifecycle (spawn / resume / cancel / merge / discard), registry persistence, worktree management, role preset precedence, delegation policy resolution, and MCP tool surface. CI passes on Node 20 and 22. Install verified end-to-end — the MCP server starts, registers 9 custom tools, and returns structured JSON for `/magic-codex:status` on a fresh Claude Code session.

### Specific Task — "Specific Task" field

> A developer wants to implement three candidate approaches to the same refactor in parallel without risking the main branch. They run `/magic-codex:spawn implementer "approach A: use strategy pattern"`, then repeat with "approach B: use visitor pattern" and "approach C: use callbacks". Each spawns a Codex agent in its own isolated git worktree on its own branch. The developer reviews all three diffs and runs `/magic-codex:merge <agent_id>` on the winner, `/magic-codex:discard` on the rest.

### Specific Prompt — "Specific Prompt" field

> After installing the plugin, paste this prompt in Claude Code to exercise the full round-trip: "Use `/magic-codex:spawn implementer` to write a short Python script that prints 'hello, magic-codex' and commits it. Then `/magic-codex:status` to watch it run, and `/magic-codex:result <agent_id>` to show the output once it completes."

### Etiquette notes

- Read `docs/CONTRIBUTING.md` and `COOLDOWN.md` **before** submitting.
- If bot rejects on formatting, fix and resubmit within the cooldown window.
- Don't submit to multiple categories — pick one.

---

## 3. buildwithclaude.com

**Live site** 403s to WebFetch, but source-of-truth is the GitHub repo **davepoon/buildwithclaude**. Submission is a PR (heavier — vendor plugin files).

**This one I (Claude) can handle via an agent PR** — if you'd rather not wait, see the background-running agent status.

---

## 4. claudemarketplaces.com

**No action needed.** Site auto-crawls GitHub daily for repos containing `.claude-plugin/marketplace.json`. We have one. Should appear within 24–48 hours.

Manual nudge: no submission form found. If you want to speed things up, tweet / DM the maintainer with the repo URL.

---

## 5. quemsah/awesome-claude-plugins

**No action needed / popularity-gated.** Their crawler ranks by stars (~3600+ needed for top 100). We've added the GitHub topics (`claude-code-plugins`, `claude-code-plugins-marketplace`) so the crawler can find us once stars accumulate.

---

## Reminder for 2026-05-01 (hesreallyhim submission window)

In 8 days, submit to hesreallyhim/awesome-claude-code using the web form above. Repo will be ≥1 week old then. All form content is pre-drafted in this file.
