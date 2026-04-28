import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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

  it("mints unique agent_ids for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        registry.create({
          role: "reviewer",
          cwd: "/tmp",
          model: "m",
          sandbox: "read-only",
          approval_policy: "never",
          last_prompt: "p",
        }),
      ),
    );
    const ids = new Set(results.map((r) => r.agent_id));
    expect(ids.size).toBe(10);
  });
});

describe("Registry.update", () => {
  it("transitions status and persists", async () => {
    const rec = await registry.create({
      role: "implementer",
      cwd: "/tmp/foo",
      model: "m",
      sandbox: "workspace-write",
      approval_policy: "never",
      last_prompt: "p",
    });
    await registry.update(rec.agent_id, {
      status: "running",
      started_at: new Date().toISOString(),
    });
    const fetched = await registry.get(rec.agent_id);
    expect(fetched!.status).toBe("running");
    expect(fetched!.started_at).toBeTruthy();
  });

  it("throws on unknown agent_id", async () => {
    await expect(registry.update("nope", { status: "running" })).rejects.toThrow(/not found/);
  });
});

describe("Registry.list and reload", () => {
  it("lists all agents and survives reload from disk", async () => {
    const a = await registry.create({
      role: "reviewer",
      cwd: "/a",
      model: "m",
      sandbox: "read-only",
      approval_policy: "never",
      last_prompt: "x",
    });
    const b = await registry.create({
      role: "implementer",
      cwd: "/b",
      model: "m",
      sandbox: "workspace-write",
      approval_policy: "never",
      last_prompt: "y",
    });
    const listed = await registry.list();
    expect(listed).toHaveLength(2);
    const fresh = new Registry(dir);
    const restored = await fresh.list();
    expect(restored.map((r) => r.agent_id).sort()).toEqual([a.agent_id, b.agent_id].sort());
  });
});

describe("Registry zombie sweep on load", () => {
  it("marks running/queued agents from a prior process as failed with kind=zombie", async () => {
    // Simulate a crashed process by creating + transitioning to running,
    // then opening a *fresh* Registry over the same state dir.
    const orig = await registry.create({
      role: "implementer",
      cwd: "/x",
      model: "m",
      sandbox: "workspace-write",
      approval_policy: "never",
      last_prompt: "long work",
    });
    await registry.update(orig.agent_id, {
      status: "running",
      started_at: new Date().toISOString(),
      pid: 4242,
    });

    // A new server process: any "running" record in state.json must be
    // a zombie because no in-process task is tracking it.
    const fresh = new Registry(dir);
    const swept = await fresh.get(orig.agent_id);
    expect(swept!.status).toBe("failed");
    expect(swept!.error?.kind).toBe("zombie");
    expect(swept!.pid).toBeNull();
    expect(swept!.ended_at).toBeTruthy();
  });

  it("leaves terminal agents (completed/failed/cancelled) untouched", async () => {
    const rec = await registry.create({
      role: "reviewer",
      cwd: "/x",
      model: "m",
      sandbox: "read-only",
      approval_policy: "never",
      last_prompt: "p",
    });
    await registry.update(rec.agent_id, {
      status: "completed",
      ended_at: new Date().toISOString(),
      last_output: "ok",
    });
    const fresh = new Registry(dir);
    const reloaded = await fresh.get(rec.agent_id);
    expect(reloaded!.status).toBe("completed");
    expect(reloaded!.error).toBeNull();
  });
});

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
    await fresh.list();
    expect(events).toEqual([]);
  });
});

describe("Registry.create — repo_root", () => {
  it("persists repo_root on the record when provided", async () => {
    const rec = await registry.create({
      role: "implementer",
      cwd: "/path/to/some/worktree",
      model: "m",
      sandbox: "danger-full-access",
      approval_policy: "never",
      last_prompt: "p",
      repo_root: "/path/to/some",
    });
    expect(rec.repo_root).toBe("/path/to/some");
    const fresh = new Registry(dir);
    const reloaded = await fresh.get(rec.agent_id);
    expect(reloaded!.repo_root).toBe("/path/to/some");
  });
});
