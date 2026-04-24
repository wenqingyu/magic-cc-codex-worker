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
export declare class GhClient {
    private readonly bin;
    private readonly cwd;
    constructor(opts?: GhClientOptions);
    getPr(number: number): Promise<PrInfo | null>;
}
