import { execa } from "execa";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
// resolve used by Worktrees.create
import type { WorktreeInfo } from "./types.js";

export interface CreateWorktreeInput {
  agent_id: string;
  branch: string;
  base_ref: string;
  parent_dir?: string;
  /** When true, run `git fetch origin <base_ref>` before creating the
   *  worktree so the agent's checkout reflects the latest state of the
   *  upstream branch. Without this, a long-lived MCP server's worktrees
   *  baseline against whatever was fetched at startup, which becomes
   *  stale as new commits land on origin. Best-effort: a fetch failure
   *  (no remote, offline, etc.) is non-fatal. */
  fetch_remote?: boolean;
}

export interface CreateDetachedWorktreeInput {
  agent_id: string;
  ref: string; // SHA or symbolic ref to check out in detached mode
  parent_dir?: string;
}

export class Worktrees {
  constructor(private readonly repoRoot: string) {}

  private defaultParent() {
    return join(this.repoRoot, ".magic-codex", "worktrees");
  }

  async create(input: CreateWorktreeInput): Promise<WorktreeInfo> {
    const parent = input.parent_dir ?? this.defaultParent();
    const path = resolve(parent, input.agent_id);
    if (input.fetch_remote) {
      // Best-effort: refresh origin/<base_ref> before branching off.
      // Failure is silent (no remote configured, offline, the remote
      // doesn't have this ref yet). The worktree create below will
      // fail loudly if the local ref also doesn't exist.
      try {
        await execa("git", [
          "-C",
          this.repoRoot,
          "fetch",
          "origin",
          input.base_ref,
          "--quiet",
        ]);
      } catch {
        // ignore
      }
    }
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

  /** Idempotently ensure `.magic-codex/` is in the repo's .gitignore so
   *  worktrees + state never get accidentally `git add -A`'d. Returns
   *  true when the file was modified.
   *  Best-effort — never throws (some repos don't have a writable
   *  workdir, the file may be readonly, etc.). */
  ensureGitignore(): boolean {
    const ignoreEntry = ".magic-codex/";
    const gitignorePath = join(this.repoRoot, ".gitignore");
    try {
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, `${ignoreEntry}\n`, "utf8");
        return true;
      }
      const raw = readFileSync(gitignorePath, "utf8");
      const lines = raw.split(/\r?\n/);
      // Match the entry exactly OR a parent path (".magic-codex" without
      // trailing slash, ".magic-codex/*", etc.). Don't add a duplicate.
      const present = lines.some((line) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return false;
        return (
          trimmed === ignoreEntry ||
          trimmed === ".magic-codex" ||
          trimmed === ".magic-codex/*" ||
          trimmed === ".magic-codex/**"
        );
      });
      if (present) return false;
      const sep = raw.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${sep}${ignoreEntry}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  /** Detect the repo's default branch. Tries (in order):
   *  1. `origin/HEAD` symbolic ref (set by `git clone`).
   *  2. Local refs `main` then `master` then `develop`.
   *  Returns null when no candidate is found. Used to pick a sensible
   *  base_ref when the caller didn't specify one — the prior fallback
   *  to a hardcoded `"main"` failed on ~40% of real-world repos that
   *  use `master`. */
  async detectDefaultBranch(): Promise<string | null> {
    try {
      const { stdout } = await execa("git", [
        "-C",
        this.repoRoot,
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      ]);
      const ref = stdout.trim();
      if (ref.startsWith("origin/")) return ref.slice("origin/".length);
      if (ref) return ref;
    } catch {
      // origin/HEAD not set — fall through to local probes
    }
    for (const candidate of ["main", "master", "develop"]) {
      try {
        await execa("git", [
          "-C",
          this.repoRoot,
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/heads/${candidate}`,
        ]);
        return candidate;
      } catch {
        // not present
      }
    }
    return null;
  }

  async createDetached(input: CreateDetachedWorktreeInput): Promise<WorktreeInfo> {
    const parent = input.parent_dir ?? this.defaultParent();
    const path = resolve(parent, input.agent_id);
    await execa("git", [
      "-C",
      this.repoRoot,
      "worktree",
      "add",
      "--detach",
      path,
      input.ref,
    ]);
    return {
      path,
      branch: `(detached)`,
      base_ref: input.ref,
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
