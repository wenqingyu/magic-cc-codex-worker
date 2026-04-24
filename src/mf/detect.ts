import { existsSync } from "node:fs";
import { join } from "node:path";

export interface MfContext {
  detected: boolean;
  repoRoot: string;
  /** Whether ops/workers.json exists and should be mirrored. */
  has_workers_json: boolean;
  /** Whether .magic-flow/ dir exists. */
  has_magic_flow_dir: boolean;
}

export function detectMf(repoRoot: string): MfContext {
  const has_magic_flow_dir = existsSync(join(repoRoot, ".magic-flow"));
  const has_workers_json = existsSync(join(repoRoot, "ops", "workers.json"));
  return {
    detected: has_magic_flow_dir || has_workers_json,
    repoRoot,
    has_workers_json,
    has_magic_flow_dir,
  };
}
