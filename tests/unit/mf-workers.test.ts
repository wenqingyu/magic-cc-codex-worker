import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkersMirror } from "../../src/mf/workers.js";
import type { AgentRecord } from "../../src/types.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "wm-"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function sampleRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const now = "2026-04-24T16:00:00.000Z";
  return {
    agent_id: "codex-impl-abc",
    role: "implementer",
    thread_id: null,
    status: "running",
    cwd: "/tmp/x",
    worktree: { path: "/tmp/wt", branch: "codex/abc", base_ref: "main", created_at: now },
    model: "gpt-5.2-codex",
    sandbox: "workspace-write",
    approval_policy: "never",
    issue_id: "TEAM-1",
    pr_number: null,
    created_at: now,
    started_at: now,
    ended_at: null,
    last_prompt: "p",
    last_output: null,
    error: null,
    pid: 42,
    ...overrides,
  };
}

describe("WorkersMirror", () => {
  it("upsert creates ops/workers.json with the record", async () => {
    const wm = new WorkersMirror(repo);
    await wm.upsertFromRecord(sampleRecord());
    const path = join(repo, "ops", "workers.json");
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.workers["codex-team:codex-impl-abc"].role).toBe("implementer");
    expect(parsed.workers["codex-team:codex-impl-abc"].branch).toBe("codex/abc");
  });

  it("upsert idempotent — subsequent calls update the entry in place", async () => {
    const wm = new WorkersMirror(repo);
    await wm.upsertFromRecord(sampleRecord({ status: "running" }));
    await wm.upsertFromRecord(sampleRecord({ status: "completed", ended_at: "2026-04-24T17:00:00.000Z" }));
    const path = join(repo, "ops", "workers.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.workers)).toHaveLength(1);
    expect(parsed.workers["codex-team:codex-impl-abc"].status).toBe("completed");
  });

  it("remove deletes the entry", async () => {
    const wm = new WorkersMirror(repo);
    await wm.upsertFromRecord(sampleRecord());
    await wm.remove("codex-impl-abc");
    const path = join(repo, "ops", "workers.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.workers)).toHaveLength(0);
  });

  it("coexists with pre-existing workers.json entries from other kinds", async () => {
    const path = join(repo, "ops", "workers.json");
    // Simulate an existing entry (e.g., from Cyrus).
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(repo, "ops"));
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        workers: {
          "cyrus:something": { worker_id: "cyrus:something", kind: "cyrus" },
        },
      }),
    );
    const wm = new WorkersMirror(repo);
    await wm.upsertFromRecord(sampleRecord());
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.workers)).toContain("cyrus:something");
    expect(Object.keys(parsed.workers)).toContain("codex-team:codex-impl-abc");
  });
});
