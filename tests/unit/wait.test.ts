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

describe("wait - replay path", () => {
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
    expect(elapsed).toBeLessThan(150);
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
    const out = await handleWait({ since: before, agent_ids: [a.agent_id] }, registry);
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
    const cursor = new Date(Date.now() + 1).toISOString();
    const out = await handleWait(
      { since: cursor, timeout_seconds: 1, agent_ids: [a.agent_id] },
      registry,
    );
    expect(out.timed_out).toBe(true);
    expect(out.events.length).toBe(0);
  });
});

describe("wait - live subscribe path", () => {
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
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(800);
  });

  it("coalesces multiple terminations within batch_window_ms into one response", async () => {
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
    await Promise.all(ids.map((id) => orch.waitForAgent(id)));
    const out = await handleWait(
      { since: new Date(Date.now() - 60_000).toISOString(), agent_ids: ids },
      registry,
    );
    expect(out.events.length).toBe(3);
    expect(out.agents_still_running).toBe(0);
  });

  it("times out cleanly with no leaked listeners", async () => {
    const cancellableFactory = () => {
      let rejectCall: ((error: Error) => void) | null = null;
      let stopped = false;
      return {
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(() => {
          if (stopped) return Promise.reject(new Error("transport closed"));
          return new Promise((_, reject) => {
            rejectCall = reject;
          });
        }),
        stop: vi.fn().mockImplementation(async () => {
          stopped = true;
          rejectCall?.(new Error("transport closed"));
        }),
        get pid() {
          return 1;
        },
      } as unknown as CodexChild;
    };
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: cancellableFactory,
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    const listenersBefore = registry.listenerCount("change");
    const start = Date.now();
    const out = await handleWait({ agent_ids: [spawn.agent_id], timeout_seconds: 0.05 }, registry);
    const elapsed = Date.now() - start;
    expect(out.timed_out).toBe(true);
    expect(out.events).toEqual([]);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
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
