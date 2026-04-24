# magic-cc-codex-worker

### Parallel Codex workers inside Claude Code.

[![CI](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

**Languages:** English · [简体中文](README.cn.md)

> **Turn Claude Code into a multi-agent coding system.** Delegate long-running implementation, reviews, and planning to a pool of Codex workers running in parallel, isolated git worktrees — without leaving your Claude Code session.

This is the bridge between two ecosystems: Claude stays in orchestrator mode (planning, synthesis, interactive work), Codex workers absorb the grunt work. You scale your throughput, preserve your Claude budget, and keep every worker's output reviewable before it touches your main tree.

## Why use this?

- ⚡ **Parallel execution.** Fan out N Codex workers on independent subtasks in N isolated worktrees. Finish work that would serialize in a single Claude session.
- 🛡️ **Isolated experimentation.** Every implementer runs in its own `git worktree` on its own branch. Try three approaches in parallel; keep the best; discard the rest. Zero risk to your main tree.
- 🔀 **Two model families beat one.** Launch a Codex (GPT) reviewer alongside your Claude review — different models catch different classes of bugs. The plugin materializes PRs in detached worktrees so the reviewer reads real files, not a diff blob.
- 💰 **Quota arbitrage.** Claude budget running low? Dial delegation up to `max` and route everything Codex can handle over there — Claude stays in orchestrator mode. One knob (`minimal` / `balance` / `max`) controls the split.
- 🎯 **Role-tuned, observable delegation.** Not a thin "forward the prompt" wrapper — a full orchestration layer with role-based specialization (implementer / reviewer / planner / generic), resumable sessions, per-role sandbox + timeout, and first-class session tracking in a persisted registry.
- 🧰 **Production engineering.** 62 unit tests, strict TypeScript, CI on Node 20/22. Designed from an actual spike of Codex's MCP protocol — no stdout parsing, no brittle scraping. Git worktrees for parallelism, MCP protocol for transport, TOML for configuration, sandboxed execution for safety.

## How it compares

|                                       | Official Codex plugin | **magic-cc-codex-worker** |
|---------------------------------------|:---------------------:|:-------------------------:|
| Single Codex session in Claude Code   | ✅                    | ✅                         |
| Multi-agent orchestration             | ❌                    | ✅                         |
| Parallel worker execution             | ❌                    | ✅                         |
| Git worktree isolation per worker     | ❌                    | ✅                         |
| Role-based specialization             | ❌                    | ✅                         |
| Resumable session continuity          | ❌                    | ✅                         |
| Dual-model PR review                  | ❌                    | ✅                         |
| Epic / batch fan-out                  | ❌                    | ✅                         |

Official Codex plugin lets you **use** Codex. This plugin lets you **scale** Codex.

---

## Quick start

### Install (two slash commands)

Paste these two slash commands into any Claude Code session:

```text
/plugin marketplace add wenqingyu/magic-cc-codex-worker
```

```text
/plugin install magic-cc-codex-worker@magic-cc-codex-worker
```

Then **restart Claude Code** — the plugin activates on the next session. That's it: no clone, no build, no config. Claude Code fetches the repo, reads `.claude-plugin/marketplace.json`, and installs the plugin with its prebuilt `dist/`, commands, and agents.

### Prerequisites

Only the `codex` CLI itself needs to be installed and authenticated:

```bash
codex --version          # any 0.122.0+ works
codex login              # if not already logged in
```

Node / git / npm are only required if you want to **develop** the plugin — see [Development](#development) below.

### First run

```
/codex-spawn implementer "Add rate limiting to /api/upload"
# → returns agent_id, e.g. codex-impl-ab12cd

/codex-status                       # see all agents
/codex-status codex-impl-ab12cd     # single agent
/codex-merge codex-impl-ab12cd      # merge the worktree back when done
```

That's the whole loop: spawn → poll → merge.

---

## Capabilities

- **Parallel task execution** — spawn N Codex workers that all run at once, each in its own sandboxed branch.
- **Isolated experimentation** — try multiple approaches to the same task; `/codex-merge` the winner, `/codex-discard` the rest. Your main tree is never at risk.
- **Best-result selection** — review each worker's diff independently before anything lands.
- **Resumable sessions** — worker finished but you need a follow-up? `/codex-resume <agent_id>` continues the same Codex thread.
- **Dual-model review** — spawn a Codex reviewer on a PR; read its report alongside your own Claude review.
- **Multi-agent workflows** — fan out a Linear epic to one worker per child issue; collect results as a batch.

## How it works

The plugin bundles two MCP servers:

1. **`codex mcp-server`** (from Codex itself) — exposed as-is for the sub-60s synchronous fast path.
2. **`codex-team`** (this project) — async orchestration: spawn in background, track state, manage git worktrees, enforce timeouts, route results back.

Every implementer-role worker runs in its own git worktree so parallel workers never clobber each other's edits. Reviewer-role workers run read-only, optionally inside a detached worktree at a PR's head SHA.

---

## Technical reference — MCP tools

| Tool | Purpose |
|---|---|
| `spawn` | Launch a Codex agent in the background. Returns `agent_id`. |
| `status` | One agent or all — returns current state + output preview. |
| `result` | Full output of a terminal-state agent. |
| `resume` | Continue a terminal agent via Codex `codex-reply` on stored `thread_id`. |
| `cancel` | Kill a running agent; marks `cancelled`. `force` also removes worktree. |
| `merge` | Merge a completed implementer's worktree back (squash / ff / rebase). |
| `discard` | Remove a terminal agent's worktree + branch. |
| `list` | Filter agents by role / status / issue_id / has_pr / stale age. |
| `get_delegation_policy` | Read the configured delegation level + guidance. |

Plus the raw `codex` / `codex-reply` tools from `codex mcp-server`.

## Slash commands

| Command | Purpose |
|---|---|
| `/codex-spawn <role> <prompt>` | Launch an agent. |
| `/codex-status [agent_id]` | Compact progress table. |
| `/codex-resume <agent_id> <prompt>` | Continue a terminal agent. |
| `/codex-cancel <agent_id> [--force]` | Kill + optional cleanup. |
| `/codex-merge <agent_id>` | Merge back. |
| `/codex-discard <agent_id>` | Remove worktree + branch. |
| `/codex-review-pr <pr_number>` | Dual-model code review for a PR. |
| `/codex-fan-out <EPIC-NNN>` | Parallel implementer-per-child for an epic. |
| `/codex-mode [minimal\|balance\|max]` | View/set delegation level. |

## Subagents

For `Agent({ subagent_type: "...", ... })` dispatch:

- `codex-implementer` — autonomous worktree work + diff review
- `codex-reviewer` — read-only dual-model review
- `codex-planner` — plan-only output for comparison

---

## Delegation level

How aggressively should Claude delegate to Codex?

| Level | Intent |
|---|---|
| `minimal` | Codex only for things Codex does notably better (second-opinion GPT review, very long runs). |
| `balance` (default) | Balanced split. Claude handles quick/interactive work; Codex handles big/parallelizable chunks. |
| `max` | Codex handles everything it can; Claude stays in orchestrator mode. |

Set via (precedence: env > project > user > default):

```bash
# Env
export CODEX_TEAM_DELEGATION_LEVEL=max
```

```toml
# codex-team.toml (project root, committed)
[delegation]
level = "balance"
```

Claude reads the policy via `get_delegation_policy` at session start.

---

## Roles

Built-in presets (`src/roles/defaults/`):

| Role | Sandbox | Worktree | Timeout |
|---|---|---|---|
| `implementer` | `workspace-write` | branch-per-agent | 30 min |
| `reviewer` | `read-only` | detached at PR head (when `pr_number` given) | 10 min |
| `planner` | `read-only` | none | 15 min |
| `generic` | `read-only` | none | 15 min |

**Model selection.** By default, each role inherits whatever model your `~/.codex/config.toml` selects. Override per-role or per-spawn:

```toml
# codex-team.toml
[roles.implementer]
model = "gpt-5-codex"        # or whatever Codex accepts

[roles.reviewer]
model = "gpt-5"              # strong reasoning for dual-review
timeout_seconds = 900
```

Per-spawn override:

```json
{
  "role": "reviewer",
  "prompt": "...",
  "overrides": { "model": "gpt-5", "timeout_seconds": 1200 }
}
```

---

## PR review flow

```
/codex-review-pr 456
```

1. Plugin runs `gh pr view 456 --json headRefOid,headRefName,baseRefName,title,url`.
2. Creates a **detached** git worktree at the PR's head SHA under `.codex-team/worktrees/<agent_id>`.
3. Starts Codex with `sandbox: read-only`, `cwd` = that worktree, plus PR context injected into `developer_instructions`.

The reviewer now has a real filesystem checkout — can grep, read tests, inspect code context — not just a diff blob. Pair with your own review (Claude directly or a separate review skill) for two independent perspectives.

---

## Magic Flow integration

Auto-activated when `.magic-flow/` or `ops/workers.json` exists at repo root. When active:

- **Linear enrichment** — if `LINEAR_API_KEY` is set and you pass `issue_id`, the issue title / description / URL populate prompt placeholders.
- **Branch naming** — `feature/TEAM-NNN-<slug>` instead of the plain `codex/<suffix>` fallback.
- **Conventions injection** — the plugin reads your `~/.claude/CLAUDE.md` "Magic Flow Workflow Conventions" section and injects it into every Codex spawn so agents follow your branch / commit / Linear rules.
- **Worker registry mirror** — every status transition upserts into `ops/workers.json` using an MF-compatible schema; `/mf-status` picks it up for free.

To opt out: remove those markers. The plugin works cleanly outside MF projects.

---

## State

- `.codex-team/state.json` (gitignored) — agent registry, status, `thread_id`s, worktree info. Survives MCP restarts.
- `.codex-team/worktrees/<agent_id>/` — per-agent worktrees. Preserved after completion until `/codex-merge` or `/codex-discard`.
- `ops/workers.json` — MF-mode worker registry mirror.

---

## Configuration reference

All files optional. Merged in this order (highest precedence last):

1. `src/roles/defaults/*.toml` (built-in)
2. `~/.codex-team/config.toml` (user-global)
3. `<repo>/codex-team.toml` (project-committed)
4. `<repo>/.codex-team/roles.toml` (project-personal, gitignored)
5. Per-spawn `overrides`

Full example — [`codex-team.toml.example`](codex-team.toml.example).

---

## Development

```bash
npm install
npm test                         # 62 unit tests, ~3s
npm run typecheck                # strict TS
npm run build                    # compile + assets
./scripts/smoke-tools-list.sh    # verify MCP server lists all 9 tools

# Optional — integration test against real codex (requires auth):
RUN_CODEX_INTEGRATION=1 npm test
```

Project layout:

```
src/
├── index.ts              # MCP server entry (stdio)
├── orchestrator.ts       # spawn/resume/cancel/merge/discard lifecycle
├── registry.ts           # persisted agent state
├── worktree.ts           # git worktree create/remove/merge/detached
├── roles/                # TOML presets + loader + templater
├── mcp/codex-client.ts   # MCP client → codex mcp-server
├── mf/                   # Magic Flow integration (detect, linear, workers, github, conventions)
├── delegation.ts         # minimal / balance / max policy
└── types.ts

commands/                 # slash commands (markdown)
agents/                   # subagent definitions (markdown)
docs/plans/               # design + implementation plans
tests/unit/               # 62 unit tests
```

Full architecture: [`docs/plans/2026-04-24-magic-cc-codex-worker-design.md`](docs/plans/2026-04-24-magic-cc-codex-worker-design.md).

---

## Safety notes

- Implementer role uses `sandbox: workspace-write` — Codex can write files in the worktree but is kept out of the main tree. Use `danger-full-access` only if you really know what you're asking for.
- Review every worktree diff before `/codex-merge`.
- The plugin never pushes to remotes on its own. PR creation is deliberately left to the user.
- The plugin never talks to Linear or GitHub unless you've provided credentials (`LINEAR_API_KEY`, `gh auth`).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Tests required; strict TypeScript; small PRs.

## License

[MIT](LICENSE) © magic-cc-codex-worker contributors.

Part of **Magic Stack** — an agent-autonomous development stack for production-ready projects. This plugin is its multi-agent bridge between Claude Code and the Codex ecosystem.
