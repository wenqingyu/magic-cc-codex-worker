# magic-cc-codex-worker — Walking Skeleton Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a working `spawn → status → result` loop — Claude Code can launch a Codex agent in a git worktree, poll its status, and retrieve the output. No resume/cancel/merge/MF yet — those are follow-up plans after this skeleton proves out.

**Architecture:** TypeScript MCP server that spawns one `codex mcp-server` child per in-flight agent, passes worktree path as `cwd` and role-derived `developer-instructions`, tracks agents in a persisted registry. Fire-and-forget `spawn`; poll via `status`. Design reference: `docs/plans/2026-04-24-magic-cc-codex-worker-design.md`.

**Tech Stack:**
- Node.js 20+, TypeScript 5
- `@modelcontextprotocol/sdk` (MCP server + stdio client)
- `zod` (input schemas)
- `smol-toml` (role preset parsing)
- `vitest` (tests)
- `execa` (git subprocess wrappers)
- `nanoid` (agent_id suffixes)

**Prerequisites:**
- `codex` CLI installed (`which codex` succeeds; verified `codex-cli 0.122.0` during spike)
- `git` ≥ 2.40 (worktrees)
- Node 20+
- Claude Code configured and working locally

---

## Context for the implementer

**What MCP is:** Model Context Protocol — JSON-RPC 2.0 over stdio (line-delimited JSON, no Content-Length headers). An MCP server exposes `tools`, `prompts`, `resources`. The client (Claude Code) calls `tools/list`, then `tools/call` with the tool name + input. `@modelcontextprotocol/sdk` handles the protocol; we just register handlers.

**How we talk to Codex:** We start `codex mcp-server` as a child process and act as its MCP *client*, issuing `initialize` + `tools/call { name: "codex", arguments: {...} }`. The tool call blocks until the Codex session ends and returns `{ threadId, content }` in one shot — no streaming. This is why our `spawn` must be async: we fire the tool call in the background and return immediately to Claude.

**Git worktrees:** `git worktree add -b <branch> <path> <base_ref>` creates a separate working tree on a new branch sharing the same `.git`. Multiple worktrees can exist simultaneously — that's how we get parallelism without trees clobbering each other. `git worktree remove <path>` cleans up.

**Claude Code plugin structure:** `plugin.json` manifest + `commands/*.md` (slash commands) + `agents/*.md` (subagent definitions) + `.claude/mcp-servers.json` (MCP server registration). For this skeleton, we only need plugin.json + the custom MCP server registration. Commands/agents come in follow-up plans.

**Test discipline:** TDD where it buys clarity — registry transitions, role merging, templating, worktree lifecycle. Skip TDD for config files and glue code that'd be mocked to death. Integration test for the end-to-end spawn must hit real `codex mcp-server` (with a trivial prompt).

**Commit cadence:** After every task. Branch is `main`; commit messages follow `<type>(scope): <description>`.

---

## Phase 1: Scaffold

### Task 1.1: Initialize Node project and TypeScript config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.nvmrc`

**Step 1: Create `package.json`**

```json
{
  "name": "magic-cc-codex-worker",
  "version": "0.0.1",
  "description": "Claude Code plugin that orchestrates Codex as agent workers",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "codex-team-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "execa": "^9.0.0",
    "nanoid": "^5.0.0",
    "smol-toml": "^1.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create `.nvmrc`**

```
20
```

**Step 4: Install dependencies**

Run: `npm install`
Expected: exits 0, creates `node_modules/` and `package-lock.json`.

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .nvmrc
git commit -m "chore: scaffold TypeScript Node project"
```

---

### Task 1.2: Directory skeleton

**Files:**
- Create: `src/index.ts` (placeholder)
- Create: `src/mcp/tools/.gitkeep`
- Create: `src/roles/defaults/.gitkeep`
- Create: `tests/unit/.gitkeep`
- Create: `tests/integration/.gitkeep`

**Step 1: Create placeholder entry**

Contents of `src/index.ts`:

```ts
// Entry point for the codex-team MCP server.
// Implemented incrementally in subsequent tasks.
console.error("codex-team MCP server — not yet implemented");
process.exit(1);
```

**Step 2: Create empty dirs with `.gitkeep`**

Run: `mkdir -p src/mcp/tools src/roles/defaults tests/unit tests/integration && touch src/mcp/tools/.gitkeep src/roles/defaults/.gitkeep tests/unit/.gitkeep tests/integration/.gitkeep`

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: exits 0, creates `dist/index.js`.

**Step 4: Commit**

```bash
git add src tests
git commit -m "chore: add source directory skeleton"
```

---

### Task 1.3: Vitest config + smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/smoke.test.ts`

**Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
```

**Step 2: Write smoke test**

Contents of `tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 3: Run tests — expect pass**

Run: `npm test`
Expected: `1 passed`.

**Step 4: Commit**

```bash
git add vitest.config.ts tests
git commit -m "test: add vitest config and smoke test"
```

---

### Task 1.4: Claude Code plugin manifest

**Files:**
- Create: `plugin.json`
- Create: `.claude/mcp-servers.json`

**Step 1: Write `plugin.json`**

```json
{
  "name": "magic-cc-codex-worker",
  "version": "0.0.1",
  "description": "Orchestrate Codex as Claude Code agent workers (spawn, resume, status, cancel)",
  "mcpServers": [".claude/mcp-servers.json"]
}
```

**Step 2: Write `.claude/mcp-servers.json`**

Registers both the custom `codex-team` server (ours) and raw `codex mcp-server` (so Claude also gets the sync fast path).

```json
{
  "mcpServers": {
    "codex-team": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "CODEX_TEAM_STATE_DIR": ".codex-team"
      }
    },
    "codex-raw": {
      "command": "codex",
      "args": ["mcp-server"]
    }
  }
}
```

**Step 3: Commit**

```bash
git add plugin.json .claude/mcp-servers.json
git commit -m "feat: add Claude Code plugin manifest"
```

---

## Phase 2: Types and registry

### Task 2.1: Core types

**Files:**
- Create: `src/types.ts`
- Test: (no test — pure types)

**Step 1: Write `src/types.ts`**

```ts
export type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AgentRole = "implementer" | "reviewer" | "planner" | "generic";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

export interface WorktreeInfo {
  path: string;
  branch: string;
  base_ref: string;
  created_at: string;
}

export interface AgentError {
  message: string;
  stderr_tail?: string;
}

export interface AgentRecord {
  agent_id: string;
  role: AgentRole;
  thread_id: string | null;
  status: AgentStatus;
  cwd: string;
  worktree: WorktreeInfo | null;
  model: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  issue_id: string | null;
  pr_number: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_prompt: string;
  last_output: string | null;
  error: AgentError | null;
  pid: number | null;
}

export interface RegistrySnapshot {
  version: 1;
  agents: Record<string, AgentRecord>;
}
```

**Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add AgentRecord and RegistrySnapshot types"
```

---

### Task 2.2: Registry — failing test for `create`

**Files:**
- Test: `tests/unit/registry.test.ts` (create)

**Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../../src/registry.js";

let dir: string;
let registry: Registry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reg-"));
  registry = new Registry(dir);
});

describe("Registry.create", () => {
  it("stores and returns a new AgentRecord with status=queued", async () => {
    const rec = await registry.create({
      role: "implementer",
      cwd: "/tmp/foo",
      model: "gpt-5.2-codex",
      sandbox: "workspace-write",
      approval_policy: "never",
      last_prompt: "do the thing",
    });
    expect(rec.agent_id).toMatch(/^codex-impl-/);
    expect(rec.status).toBe("queued");
    expect(rec.thread_id).toBeNull();
    expect(rec.created_at).toBeTruthy();
    const fetched = await registry.get(rec.agent_id);
    expect(fetched).toEqual(rec);
  });
});
```

**Step 2: Run — expect fail**

Run: `npm test -- registry`
Expected: FAIL — "Cannot find module '../../src/registry.js'".

---

### Task 2.3: Registry — implement `create` + `get`

**Files:**
- Create: `src/registry.ts`

**Step 1: Write minimal implementation**

```ts
import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { AgentRecord, AgentRole, RegistrySnapshot, SandboxMode, ApprovalPolicy } from "./types.js";

export interface CreateInput {
  role: AgentRole;
  cwd: string;
  model: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  last_prompt: string;
  issue_id?: string | null;
  pr_number?: number | null;
}

const ROLE_PREFIX: Record<AgentRole, string> = {
  implementer: "impl",
  reviewer: "rvw",
  planner: "plan",
  generic: "gen",
};

export class Registry {
  private state: RegistrySnapshot = { version: 1, agents: {} };
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly stateDir: string) {}

  private get stateFile() {
    return join(this.stateDir, "state.json");
  }

  private async load() {
    if (this.loaded) return;
    await mkdir(this.stateDir, { recursive: true });
    if (existsSync(this.stateFile)) {
      const raw = await readFile(this.stateFile, "utf8");
      this.state = JSON.parse(raw) as RegistrySnapshot;
    }
    this.loaded = true;
  }

  private async persist() {
    const tmp = `${this.stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await rename(tmp, this.stateFile);
  }

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(op);
    this.writeLock = next.then(() => undefined, () => undefined);
    return next;
  }

  async create(input: CreateInput): Promise<AgentRecord> {
    return this.serialize(async () => {
      await this.load();
      const idSuffix = nanoid(6).toLowerCase();
      const agent_id = `codex-${ROLE_PREFIX[input.role]}-${idSuffix}`;
      const now = new Date().toISOString();
      const rec: AgentRecord = {
        agent_id,
        role: input.role,
        thread_id: null,
        status: "queued",
        cwd: input.cwd,
        worktree: null,
        model: input.model,
        sandbox: input.sandbox,
        approval_policy: input.approval_policy,
        issue_id: input.issue_id ?? null,
        pr_number: input.pr_number ?? null,
        created_at: now,
        started_at: null,
        ended_at: null,
        last_prompt: input.last_prompt,
        last_output: null,
        error: null,
        pid: null,
      };
      this.state.agents[agent_id] = rec;
      await this.persist();
      return rec;
    });
  }

  async get(agent_id: string): Promise<AgentRecord | null> {
    await this.load();
    return this.state.agents[agent_id] ?? null;
  }
}
```

**Step 2: Run — expect pass**

Run: `npm test -- registry`
Expected: `1 passed`.

**Step 3: Commit**

```bash
git add src/registry.ts tests/unit/registry.test.ts
git commit -m "feat(registry): add create and get with atomic persistence"
```

---

### Task 2.4: Registry — failing test for `update` and status transitions

**Files:**
- Test: `tests/unit/registry.test.ts` (append)

**Step 1: Add test case**

Append to `tests/unit/registry.test.ts`:

```ts
describe("Registry.update", () => {
  it("transitions status and persists", async () => {
    const rec = await registry.create({
      role: "implementer", cwd: "/tmp/foo", model: "m",
      sandbox: "workspace-write", approval_policy: "never", last_prompt: "p",
    });
    await registry.update(rec.agent_id, { status: "running", started_at: new Date().toISOString() });
    const fetched = await registry.get(rec.agent_id);
    expect(fetched!.status).toBe("running");
    expect(fetched!.started_at).toBeTruthy();
  });

  it("throws on unknown agent_id", async () => {
    await expect(registry.update("nope", { status: "running" })).rejects.toThrow(/not found/);
  });
});
```

**Step 2: Run — expect fail**

Run: `npm test -- registry`
Expected: FAIL — `registry.update is not a function`.

---

### Task 2.5: Registry — implement `update`

**Files:**
- Modify: `src/registry.ts`

**Step 1: Add `update` method**

Inside the `Registry` class:

```ts
  async update(agent_id: string, patch: Partial<AgentRecord>): Promise<AgentRecord> {
    return this.serialize(async () => {
      await this.load();
      const existing = this.state.agents[agent_id];
      if (!existing) throw new Error(`agent ${agent_id} not found`);
      const merged: AgentRecord = { ...existing, ...patch, agent_id };
      this.state.agents[agent_id] = merged;
      await this.persist();
      return merged;
    });
  }
```

**Step 2: Run — expect pass**

Run: `npm test -- registry`
Expected: all passed.

**Step 3: Commit**

```bash
git add src/registry.ts tests/unit/registry.test.ts
git commit -m "feat(registry): add update with concurrency-safe persistence"
```

---

### Task 2.6: Registry — `list` + reload-from-disk test

**Files:**
- Test: `tests/unit/registry.test.ts` (append)
- Modify: `src/registry.ts`

**Step 1: Add test**

```ts
describe("Registry.list and reload", () => {
  it("lists all agents and survives reload from disk", async () => {
    const a = await registry.create({ role: "reviewer", cwd: "/a", model: "m", sandbox: "read-only", approval_policy: "never", last_prompt: "x" });
    const b = await registry.create({ role: "implementer", cwd: "/b", model: "m", sandbox: "workspace-write", approval_policy: "never", last_prompt: "y" });
    const listed = await registry.list();
    expect(listed).toHaveLength(2);
    // Reload: fresh registry pointing at same dir
    const fresh = new Registry(dir);
    const restored = await fresh.list();
    expect(restored.map((r) => r.agent_id).sort()).toEqual([a.agent_id, b.agent_id].sort());
  });
});
```

**Step 2: Run — expect fail**

Run: `npm test -- registry`
Expected: FAIL — `registry.list is not a function`.

**Step 3: Implement `list`**

Inside `Registry`:

```ts
  async list(): Promise<AgentRecord[]> {
    await this.load();
    return Object.values(this.state.agents);
  }
```

**Step 4: Run — expect pass**

Run: `npm test -- registry`
Expected: all passed.

**Step 5: Commit**

```bash
git add src/registry.ts tests/unit/registry.test.ts
git commit -m "feat(registry): add list and verify reload-from-disk"
```

---

## Phase 3: Worktree lifecycle

### Task 3.1: Worktree — failing test for `create`

**Files:**
- Test: `tests/unit/worktree.test.ts`

**Step 1: Write test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { Worktrees } from "../../src/worktree.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "repo-"));
  await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
  await execa("git", ["-C", repo, "config", "user.name", "t"]);
  await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("Worktrees.create", () => {
  it("creates a worktree on a new branch", async () => {
    const wt = new Worktrees(repo);
    const info = await wt.create({
      agent_id: "codex-impl-abc",
      branch: "codex/abc",
      base_ref: "main",
    });
    expect(existsSync(info.path)).toBe(true);
    expect(info.branch).toBe("codex/abc");
    const { stdout } = await execa("git", ["-C", info.path, "rev-parse", "--abbrev-ref", "HEAD"]);
    expect(stdout.trim()).toBe("codex/abc");
  });
});
```

**Step 2: Run — expect fail**

Run: `npm test -- worktree`
Expected: FAIL — module not found.

---

### Task 3.2: Worktree — implement `create`

**Files:**
- Create: `src/worktree.ts`

**Step 1: Write implementation**

```ts
import { execa } from "execa";
import { join, resolve } from "node:path";
import type { WorktreeInfo } from "./types.js";

export interface CreateWorktreeInput {
  agent_id: string;
  branch: string;
  base_ref: string;
  parent_dir?: string; // default: <repo>/.codex-team/worktrees
}

export class Worktrees {
  constructor(private readonly repoRoot: string) {}

  private defaultParent() {
    return join(this.repoRoot, ".codex-team", "worktrees");
  }

  async create(input: CreateWorktreeInput): Promise<WorktreeInfo> {
    const parent = input.parent_dir ?? this.defaultParent();
    const path = resolve(parent, input.agent_id);
    await execa("git", [
      "-C", this.repoRoot,
      "worktree", "add",
      "-b", input.branch,
      path,
      input.base_ref,
    ]);
    return {
      path,
      branch: input.branch,
      base_ref: input.base_ref,
      created_at: new Date().toISOString(),
    };
  }
}
```

**Step 2: Run — expect pass**

Run: `npm test -- worktree`
Expected: `1 passed`.

**Step 3: Commit**

```bash
git add src/worktree.ts tests/unit/worktree.test.ts
git commit -m "feat(worktree): add create"
```

---

### Task 3.3: Worktree — `remove` with failing test

**Files:**
- Test: `tests/unit/worktree.test.ts` (append)
- Modify: `src/worktree.ts`

**Step 1: Add test**

```ts
describe("Worktrees.remove", () => {
  it("removes the worktree and its branch", async () => {
    const wt = new Worktrees(repo);
    const info = await wt.create({ agent_id: "codex-impl-del", branch: "codex/del", base_ref: "main" });
    await wt.remove(info.path, { delete_branch: true });
    expect(existsSync(info.path)).toBe(false);
    const { stdout } = await execa("git", ["-C", repo, "branch", "--list", "codex/del"]);
    expect(stdout.trim()).toBe("");
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Implement**

Add to `Worktrees`:

```ts
  async remove(path: string, opts: { delete_branch?: boolean } = {}): Promise<void> {
    const { stdout } = await execa("git", ["-C", this.repoRoot, "worktree", "list", "--porcelain"]);
    const branch = parseBranchForPath(stdout, path);
    await execa("git", ["-C", this.repoRoot, "worktree", "remove", "--force", path]);
    if (opts.delete_branch && branch) {
      await execa("git", ["-C", this.repoRoot, "branch", "-D", branch]);
    }
  }
```

Add helper at module scope:

```ts
function parseBranchForPath(porcelain: string, path: string): string | null {
  const resolved = resolve(path);
  const blocks = porcelain.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    const worktreeLine = lines.find((l) => l.startsWith("worktree "));
    if (!worktreeLine || resolve(worktreeLine.slice("worktree ".length)) !== resolved) continue;
    const branchLine = lines.find((l) => l.startsWith("branch "));
    if (!branchLine) return null;
    return branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
  }
  return null;
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add src/worktree.ts tests/unit/worktree.test.ts
git commit -m "feat(worktree): add remove with optional branch deletion"
```

---

## Phase 4: Role presets

### Task 4.1: Built-in role defaults (TOML)

**Files:**
- Create: `src/roles/defaults/implementer.toml`
- Create: `src/roles/defaults/reviewer.toml`
- Create: `src/roles/defaults/planner.toml`
- Create: `src/roles/defaults/generic.toml`

**Step 1: Write `implementer.toml`**

```toml
[role]
model = "gpt-5.2-codex"
sandbox = "workspace-write"
approval_policy = "never"
worktree = true
timeout_seconds = 1800
developer_instructions = """
You are an autonomous implementer running in an isolated git worktree.
- Working directory: {{worktree_path}}
- Branch: {{branch}} (based on {{base_ref}})
- Commit your work with descriptive messages. Do NOT push to the remote.
- Run tests before considering the task complete.
- If you cannot complete the task, commit what you have and explain why.
"""
```

**Step 2: Write `reviewer.toml`**

```toml
[role]
model = "gpt-5.2"
sandbox = "read-only"
approval_policy = "never"
worktree = false
timeout_seconds = 600
developer_instructions = """
You are a critical code reviewer. Focus on:
- Correctness and hidden assumptions
- Security concerns and data handling
- Test coverage for the changes
- Edge cases and performance regressions

Return a structured report with file:line citations. Flag high-confidence
issues separately from speculative concerns. Be specific and actionable.
"""
```

**Step 3: Write `planner.toml`**

```toml
[role]
model = "gpt-5.2"
sandbox = "read-only"
approval_policy = "never"
worktree = false
timeout_seconds = 900
developer_instructions = """
You are a planning agent. Produce an implementation plan for the given task:
- Break work into bite-sized steps
- Identify files to touch and tests to write
- Call out risks and open questions
- Do not write implementation code
"""
```

**Step 4: Write `generic.toml`**

```toml
[role]
sandbox = "read-only"
approval_policy = "never"
worktree = false
timeout_seconds = 900
developer_instructions = ""
```

**Step 5: Commit**

```bash
git add src/roles/defaults
git commit -m "feat(roles): add built-in role preset defaults"
```

---

### Task 4.2: Role preset types + failing test for loader

**Files:**
- Create: `src/roles/types.ts`
- Test: `tests/unit/roles-loader.test.ts`

**Step 1: Write `src/roles/types.ts`**

```ts
import type { ApprovalPolicy, SandboxMode } from "../types.js";

export interface RolePreset {
  model?: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  worktree: boolean;
  timeout_seconds: number;
  developer_instructions: string;
}

export type PartialRolePreset = Partial<RolePreset>;
```

**Step 2: Write failing test**

Contents of `tests/unit/roles-loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRole } from "../../src/roles/loader.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const defaultsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "roles", "defaults");

describe("loadRole — built-in defaults", () => {
  it("loads implementer role", async () => {
    const role = await loadRole("implementer", { defaultsDir });
    expect(role.model).toBe("gpt-5.2-codex");
    expect(role.sandbox).toBe("workspace-write");
    expect(role.worktree).toBe(true);
    expect(role.timeout_seconds).toBe(1800);
    expect(role.developer_instructions).toContain("isolated git worktree");
  });

  it("loads reviewer role with read-only sandbox", async () => {
    const role = await loadRole("reviewer", { defaultsDir });
    expect(role.sandbox).toBe("read-only");
    expect(role.worktree).toBe(false);
  });
});
```

**Step 3: Run — expect fail**

Run: `npm test -- roles-loader`
Expected: FAIL — module not found.

---

### Task 4.3: Role loader — built-in defaults only

**Files:**
- Create: `src/roles/loader.ts`

**Step 1: Write implementation**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { AgentRole } from "../types.js";
import type { RolePreset } from "./types.js";

export interface LoadRoleOptions {
  defaultsDir: string;
  userGlobalPath?: string;   // ~/.codex-team/roles.toml — later task
  projectCommitted?: string; // codex-team.toml — later task
  projectPersonal?: string;  // .codex-team/roles.toml — later task
}

export async function loadRole(role: AgentRole, opts: LoadRoleOptions): Promise<RolePreset> {
  const defaultPath = join(opts.defaultsDir, `${role}.toml`);
  const raw = await readFile(defaultPath, "utf8");
  const parsed = parseToml(raw) as { role: RolePreset };
  return parsed.role;
}
```

**Step 2: Run — expect pass**

Run: `npm test -- roles-loader`
Expected: `2 passed`.

**Step 3: Commit**

```bash
git add src/roles/types.ts src/roles/loader.ts tests/unit/roles-loader.test.ts
git commit -m "feat(roles): add role loader for built-in defaults"
```

---

### Task 4.4: Role loader — precedence merge with project overrides

**Files:**
- Test: `tests/unit/roles-loader.test.ts` (append)
- Modify: `src/roles/loader.ts`

**Step 1: Add failing test**

```ts
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("loadRole — precedence", () => {
  it("project committed overrides built-in defaults; per-spawn overrides both", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "roles-"));
    const projectFile = join(tmp, "codex-team.toml");
    writeFileSync(projectFile, `
[roles.implementer]
model = "gpt-project-override"
timeout_seconds = 9999
`);
    const role = await loadRole("implementer", {
      defaultsDir,
      projectCommitted: projectFile,
      overrides: { model: "gpt-spawn-override" },
    });
    expect(role.model).toBe("gpt-spawn-override");        // per-spawn wins
    expect(role.timeout_seconds).toBe(9999);              // project overrides default
    expect(role.sandbox).toBe("workspace-write");         // default preserved
    expect(role.developer_instructions).toContain("worktree"); // default preserved
    rmSync(tmp, { recursive: true, force: true });
  });
});
```

**Step 2: Run — expect fail**

**Step 3: Update loader**

Extend `LoadRoleOptions` and implementation:

```ts
export interface LoadRoleOptions {
  defaultsDir: string;
  userGlobalPath?: string;
  projectCommitted?: string;
  projectPersonal?: string;
  overrides?: Partial<RolePreset>;
}

async function readRoleFile(path: string | undefined, role: AgentRole): Promise<Partial<RolePreset>> {
  if (!path) return {};
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseToml(raw) as { roles?: Record<string, Partial<RolePreset>> };
    return parsed.roles?.[role] ?? {};
  } catch (e: any) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

export async function loadRole(role: AgentRole, opts: LoadRoleOptions): Promise<RolePreset> {
  const defaultPath = join(opts.defaultsDir, `${role}.toml`);
  const defaultsRaw = await readFile(defaultPath, "utf8");
  const defaults = (parseToml(defaultsRaw) as { role: RolePreset }).role;
  const userGlobal = await readRoleFile(opts.userGlobalPath, role);
  const projectCommitted = await readRoleFile(opts.projectCommitted, role);
  const projectPersonal = await readRoleFile(opts.projectPersonal, role);
  return {
    ...defaults,
    ...userGlobal,
    ...projectCommitted,
    ...projectPersonal,
    ...(opts.overrides ?? {}),
  };
}
```

**Step 4: Run — expect pass**

Run: `npm test -- roles-loader`
Expected: all passed.

**Step 5: Commit**

```bash
git add src/roles/loader.ts tests/unit/roles-loader.test.ts
git commit -m "feat(roles): add precedence merge for role presets"
```

---

### Task 4.5: Templater — failing test

**Files:**
- Test: `tests/unit/templater.test.ts`

**Step 1: Write test**

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/roles/templater.js";

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    const out = renderTemplate("Branch {{branch}} at {{worktree_path}}", {
      branch: "codex/abc",
      worktree_path: "/tmp/w",
    });
    expect(out).toBe("Branch codex/abc at /tmp/w");
  });

  it("leaves unknown placeholders as literals", () => {
    const out = renderTemplate("Hello {{unknown}}", {});
    expect(out).toBe("Hello {{unknown}}");
  });

  it("substitutes multiple occurrences", () => {
    const out = renderTemplate("{{a}}/{{a}}", { a: "x" });
    expect(out).toBe("x/x");
  });
});
```

**Step 2: Run — expect fail**

---

### Task 4.6: Templater — implement

**Files:**
- Create: `src/roles/templater.ts`

**Step 1: Implementation**

```ts
export type TemplateContext = Record<string, string | number | undefined>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(PLACEHOLDER, (match, key) => {
    const value = ctx[key];
    return value === undefined ? match : String(value);
  });
}
```

**Step 2: Run — expect pass**

**Step 3: Commit**

```bash
git add src/roles/templater.ts tests/unit/templater.test.ts
git commit -m "feat(roles): add placeholder templater"
```

---

## Phase 5: Codex MCP client

### Task 5.1: Codex client — types

**Files:**
- Create: `src/mcp/codex-client.ts` (types + stub)

**Step 1: Write stub**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface CodexCallInput {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval_policy?: "untrusted" | "on-failure" | "on-request" | "never";
  developer_instructions?: string;
  thread_id?: string; // if set, uses codex-reply instead of codex
}

export interface CodexCallResult {
  threadId: string;
  content: string;
}

export class CodexChild {
  private proc: ChildProcess | null = null;
  private client: Client | null = null;

  async start(): Promise<void> {
    throw new Error("not implemented");
  }

  async call(_input: CodexCallInput): Promise<CodexCallResult> {
    throw new Error("not implemented");
  }

  async stop(): Promise<void> {
    throw new Error("not implemented");
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }
}
```

**Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 (stubs throw; types compile).

**Step 3: Commit**

```bash
git add src/mcp/codex-client.ts
git commit -m "feat(codex-client): add type stubs"
```

---

### Task 5.2: Codex client — failing integration test

**Files:**
- Test: `tests/integration/codex-client.test.ts`

**Step 1: Write test**

```ts
import { describe, it, expect } from "vitest";
import { CodexChild } from "../../src/mcp/codex-client.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Marked as integration — runs a real `codex mcp-server` subprocess.
// Requires `codex` CLI installed and authenticated.
describe.skipIf(!process.env.RUN_CODEX_INTEGRATION)("CodexChild (integration)", () => {
  it("starts, calls codex with trivial prompt, returns threadId and content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cdx-"));
    const child = new CodexChild();
    await child.start();
    try {
      const result = await child.call({
        prompt: "Respond with exactly the word: OK",
        cwd: dir,
        sandbox: "read-only",
        approval_policy: "never",
      });
      expect(result.threadId).toMatch(/\S/);
      expect(result.content).toMatch(/OK/i);
    } finally {
      await child.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
```

**Step 2: Run — expect skip (env var not set)**

Run: `npm test -- codex-client`
Expected: `0 passed | 1 skipped`.

**Step 3: Run with integration flag — expect fail**

Run: `RUN_CODEX_INTEGRATION=1 npm test -- codex-client`
Expected: FAIL — `not implemented`.

---

### Task 5.3: Codex client — implement `start` / `call` / `stop`

**Files:**
- Modify: `src/mcp/codex-client.ts`

**Step 1: Implement**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface CodexCallInput {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval_policy?: "untrusted" | "on-failure" | "on-request" | "never";
  developer_instructions?: string;
  thread_id?: string;
}

export interface CodexCallResult {
  threadId: string;
  content: string;
}

export class CodexChild {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _pid: number | null = null;

  async start(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: "codex",
      args: ["mcp-server"],
    });
    this.client = new Client({ name: "codex-team", version: "0.0.1" }, { capabilities: {} });
    await this.client.connect(this.transport);
    // Transport exposes the child proc internally; we record pid via reflection
    // (safe: StdioClientTransport stores the child as `_process`).
    this._pid = (this.transport as unknown as { _process?: ChildProcess })._process?.pid ?? null;
  }

  async call(input: CodexCallInput): Promise<CodexCallResult> {
    if (!this.client) throw new Error("CodexChild.start() not called");
    const toolName = input.thread_id ? "codex-reply" : "codex";
    const args: Record<string, unknown> = input.thread_id
      ? { threadId: input.thread_id, prompt: input.prompt }
      : {
          prompt: input.prompt,
          cwd: input.cwd,
          ...(input.model ? { model: input.model } : {}),
          ...(input.sandbox ? { sandbox: input.sandbox } : {}),
          ...(input.approval_policy ? { "approval-policy": input.approval_policy } : {}),
          ...(input.developer_instructions
            ? { "developer-instructions": input.developer_instructions }
            : {}),
        };
    const result = await this.client.callTool({ name: toolName, arguments: args });
    // Codex returns structured output via content[].text or structuredContent
    const structured = (result as { structuredContent?: CodexCallResult }).structuredContent;
    if (structured && structured.threadId && typeof structured.content === "string") {
      return structured;
    }
    // Fallback: parse from text content
    const content = (result.content as Array<{ type: string; text?: string }> | undefined) ?? [];
    const textBlock = content.find((c) => c.type === "text")?.text ?? "";
    // Last-ditch: treat whole text as content, threadId unknown
    return { threadId: "", content: textBlock };
  }

  async stop(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
    this._pid = null;
  }

  get pid(): number | null {
    return this._pid;
  }
}
```

**Step 2: Run — expect pass**

Run: `RUN_CODEX_INTEGRATION=1 npm test -- codex-client`
Expected: `1 passed`.

**Note for implementer:** if the `structuredContent` field shape differs from our spike observation (Codex server may emit threadId via different path), tweak the parsing. The spike confirmed `outputSchema: { threadId, content }` so `structuredContent` should be populated — but if MCP SDK version gates this, log the raw `result` object the first run to see its shape, then adjust.

**Step 3: Commit**

```bash
git add src/mcp/codex-client.ts tests/integration/codex-client.test.ts
git commit -m "feat(codex-client): implement MCP client over codex mcp-server"
```

---

## Phase 6: `spawn` tool

### Task 6.1: Spawn orchestrator — types + failing unit test (mocked)

**Files:**
- Create: `src/orchestrator.ts` (stub)
- Test: `tests/unit/orchestrator.test.ts`

**Step 1: Write test (mocks CodexChild and Worktrees)**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../../src/registry.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { CodexChild } from "../../src/mcp/codex-client.js";
import type { Worktrees } from "../../src/worktree.js";

describe("Orchestrator.spawn (mocked)", () => {
  let registry: Registry;
  let orch: Orchestrator;
  let wtMock: Worktrees;
  let codexFactory: () => CodexChild;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    registry = new Registry(dir);
    wtMock = {
      create: vi.fn().mockResolvedValue({
        path: "/tmp/wt/codex-impl-xxx",
        branch: "codex/xxx",
        base_ref: "main",
        created_at: new Date().toISOString(),
      }),
      remove: vi.fn(),
    } as unknown as Worktrees;
    codexFactory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue({ threadId: "thread-1", content: "done" }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() { return 4242; },
      } as unknown as CodexChild);
    orch = new Orchestrator({
      registry,
      worktrees: wtMock,
      codexFactory,
      rolesDir: join(process.cwd(), "src/roles/defaults"),
      repoRoot: "/tmp/fake-repo",
    });
  });

  it("returns immediately with status=running and agent_id", async () => {
    const result = await orch.spawn({
      role: "implementer",
      prompt: "do a thing",
    });
    expect(result.agent_id).toMatch(/^codex-impl-/);
    expect(result.status).toBe("running");
    expect(result.worktree_path).toBe("/tmp/wt/codex-impl-xxx");
  });

  it("transitions the agent to completed in background with thread_id set", async () => {
    const result = await orch.spawn({ role: "implementer", prompt: "do a thing" });
    // Wait for the background promise to settle
    await orch.waitForAgent(result.agent_id);
    const rec = await registry.get(result.agent_id);
    expect(rec!.status).toBe("completed");
    expect(rec!.thread_id).toBe("thread-1");
    expect(rec!.last_output).toBe("done");
  });
});
```

**Step 2: Run — expect fail (module not found)**

---

### Task 6.2: Orchestrator — implement `spawn` + `waitForAgent`

**Files:**
- Create: `src/orchestrator.ts`

**Step 1: Write implementation**

```ts
import type { Registry } from "./registry.js";
import type { Worktrees } from "./worktree.js";
import type { AgentRecord, AgentRole } from "./types.js";
import type { CodexChild } from "./mcp/codex-client.js";
import { loadRole } from "./roles/loader.js";
import { renderTemplate } from "./roles/templater.js";

export interface SpawnInput {
  role: AgentRole;
  prompt: string;
  issue_id?: string | null;
  pr_number?: number | null;
  base_ref?: string;
  overrides?: Partial<{
    model: string;
    sandbox: "read-only" | "workspace-write" | "danger-full-access";
    approval_policy: "untrusted" | "on-failure" | "on-request" | "never";
    timeout_seconds: number;
    developer_instructions_append: string;
    developer_instructions_replace: string;
  }>;
}

export interface SpawnResult {
  agent_id: string;
  status: AgentRecord["status"];
  worktree_path: string | null;
  role: AgentRole;
}

export interface OrchestratorOptions {
  registry: Registry;
  worktrees: Worktrees;
  codexFactory: () => CodexChild;
  rolesDir: string;
  repoRoot: string;
  projectCommittedRolesPath?: string;
  userGlobalRolesPath?: string;
}

export class Orchestrator {
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(private readonly opts: OrchestratorOptions) {}

  async spawn(input: SpawnInput): Promise<SpawnResult> {
    const preset = await loadRole(input.role, {
      defaultsDir: this.opts.rolesDir,
      projectCommitted: this.opts.projectCommittedRolesPath,
      userGlobalPath: this.opts.userGlobalRolesPath,
      overrides: {
        ...(input.overrides?.model ? { model: input.overrides.model } : {}),
        ...(input.overrides?.sandbox ? { sandbox: input.overrides.sandbox } : {}),
        ...(input.overrides?.approval_policy ? { approval_policy: input.overrides.approval_policy } : {}),
        ...(input.overrides?.timeout_seconds ? { timeout_seconds: input.overrides.timeout_seconds } : {}),
      },
    });

    const model = preset.model ?? "gpt-5.2-codex";
    const baseRef = input.base_ref ?? "main";

    const rec = await this.opts.registry.create({
      role: input.role,
      cwd: this.opts.repoRoot,
      model,
      sandbox: preset.sandbox,
      approval_policy: preset.approval_policy,
      last_prompt: input.prompt,
      issue_id: input.issue_id ?? null,
      pr_number: input.pr_number ?? null,
    });

    let cwd = this.opts.repoRoot;
    let worktreeInfo = null;
    if (preset.worktree) {
      const branch = `codex/${rec.agent_id.replace(/^codex-/, "")}`;
      worktreeInfo = await this.opts.worktrees.create({
        agent_id: rec.agent_id,
        branch,
        base_ref: baseRef,
      });
      cwd = worktreeInfo.path;
      await this.opts.registry.update(rec.agent_id, { cwd, worktree: worktreeInfo });
    }

    const templateCtx = {
      agent_id: rec.agent_id,
      role: input.role,
      cwd,
      worktree_path: worktreeInfo?.path ?? "",
      branch: worktreeInfo?.branch ?? "",
      base_ref: worktreeInfo?.base_ref ?? "",
    };

    let instructions = renderTemplate(preset.developer_instructions, templateCtx);
    if (input.overrides?.developer_instructions_replace) {
      instructions = input.overrides.developer_instructions_replace;
    } else if (input.overrides?.developer_instructions_append) {
      instructions += "\n\n" + input.overrides.developer_instructions_append;
    }

    const child = this.opts.codexFactory();
    const startedAt = new Date().toISOString();
    await this.opts.registry.update(rec.agent_id, { status: "running", started_at: startedAt });

    const task = (async () => {
      try {
        await child.start();
        await this.opts.registry.update(rec.agent_id, { pid: child.pid });
        const result = await child.call({
          prompt: input.prompt,
          cwd,
          model,
          sandbox: preset.sandbox,
          approval_policy: preset.approval_policy,
          developer_instructions: instructions,
        });
        await this.opts.registry.update(rec.agent_id, {
          status: "completed",
          thread_id: result.threadId || null,
          last_output: result.content,
          ended_at: new Date().toISOString(),
          pid: null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await this.opts.registry.update(rec.agent_id, {
          status: "failed",
          error: { message },
          ended_at: new Date().toISOString(),
          pid: null,
        });
      } finally {
        await child.stop().catch(() => {});
      }
    })();
    this.tasks.set(rec.agent_id, task);

    return {
      agent_id: rec.agent_id,
      status: "running",
      worktree_path: worktreeInfo?.path ?? null,
      role: input.role,
    };
  }

  async waitForAgent(agent_id: string): Promise<void> {
    const task = this.tasks.get(agent_id);
    if (task) await task;
  }
}
```

**Step 2: Run — expect pass**

Run: `npm test -- orchestrator`
Expected: `2 passed`.

**Step 3: Commit**

```bash
git add src/orchestrator.ts tests/unit/orchestrator.test.ts
git commit -m "feat(orchestrator): implement async spawn with background task"
```

---

### Task 6.3: Spawn failure path — failing test

**Files:**
- Test: `tests/unit/orchestrator.test.ts` (append)

**Step 1: Add test**

```ts
describe("Orchestrator.spawn — failure", () => {
  it("marks agent failed if codex child throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-fail-"));
    const reg = new Registry(dir);
    const wt = { create: vi.fn().mockResolvedValue({ path: "/tmp/w", branch: "b", base_ref: "main", created_at: "" }), remove: vi.fn() } as unknown as Worktrees;
    const codexFactory = () =>
      ({
        start: vi.fn().mockRejectedValue(new Error("codex bang")),
        call: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() { return null; },
      } as unknown as CodexChild);
    const orch = new Orchestrator({ registry: reg, worktrees: wt, codexFactory, rolesDir: join(process.cwd(), "src/roles/defaults"), repoRoot: "/tmp/r" });
    const res = await orch.spawn({ role: "implementer", prompt: "x" });
    await orch.waitForAgent(res.agent_id);
    const rec = await reg.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.message).toContain("codex bang");
  });
});
```

**Step 2: Run — expect pass** (implementation already handles this path)

Run: `npm test -- orchestrator`
Expected: all passed.

**Step 3: Commit**

```bash
git add tests/unit/orchestrator.test.ts
git commit -m "test(orchestrator): cover codex start failure path"
```

---

## Phase 7: MCP server — expose tools to Claude

### Task 7.1: MCP server skeleton — `tools/list` works

**Files:**
- Modify: `src/index.ts`

**Step 1: Write MCP server entry**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Registry } from "./registry.js";
import { Worktrees } from "./worktree.js";
import { Orchestrator } from "./orchestrator.js";
import { CodexChild } from "./mcp/codex-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function detectRepoRoot(): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    return process.cwd();
  }
}

async function main() {
  const repoRoot = await detectRepoRoot();
  const stateDir = process.env.CODEX_TEAM_STATE_DIR
    ? resolve(repoRoot, process.env.CODEX_TEAM_STATE_DIR)
    : join(repoRoot, ".codex-team");

  const registry = new Registry(stateDir);
  const worktrees = new Worktrees(repoRoot);
  const rolesDir = join(__dirname, "roles", "defaults");
  const orch = new Orchestrator({
    registry,
    worktrees,
    codexFactory: () => new CodexChild(),
    rolesDir,
    repoRoot,
    projectCommittedRolesPath: join(repoRoot, "codex-team.toml"),
    userGlobalRolesPath: join(process.env.HOME ?? "~", ".codex-team", "roles.toml"),
  });

  const server = new Server(
    { name: "codex-team", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "spawn",
        description: "Launch a Codex agent in the background. Returns immediately with agent_id; poll via `status`.",
        inputSchema: {
          type: "object",
          required: ["role", "prompt"],
          properties: {
            role: { type: "string", enum: ["implementer", "reviewer", "planner", "generic"] },
            prompt: { type: "string" },
            issue_id: { type: "string" },
            pr_number: { type: "number" },
            base_ref: { type: "string" },
            overrides: {
              type: "object",
              properties: {
                model: { type: "string" },
                sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] },
                approval_policy: { type: "string" },
                timeout_seconds: { type: "number" },
                developer_instructions_append: { type: "string" },
                developer_instructions_replace: { type: "string" },
              },
            },
          },
        },
      },
      {
        name: "status",
        description: "Get the status of one agent (if agent_id given) or all agents.",
        inputSchema: {
          type: "object",
          properties: { agent_id: { type: "string" } },
        },
      },
      {
        name: "result",
        description: "Get the full last output of a completed agent.",
        inputSchema: {
          type: "object",
          required: ["agent_id"],
          properties: { agent_id: { type: "string" } },
        },
      },
    ],
  }));

  const SpawnInputZ = z.object({
    role: z.enum(["implementer", "reviewer", "planner", "generic"]),
    prompt: z.string().min(1),
    issue_id: z.string().optional(),
    pr_number: z.number().optional(),
    base_ref: z.string().optional(),
    overrides: z
      .object({
        model: z.string().optional(),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
        approval_policy: z.enum(["untrusted", "on-failure", "on-request", "never"]).optional(),
        timeout_seconds: z.number().optional(),
        developer_instructions_append: z.string().optional(),
        developer_instructions_replace: z.string().optional(),
      })
      .optional(),
  });

  const StatusInputZ = z.object({ agent_id: z.string().optional() });
  const ResultInputZ = z.object({ agent_id: z.string() });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === "spawn") {
      const parsed = SpawnInputZ.parse(args);
      const result = await orch.spawn(parsed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }
    if (name === "status") {
      const parsed = StatusInputZ.parse(args);
      if (parsed.agent_id) {
        const rec = await registry.get(parsed.agent_id);
        const payload = rec ? summarize(rec) : { error: "not found" };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
      }
      const all = await registry.list();
      const payload = {
        agents: all.map(summarize),
        summary: countByStatus(all),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
    if (name === "result") {
      const parsed = ResultInputZ.parse(args);
      const rec = await registry.get(parsed.agent_id);
      if (!rec) return { content: [{ type: "text", text: JSON.stringify({ error: "not found" }) }], isError: true };
      const payload = { agent_id: rec.agent_id, status: rec.status, output: rec.last_output, error: rec.error };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
    throw new Error(`unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("codex-team MCP server listening on stdio");
}

function summarize(rec: { agent_id: string; role: string; status: string; thread_id: string | null; created_at: string; started_at: string | null; ended_at: string | null; worktree: { path: string } | null; issue_id: string | null; pr_number: number | null; last_output: string | null; error: { message: string } | null }) {
  return {
    agent_id: rec.agent_id,
    role: rec.role,
    status: rec.status,
    thread_id: rec.thread_id,
    worktree_path: rec.worktree?.path ?? null,
    issue_id: rec.issue_id,
    pr_number: rec.pr_number,
    created_at: rec.created_at,
    started_at: rec.started_at,
    ended_at: rec.ended_at,
    last_output_preview: rec.last_output?.slice(0, 500) ?? null,
    error_summary: rec.error?.message ?? null,
  };
}

function countByStatus(records: Array<{ status: string }>) {
  const counts: Record<string, number> = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

main().catch((err) => {
  console.error("codex-team MCP fatal:", err);
  process.exit(1);
});
```

**Step 2: Build**

Run: `npm run build`
Expected: exits 0.

**Step 3: Smoke — `tools/list` via raw JSON-RPC**

Create: `scripts/smoke-tools-list.sh`

```bash
#!/usr/bin/env bash
# Spawn the built MCP server, send initialize + tools/list, print response.
set -euo pipefail
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
```

Run: `chmod +x scripts/smoke-tools-list.sh && ./scripts/smoke-tools-list.sh`
Expected: stdout shows the three tools (`spawn`, `status`, `result`).

**Step 4: Commit**

```bash
git add src/index.ts scripts/smoke-tools-list.sh
git commit -m "feat(mcp): expose spawn/status/result tools over stdio"
```

---

### Task 7.2: End-to-end integration test (real codex)

**Files:**
- Test: `tests/integration/end-to-end.test.ts`

**Step 1: Write test**

```ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

describe.skipIf(!process.env.RUN_CODEX_INTEGRATION)("end-to-end — real codex (integration)", () => {
  it("spawns an implementer, polls status until completed, returns result", async () => {
    const repo = mkdtempSync(join(tmpdir(), "e2e-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);

    const mcp = spawn("node", [join(process.cwd(), "dist", "index.js")], {
      cwd: repo,
      env: { ...process.env, CODEX_TEAM_STATE_DIR: ".codex-team" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Keep this test minimal: issue initialize + tools/call spawn + poll status.
    // See scripts/smoke-e2e.sh for a readable reference.
    const send = (msg: unknown) => mcp.stdin.write(JSON.stringify(msg) + "\n");

    const responses = new Map<number, any>();
    let buf = "";
    mcp.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.trim()) continue;
        const msg = JSON.parse(l);
        if (msg.id != null) responses.set(msg.id, msg);
      }
    });
    const waitFor = (id: number, timeoutMs = 60_000) =>
      new Promise<any>((res, rej) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          if (responses.has(id)) return res(responses.get(id));
          if (Date.now() > deadline) return rej(new Error(`timeout waiting for id=${id}`));
          setTimeout(tick, 100);
        };
        tick();
      });

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } });
    await waitFor(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: {
        name: "spawn",
        arguments: {
          role: "generic",
          prompt: "Respond with exactly: OK",
          overrides: { sandbox: "read-only", timeout_seconds: 120 },
        },
      },
    });
    const spawnResp = await waitFor(2);
    const spawnResult = JSON.parse(spawnResp.result.content[0].text);
    expect(spawnResult.agent_id).toMatch(/^codex-gen-/);
    expect(spawnResult.status).toBe("running");

    // Poll status until terminal
    let pollId = 10;
    const start = Date.now();
    let terminal: any = null;
    while (Date.now() - start < 180_000) {
      send({ jsonrpc: "2.0", id: ++pollId, method: "tools/call", params: { name: "status", arguments: { agent_id: spawnResult.agent_id } } });
      const resp = await waitFor(pollId);
      const s = JSON.parse(resp.result.content[0].text);
      if (s.status === "completed" || s.status === "failed" || s.status === "cancelled") { terminal = s; break; }
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(terminal).not.toBeNull();
    expect(terminal.status).toBe("completed");

    mcp.kill();
    rmSync(repo, { recursive: true, force: true });
  }, 240_000);
});
```

**Step 2: Run — expect skip then pass**

Run: `npm test -- end-to-end` → `skipped`.
Run: `RUN_CODEX_INTEGRATION=1 npm run build && RUN_CODEX_INTEGRATION=1 npm test -- end-to-end` → `1 passed` (takes up to a minute for a trivial Codex response).

**Step 3: Commit**

```bash
git add tests/integration/end-to-end.test.ts
git commit -m "test(e2e): verify spawn→status→completed against real codex"
```

---

## Phase 8: Documentation

### Task 8.1: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

Contents:

````markdown
# magic-cc-codex-worker

Claude Code plugin that orchestrates [Codex](https://github.com/openai/codex) as a pool of agent workers.

**Walking-skeleton status:** `spawn` / `status` / `result` tools work end-to-end. `resume`, `cancel`, `merge`, `discard`, slash commands, subagents, and Magic Flow integration ship in follow-up releases.

## Prerequisites

- `codex` CLI installed and authenticated (`which codex` returns a path)
- Node.js 20+
- Git 2.40+
- Claude Code configured

## Install

```bash
git clone <repo-url>
cd magic-cc-codex-worker
npm install
npm run build
```

Register the plugin with Claude Code (TBD — depends on Claude Code's plugin install mechanism for this version).

## Tools

### `spawn`
Launch a Codex agent in the background. Returns immediately; poll via `status`.

### `status`
Get per-agent or all-agents state snapshot.

### `result`
Get the full output of a terminal-state agent.

## Running tests

```bash
npm test                                 # unit tests only
RUN_CODEX_INTEGRATION=1 npm test         # include integration (requires codex CLI + auth)
```

## Design

See [`docs/plans/2026-04-24-magic-cc-codex-worker-design.md`](docs/plans/2026-04-24-magic-cc-codex-worker-design.md).
````

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README for walking-skeleton state"
```

---

## Post-skeleton — next plans

After this plan completes, the following are next (each its own plan):

1. **Resume + cancel + list** — adds session continuity and killability.
2. **Merge + discard + slash commands + subagent definitions** — makes the plugin ergonomic for humans.
3. **Magic Flow integration** — detection, Linear, branch naming, workers.json, hooks.
4. **Dual-model PR review + epic fan-out** — the high-value MF features.
5. **Progress/streaming if codex-mcp-server gains progress notifications** — speculative.

Adjustments surfaced during this skeleton feed back into the design doc before plan 2 starts.

---

## Verification before shipping this plan

Before calling the skeleton "done":

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` (unit) — all pass
- [ ] `RUN_CODEX_INTEGRATION=1 npm test` (integration) — all pass
- [ ] `scripts/smoke-tools-list.sh` — shows 3 tools
- [ ] Manual: register plugin in Claude Code, ask Claude to spawn a generic agent saying "respond with OK", poll status, confirm completion. Confirm `.codex-team/state.json` persists the record.
