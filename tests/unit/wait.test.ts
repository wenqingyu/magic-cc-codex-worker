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
