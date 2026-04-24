export interface MfContext {
    detected: boolean;
    repoRoot: string;
    /** Whether ops/workers.json exists and should be mirrored. */
    has_workers_json: boolean;
    /** Whether .magic-flow/ dir exists. */
    has_magic_flow_dir: boolean;
}
export declare function detectMf(repoRoot: string): MfContext;
