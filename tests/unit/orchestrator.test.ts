import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { Registry } from "../../src/registry.js";
import { Worktrees } from "../../src/worktree.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { CodexChild } from "../../src/mcp/codex-client.js";

const rolesDir = resolve(process.cwd(), "src", "roles", "defaults");

describe("Orchestrator.spawn", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-repo-"));
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

  function mockCodexFactory(
    call: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-1", content: "done", raw: {} }),
  ): () => CodexChild {
    return () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call,
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 4242;
        },
      }) as unknown as CodexChild;
  }

  it("returns immediately with status=running and agent_id", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const result = await orch.spawn({ role: "implementer", prompt: "do a thing" });
    expect(result.agent_id).toMatch(/^codex-impl-/);
    expect(result.status).toBe("running");
    expect(result.worktree_path).not.toBeNull();
    // Drain background task so afterEach can safely cleanup state dir.
    await orch.waitForAgent(result.agent_id);
  });

  it("completes in background with thread_id, last_output, and completed status", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const result = await orch.spawn({ role: "implementer", prompt: "do" });
    await orch.waitForAgent(result.agent_id);
    const rec = await registry.get(result.agent_id);
    expect(rec!.status).toBe("completed");
    expect(rec!.thread_id).toBe("thread-1");
    expect(rec!.last_output).toBe("done");
    expect(rec!.ended_at).toBeTruthy();
    expect(rec!.pid).toBeNull();
  });

  it("marks failed when codex start throws", async () => {
    const failingFactory = () =>
      ({
        start: vi.fn().mockRejectedValue(new Error("codex bang")),
        call: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return null;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: failingFactory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "reviewer", prompt: "review" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.message).toContain("codex bang");
  });

  it("marks failed with timeout message when codex call hangs past timeout", async () => {
    const hangingCall = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(hangingCall),
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({
      role: "generic",
      prompt: "hang",
      overrides: { timeout_seconds: 1 },
    });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.message).toMatch(/timeout/);
  });

  it("skips worktree creation for reviewer role", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const result = await orch.spawn({ role: "reviewer", prompt: "review x" });
    expect(result.worktree_path).toBeNull();
    await orch.waitForAgent(result.agent_id);
    const rec = await registry.get(result.agent_id);
    expect(rec!.worktree).toBeNull();
    expect(rec!.cwd).toBe(repo);
  });

  it("applies developer_instructions_append override", async () => {
    const call = vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(call),
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({
      role: "generic",
      prompt: "p",
      overrides: { developer_instructions_append: "EXTRA-GUIDANCE-TOKEN" },
    });
    await orch.waitForAgent(res.agent_id);
    const passed = call.mock.calls[0][0];
    expect(passed.developer_instructions).toContain("EXTRA-GUIDANCE-TOKEN");
  });
});
