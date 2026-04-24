import { execa } from "execa";
/**
 * Minimal `gh` CLI wrapper used by reviewer role to materialize a PR
 * head in a detached worktree.
 */
export class GhClient {
    bin;
    cwd;
    constructor(opts = {}) {
        this.bin = opts.ghBin ?? "gh";
        this.cwd = opts.cwd;
    }
    async getPr(number) {
        try {
            const { stdout } = await execa(this.bin, [
                "pr",
                "view",
                String(number),
                "--json",
                "number,headRefOid,headRefName,baseRefName,title,url",
            ], this.cwd ? { cwd: this.cwd } : {});
            const parsed = JSON.parse(stdout);
            return parsed;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=github.js.map