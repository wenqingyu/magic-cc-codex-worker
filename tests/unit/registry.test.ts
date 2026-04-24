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
