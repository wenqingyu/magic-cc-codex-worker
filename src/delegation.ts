import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import type { DelegationLevel } from "./types.js";

export const DELEGATION_LEVELS: DelegationLevel[] = ["minimal", "balance", "max"];

export const DELEGATION_GUIDANCE: Record<DelegationLevel, string> = {
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

export interface DelegationPolicy {
  level: DelegationLevel;
  guidance: string;
  all_levels: Array<{ level: DelegationLevel; guidance: string }>;
  source: "env" | "project" | "user" | "default";
}

export interface ResolvePolicyOptions {
  projectConfigPath?: string;
  userConfigPath?: string;
  envOverride?: string;
}

export async function resolveDelegationPolicy(
  opts: ResolvePolicyOptions,
): Promise<DelegationPolicy> {
  const env = opts.envOverride?.toLowerCase();
  if (env && isDelegationLevel(env)) {
    return toPolicy(env, "env");
  }
  const fromProject = await readLevelFromToml(opts.projectConfigPath);
  if (fromProject) return toPolicy(fromProject, "project");
  const fromUser = await readLevelFromToml(opts.userConfigPath);
  if (fromUser) return toPolicy(fromUser, "user");
  return toPolicy("balance", "default");
}

function toPolicy(level: DelegationLevel, source: DelegationPolicy["source"]): DelegationPolicy {
  return {
    level,
    guidance: DELEGATION_GUIDANCE[level],
    all_levels: DELEGATION_LEVELS.map((l) => ({ level: l, guidance: DELEGATION_GUIDANCE[l] })),
    source,
  };
}

function isDelegationLevel(v: string): v is DelegationLevel {
  return (DELEGATION_LEVELS as string[]).includes(v);
}

async function readLevelFromToml(path: string | undefined): Promise<DelegationLevel | null> {
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseToml(raw) as unknown as { delegation?: { level?: string } };
    const lvl = parsed.delegation?.level?.toLowerCase();
    if (lvl && isDelegationLevel(lvl)) return lvl;
    return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}
