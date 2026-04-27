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

// Shared helper: codex child whose call() hangs until stop() is called.
// Models real transport-close semantics: once stopped, any in-flight OR future
// call() rejects immediately.
function makeCancellableFactory(): () => CodexChild {
  return () => {
    let rejectCall: ((e: Error) => void) | null = null;
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
        return 4242;
      },
    } as unknown as CodexChild;
  };
}

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

  it("passes the per-role timeoutMs through to child.call (not just the outer wrapper)", async () => {
    // Bug 0.3.5 fix: MCP SDK had a 60s default Request timeout that fired
    // before our Node-level withTimeout wrapper, killing every long codex
    // run. Confirm the timeoutMs argument is now threaded through.
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
      overrides: { timeout_seconds: 1234 },
    });
    await orch.waitForAgent(res.agent_id);
    expect(call).toHaveBeenCalledTimes(1);
    // 2nd arg to child.call is the timeoutMs — must equal 1234 * 1000
    const secondArg = call.mock.calls[0][1];
    expect(secondArg).toBe(1234 * 1000);
  });

  it("passes writable_roots=[repoRoot/.git] for workspace-write worktree spawns", async () => {
    // 0.3.6 fix: codex's workspace-write sandbox blocks writes to the
    // main repo's `.git` (objects/refs/per-worktree metadata), so git
    // inside a linked worktree silently fails. Expose `.git` as an
    // extra writable root so agents can commit from their own worktree.
    //
    // 0.4.0: implementer default is now danger-full-access (which
    // doesn't need writable_roots at all). This test explicitly
    // overrides back to workspace-write to exercise the safety net
    // for users who opt back via magic-codex.toml.
    const call = vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(call),
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({
      role: "implementer",
      prompt: "edit and commit",
      overrides: { sandbox: "workspace-write" },
    });
    await orch.waitForAgent(res.agent_id);
    const passed = call.mock.calls[0][0];
    // 0.3.7: path is realpath-canonicalized so macOS seatbelt matches
    // reliably regardless of /var vs /private/var or APFS firmlinks.
    const { realpathSync } = await import("node:fs");
    expect(passed.writable_roots).toEqual([realpathSync(`${repo}/.git`)]);
  });

  it("captures codex stderr to <stateDir>/logs/<agent_id>.codex.stderr and records the path on the agent", async () => {
    // 0.3.8 diagnostic: capture sandbox-denial messages and codex
    // startup errors that would otherwise vanish with the child process.
    let capturedOnStderr: ((chunk: Buffer) => void) | undefined;
    const factory = (opts?: { onStderr?: (chunk: Buffer) => void }) => {
      capturedOnStderr = opts?.onStderr;
      return {
        start: vi.fn().mockImplementation(async () => {
          // Simulate codex emitting a seatbelt denial during startup.
          capturedOnStderr?.(Buffer.from("sandbox: write blocked at /some/path\n"));
        }),
        call: vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 4242;
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
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    expect(capturedOnStderr).toBeDefined();
    const rec = await registry.get(res.agent_id);
    expect(rec!.stderr_log).toMatch(/logs\/codex-impl-[^/]+\.codex\.stderr$/);
    const { readFileSync } = await import("node:fs");
    const logContents = readFileSync(rec!.stderr_log!, "utf8");
    expect(logContents).toContain("sandbox: write blocked at /some/path");
  });

  it("classifies rate-limit failures from codex stderr as error.kind='rate_limited'", async () => {
    // 0.3.9: supervisors branch on error.kind to fall back to Sonnet
    // subagents when codex hits its daily quota, instead of blind retry.
    const factory = (opts?: { onStderr?: (chunk: Buffer) => void }) => {
      return {
        start: vi.fn().mockImplementation(async () => {
          opts?.onStderr?.(
            Buffer.from("ERROR: rate limit exceeded, try again later\n"),
          );
        }),
        call: vi.fn().mockRejectedValue(new Error("tool call failed")),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 4242;
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
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.kind).toBe("rate_limited");
    expect(rec!.error?.stderr_tail).toContain("rate limit exceeded");
  });

  it("omits writable_roots for read-only roles (reviewer without PR)", async () => {
    const call = vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: mockCodexFactory(call),
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "reviewer", prompt: "review x" });
    await orch.waitForAgent(res.agent_id);
    const passed = call.mock.calls[0][0];
    expect(passed.writable_roots).toBeUndefined();
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

describe("Orchestrator.resume", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-res-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-res-repo-"));
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

  it("rejects resume on an unknown agent_id", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () => ({}) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    await expect(orch.resume({ agent_id: "nope", prompt: "continue" })).rejects.toThrow(
      /not found/,
    );
  });

  it("rejects resume on a running agent", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    await expect(orch.resume({ agent_id: spawn.agent_id, prompt: "more" })).rejects.toThrow(
      /running/,
    );
    await orch.cancel({ agent_id: spawn.agent_id });
  });

  it("rejects resume if thread_id is null", async () => {
    // Agent completed but codex never returned a threadId (edge case)
    const call = vi.fn().mockResolvedValue({ threadId: "", content: "done", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call,
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 2;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    await orch.waitForAgent(spawn.agent_id);
    await expect(orch.resume({ agent_id: spawn.agent_id, prompt: "more" })).rejects.toThrow(
      /thread_id/,
    );
  });

  it("resumes a completed agent via codex-reply with stored thread_id", async () => {
    const firstCall = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-XYZ", content: "initial", raw: {} });
    const secondCall = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-XYZ", content: "followup", raw: {} });
    let callIndex = 0;
    const factory = () => {
      const impl = callIndex++ === 0 ? firstCall : secondCall;
      return {
        start: vi.fn().mockResolvedValue(undefined),
        call: impl,
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 9999;
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
    const spawn = await orch.spawn({ role: "reviewer", prompt: "first" });
    await orch.waitForAgent(spawn.agent_id);
    const resume = await orch.resume({ agent_id: spawn.agent_id, prompt: "continue please" });
    expect(resume.status).toBe("running");
    await orch.waitForAgent(spawn.agent_id);
    const rec = await registry.get(spawn.agent_id);
    expect(rec!.status).toBe("completed");
    expect(rec!.last_output).toBe("followup");
    expect(rec!.thread_id).toBe("thread-XYZ");
    const secondArgs = secondCall.mock.calls[0][0];
    expect(secondArgs.thread_id).toBe("thread-XYZ");
    expect(secondArgs.prompt).toBe("continue please");
  });
});

describe("Orchestrator.cancel", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-can-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-can-repo-"));
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

  it("cancels a running agent and marks status=cancelled (not failed)", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "long work" });
    const res = await orch.cancel({ agent_id: spawn.agent_id });
    expect(res.status).toBe("cancelled");
    const rec = await registry.get(spawn.agent_id);
    expect(rec!.status).toBe("cancelled");
    expect(rec!.error).toBeNull();
  });

  it("is idempotent on already-terminal agents", async () => {
    const call = vi.fn().mockResolvedValue({ threadId: "t", content: "done", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call,
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 1;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "reviewer", prompt: "p" });
    await orch.waitForAgent(spawn.agent_id);
    const res = await orch.cancel({ agent_id: spawn.agent_id });
    expect(res.status).toBe("completed"); // stays completed
    expect(res.worktree_removed).toBe(false);
  });

  it("removes the worktree when force is true", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "implementer", prompt: "work" });
    expect(spawn.worktree_path).not.toBeNull();
    const res = await orch.cancel({ agent_id: spawn.agent_id, force: true });
    expect(res.status).toBe("cancelled");
    expect(res.worktree_removed).toBe(true);
    const rec = await registry.get(spawn.agent_id);
    expect(rec!.worktree).toBeNull();
  });
});

describe("Orchestrator.merge and discard", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-mrg-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-mrg-repo-"));
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

  it("merges a completed implementer's worktree into base_ref with squash", async () => {
    // Factory whose call creates a commit in the worktree before resolving.
    const factory = () => {
      const cwdSeen: { cwd?: string } = {};
      return {
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string }) => {
          cwdSeen.cwd = input.cwd;
          const { writeFileSync } = await import("node:fs");
          writeFileSync(join(input.cwd, "AGENT_WORK.md"), "agent output\n");
          await execa("git", ["-C", input.cwd, "add", "AGENT_WORK.md"]);
          await execa("git", ["-C", input.cwd, "commit", "-m", "agent work"]);
          return { threadId: "t-1", content: "done", raw: {} };
        }),
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
    const spawn = await orch.spawn({ role: "implementer", prompt: "do work" });
    await orch.waitForAgent(spawn.agent_id);

    const res = await orch.merge({ agent_id: spawn.agent_id });
    expect(res.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(res.merged_into).toBe("main");
    expect(res.worktree_removed).toBe(true);

    const { stdout } = await execa("git", ["-C", repo, "log", "--oneline", "-n", "2"]);
    expect(stdout).toContain("Merge codex agent branch");
  });

  it("rejects merge on non-completed agents", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "implementer", prompt: "w" });
    await expect(orch.merge({ agent_id: spawn.agent_id })).rejects.toThrow(/only completed/);
    await orch.cancel({ agent_id: spawn.agent_id });
  });

  it("discards a terminal agent's worktree + branch", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "implementer", prompt: "w" });
    await orch.cancel({ agent_id: spawn.agent_id });
    const res = await orch.discard({ agent_id: spawn.agent_id });
    expect(res.worktree_removed).toBe(true);
    expect(res.branch_deleted).toBe(true);
  });

  it("rejects discard on a still-running agent", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: makeCancellableFactory(),
      rolesDir,
      repoRoot: repo,
    });
    const spawn = await orch.spawn({ role: "implementer", prompt: "w" });
    await expect(orch.discard({ agent_id: spawn.agent_id })).rejects.toThrow(/cancel first/);
    await orch.cancel({ agent_id: spawn.agent_id });
  });
});

describe("Orchestrator multi-repo discard / merge / cancel --force", () => {
  // Regression for the bug where discard ran git -C <orchestrator's
  // default repo> instead of -C <per-spawn repo_root>, failing with
  // "fatal: not a git repository" in multi-repo workspaces.
  let stateDir: string;
  let repoA: string;
  let repoB: string;
  let registry: Registry;
  let worktreesA: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-multi-state-"));
    repoA = mkdtempSync(join(tmpdir(), "orch-multi-A-"));
    repoB = mkdtempSync(join(tmpdir(), "orch-multi-B-"));
    for (const r of [repoA, repoB]) {
      await execa("git", ["-C", r, "init", "-q", "-b", "main"]);
      await execa("git", ["-C", r, "config", "user.email", "t@t"]);
      await execa("git", ["-C", r, "config", "user.name", "t"]);
      await execa("git", ["-C", r, "commit", "--allow-empty", "-m", "init"]);
    }
    registry = new Registry(stateDir);
    worktreesA = new Worktrees(repoA);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  });

  function okFactory() {
    return () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue({ threadId: "t-1", content: "done", raw: {} }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
  }

  it("discards a worktree against the per-spawn repo_root, not the default", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees: worktreesA, // default points at repoA
      codexFactory: okFactory(),
      rolesDir,
      repoRoot: repoA,
    });
    const res = await orch.spawn({
      role: "implementer",
      prompt: "work",
      repo_root: repoB, // spawn against repoB
    });
    await orch.waitForAgent(res.agent_id);
    // Discard must succeed even though orchestrator's default repo is
    // repoA — pre-fix it would error with "fatal: not a git repository"
    // when repoA happened to not be a git repo (the multi-repo HQ
    // pattern). Here both are git repos, but the worktree path lives
    // under repoB so removing via repoA's worktrees instance fails.
    const result = await orch.discard({ agent_id: res.agent_id });
    expect(result.worktree_removed).toBe(true);
    expect(result.branch_deleted).toBe(true);
    const rec = await registry.get(res.agent_id);
    expect(rec!.worktree).toBeNull();
  });
});

describe("Orchestrator default-branch auto-detect", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-defbr-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-defbr-repo-"));
    // Init with `master` to verify we don't blindly fall back to `main`.
    await execa("git", ["-C", repo, "init", "-q", "-b", "master"]);
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

  it("detects `master` when base_ref omitted and `main` does not exist", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call: vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} }),
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 1;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.worktree?.base_ref).toBe("master");
  });
});

describe("Orchestrator Rust no-fmt guardrail", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-rust-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-rust-repo-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    // Plant a Cargo.toml so the agent's worktree (forked off main) sees
    // it and the guardrail kicks in.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, "Cargo.toml"), "[package]\nname = \"x\"\n");
    await execa("git", ["-C", repo, "add", "Cargo.toml"]);
    await execa("git", ["-C", repo, "commit", "-m", "init"]);
    registry = new Registry(stateDir);
    worktrees = new Worktrees(repo);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("injects a 'do not run cargo fmt' rule into developer_instructions when Cargo.toml is present", async () => {
    const call = vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} });
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call,
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 1;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const passed = call.mock.calls[0][0];
    expect(passed.developer_instructions).toMatch(/cargo fmt/i);
    expect(passed.developer_instructions).toMatch(/DO NOT/);
  });

  it("does NOT inject the guardrail in repos without Cargo.toml", async () => {
    // Use a different repo without Cargo.toml.
    const plainRepo = mkdtempSync(join(tmpdir(), "orch-plain-"));
    await execa("git", ["-C", plainRepo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", plainRepo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", plainRepo, "config", "user.name", "t"]);
    await execa("git", ["-C", plainRepo, "commit", "--allow-empty", "-m", "init"]);
    try {
      const call = vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} });
      const orch = new Orchestrator({
        registry,
        worktrees: new Worktrees(plainRepo),
        codexFactory: () =>
          ({
            start: vi.fn().mockResolvedValue(undefined),
            call,
            stop: vi.fn().mockResolvedValue(undefined),
            get pid() {
              return 1;
            },
          }) as unknown as CodexChild,
        rolesDir,
        repoRoot: plainRepo,
      });
      const res = await orch.spawn({ role: "implementer", prompt: "p" });
      await orch.waitForAgent(res.agent_id);
      const passed = call.mock.calls[0][0];
      expect(passed.developer_instructions).not.toMatch(/cargo fmt/i);
    } finally {
      rmSync(plainRepo, { recursive: true, force: true });
    }
  });
});

describe("Orchestrator .gitignore management", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-gi-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-gi-repo-"));
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

  it("adds .magic-codex/ to repo's .gitignore on first worktree-bearing spawn", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: () =>
        ({
          start: vi.fn().mockResolvedValue(undefined),
          call: vi.fn().mockResolvedValue({ threadId: "t", content: "", raw: {} }),
          stop: vi.fn().mockResolvedValue(undefined),
          get pid() {
            return 1;
          },
        }) as unknown as CodexChild,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const { readFileSync, existsSync } = await import("node:fs");
    expect(existsSync(join(repo, ".gitignore"))).toBe(true);
    const content = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(content).toMatch(/\.magic-codex\/?/);
  });
});

describe("Orchestrator silent-failure detection on the success path", () => {
  // Regression for the dispatcher trust bug: codex would return a
  // "successful" tool call with status=completed, error_kind=null, but
  // the agent's prose explained that .git writes were blocked and no
  // commits actually landed. The dispatcher saw `completed` and moved
  // on. Fix: post-completion, classify the captured stderr and demote
  // the run to `failed` when sandbox denials or rate-limit messages
  // were detected.
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-silent-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-silent-repo-"));
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

  it("demotes completed → failed when stderr contains a sandbox denial", async () => {
    const factory = (opts?: { onStderr?: (chunk: Buffer) => void }) =>
      ({
        start: vi.fn().mockImplementation(async () => {
          // Codex emitted a denial but the tool call still resolves —
          // common when the agent caught the error and wrote prose.
          opts?.onStderr?.(
            Buffer.from(
              "sandbox: write blocked at /tmp/repo/.git/worktrees/x/index.lock\n",
            ),
          );
        }),
        call: vi.fn().mockResolvedValue({
          threadId: "t-1",
          content: "I tried to commit but couldn't.",
          raw: {},
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.kind).toBe("sandbox_denied");
    // Original prose is preserved on the failure record.
    expect(rec!.last_output).toContain("I tried to commit");
  });

  it("demotes completed → failed when stderr contains a rate-limit message + populates retry_at", async () => {
    const factory = (opts?: { onStderr?: (chunk: Buffer) => void }) =>
      ({
        start: vi.fn().mockImplementation(async () => {
          opts?.onStderr?.(
            Buffer.from(
              "ERROR: rate limit exceeded; try again in 1800 seconds\n",
            ),
          );
        }),
        call: vi.fn().mockResolvedValue({
          threadId: "t-1",
          content: "partial work — quota cut us off",
          raw: {},
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.kind).toBe("rate_limited");
    expect(rec!.error?.retry_after_seconds).toBe(1800);
    expect(rec!.error?.retry_at).toBeTruthy();
  });

  it("demotes via prose signal when stderr is clean but the agent reports .git/worktrees lock denied + commits_ahead=0", async () => {
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue({
          threadId: "t-1",
          // Real-world example from the user's bug report.
          content:
            "Branching and commit could not be completed. .git writes are blocked: Operation not permitted on /repo/.git/worktrees/codex-impl-x/index.lock. The work is on codex/x but never committed.",
          raw: {},
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("failed");
    expect(rec!.error?.kind).toBe("sandbox_denied");
  });

  it("does NOT demote a clean successful run", async () => {
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string }) => {
          // Land an actual commit — proves the no-demote path with
          // commits_ahead > 0.
          const { writeFileSync } = await import("node:fs");
          writeFileSync(join(input.cwd, "OK.md"), "ok\n");
          await execa("git", ["-C", input.cwd, "add", "OK.md"]);
          await execa("git", ["-C", input.cwd, "commit", "-m", "ok"]);
          return { threadId: "t", content: "all good", raw: {} };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("completed");
    expect(rec!.error).toBeNull();
  });

  it("does NOT demote when prose mentions errors but commits actually landed", async () => {
    // Edge case: agent worked through a transient denial, recovered,
    // and successfully committed. Prose mentions the error, but
    // commits_ahead > 0 means the work landed — don't false-fail.
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string }) => {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(join(input.cwd, "OK.md"), "recovered\n");
          await execa("git", ["-C", input.cwd, "add", "OK.md"]);
          await execa("git", ["-C", input.cwd, "commit", "-m", "after retry"]);
          return {
            threadId: "t",
            content:
              "First attempt failed with operation not permitted on .git/worktrees/x/index.lock, retried and it worked.",
            raw: {},
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.status).toBe("completed");
  });
});

describe("Orchestrator delta capture (post-completion structured output)", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-delta-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-delta-repo-"));
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

  it("captures branch + commit_sha + diff_stat after a successful implementer run", async () => {
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string }) => {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(join(input.cwd, "OUT.md"), "agent did stuff\n");
          await execa("git", ["-C", input.cwd, "add", "OUT.md"]);
          await execa("git", ["-C", input.cwd, "commit", "-m", "agent commit"]);
          return { threadId: "t", content: "done", raw: {} };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "p" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.delta).toBeTruthy();
    expect(rec!.delta!.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(rec!.delta!.commits_ahead).toBeGreaterThanOrEqual(1);
    expect(rec!.delta!.diff_stat).toMatch(/OUT\.md/);
    expect(rec!.delta!.branch).toBeTruthy();
  });
});

describe("Orchestrator.spawn — repo_root override", () => {
  let stateDir: string;
  let repoA: string;
  let repoB: string;
  let registry: Registry;
  let worktreesA: Worktrees;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-repo-root-state-"));
    repoA = mkdtempSync(join(tmpdir(), "orch-repo-root-A-"));
    repoB = mkdtempSync(join(tmpdir(), "orch-repo-root-B-"));
    for (const r of [repoA, repoB]) {
      await execa("git", ["-C", r, "init", "-q", "-b", "main"]);
      await execa("git", ["-C", r, "config", "user.email", "t@t"]);
      await execa("git", ["-C", r, "config", "user.name", "t"]);
      await execa("git", ["-C", r, "commit", "--allow-empty", "-m", "init"]);
    }
    registry = new Registry(stateDir);
    worktreesA = new Worktrees(repoA);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  });

  function okCodexFactory() {
    return () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockResolvedValue({ threadId: "t-1", content: "done", raw: {} }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
  }

  it("creates worktree in repo_root (override) when provided, not the orchestrator's default repoRoot", async () => {
    // Orchestrator configured with repoA as default, but we spawn against repoB
    const orch = new Orchestrator({
      registry,
      worktrees: worktreesA,
      codexFactory: okCodexFactory(),
      rolesDir,
      repoRoot: repoA,
    });
    const res = await orch.spawn({
      role: "implementer",
      prompt: "work in repo B",
      repo_root: repoB,
    });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    // Worktree path must be under repoB, not repoA
    expect(rec!.worktree?.path.startsWith(repoB)).toBe(true);
    expect(rec!.worktree?.path.startsWith(repoA)).toBe(false);
    expect(rec!.cwd.startsWith(repoB)).toBe(true);
  });

  it("falls back to default repoRoot when repo_root is omitted", async () => {
    const orch = new Orchestrator({
      registry,
      worktrees: worktreesA,
      codexFactory: okCodexFactory(),
      rolesDir,
      repoRoot: repoA,
    });
    const res = await orch.spawn({ role: "implementer", prompt: "default" });
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    expect(rec!.worktree?.path.startsWith(repoA)).toBe(true);
  });
});
