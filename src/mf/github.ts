import { execa } from "execa";

export interface PrInfo {
  number: number;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  title: string;
  url: string;
}

export interface GhClientOptions {
  ghBin?: string;
  cwd?: string;
}

/**
 * Minimal `gh` CLI wrapper used by reviewer role to materialize a PR
 * head in a detached worktree.
 */
export class GhClient {
  private readonly bin: string;
  private readonly cwd: string | undefined;

  constructor(opts: GhClientOptions = {}) {
    this.bin = opts.ghBin ?? "gh";
    this.cwd = opts.cwd;
  }

  async getPr(number: number): Promise<PrInfo | null> {
    try {
      const { stdout } = await execa(
        this.bin,
        [
          "pr",
          "view",
          String(number),
          "--json",
          "number,headRefOid,headRefName,baseRefName,title,url",
        ],
        this.cwd ? { cwd: this.cwd } : {},
      );
      const parsed = JSON.parse(stdout) as PrInfo;
      return parsed;
    } catch {
      return null;
    }
  }
}
