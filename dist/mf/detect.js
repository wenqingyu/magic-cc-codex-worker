import { existsSync } from "node:fs";
import { join } from "node:path";
export function detectMf(repoRoot) {
    const has_magic_flow_dir = existsSync(join(repoRoot, ".magic-flow"));
    const has_workers_json = existsSync(join(repoRoot, "ops", "workers.json"));
    return {
        detected: has_magic_flow_dir || has_workers_json,
        repoRoot,
        has_workers_json,
        has_magic_flow_dir,
    };
}
//# sourceMappingURL=detect.js.map