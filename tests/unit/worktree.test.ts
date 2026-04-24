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

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

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
    const { stdout } = await execa("git", [
      "-C",
      info.path,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    expect(stdout.trim()).toBe("codex/abc");
  });
});

describe("Worktrees.remove", () => {
  it("removes the worktree and its branch", async () => {
    const wt = new Worktrees(repo);
    const info = await wt.create({
      agent_id: "codex-impl-del",
      branch: "codex/del",
      base_ref: "main",
    });
    await wt.remove(info.path, { delete_branch: true });
    expect(existsSync(info.path)).toBe(false);
    const { stdout } = await execa("git", ["-C", repo, "branch", "--list", "codex/del"]);
    expect(stdout.trim()).toBe("");
  });

  it("preserves the branch when delete_branch is false", async () => {
    const wt = new Worktrees(repo);
    const info = await wt.create({
      agent_id: "codex-impl-keep",
      branch: "codex/keep",
      base_ref: "main",
    });
    await wt.remove(info.path);
    expect(existsSync(info.path)).toBe(false);
    const { stdout } = await execa("git", ["-C", repo, "branch", "--list", "codex/keep"]);
    expect(stdout.trim()).toContain("codex/keep");
  });
});
