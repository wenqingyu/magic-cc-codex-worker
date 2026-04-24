# magic-cc-codex-worker — Design

**Date:** 2026-04-24
**Status:** Draft, approved for implementation planning
**Author:** Architect brainstorm (yuwenqingisu@gmail.com)

## Purpose

A Claude Code plugin that lets Claude Code orchestrate Codex as a pool of agent workers — spawning them in parallel, resuming sessions across conversations, isolating their filesystem writes in git worktrees, and specializing them via role presets (implementer, reviewer, planner, generic).

## Goals

1. **Context offload** — long-running work runs out-of-process; only summaries return to Claude's context.
2. **Parallelism** — fan out N independent tasks across N Codex workers.
3. **Session continuity** — resume named agents across conversations.
4. **Role specialization** — per-role model, sandbox, prompt, worktree policy. Enables use cases like "SOTA GPT reasoning model as a second-opinion PR reviewer."
5. **Magic Flow integration (optional, auto-detected)** — when running inside an MF project, behave as a first-class MF worker (Linear issue flow, branch conventions, worker registry, hooks).

## Non-goals

- Not a replacement for Claude Code's built-in `Agent` tool (which remains the default for small subtasks).
- Not a multi-tenant server — single-user, single-machine.
- No progress streaming in v1 (codex-mcp-server doesn't emit it today).
- No consensus/voting logic between reviewers — we surface both reports; humans adjudicate.

## Spike findings — what `codex mcp-server` already provides

Running `codex mcp-server` and enumerating its MCP surface revealed two first-class tools:

- **`codex`** — start a session. Inputs: `prompt` (req), `cwd`, `model`, `sandbox`, `approval-policy`, `base-instructions`, `developer-instructions`, `config`, `profile`. Returns `{ threadId, content }`.
- **`codex-reply`** — continue a session. Inputs: `threadId`, `prompt`. Returns `{ threadId, content }`.

Native capabilities that eliminate custom work:
- **Worktree-per-agent** via `cwd` input.
- **Role-based model/sandbox/approval** via first-class inputs.
- **Role system prompt** via `developer-instructions`.
- **Session continuity** via `threadId` + `codex-reply`.

Gaps that this plugin fills:
- **Synchronous tool contract** (blocks until session finishes) → we need an async layer.
- **No status/list/cancel** → we maintain a registry.
- **No worktree lifecycle** → we own it.
- **No role presets / prompt templating** → we own it.
- **No Magic Flow / Linear integration** → we own it.

## Architecture

### Shape

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code (main conversation)                         │
└─────┬────────────────────────────────────┬──────────────┘
      │ MCP                                │ MCP
      ▼                                    ▼
┌──────────────────────┐        ┌────────────────────────┐
│  codex-team MCP      │        │  codex mcp-server      │
│  (this plugin)       │        │  (raw, for sync fast   │
│  - spawn/resume      │        │   path: codex/codex-   │
│  - status/list/...   │        │   reply tools exposed  │
│  - worktrees         │        │   directly to Claude)  │
│  - roles             │        └────────────────────────┘
│  - MF integration    │
└─────┬────────────────┘
      │ spawns N children, one per agent
      ▼
 ┌─────────┐  ┌─────────┐  ┌─────────┐
 │ codex   │  │ codex   │  │ codex   │
 │ mcp-    │  │ mcp-    │  │ mcp-    │  … (bounded by max_parallel)
 │ server  │  │ server  │  │ server  │
 └─────────┘  └─────────┘  └─────────┘
```

Two MCP servers ship in the plugin:

1. **Raw `codex mcp-server`** — registered for Claude's use directly. Gives Claude the `codex` and `codex-reply` tools for the synchronous fast path (quick reviews, sub-60s tasks).
2. **Custom `codex-team` MCP server** (this project) — async orchestration: `spawn`, `resume`, `status`, `list`, `result`, `cancel`, `merge`, `discard`. Internally spawns one codex-mcp-server child per in-flight agent and talks to them via MCP protocol (no stdout parsing).

### Subprocess model

**One codex-mcp-server child per in-flight agent.** Tradeoff decided:
- Surgical cancel (process kill kills only that agent).
- Failure isolation.
- Simpler lifecycle (child = agent).
- Startup ~200-500ms per spawn (acceptable).
- Bounded by `max_parallel` (default 5).

### Async tool contract

| Tool | Latency | Blocks on Codex? |
|------|---------|------------------|
| `spawn` | <2s | No — fires Codex call in background |
| `resume` | <2s | No |
| `status` / `list` / `result` | <50ms | No |
| `cancel` | <100ms | No |
| `merge` / `discard` | <500ms | No |

All tools return well inside Claude Code's ~60s MCP window.

### Polling contract

After `spawn`, Claude polls `status(agent_id)` every 15–30s until terminal state. `status` response includes `last_output_preview` (first 500 chars) inline; `result(agent_id)` returns full output for historical agents. `status()` with no args returns all agents — the primitive for fan-out.

Recommended pattern (documented in tool descriptions): on fan-outs, Claude uses the `schedule` / `ScheduleWakeup` skill to defer rechecks by 5–30 min rather than polling in a tight loop.

## Data model

### `AgentRecord`

```ts
type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type AgentRole = "implementer" | "reviewer" | "planner" | "generic";

interface AgentRecord {
  agent_id: string;           // human-readable — "codex-TEAM-123" or "codex-rvw-a1b2"
  role: AgentRole;
  thread_id: string | null;   // Codex's native threadId; null until session completes once
  status: AgentStatus;
  cwd: string;                // absolute path — worktree for implementer, repo root for reviewer
  worktree: {
    path: string;
    branch: string;
    base_ref: string;
    created_at: string;
  } | null;
  model: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  issue_id: string | null;    // Linear issue, MF mode
  pr_number: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_prompt: string;
  last_output: string | null;
  error: { message: string; stderr_tail?: string } | null;
  pid: number | null;
}
```

### Persistence

- `.codex-team/state.json` at repo root (gitignored), atomic write (temp + rename).
- Loaded at MCP server start; persisted on every mutation (single-writer mutex, trivially safe given Node's single-threaded event loop).
- MF projects additionally mirror subset into `ops/workers.json` on status transitions.

## Lifecycles

### Agent state machine

```
  spawn()
    │
    ▼
  queued ──(slot acquired, worktree ready, codex call dispatched)──▶ running
                                                                        │
             ┌─────────────────────────┬──────────────────────────────┤
             ▼                         ▼                              ▼
         completed                  failed                      cancelled
             │
          resume()
             │
             ▼
          running   (codex-reply with stored thread_id)
```

Key property: `thread_id` is known only **after** the first session completes. codex-mcp-server emits `{ threadId, content }` atomically at end of the `codex` tool call, not mid-session. During `running`, users address agents by `agent_id` only.

### Worktree lifecycle

- **Create** on spawn for `implementer`/`planner`: `git worktree add -b <branch> .codex-team/worktrees/<agent_id> <base_ref>`.
  - Branch naming (MF): `feature/TEAM-NNN-<slug>`. Standalone: `codex/<agent_id>`.
- **Preserve across `completed`** — user reviews diff, then `/codex merge <agent_id>` or `/codex discard <agent_id>`.
- **GC on `cancelled`** with opt-in flag (`force: true`) — partial work often worth inspecting.
- **SessionStop hook** prompts for cleanup of worktrees older than N days in terminal states.

### Reviewer worktree sub-modes (distinct from implementer)

- `worktree_mode = "pr"` — caller passes `pr_number`. Plugin runs `gh pr view --json headRefOid,headRefName,baseRefName`, creates detached worktree at PR head SHA. Read-only sandbox. Auto-removed on completion. Gives reviewer real filesystem access to PR contents (grep, read tests, inspect context) — not just a diff blob.
- `worktree_mode = "ref"` — caller passes `head_ref` (+ optional `base_ref`).
- `worktree_mode = "none"` — no worktree, runs in repo cwd read-only.

### MCP server lifecycle

- Started by Claude Code plugin loader.
- On start: load state, scan for orphaned `running` records → mark `failed` with `error: "MCP server restart"`. `thread_id`s captured before restart remain valid → `resume` recovers.
- On shutdown: persist state, SIGTERM all codex-mcp-server children.

## Role presets

TOML, merged with field-level deep merge across precedence layers.

### Precedence (lowest → highest)

1. Plugin built-in defaults (`src/roles/defaults/*.toml`)
2. User global (`~/.codex-team/roles.toml`)
3. Project committed (`codex-team.toml` at repo root)
4. Project personal (`.codex-team/roles.toml`, gitignored)
5. Per-spawn overrides

### Built-in defaults (summary)

| Role | Model | Sandbox | Worktree | Timeout |
|------|-------|---------|----------|---------|
| `implementer` | `gpt-5.2-codex` | `workspace-write` | yes, auto-create | 30m |
| `reviewer` | `gpt-5.2` | `read-only` | PR-mode | 10m |
| `planner` | `gpt-5.2` | `read-only` | no | 15m |
| `generic` | (caller supplied) | `read-only` | no | 15m |

Each preset includes `developer_instructions` with placeholder substitution.

### Placeholders

Resolved at spawn time against agent context:

- Always: `{{agent_id}}`, `{{role}}`, `{{cwd}}`
- Worktree present: `{{worktree_path}}`, `{{branch}}`, `{{base_ref}}`
- Linear-linked (MF + `issue_id`): `{{issue_id}}`, `{{issue_title}}`, `{{issue_description}}`, `{{issue_url}}`
- PR-linked (reviewer + `pr_number`): `{{pr_number}}`, `{{pr_title}}`, `{{pr_head_ref}}`, `{{pr_diff_url}}`
- MF mode: `{{mf_conventions}}` (extracted from `~/.claude/CLAUDE.md`)
- From `codex-team.toml` user-defined: `{{user.*}}`, `{{env.*}}`

Unresolved placeholders pass through as literals with a non-fatal warning in the agent record.

### Per-spawn overrides

```ts
spawn({
  role: "implementer",
  prompt: "Add rate limiting to /api/upload",
  issue_id?: "TEAM-123",
  pr_number?: 456,
  base_ref?: "main",
  overrides?: {
    model, sandbox, approval_policy, timeout_seconds,
    developer_instructions_append,       // appends to role's template
    developer_instructions_replace,      // full replacement (escape hatch)
    config,                              // forwarded verbatim to codex config
  }
})
```

## Magic Flow integration

Auto-detected via `[ -d .magic-flow ]` or `[ -f ops/workers.json ]`. Opt-outable in `codex-team.toml`:

```toml
[mf]
auto_detect = true
link_linear = true
dual_review = false       # off by default — enable after validating
branch_naming = "mf"      # "mf" | "plain"
worker_registry = true
```

### Integration points

| Behavior | Mechanism |
|---|---|
| Linear issue fetch | `mcp__claude_ai_Linear__get_issue`; fallback to REST via `LINEAR_API_KEY`. |
| Branch naming | `feature/TEAM-NNN-<slug>` from issue title. |
| `{{mf_conventions}}` | Parsed "Magic Flow Workflow Conventions" section from `~/.claude/CLAUDE.md`. |
| Worker registry mirror | Upsert `AgentRecord` subset into `ops/workers.json` on every status transition. |
| `mf-session-start` | Fired on `spawn` — Linear to "In Progress", worker comment. |
| `mf-session-stop` | Fired on terminal status — Linear/registry update. |
| `mf-on-pr-created` | Fired when PR opens on the agent's branch — "In Review" transition. |
| Dual-model review | When `mf.dual_review = true`, `mf-on-pr-created` also spawns a reviewer-role Codex agent alongside the Claude `mf-pr-reviewer`. Both post PR comments. |
| `/codex fan-out EPIC-123` | MF-only: reads Linear epic's children, spawns N implementers in parallel, each in its own worktree on its own issue. |

### Not integrated

`mf-e2e-tester`, `magic-ontology` (`mo-*`). Can be considered later.

## Tool surface (custom MCP)

| Tool | Purpose |
|------|---------|
| `spawn(role, prompt, issue_id?, pr_number?, base_ref?, overrides?)` | Fire-and-forget launch; returns `{agent_id, status, worktree_path?}` |
| `resume(agent_id, prompt)` | Continue a completed/failed session via `codex-reply` |
| `status(agent_id?)` | Per-agent or all-agents registry snapshot + summary counts |
| `result(agent_id)` | Full `last_output` (status has only preview) |
| `cancel(agent_id, force?)` | Kill child, mark cancelled, preserve worktree unless `force` |
| `merge(agent_id, strategy?)` | Merge worktree branch back (squash/ff/rebase) |
| `discard(agent_id)` | Remove worktree + delete branch |
| `list(filter?)` | Optional filters: role, status, stale, has_pr |

## Slash commands

Thin wrappers over MCP tools, ergonomic for humans in the transcript:

- `/codex spawn <role> <prompt>` — e.g. `/codex spawn reviewer "review current dirty state"`
- `/codex status` / `/codex status <agent_id>`
- `/codex resume <agent_id> <prompt>`
- `/codex cancel <agent_id>`
- `/codex merge <agent_id>`
- `/codex discard <agent_id>`
- `/codex review-pr <pr_number>` — pre-bakes reviewer role + pr mode
- `/codex fan-out <EPIC-NNN>` — MF-only

## Subagent definitions

In `agents/`:

- `codex-implementer.md` — subagent that dispatches implementer-role spawns via the MCP tool.
- `codex-reviewer.md` — dispatches reviewer-role spawns.
- `codex-planner.md` — planner-role.

These let Claude's built-in `Agent` tool treat Codex agents as first-class subagents (the `Agent({subagent_type: "codex-implementer", ...})` pattern).

## Hooks

- `hooks/on-mcp-start.sh` — restore registry, mark orphans as failed.
- `hooks/session-start.sh` — surface count of live agents to Claude.
- MF hooks (`mf-session-start`, `mf-session-stop`, `mf-on-pr-created`) invoked via shell-out when MF detected.

## Repo layout

```
magic-cc-codex-worker/
├── plugin.json                         # Claude Code plugin manifest
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── .claude/
│   └── mcp-servers.json                # registers codex-team + raw codex mcp-server
├── src/
│   ├── index.ts                        # custom MCP server entry
│   ├── mcp/
│   │   ├── tools/{spawn,resume,status,cancel,merge,discard,list,result}.ts
│   │   ├── schemas.ts                  # zod
│   │   └── codex-client.ts             # MCP client → codex mcp-server child
│   ├── registry.ts                     # AgentRecord CRUD + atomic persistence
│   ├── worktree.ts                     # git worktree lifecycle
│   ├── roles/
│   │   ├── loader.ts                   # precedence merge
│   │   ├── templater.ts                # placeholder substitution
│   │   └── defaults/{implementer,reviewer,planner,generic}.toml
│   ├── mf/
│   │   ├── detect.ts
│   │   ├── linear.ts
│   │   ├── workers-json.ts
│   │   ├── conventions.ts              # parse CLAUDE.md
│   │   └── hooks.ts
│   └── config.ts
├── commands/
│   ├── codex-spawn.md
│   ├── codex-status.md
│   ├── codex-resume.md
│   ├── codex-cancel.md
│   ├── codex-merge.md
│   ├── codex-discard.md
│   ├── codex-review-pr.md
│   └── codex-fan-out.md                # MF-only
├── agents/
│   ├── codex-implementer.md
│   ├── codex-reviewer.md
│   └── codex-planner.md
├── hooks/
│   ├── session-start.sh
│   └── on-mcp-start.sh
├── tests/
│   ├── unit/{registry,worktree,roles,templater}.test.ts
│   └── integration/
│       ├── spawn-resume.test.ts
│       └── mf-detect.test.ts
└── docs/
    ├── plans/2026-04-24-magic-cc-codex-worker-design.md  (this doc)
    ├── architecture.md
    ├── mf-integration.md
    └── troubleshooting.md
```

## Concurrency & safety

- **max_parallel** default 5, configurable. Spawns beyond cap go `queued`; scheduler promotes to `running` as slots free.
- **Branch collisions** — if two spawns resolve to the same Linear issue, the second's branch gets `-<agent_id>` suffix.
- **State file writes** — single-writer mutex inside the MCP process.
- **Orphaned children on MCP crash** — on restart, `running` records marked `failed`; their worktrees and (if captured) thread_ids remain usable for manual inspection / resume.

## Timeouts

Per-role defaults (reviewer 10m, planner 15m, implementer 30m, generic 15m). Overridable per-spawn via `timeout_seconds`. On timeout: child killed, status `failed`, worktree preserved.

## Cancellation

`cancel(agent_id)`:
1. Send JSON-RPC `notifications/cancelled` to child (2s grace).
2. SIGTERM (3s grace).
3. SIGKILL.
4. Mark `cancelled`, preserve worktree unless `force: true`.

## Testing strategy

- **Unit** (mocked): registry transitions, worktree lifecycle, role preset merging, placeholder templater, MF detection.
- **Integration** (real codex subprocess, trivial prompts): spawn → status → complete → resume cycle. Run in CI against a disposable repo.
- **Smoke** (human-in-the-loop): fan-out of 3 agents on a real MF project, verify Linear status + workers.json + worktrees.

## Open questions (deferred to implementation)

- Concurrent `codex` calls within a single codex-mcp-server child — we decided on N children per agent, so this is moot in v1. Revisit if startup cost becomes a bottleneck.
- Dual-review report schema — normalize Codex + Claude reviewer output into a common format for side-by-side rendering.
- Linear API fallback — REST client vs. always-require-Linear-MCP. Start with Linear MCP required + graceful degradation if missing.
- Worktree parent dir — configurable (`.codex-team/worktrees/` default) for teams that want worktrees outside the main tree.

## Build order (feeds into the implementation plan)

1. **Scaffold + plugin manifest + raw codex-mcp-server registration** (smoke test: Claude can call `codex` tool directly).
2. **Custom MCP skeleton + registry + state persistence** (unit tests).
3. **Worktree lifecycle + role preset loader + templater** (unit tests).
4. **`spawn` + `status` + `result`** end-to-end against codex-mcp-server child (integration test on trivial prompt).
5. **`resume` + `cancel` + `list`**.
6. **`merge` + `discard`** + slash commands.
7. **Subagent definitions**.
8. **MF integration** — detection, linear fetch, workers.json mirror, conventions parser, hook invocations.
9. **Dual-review wiring + fan-out command**.
10. **Docs + release prep**.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| codex-mcp-server API changes between versions | Pin expected version range; integration test catches regressions. |
| Codex `threadId` only returned at session end — makes mid-run thread recovery impossible | Document clearly; for cancelled/crashed mid-run agents, user re-spawns with the same worktree rather than resumes. |
| Worktree accumulation if users forget to merge/discard | SessionStop hook reminds; `list --stale` surfaces forgotten ones. |
| `--dangerously-bypass-approvals-and-sandbox` equivalent (sandbox=`danger-full-access`) is a footgun | Never the default; only accessible via explicit per-spawn override. |
| Dual-review produces contradictory advice confusing authors | Not the plugin's job to resolve — surface both transparently. Docs explain the pattern. |
| Linear MCP missing in environment | Graceful degradation: MF features that require Linear warn and skip; core plugin still works. |
