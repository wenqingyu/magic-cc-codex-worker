# magic-cc-codex-worker

[![CI](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

**Languages:** English · [简体中文](README.cn.md)

> A Claude Code plugin that turns **[Codex](https://github.com/openai/codex) into a pool of agent workers** — spawn, track, resume, review, and merge Codex sessions directly from inside Claude Code.

## Why use this?

- 🎯 **The best way to systematically delegate Codex agents as Claude Code sub-workers.** Not a thin wrapper that just forwards a prompt to a single Codex call — this is a full orchestration layer with role-based specialization, git worktree isolation, resumable sessions, parallel fan-out, and first-class session tracking. Every delegation is tuned, sandboxed, and observable.
- 💰 **Save and balance your Claude Code quota.** Offload long-running implementation, reviews, and planning to Codex — let Claude stay in orchestrator mode. Your Claude budget goes further; the Codex stack absorbs the grunt work. One knob (`minimal` / `balance` / `max`) controls the split.
- 🔀 **Two model families beat one.** Spawn a Codex (GPT) reviewer alongside Claude's own review — different models catch different classes of bugs. The plugin materializes PRs in detached git worktrees so the reviewer inspects real files, not a diff blob.
- 🧰 **Real engineering, not a toy.** 62 unit tests, strict TypeScript, CI on Node 20/22. Designed from an actual spike of Codex's MCP protocol — no stdout parsing, no brittle scraping. Git worktrees for parallelism, MCP protocol for transport, TOML for configuration, sandboxed execution for safety.

**Use cases** — run long implementation tasks out-of-process so they don't eat Claude's context • fan out parallel Codex workers on independent subtasks • get a second-opinion GPT review on PRs alongside Claude's review • resume named agents across conversations.

---

## Quick start

### One-prompt install (recommended)

Paste this into any Claude Code session — Claude will clone, build, register, and verify the plugin end-to-end:

```text
Install the `magic-cc-codex-worker` Claude Code plugin from https://github.com/wenqingyu/magic-cc-codex-worker.

Before starting, verify prerequisites — abort and tell me if any fail:
- `node --version` is v20 or later
- `git --version` is v2.40 or later
- `codex --version` succeeds (Codex CLI installed and authenticated)

Steps:
1. Run: `mkdir -p ~/.claude/plugins-local && git clone https://github.com/wenqingyu/magic-cc-codex-worker ~/.claude/plugins-local/magic-cc-codex-worker` — skip the clone if that directory already exists and is a valid clone of this repo.
2. Run: `cd ~/.claude/plugins-local/magic-cc-codex-worker && npm install && npm run build`.
3. In this Claude Code session, invoke the slash command: `/plugin marketplace add ~/.claude/plugins-local/magic-cc-codex-worker`
4. Invoke the slash command: `/plugin install magic-cc-codex-worker@magic-cc-codex-worker` — the format is `<plugin-name>@<marketplace-name>`; both happen to be the same here.
5. Tell me to restart Claude Code; the plugin only activates after restart. After I restart, verify by running `/codex-status` — it should return an empty agent list. Confirm that these 9 `codex-team` MCP tools are registered: spawn, status, result, resume, cancel, list, merge, discard, get_delegation_policy.

If any step fails, stop and report exactly which command failed and its error output. Do not attempt workarounds.
```

### Manual install

```bash
# Prerequisites: Node 20+, git 2.40+, codex CLI authenticated
codex --version          # any 0.122.0+ works
git clone https://github.com/wenqingyu/magic-cc-codex-worker ~/.claude/plugins-local/magic-cc-codex-worker
cd ~/.claude/plugins-local/magic-cc-codex-worker
npm install && npm run build
```

Then in a Claude Code session:

```
/plugin marketplace add ~/.claude/plugins-local/magic-cc-codex-worker
/plugin install magic-cc-codex-worker@magic-cc-codex-worker
```

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

## How it works

The plugin bundles two MCP servers:

1. **`codex mcp-server`** (from Codex itself) — exposed as-is for the sub-60s synchronous fast path.
2. **`codex-team`** (this project) — async orchestration: spawn in background, track state, manage git worktrees, enforce timeouts, route results back.

Every implementer-role agent runs in its own git worktree so parallel agents never clobber each other's edits. Reviewer-role agents run read-only, optionally inside a detached worktree at a PR's head SHA.

---

## MCP tools

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

Part of **Magic Stack** — an agent-autonomous development stack for production-ready projects.
