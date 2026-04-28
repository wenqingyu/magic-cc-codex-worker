import type { Registry } from "./registry.js";
import type { AgentRecord, AgentStatus } from "./types.js";

const TERMINAL_STATUSES: AgentStatus[] = ["completed", "failed", "cancelled"];

export interface WaitInput {
  timeout_seconds?: number;
  since?: string;
  agent_ids?: string[];
  terminal_only?: boolean;
  batch_window_ms?: number;
}

export interface WaitAgentSummary {
  agent_id: string;
  role: AgentRecord["role"];
  status: AgentRecord["status"];
  thread_id: AgentRecord["thread_id"];
  worktree_path: string | null;
  branch: string | null;
  base_ref: string | null;
  repo_root: string | null;
  issue_id: string | null;
  pr_number: number | null;
  ended_at: string | null;
  last_output_preview: string | null;
  error_summary: string | null;
  error_kind: string | null;
  error_retry_at: string | null;
  error_retry_after_seconds: number | null;
  commit_sha: string | null;
  diff_stat: string | null;
  commits_ahead: number | null;
}

export interface WaitResult {
  events: WaitAgentSummary[];
  observed_at: string;
  agents_still_running: number;
  agents_running_ids: string[];
  timed_out: boolean;
}

function summarize(rec: AgentRecord): WaitAgentSummary {
  return {
    agent_id: rec.agent_id,
    role: rec.role,
    status: rec.status,
    thread_id: rec.thread_id,
    worktree_path: rec.worktree?.path ?? null,
    branch: rec.worktree?.branch ?? null,
    base_ref: rec.worktree?.base_ref ?? null,
    repo_root: rec.repo_root ?? null,
    issue_id: rec.issue_id,
    pr_number: rec.pr_number,
    ended_at: rec.ended_at,
    last_output_preview: rec.last_output?.slice(0, 500) ?? null,
    error_summary: rec.error?.message ?? null,
    error_kind: rec.error?.kind ?? null,
    error_retry_at: rec.error?.retry_at ?? null,
    error_retry_after_seconds: rec.error?.retry_after_seconds ?? null,
    commit_sha: rec.delta?.commit_sha ?? null,
    diff_stat: rec.delta?.diff_stat ?? null,
    commits_ahead: rec.delta?.commits_ahead ?? null,
  };
}

function matches(
  rec: AgentRecord,
  filter: { agent_ids?: string[]; terminal_only?: boolean },
): boolean {
  if (filter.agent_ids && !filter.agent_ids.includes(rec.agent_id)) return false;
  const terminalOnly = filter.terminal_only !== false;
  if (terminalOnly && !TERMINAL_STATUSES.includes(rec.status)) return false;
  return true;
}

function isAfter(timeIso: string | null, sinceIso: string): boolean {
  if (!timeIso) return false;
  return Date.parse(timeIso) > Date.parse(sinceIso);
}

function buildResponse(
  events: AgentRecord[],
  allAgents: AgentRecord[],
  agentIds: string[] | undefined,
  timedOut: boolean,
): WaitResult {
  const observed_at = new Date().toISOString();
  const scope = agentIds ? allAgents.filter((r) => agentIds.includes(r.agent_id)) : allAgents;
  const stillRunning = scope.filter((r) => !TERMINAL_STATUSES.includes(r.status));
  return {
    events: events.map(summarize),
    observed_at,
    agents_still_running: stillRunning.length,
    agents_running_ids: stillRunning.map((r) => r.agent_id),
    timed_out: timedOut,
  };
}

function collectReplay(input: WaitInput, registryAgents: AgentRecord[]): AgentRecord[] {
  if (!input.since) return [];
  const matched: AgentRecord[] = [];
  for (const rec of registryAgents) {
    if (!matches(rec, input)) continue;
    if (input.terminal_only !== false) {
      if (!isAfter(rec.ended_at, input.since)) continue;
    } else if (!isAfter(rec.started_at ?? rec.ended_at, input.since)) {
      continue;
    }
    matched.push(rec);
  }
  return matched;
}

export async function handleWait(input: WaitInput, registry: Registry): Promise<WaitResult> {
  const all = await registry.list();
  const replay = collectReplay(input, all);
  if (replay.length > 0) {
    return buildResponse(replay, all, input.agent_ids, false);
  }

  return buildResponse([], all, input.agent_ids, true);
}
