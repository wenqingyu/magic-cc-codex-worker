import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { Registry } from "../../src/registry.js";
import { Worktrees } from "../../src/worktree.js";
import { Orchestrator } from "../../src/orchestrator.js";
import type { GhClient } from "../../src/mf/github.js";
import type { CodexChild } from "../../src/mcp/codex-client.js";

const rolesDir = resolve(process.cwd(), "src", "roles", "defaults");

describe("Orchestrator — PR worktree mode (reviewer + pr_number)", () => {
  let stateDir: string;
  let repo: string;
  let registry: Registry;
  let worktrees: Worktrees;
  let prHeadSha: string;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "orch-pr-state-"));
    repo = mkdtempSync(join(tmpdir(), "orch-pr-repo-"));
    await execa("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await execa("git", ["-C", repo, "config", "user.email", "t@t"]);
    await execa("git", ["-C", repo, "config", "user.name", "t"]);
    await execa("git", ["-C", repo, "commit", "--allow-empty", "-m", "init"]);
    // Create a "PR-like" feature branch with a distinguishing commit
    await execa("git", ["-C", repo, "checkout", "-b", "feat/pr-123"]);
    writeFileSync(join(repo, "PR.md"), "pr file\n");
    await execa("git", ["-C", repo, "add", "PR.md"]);
    await execa("git", ["-C", repo, "commit", "-m", "pr commit"]);
    const { stdout } = await execa("git", ["-C", repo, "rev-parse", "HEAD"]);
    prHeadSha = stdout.trim();
    await execa("git", ["-C", repo, "checkout", "main"]);
    registry = new Registry(stateDir);
    worktrees = new Worktrees(repo);
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("materializes a detached worktree at PR head when reviewer+pr_number given", async () => {
    const seen: { instr?: string; cwd?: string } = {};
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string; developer_instructions?: string }) => {
          seen.cwd = input.cwd;
          seen.instr = input.developer_instructions;
          return { threadId: "t-1", content: "reviewed", raw: {} };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;

    const fakeGh = {
      getPr: vi.fn().mockResolvedValue({
        number: 123,
        headRefOid: prHeadSha,
        headRefName: "feat/pr-123",
        baseRefName: "main",
        title: "Add PR file",
        url: "https://github.com/x/y/pull/123",
      }),
    } as unknown as GhClient;

    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
      gh: fakeGh,
    });
    const res = await orch.spawn({
      role: "reviewer",
      prompt: "please review",
      pr_number: 123,
    });
    expect(res.worktree_path).not.toBeNull();
    await orch.waitForAgent(res.agent_id);
    const rec = await registry.get(res.agent_id);
    // Detached worktree
    expect(rec!.worktree?.branch).toBe("(detached)");
    expect(rec!.worktree?.base_ref).toBe(prHeadSha);
    // Reviewer sees PR-specific content in cwd
    const prFile = join(seen.cwd!, "PR.md");
    const { stdout } = await execa("ls", [seen.cwd!]);
    expect(stdout).toContain("PR.md");
    // Developer instructions mention PR context
    expect(seen.instr).toContain("Reviewing PR #123");
    expect(seen.instr).toContain(prHeadSha);
    expect(prFile).toContain("PR.md");
  });

  it("falls back to no-worktree when pr_number given but gh returns null", async () => {
    const seen: { cwd?: string } = {};
    const factory = () =>
      ({
        start: vi.fn().mockResolvedValue(undefined),
        call: vi.fn().mockImplementation(async (input: { cwd: string }) => {
          seen.cwd = input.cwd;
          return { threadId: "t", content: "done", raw: {} };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        get pid() {
          return 1;
        },
      }) as unknown as CodexChild;
    const fakeGh = { getPr: vi.fn().mockResolvedValue(null) } as unknown as GhClient;

    const orch = new Orchestrator({
      registry,
      worktrees,
      codexFactory: factory,
      rolesDir,
      repoRoot: repo,
      gh: fakeGh,
    });
    const res = await orch.spawn({ role: "reviewer", prompt: "r", pr_number: 999 });
    await orch.waitForAgent(res.agent_id);
    // reviewer preset has worktree=false → no worktree when PR lookup failed
    expect(res.worktree_path).toBeNull();
    expect(seen.cwd).toBe(repo);
  });
});
