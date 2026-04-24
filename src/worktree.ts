import { execa } from "execa";
import { join, resolve } from "node:path";
// resolve used by Worktrees.create
import type { WorktreeInfo } from "./types.js";

export interface CreateWorktreeInput {
  agent_id: string;
  branch: string;
  base_ref: string;
  parent_dir?: string;
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
      "-C",
      this.repoRoot,
      "worktree",
      "add",
      "-b",
      input.branch,
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

  async merge(opts: {
    branch: string;
    base_ref: string;
    strategy?: "squash" | "ff" | "rebase";
    message?: string;
  }): Promise<{ sha: string }> {
    const strategy = opts.strategy ?? "squash";
    // Checkout base_ref in the main repo
    await execa("git", ["-C", this.repoRoot, "checkout", opts.base_ref]);

    if (strategy === "squash") {
      await execa("git", ["-C", this.repoRoot, "merge", "--squash", opts.branch]);
      const message = opts.message ?? `Merge codex agent branch ${opts.branch}`;
      await execa("git", ["-C", this.repoRoot, "commit", "-m", message]);
    } else if (strategy === "ff") {
      await execa("git", ["-C", this.repoRoot, "merge", "--ff-only", opts.branch]);
    } else if (strategy === "rebase") {
      await execa("git", ["-C", this.repoRoot, "rebase", opts.base_ref, opts.branch]);
      await execa("git", ["-C", this.repoRoot, "checkout", opts.base_ref]);
      await execa("git", ["-C", this.repoRoot, "merge", "--ff-only", opts.branch]);
    }
    const { stdout } = await execa("git", ["-C", this.repoRoot, "rev-parse", "HEAD"]);
    return { sha: stdout.trim() };
  }

  async remove(path: string, opts: { delete_branch?: boolean } = {}): Promise<void> {
    let branch: string | null = null;
    if (opts.delete_branch) {
      try {
        const { stdout } = await execa("git", ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"]);
        const name = stdout.trim();
        if (name && name !== "HEAD") branch = name;
      } catch {
        branch = null;
      }
    }
    await execa("git", ["-C", this.repoRoot, "worktree", "remove", "--force", path]);
    if (branch) {
      await execa("git", ["-C", this.repoRoot, "branch", "-D", branch]);
    }
  }
}
