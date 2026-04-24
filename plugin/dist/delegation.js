import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
export const DELEGATION_LEVELS = ["minimal", "balance", "max"];
export const DELEGATION_GUIDANCE = {
    minimal: `Delegate to Codex ONLY when Codex offers capabilities Claude lacks or does notably better:
- Running a SEPARATE-MODEL (GPT) second-opinion PR review alongside Claude
- Long-running autonomous implementation that would exhaust Claude's context if done in-session
- Anything explicitly requested by the user to be done via Codex

Default: do the work in Claude. This preserves Codex quota for high-value specialized tasks.`,
    balance: `Delegate to Codex moderately, balancing Claude and Codex quota use:
- Multi-step implementation work that would consume >30% of Claude's remaining context
- PR reviews that benefit from a second (GPT) model's perspective
- Parallelizable tasks that would otherwise serialize (fan out across Codex workers)
- Long-running refactors or migrations

Keep planning, research, quick edits, and interactive debugging in Claude.
This is the default level.`,
    max: `Delegate to Codex aggressively. Claude stays in orchestrator mode:
- Decompose the user's request into concrete tasks
- Spawn a Codex agent for each implementation task, review, planning step, refactor, test-writing chore
- Read Codex summaries; make next-step decisions; spawn follow-up agents
- Preserve Claude tokens for synthesis, cross-task reasoning, and user interaction

Only do work directly in Claude when Codex genuinely cannot handle it (e.g. interactive
clarification with the user, cross-cutting synthesis that needs the full conversation context).`,
};
export async function resolveDelegationPolicy(opts) {
    const env = opts.envOverride?.toLowerCase();
    if (env && isDelegationLevel(env)) {
        return toPolicy(env, "env");
    }
    const fromProject = await readLevelFromToml(opts.projectConfigPath);
    if (fromProject)
        return toPolicy(fromProject, "project");
    const fromUser = await readLevelFromToml(opts.userConfigPath);
    if (fromUser)
        return toPolicy(fromUser, "user");
    return toPolicy("balance", "default");
}
function toPolicy(level, source) {
    return {
        level,
        guidance: DELEGATION_GUIDANCE[level],
        all_levels: DELEGATION_LEVELS.map((l) => ({ level: l, guidance: DELEGATION_GUIDANCE[l] })),
        source,
    };
}
function isDelegationLevel(v) {
    return DELEGATION_LEVELS.includes(v);
}
async function readLevelFromToml(path) {
    if (!path)
        return null;
    try {
        const raw = await readFile(path, "utf8");
        const parsed = parseToml(raw);
        const lvl = parsed.delegation?.level?.toLowerCase();
        if (lvl && isDelegationLevel(lvl))
            return lvl;
        return null;
    }
    catch (e) {
        if (e.code === "ENOENT")
            return null;
        return null;
    }
}
//# sourceMappingURL=delegation.js.map