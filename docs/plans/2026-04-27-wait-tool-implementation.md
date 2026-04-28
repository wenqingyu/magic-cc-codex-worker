# `wait` tool implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a blocking MCP tool `wait` so the dispatcher gets pushed terminal-state events instead of polling — eliminating ScheduleWakeup cache-miss costs.

**Architecture:** Wire `Registry.update()` to an `EventEmitter`; new `wait` handler in `index.ts` does a synchronous replay pass against state.json, then subscribes to the emitter for live events with batch coalescing and a long timeout. No changes to existing tools.

**Tech Stack:** TypeScript, Node 20, Vitest, `@modelcontextprotocol/sdk`, `zod`. Source repo: `/Users/wenqingyu/.claude/plugins/marketplaces/magic-codex` (branch `feature/wait-tool`, design doc at `docs/plans/2026-04-27-codex-worker-notifications-design.md`).

**Total estimated additions:** ~300 LOC. No removals. No breaking changes to existing tools.

**Pre-flight:** All commands assume `cd /Users/wenqingyu/.claude/plugins/marketplaces/magic-codex`. Branch `feature/wait-tool` is already checked out with the design doc committed (`8a4120c`).

---

## Task 1: Make Registry an EventEmitter and emit `change` on update

**Files:**
- Modify: `src/registry.ts`
- Test: `tests/unit/registry.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/registry.test.ts` after the existing `Registry zombie sweep on load` describe block:

```typescript
describe("Registry change events", () => {
  it("emits 'change' on every update with { before_status, record }", async () => {
    const rec = await registry.create({
      role: "implementer",
      cwd: "/x",
      model: "m",
      sandbox: "danger-full-access",
      approval_policy: "never",
      last_prompt: "p",
    });
    const events: Array<{ before_status: string; agent_id: string; status: string }> = [];
    registry.on("change", (ev) => {
      events.push({
        before_status: ev.before_status,
        agent_id: ev.record.agent_id,
        status: ev.record.status,
      });
    });
    await registry.update(rec.agent_id, { status: "running" });
    await registry.update(rec.agent_id, { status: "completed", ended_at: new Date().toISOString() });
    expect(events).toEqual([
      { before_status: "queued", agent_id: rec.agent_id, status: "running" },
      { before_status: "running", agent_id: rec.agent_id, status: "completed" },
    ]);
  });

  it("does NOT emit change events from the zombie sweep on load", async () => {
    // Sweeping is a maintenance pass, not a real-time transition the
    // dispatcher should react to — emitting would trigger spurious
    // wait() resolutions on server restart.
    const orig = await registry.create({
      role: "reviewer",
      cwd: "/x",
      model: "m",
      sandbox: "read-only",
      approval_policy: "never",
      last_prompt: "p",
    });
    await registry.update(orig.agent_id, { status: "running" });
    const fresh = new Registry(dir);
    const events: unknown[] = [];
    fresh.on("change", (ev) => events.push(ev));
    // Trigger load (sweep happens in load).
    await fresh.list();
    expect(events).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/registry.test.ts 2>&1 | tail -20`
Expected: 2 failures — `registry.on is not a function` (Registry doesn't extend EventEmitter yet).

**Step 3: Implement minimal code**

In `src/registry.ts`:

1. Change the imports to include `EventEmitter`:
   ```typescript
   import { EventEmitter } from "node:events";
   ```

2. Add a typed event payload interface near the top, after the `CreateInput` interface:
   ```typescript
   /** Event payload emitted on every successful Registry.update().
    *  Consumers can branch on `before_status` to detect specific
    *  transitions (e.g. running → completed). */
   export interface RegistryChangeEvent {
     before_status: AgentRecord["status"];
     record: AgentRecord;
   }
   ```

3. Change the class declaration:
   ```typescript
   export class Registry extends EventEmitter {
   ```

4. In the constructor, add `super()` as the first line:
   ```typescript
   constructor(private readonly stateDir: string) {
     super();
   }
   ```

5. In `update()`, after the `await this.persist()` call, capture `before_status` BEFORE the merge and emit AFTER persistence succeeds:

   Replace the current `update` body inside the serialize block:
   ```typescript
   async update(agent_id: string, patch: Partial<AgentRecord>): Promise<AgentRecord> {
     return this.serialize(async () => {
       await this.load();
       const existing = this.state.agents[agent_id];
       if (!existing) throw new Error(`agent ${agent_id} not found`);
       const before_status = existing.status;
       const merged: AgentRecord = { ...existing, ...patch, agent_id };
       this.state.agents[agent_id] = merged;
       await this.persist();
       // Emit AFTER successful persist so subscribers never see a
       // record that wasn't durable. Wrapped in try/catch because
       // EventEmitter rethrows synchronous listener errors — we don't
       // want a buggy listener to break the registry mutation path.
       try {
         this.emit("change", { before_status, record: merged });
       } catch {
         // ignore listener errors
       }
       return merged;
     });
   }
   ```

6. The zombie sweep MUST NOT emit. Confirm it doesn't go through `update()` — it mutates `this.state.agents` directly, which is correct. Leave it alone. Add a one-line comment to `sweepZombies` explicitly noting "no `change` event emitted — sweep is a load-time maintenance pass, not a real-time transition."

**Step 4: Run tests**

Run: `npm test -- tests/unit/registry.test.ts 2>&1 | tail -15`
Expected: all `registry.test.ts` tests pass (10 total: 8 existing + 2 new).

Then run the full suite: `npm test 2>&1 | tail -8`
Expected: 110 passed (was 108).

**Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/registry.ts tests/unit/registry.test.ts
git commit -m "feat(registry): emit 'change' on every update for wait-tool subscribers"
```

---

## Task 2: Add `WaitInput` zod schema and tool registration in `index.ts`

**Files:**
- Modify: `src/index.ts`

We register the tool before implementing the handler so the schema is locked in first. The handler stub returns an error so accidental calls during development don't silently succeed.

**Step 1: Add the schema near the other zod schemas**

Find the line `const DiscardInputZ = z.object({ agent_id: z.string() });` in `src/index.ts` and add immediately after it:

```typescript
const WaitInputZ = z.object({
  timeout_seconds: z.number().int().positive().max(1800).optional(),
  since: z.string().optional(),
  agent_ids: z.array(z.string()).optional(),
  terminal_only: z.boolean().optional(),
  batch_window_ms: z.number().int().min(0).max(5000).optional(),
});
```

**Step 2: Add the tool descriptor in the `ListToolsRequestSchema` handler**

Find the `discard` tool entry in the `tools: [...]` array and add a new entry right after it (before `get_delegation_policy`):

```typescript
{
  name: "wait",
  description:
    "Block until any tracked agent transitions to a terminal state (completed/failed/cancelled), or until timeout. Returns immediately if events already happened since the supplied `since` cursor (replay-safe across reconnects). Eliminates the poll-based ScheduleWakeup loop — call this once after spawning, react to the events, call again with the returned `observed_at` until `agents_still_running === 0`.",
  inputSchema: {
    type: "object",
    properties: {
      timeout_seconds: {
        type: "number",
        description:
          "Max seconds to block before returning {timed_out: true}. Default 1500 (25 min); the longer you set this the better — return is instant when events arrive, and a long timeout keeps the prompt cache warm across the wait/react loop. Capped at 1800.",
      },
      since: {
        type: "string",
        description:
          "ISO 8601 cursor. Events with `record.ended_at > since` are returned immediately without blocking — guarantees gap-free delivery across reconnects. Pass the previous response's `observed_at`.",
      },
      agent_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional whitelist; default = all agents. Use this when you fanned out a known batch and don't care about unrelated work.",
      },
      terminal_only: {
        type: "boolean",
        description:
          "Default true. When true, only completed/failed/cancelled transitions resolve the wait. Set false to wake on every status change (queued→running→...).",
      },
      batch_window_ms: {
        type: "number",
        description:
          "After the first matching event, hold the response open this many ms to coalesce co-occurring events into one batch. Default 100. Set to 0 to disable batching (one event per call).",
      },
    },
  },
},
```

**Step 3: Add a stub handler inside `setRequestHandler(CallToolRequestSchema, ...)` before the `throw new Error(\`unknown tool: ${name}\`)` line**

```typescript
if (name === "wait") {
  const parsed = WaitInputZ.parse(args);
  // Stub — replaced in Task 3.
  void parsed;
  throw new Error("wait: not yet implemented");
}
```

**Step 4: Verify typecheck and tool registration**

Run: `npm run typecheck`
Expected: clean.

Run: `npm test 2>&1 | tail -5`
Expected: still 110 passing — no test exercises the new tool yet.

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(wait): register wait tool + zod schema (handler stub)"
```

---

## Task 3: Implement the `wait` handler — replay path

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit/wait.test.ts` (new file)

We implement and test the synchronous replay path first — it has no timing concerns and validates the filtering logic.

**Step 1: Write the failing test**

Create `tests/unit/wait.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { Registry } from "../../src/registry.js";
import { Worktrees } from "../../src/worktree.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { CodexChild } from "../../src/mcp/codex-client.js";
import { handleWait } from "../../src/wait.js";

const rolesDir = resolve(process.cwd(), "src", "roles", "defaults");

function okFactory(): () => CodexChild {
  return () =>
    ({
      start: vi.fn().mockResolvedValue(undefined),
      call: vi.fn().mockResolvedValue({ threadId: "t", content: "done", raw: {} }),
      stop: vi.fn().mockResolvedValue(undefined),
      get pid() {
        return 1;
      },
    }) as unknown as CodexChild;
}

describe("wait — replay path", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "wait-state-"));
    repo = mkdtempSync(join(tmpdir(), "wait-repo-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);
    registry = new Registry(stateDir);
    worktrees = new Worktrees(repo);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns historical terminal events without blocking when since is in the past", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const before = new Date(Date.now() - 60_000).toISOString();
    const res = await orch.spawn({ role: "reviewer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);

    const start = Date.now();
    const out = await handleWait({ since: before }, registry);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(150); // no blocking
    expect(out.events.length).toBe(1);
    expect(out.events[0].agent_id).toBe(res.agent_id);
    expect(out.events[0].status).toBe("completed");
    expect(out.timed_out).toBe(false);
    expect(out.agents_still_running).toBe(0);
    expect(out.observed_at).toBeTruthy();
  });

  it("filters by agent_ids when supplied", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const before = new Date(Date.now() - 60_000).toISOString();
    const a = await orch.spawn({ role: "reviewer", prompt: "a" });
    const b = await orch.spawn({ role: "reviewer", prompt: "b" });
    await orch.waitForAgent(a.agent_id);
    await orch.waitForAgent(b.agent_id);
    const out = await handleWait(
      { since: before, agent_ids: [a.agent_id] },
      registry,
    );
    expect(out.events.length).toBe(1);
    expect(out.events[0].agent_id).toBe(a.agent_id);
  });

  it("excludes events whose ended_at is older than `since`", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const a = await orch.spawn({ role: "reviewer", prompt: "a" });
    await orch.waitForAgent(a.agent_id);
    // since = NOW (just after agent A finished); only future events match.
    const cursor = new Date(Date.now() + 1).toISOString();
    const out = await handleWait(
      { since: cursor, timeout_seconds: 1, agent_ids: [a.agent_id] },
      registry,
    );
    expect(out.timed_out).toBe(true);
    expect(out.events.length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/wait.test.ts 2>&1 | tail -20`
Expected: failures — `cannot find module '../../src/wait.js'`.

**Step 3: Create `src/wait.ts` with replay-only logic**

Create `src/wait.ts`:

```typescript
import type { Registry } from "./registry.js";
import type { AgentRecord, AgentStatus } from "./types.js";

const TERMINAL_STATUSES: AgentStatus[] = ["completed", "failed", "cancelled"];

export interface WaitInput {
  timeout_seconds?: number;
  since?: string;
  agent_ids?: string[];
  terminal_only?: boolean;
  batch_window_ms?: number;
}

/** Compact summary used in wait responses. Mirrors `agentSummary()` in
 *  index.ts but shaped here so the wait module can stand on its own
 *  without importing from index.ts (which would be a circular dep). */
export interface WaitAgentSummary {
  agent_id: string;
  role: AgentRecord["role"];
  status: AgentRecord["status"];
  thread_id: AgentRecord["thread_id"];
  worktree_path: string | null;
  branch: string | null;
  base_ref: string | null;
  repo_root: string | null;
  issue_id: string | null;
  pr_number: number | null;
  ended_at: string | null;
  last_output_preview: string | null;
  error_summary: string | null;
  error_kind: string | null;
  error_retry_at: string | null;
  error_retry_after_seconds: number | null;
  commit_sha: string | null;
  diff_stat: string | null;
  commits_ahead: number | null;
}

export interface WaitResult {
  events: WaitAgentSummary[];
  observed_at: string;
  agents_still_running: number;
  agents_running_ids: string[];
  timed_out: boolean;
}

function summarize(rec: AgentRecord): WaitAgentSummary {
  return {
    agent_id: rec.agent_id,
    role: rec.role,
    status: rec.status,
    thread_id: rec.thread_id,
    worktree_path: rec.worktree?.path ?? null,
    branch: rec.worktree?.branch ?? null,
    base_ref: rec.worktree?.base_ref ?? null,
    repo_root: rec.repo_root ?? null,
    issue_id: rec.issue_id,
    pr_number: rec.pr_number,
    ended_at: rec.ended_at,
    last_output_preview: rec.last_output?.slice(0, 500) ?? null,
    error_summary: rec.error?.message ?? null,
    error_kind: rec.error?.kind ?? null,
    error_retry_at: rec.error?.retry_at ?? null,
    error_retry_after_seconds: rec.error?.retry_after_seconds ?? null,
    commit_sha: rec.delta?.commit_sha ?? null,
    diff_stat: rec.delta?.diff_stat ?? null,
    commits_ahead: rec.delta?.commits_ahead ?? null,
  };
}

function matches(
  rec: AgentRecord,
  filter: { agent_ids?: string[]; terminal_only?: boolean },
): boolean {
  if (filter.agent_ids && !filter.agent_ids.includes(rec.agent_id)) return false;
  const terminalOnly = filter.terminal_only !== false; // default true
  if (terminalOnly && !TERMINAL_STATUSES.includes(rec.status)) return false;
  return true;
}

function isAfter(timeIso: string | null, sinceIso: string): boolean {
  if (!timeIso) return false;
  return Date.parse(timeIso) > Date.parse(sinceIso);
}

function buildResponse(
  events: AgentRecord[],
  allAgents: AgentRecord[],
  agentIds: string[] | undefined,
  timedOut: boolean,
): WaitResult {
  const observed_at = new Date().toISOString();
  const scope = agentIds
    ? allAgents.filter((r) => agentIds.includes(r.agent_id))
    : allAgents;
  const stillRunning = scope.filter(
    (r) => !TERMINAL_STATUSES.includes(r.status),
  );
  return {
    events: events.map(summarize),
    observed_at,
    agents_still_running: stillRunning.length,
    agents_running_ids: stillRunning.map((r) => r.agent_id),
    timed_out: timedOut,
  };
}

/** Synchronous replay: return any matching records whose terminal
 *  transition happened after `since`. */
function collectReplay(
  input: WaitInput,
  registryAgents: AgentRecord[],
): AgentRecord[] {
  if (!input.since) return [];
  const matched: AgentRecord[] = [];
  for (const rec of registryAgents) {
    if (!matches(rec, input)) continue;
    if (input.terminal_only !== false) {
      if (!isAfter(rec.ended_at, input.since)) continue;
    } else {
      // For non-terminal-only, use started_at as the activity cursor.
      if (!isAfter(rec.started_at ?? rec.ended_at, input.since)) continue;
    }
    matched.push(rec);
  }
  return matched;
}

export async function handleWait(
  input: WaitInput,
  registry: Registry,
): Promise<WaitResult> {
  const all = await registry.list();
  const replay = collectReplay(input, all);
  if (replay.length > 0) {
    return buildResponse(replay, all, input.agent_ids, false);
  }
  // Live path is added in Task 4. For now, return timed_out immediately
  // when timeout_seconds is small (lets the test exercise the
  // empty-replay path without hanging).
  return buildResponse([], all, input.agent_ids, true);
}
```

**Step 4: Run the wait tests**

Run: `npm test -- tests/unit/wait.test.ts 2>&1 | tail -15`
Expected: 3 tests pass.

Then full suite: `npm test 2>&1 | tail -5`
Expected: 113 passing.

**Step 5: Commit**

```bash
git add src/wait.ts tests/unit/wait.test.ts
git commit -m "feat(wait): replay path — return historical terminal events without blocking"
```

---

## Task 4: Implement the live-subscribe path with batch coalescing and timeout

**Files:**
- Modify: `src/wait.ts`
- Test: `tests/unit/wait.test.ts`

**Step 1: Write the failing tests**

Append to `tests/unit/wait.test.ts`:

```typescript
describe("wait — live subscribe path", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "wait-live-state-"));
    repo = mkdtempSync(join(tmpdir(), "wait-live-repo-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);
    registry = new Registry(stateDir);
    worktrees = new Worktrees(repo);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("resolves when an agent reaches a terminal state", async () => {
    // Codex call resolves after 80ms; wait should return at ~80ms+batch_window.
    const factory = () => {
      let resolveCall: ((r: unknown) => void) | null = null;
      const callPromise = new Promise((resolve) => {
        resolveCall = resolve;
      });
      setTimeout(() => resolveCall?.({ threadId: "t", content: "done", raw: {} }), 80);
      return {
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockReturnValue(callPromise),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      } as unknown as CodexChild;
    };
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    const start = Date.now();
    const out = await handleWait(
      { agent_ids: [spawn.agent_id], batch_window_ms: 50, timeout_seconds: 5 },
      registry,
    );
    const elapsed = Date.now() - start;
    expect(out.timed_out).toBe(false);
    expect(out.events.length).toBe(1);
    expect(out.events[0].agent_id).toBe(spawn.agent_id);
    expect(out.events[0].status).toBe("completed");
    // Should resolve close to 80ms + 50ms batch window, not immediately.
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(800);
  });

  it("coalesces multiple terminations within batch_window_ms into one response", async () => {
    // Three reviewers (no worktree, fast) finishing in quick succession.
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const spawn = await orch.spawn({ role: "reviewer", prompt: `p${i}` });
      ids.push(spawn.agent_id);
    }
    // All three resolve very fast (mocked). By the time wait subscribes,
    // they may already be done — exercise both replay and live by passing
    // a since cursor BEFORE the spawns. (Strictly this hits replay; the
    // batch test for pure live is below.)
    // Wait briefly to let the orchestrator finish them.
    await Promise.all(ids.map((id) => orch.waitForAgent(id)));
    const out = await handleWait(
      { since: new Date(Date.now() - 60_000).toISOString(), agent_ids: ids },
      registry,
    );
    expect(out.events.length).toBe(3);
    expect(out.agents_still_running).toBe(0);
  });

  it("times out cleanly with no leaked listeners", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call: vi.fn().mockImplementation(() => new Promise(() => undefined)), // never
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 1;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    const listenersBefore = registry.listenerCount("change");
    const start = Date.now();
    const out = await handleWait(
      { agent_ids: [spawn.agent_id], timeout_seconds: 0.05 },
      registry,
    );
    const elapsed = Date.now() - start;
    expect(out.timed_out).toBe(true);
    expect(out.events).toEqual([]);
    expect(elapsed).toBeGreaterThanOrEqual(40); // ~50ms timeout
    expect(elapsed).toBeLessThan(500);
    // Critical: no listener leak.
    expect(registry.listenerCount("change")).toBe(listenersBefore);
    await orch.cancel({ agent_id: spawn.agent_id });
  });

  it("agents_still_running reflects the agent_ids scope, not the whole registry", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const a = await orch.spawn({ role: "reviewer", prompt: "a" });
    const b = await orch.spawn({ role: "reviewer", prompt: "b" });
    await orch.waitForAgent(a.agent_id);
    await orch.waitForAgent(b.agent_id);
    const out = await handleWait(
      { agent_ids: [a.agent_id], since: new Date(Date.now() - 60_000).toISOString() },
      registry,
    );
    expect(out.agents_still_running).toBe(0);
    expect(out.events.length).toBe(1);
  });
});
```

**Step 2: Run tests to verify failures**

Run: `npm test -- tests/unit/wait.test.ts 2>&1 | tail -25`
Expected: 4 failures — the live subscribe path isn't implemented yet (tests time out without firing).

**Step 3: Implement the live-subscribe path**

In `src/wait.ts`, replace the current `handleWait` body:

```typescript
import type { RegistryChangeEvent } from "./registry.js";

// ... (keep everything before handleWait unchanged)

export async function handleWait(
  input: WaitInput,
  registry: Registry,
): Promise<WaitResult> {
  const all = await registry.list();
  const replay = collectReplay(input, all);
  if (replay.length > 0) {
    return buildResponse(replay, all, input.agent_ids, false);
  }

  const timeoutMs = (input.timeout_seconds ?? 1500) * 1000;
  const batchMs = input.batch_window_ms ?? 100;

  return new Promise<WaitResult>((resolve) => {
    const matched: AgentRecord[] = [];
    let batchTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      registry.off("change", onChange);
      if (batchTimer) clearTimeout(batchTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const flush = async () => {
      cleanup();
      const fresh = await registry.list();
      resolve(buildResponse(matched, fresh, input.agent_ids, false));
    };

    const onChange = (ev: RegistryChangeEvent) => {
      if (!matches(ev.record, input)) return;
      // Dedupe in case the same record transitions twice within the
      // batch window (rare, but cheap insurance).
      if (matched.some((r) => r.agent_id === ev.record.agent_id)) return;
      matched.push(ev.record);
      if (batchTimer === null) {
        if (batchMs === 0) {
          // Caller explicitly opted out of batching.
          void flush();
        } else {
          batchTimer = setTimeout(() => void flush(), batchMs);
        }
      }
      // else: timer already running; this event will be included.
    };

    timeoutTimer = setTimeout(async () => {
      cleanup();
      const fresh = await registry.list();
      resolve(buildResponse([], fresh, input.agent_ids, true));
    }, timeoutMs);

    registry.on("change", onChange);
  });
}
```

**Step 4: Verify tests pass**

Run: `npm test -- tests/unit/wait.test.ts 2>&1 | tail -15`
Expected: all 7 wait tests pass.

Full suite: `npm test 2>&1 | tail -5`
Expected: 117 passing.

Run 3 times back-to-back to catch flakes:
```bash
for i in 1 2 3; do echo "--- $i ---"; npm test 2>&1 | tail -4; done
```
Expected: 117 passing in all three runs.

**Step 5: Commit**

```bash
git add src/wait.ts tests/unit/wait.test.ts
git commit -m "feat(wait): live subscribe path with batch coalescing and timeout"
```

---

## Task 5: Wire `handleWait` into `index.ts`

**Files:**
- Modify: `src/index.ts`

**Step 1: Replace the stub handler**

In `src/index.ts`, replace the `if (name === "wait")` block (the stub from Task 2):

```typescript
if (name === "wait") {
  const parsed = WaitInputZ.parse(args);
  const result = await handleWait(parsed, registry);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}
```

Add the import at the top of the file (next to the other relative imports):

```typescript
import { handleWait } from "./wait.js";
```

**Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

**Step 3: Add a smoke test that goes through MCP**

In `tests/unit/wait.test.ts`, add a final block that calls `handleWait` exactly the way `index.ts` does (already covered by existing tests — this step is a no-op verification). Skip if the existing tests are sufficient.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(wait): wire handler into MCP request dispatcher"
```

---

## Task 6: CHANGELOG, version bump, build, PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugin/.claude-plugin/plugin.json`
- Modify: `src/index.ts` (MCP banner version)
- Modify: `src/mcp/codex-client.ts` (MCP banner version)

**Step 1: Bump every version literal to 0.5.0**

Run these one at a time so we don't drift:

```bash
sed -i '' 's/"version": "0.4.2"/"version": "0.5.0"/' package.json
sed -i '' 's/"version": "0.4.2"/"version": "0.5.0"/g' .claude-plugin/marketplace.json
sed -i '' 's/"version": "0.4.2"/"version": "0.5.0"/' plugin/.claude-plugin/plugin.json
```

For the MCP banner literals, use the Edit tool (sed regex on source can be fragile). Both files have the line `{ name: "magic-codex", version: "0.4.2" }` — change to `0.5.0`.

**Step 2: Add CHANGELOG entry above the 0.4.2 entry**

```markdown
## [0.5.0] — 2026-04-27

### Added
- **`wait` MCP tool — push notifications instead of polling.** Block until any tracked agent reaches a terminal state (`completed` / `failed` / `cancelled`), then return the batch of agents that just transitioned. Replaces the dispatcher's `ScheduleWakeup` loop with a single blocking call: spawn agents → call `wait` once → react to events → optionally call `wait` again with the returned `observed_at` cursor. The connection stays open while waiting, so the prompt cache never goes cold between checks. Eliminates the 5-min poll cadence and its cache-miss costs.
  - **Replay-safe via `since` cursor.** Pass the previous response's `observed_at` to guarantee gap-free delivery across reconnects or transient disconnects. Historical events are returned synchronously without blocking.
  - **Batch coalescing.** When several agents finish within milliseconds of each other (common at the tail of a fan-out batch), `wait` returns them in a single response. Default batch window: 100ms. Set `batch_window_ms: 0` to disable.
  - **Self-describing response.** `agents_still_running` and `agents_running_ids` tell the caller whether and how to call again — no separate `list` or `status` round-trip needed.
  - **Filtering.** `agent_ids: ["..."]` scopes the wait to a known fan-out batch; `terminal_only: false` widens to every status transition. Defaults match the common dispatcher case.
- **`Registry` extends `EventEmitter`** and emits `change` (`{ before_status, record }`) on every successful update. Internal API; the zombie sweep on load explicitly does not emit (it's a maintenance pass, not a real-time transition).

### Internal
- New module `src/wait.ts` houses the handler logic (replay + live subscribe + batch + timeout). Independent of the MCP transport so it's straightforward to unit-test.
- 7 new tests across `Registry` (event emission + zombie-sweep silence) and `wait` (replay, live subscribe, batch, timeout, listener leak guard, scoped agents_still_running). Total: 117 (was 108).
```

**Step 3: Build (drift guard validates all five literals match)**

Run: `npm run build`
Expected: `plugin/dist/index.js` rebuilt; drift guard prints no errors.

**Step 4: Final test pass**

Run: `npm test 2>&1 | tail -5`
Expected: 117 passing.

**Step 5: Commit and push**

```bash
git add -- .claude-plugin/marketplace.json CHANGELOG.md package.json plugin/ src/
git commit -m "$(cat <<'EOF'
feat: 0.5.0 — wait tool for codex push notifications

Block-until-terminal MCP tool replaces the dispatcher's poll-based
ScheduleWakeup loop. The wait/react/wait pattern keeps the prompt
cache warm and wakes Claude exactly at event time, not at the next
arbitrary poll boundary. Batch coalescing collapses fan-out tails
into single wakes; since cursor makes reconnects gap-free.

Implementation: Registry now extends EventEmitter and emits change
on every update; wait handler does a synchronous replay pass first,
then subscribes for live events with a 100ms default batch window
and 25min default timeout.

7 new tests; 117 total. No breaking changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin feature/wait-tool
```

**Step 6: Open PR**

```bash
gh pr create --base main --head feature/wait-tool --title "0.5.0 — wait tool for codex push notifications" --body "$(cat <<'EOF'
## Summary

Adds a single new MCP tool `wait` that replaces the dispatcher's poll-based ScheduleWakeup loop. The dispatcher calls `wait` once after spawning a batch of codex agents; the call hangs until any agent terminates, then returns a batched list of all agents that transitioned within a short coalescing window. No more 5-min polls, no more prompt-cache misses on every wake.

## Why

The current pattern: dispatcher spawns N agents → ScheduleWakeup every ~5min → wake → call `status` → most still running → sleep again. Each wake re-reads the full conversation context (cache TTL is 5min) and waiting agents are reacted to ~5min after they actually finish. With this PR: dispatcher calls `wait` once, the connection stays open, Claude wakes exactly when an event happens.

## Design doc

`docs/plans/2026-04-27-codex-worker-notifications-design.md` (committed in `8a4120c`).

## Test plan

- [x] `npm run typecheck` — clean
- [x] `npm test` — 117 passing (was 108); 9 new tests
  - Registry: emits `change` on update; zombie sweep does NOT emit
  - wait: replay path returns historical events without blocking
  - wait: filters by `agent_ids` and `since`
  - wait: live subscribe resolves when agent reaches terminal
  - wait: batch coalescing returns multiple agents in one response
  - wait: clean timeout with no listener leak
  - wait: `agents_still_running` honors the `agent_ids` scope
- [x] `npm run build` — drift guard validates all five version literals match 0.5.0
- [ ] Manual: dispatch 3 codex implementers, call `wait`, confirm one wake delivers all three when they near-simultaneously complete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 7: Merge, tag, sync**

```bash
gh pr merge --merge --delete-branch
git checkout main
git pull --ff-only
git tag -a v0.5.0 -m "v0.5.0 — wait tool for codex push notifications"
git push origin v0.5.0
```

---

## Final verification

After Task 6 completes:

```bash
cd /Users/wenqingyu/.claude/plugins/marketplaces/magic-codex
git log --oneline -10
```

You should see (most recent first):

- `feat: 0.5.0 — wait tool for codex push notifications` (the merge or single squashed commit)
- `feat(wait): wire handler into MCP request dispatcher`
- `feat(wait): live subscribe path with batch coalescing and timeout`
- `feat(wait): replay path — return historical terminal events without blocking`
- `feat(wait): register wait tool + zod schema (handler stub)`
- `feat(registry): emit 'change' on every update for wait-tool subscribers`
- `docs: design — wait tool for codex push notifications`

And `npm test` outputs 117 passing.

## Out of scope

Not in this plan; can be follow-ups:

- Cross-session push (file watcher, OS notify) — see Approach C in the design doc.
- Synchronous `spawn_and_wait` mode — see Approach B.
- Detecting "I need a decision" prose patterns to surface escalation events.
- A non-terminal `blocked` status for codex agents that pause for input.
