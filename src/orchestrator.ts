import type { Registry } from "./registry.js";
import { Worktrees } from "./worktree.js";
import type {
  AgentRecord,
  AgentRole,
  ApprovalPolicy,
  SandboxMode,
} from "./types.js";
import type { CodexChild, CodexCallInput } from "./mcp/codex-client.js";
import { loadRole } from "./roles/loader.js";
import type { RolePreset } from "./roles/types.js";
import { renderTemplate } from "./roles/templater.js";
import type { MfContext } from "./mf/detect.js";
import type { LinearClient, LinearIssue } from "./mf/linear.js";
import type { WorkersMirror } from "./mf/workers.js";
import type { GhClient, PrInfo } from "./mf/github.js";

export interface SpawnOverrides {
  model?: string;
  sandbox?: SandboxMode;
  approval_policy?: ApprovalPolicy;
  timeout_seconds?: number;
  developer_instructions_append?: string;
  developer_instructions_replace?: string;
}

export interface SpawnInput {
  role: AgentRole;
  prompt: string;
  issue_id?: string | null;
  pr_number?: number | null;
  base_ref?: string;
  /** Absolute path to the git repo root the worker should operate in.
   *  When omitted, falls back to the MCP server's configured repoRoot
   *  (auto-detected via `git rev-parse --show-toplevel` at startup).
   *  Required when running in multi-repo workspaces where the MCP
   *  server's launch cwd isn't a git repo. */
  repo_root?: string;
  overrides?: SpawnOverrides;
}

export interface SpawnResult {
  agent_id: string;
  status: AgentRecord["status"];
  worktree_path: string | null;
  role: AgentRole;
}

export interface ResumeInput {
  agent_id: string;
  prompt: string;
  overrides?: Pick<SpawnOverrides, "timeout_seconds">;
}

export interface ResumeResult {
  agent_id: string;
  status: AgentRecord["status"];
  role: AgentRole;
}

export interface CancelInput {
  agent_id: string;
  force?: boolean;
}

export interface CancelResult {
  agent_id: string;
  status: AgentRecord["status"];
  worktree_removed: boolean;
}

export interface MergeInput {
  agent_id: string;
  strategy?: "squash" | "ff" | "rebase";
  message?: string;
  keep_worktree?: boolean;
}

export interface MergeResult {
  agent_id: string;
  merged_into: string;
  sha: string;
  worktree_removed: boolean;
}

export interface DiscardInput {
  agent_id: string;
}

export interface DiscardResult {
  agent_id: string;
  worktree_removed: boolean;
  branch_deleted: boolean;
}

export interface OrchestratorOptions {
  registry: Registry;
  worktrees: Worktrees;
  codexFactory: () => CodexChild;
  rolesDir: string;
  repoRoot: string;
  projectCommittedRolesPath?: string;
  userGlobalRolesPath?: string;
  mf?: MfContext;
  linear?: LinearClient;
  workersMirror?: WorkersMirror;
  gh?: GhClient;
  /** Magic Flow conventions text to inject into developer_instructions. */
  mfConventions?: string;
}

interface AgentContext {
  child: CodexChild;
  cancelRequested: boolean;
}

const TERMINAL_STATUSES: Array<AgentRecord["status"]> = [
  "completed",
  "failed",
  "cancelled",
];

export class Orchestrator {
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly active = new Map<string, AgentContext>();

  constructor(private readonly opts: OrchestratorOptions) {}

  async spawn(input: SpawnInput): Promise<SpawnResult> {
    const preset = await loadRole(input.role, {
      defaultsDir: this.opts.rolesDir,
      projectCommittedPath: this.opts.projectCommittedRolesPath,
      userGlobalPath: this.opts.userGlobalRolesPath,
      overrides: {
        ...(input.overrides?.model ? { model: input.overrides.model } : {}),
        ...(input.overrides?.sandbox ? { sandbox: input.overrides.sandbox } : {}),
        ...(input.overrides?.approval_policy
          ? { approval_policy: input.overrides.approval_policy }
          : {}),
        ...(input.overrides?.timeout_seconds
          ? { timeout_seconds: input.overrides.timeout_seconds }
          : {}),
      },
    });

    // preset.model may be undefined — we pass it through and let codex mcp-server
    // use its own configured default. Override via magic-codex.toml or overrides.model.
    const model = preset.model;
    const baseRef = input.base_ref ?? "main";

    // Per-spawn repo root. When caller provides input.repo_root (for multi-repo
    // workspaces where the MCP server's launch cwd isn't a git repo), use it.
    // Otherwise fall back to the server's configured repoRoot.
    const repoRoot = input.repo_root ?? this.opts.repoRoot;
    const worktrees = input.repo_root
      ? new Worktrees(input.repo_root)
      : this.opts.worktrees;

    const rec = await this.opts.registry.create({
      role: input.role,
      cwd: repoRoot,
      model: model ?? "(codex default)",
      sandbox: preset.sandbox,
      approval_policy: preset.approval_policy,
      last_prompt: input.prompt,
      issue_id: input.issue_id ?? null,
      pr_number: input.pr_number ?? null,
    });

    // Optional Linear issue enrichment (MF mode)
    let linearIssue: LinearIssue | null = null;
    if (input.issue_id && this.opts.mf?.detected && this.opts.linear?.isConfigured) {
      linearIssue = await this.opts.linear.getIssue(input.issue_id);
    }

    // Optional PR materialization (reviewer role with pr_number)
    let prInfo: PrInfo | null = null;
    if (input.role === "reviewer" && input.pr_number && this.opts.gh) {
      prInfo = await this.opts.gh.getPr(input.pr_number);
    }

    let cwd = repoRoot;
    let worktreeInfo: AgentRecord["worktree"] = null;

    if (prInfo) {
      // PR worktree mode: detached checkout at PR head SHA for read-only review.
      worktreeInfo = await worktrees.createDetached({
        agent_id: rec.agent_id,
        ref: prInfo.headRefOid,
      });
      cwd = worktreeInfo.path;
      await this.opts.registry.update(rec.agent_id, { cwd, worktree: worktreeInfo });
    } else if (preset.worktree) {
      const branch = this.makeBranchName(rec.agent_id, input.issue_id, linearIssue);
      worktreeInfo = await worktrees.create({
        agent_id: rec.agent_id,
        branch,
        base_ref: baseRef,
      });
      cwd = worktreeInfo.path;
      await this.opts.registry.update(rec.agent_id, { cwd, worktree: worktreeInfo });
    }

    const instructions = this.buildInstructions(
      preset,
      input,
      rec.agent_id,
      cwd,
      worktreeInfo,
      linearIssue,
      prInfo,
    );

    const running = await this.opts.registry.update(rec.agent_id, {
      status: "running",
      started_at: new Date().toISOString(),
    });
    await this.mirrorWorker(running);

    this.launchBackground(rec.agent_id, preset, {
      prompt: input.prompt,
      cwd,
      model,
      sandbox: preset.sandbox,
      approval_policy: preset.approval_policy,
      developer_instructions: instructions,
    });

    return {
      agent_id: rec.agent_id,
      status: "running",
      worktree_path: worktreeInfo?.path ?? null,
      role: input.role,
    };
  }

  private makeBranchName(
    agent_id: string,
    issue_id?: string | null,
    linearIssue?: LinearIssue | null,
  ): string {
    if (this.opts.mf?.detected && issue_id) {
      const slug = slugify(linearIssue?.title ?? issue_id);
      return `feature/${issue_id}-${slug}`;
    }
    return `codex/${agent_id.replace(/^codex-/, "")}`;
  }

  private async mirrorWorker(rec: AgentRecord): Promise<void> {
    if (!this.opts.workersMirror) return;
    try {
      await this.opts.workersMirror.upsertFromRecord(rec);
    } catch {
      // best-effort; never fail the agent if registry mirror fails
    }
  }

  async resume(input: ResumeInput): Promise<ResumeResult> {
    const rec = await this.opts.registry.get(input.agent_id);
    if (!rec) throw new Error(`agent ${input.agent_id} not found`);
    if (!TERMINAL_STATUSES.includes(rec.status)) {
      throw new Error(`agent ${input.agent_id} is ${rec.status}; can only resume terminal agents`);
    }
    if (!rec.thread_id) {
      throw new Error(
        `agent ${input.agent_id} has no thread_id; cannot resume (initial session never produced one)`,
      );
    }

    const preset = await loadRole(rec.role, {
      defaultsDir: this.opts.rolesDir,
      projectCommittedPath: this.opts.projectCommittedRolesPath,
      userGlobalPath: this.opts.userGlobalRolesPath,
      overrides: {
        ...(input.overrides?.timeout_seconds
          ? { timeout_seconds: input.overrides.timeout_seconds }
          : {}),
      },
    });

    await this.opts.registry.update(rec.agent_id, {
      status: "running",
      started_at: new Date().toISOString(),
      ended_at: null,
      error: null,
      last_prompt: input.prompt,
    });

    this.launchBackground(rec.agent_id, preset, {
      prompt: input.prompt,
      cwd: rec.cwd,
      thread_id: rec.thread_id,
    });

    return {
      agent_id: rec.agent_id,
      status: "running",
      role: rec.role,
    };
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    const rec = await this.opts.registry.get(input.agent_id);
    if (!rec) throw new Error(`agent ${input.agent_id} not found`);
    if (TERMINAL_STATUSES.includes(rec.status)) {
      return {
        agent_id: rec.agent_id,
        status: rec.status,
        worktree_removed: false,
      };
    }
    const ctx = this.active.get(input.agent_id);
    if (ctx) {
      ctx.cancelRequested = true;
      await ctx.child.stop().catch(() => undefined);
    } else {
      await this.opts.registry.update(rec.agent_id, {
        status: "cancelled",
        ended_at: new Date().toISOString(),
        pid: null,
      });
    }
    await this.waitForAgent(input.agent_id);

    let worktree_removed = false;
    if (input.force && rec.worktree) {
      try {
        await this.opts.worktrees.remove(rec.worktree.path, { delete_branch: true });
        worktree_removed = true;
        await this.opts.registry.update(rec.agent_id, { worktree: null });
      } catch {
        // best-effort; leave worktree if removal fails
      }
    }

    const after = await this.opts.registry.get(rec.agent_id);
    return {
      agent_id: rec.agent_id,
      status: after?.status ?? "cancelled",
      worktree_removed,
    };
  }

  async merge(input: MergeInput): Promise<MergeResult> {
    const rec = await this.opts.registry.get(input.agent_id);
    if (!rec) throw new Error(`agent ${input.agent_id} not found`);
    if (!rec.worktree) throw new Error(`agent ${input.agent_id} has no worktree to merge`);
    if (rec.status !== "completed") {
      throw new Error(
        `agent ${input.agent_id} is ${rec.status}; only completed agents can be merged`,
      );
    }
    const { sha } = await this.opts.worktrees.merge({
      branch: rec.worktree.branch,
      base_ref: rec.worktree.base_ref,
      strategy: input.strategy,
      message: input.message,
    });
    let worktree_removed = false;
    if (!input.keep_worktree) {
      await this.opts.worktrees.remove(rec.worktree.path, { delete_branch: true });
      worktree_removed = true;
      await this.opts.registry.update(rec.agent_id, { worktree: null });
    }
    return {
      agent_id: rec.agent_id,
      merged_into: rec.worktree.base_ref,
      sha,
      worktree_removed,
    };
  }

  async discard(input: DiscardInput): Promise<DiscardResult> {
    const rec = await this.opts.registry.get(input.agent_id);
    if (!rec) throw new Error(`agent ${input.agent_id} not found`);
    if (!TERMINAL_STATUSES.includes(rec.status)) {
      throw new Error(
        `agent ${input.agent_id} is ${rec.status}; cancel first before discarding`,
      );
    }
    let worktree_removed = false;
    let branch_deleted = false;
    if (rec.worktree) {
      await this.opts.worktrees.remove(rec.worktree.path, { delete_branch: true });
      worktree_removed = true;
      branch_deleted = true;
      await this.opts.registry.update(rec.agent_id, { worktree: null });
    }
    return { agent_id: rec.agent_id, worktree_removed, branch_deleted };
  }

  async waitForAgent(agent_id: string): Promise<void> {
    const task = this.tasks.get(agent_id);
    if (task) await task;
  }

  private buildInstructions(
    preset: RolePreset,
    input: SpawnInput,
    agent_id: string,
    cwd: string,
    worktree: AgentRecord["worktree"],
    linearIssue: LinearIssue | null,
    prInfo: PrInfo | null,
  ): string {
    const prContext = prInfo
      ? `Reviewing PR #${prInfo.number}: "${prInfo.title}". Head SHA ${prInfo.headRefOid} checked out in detached worktree; base ref is ${prInfo.baseRefName}. PR URL: ${prInfo.url}`
      : "";
    const ctx: Record<string, string | number | undefined> = {
      agent_id,
      role: input.role,
      cwd,
      worktree_path: worktree?.path ?? "",
      branch: worktree?.branch ?? "",
      base_ref: worktree?.base_ref ?? "",
      issue_id: input.issue_id ?? undefined,
      pr_number: input.pr_number ?? undefined,
      mf_conventions: this.opts.mfConventions ?? "",
      issue_title: linearIssue?.title ?? "",
      issue_description: linearIssue?.description ?? "",
      issue_url: linearIssue?.url ?? "",
      pr_title: prInfo?.title ?? "",
      pr_head_ref: prInfo?.headRefName ?? "",
      pr_diff_url: prInfo ? `${prInfo.url}/files` : "",
      pr_context: prContext,
    };
    let instructions = renderTemplate(preset.developer_instructions, ctx);
    if (input.overrides?.developer_instructions_replace) {
      instructions = input.overrides.developer_instructions_replace;
    } else if (input.overrides?.developer_instructions_append) {
      instructions += "\n\n" + input.overrides.developer_instructions_append;
    }
    return instructions;
  }

  private launchBackground(
    agent_id: string,
    preset: RolePreset,
    callInput: CodexCallInput,
  ): void {
    const child = this.opts.codexFactory();
    const ctx: AgentContext = { child, cancelRequested: false };
    this.active.set(agent_id, ctx);
    const timeoutMs = preset.timeout_seconds * 1000;

    const task = (async () => {
      try {
        await child.start();
        await this.opts.registry.update(agent_id, { pid: child.pid });
        const result = await withTimeout(child.call(callInput), timeoutMs);
        const completed = await this.opts.registry.update(agent_id, {
          status: "completed",
          thread_id: result.threadId || null,
          last_output: result.content,
          ended_at: new Date().toISOString(),
          pid: null,
        });
        await this.mirrorWorker(completed);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const finalStatus = ctx.cancelRequested ? "cancelled" : "failed";
        const patch: Partial<AgentRecord> = {
          status: finalStatus,
          ended_at: new Date().toISOString(),
          pid: null,
        };
        if (finalStatus === "failed") patch.error = { message };
        const updated = await this.opts.registry.update(agent_id, patch);
        await this.mirrorWorker(updated);
      } finally {
        await child.stop().catch(() => undefined);
        this.active.delete(agent_id);
      }
    })();
    this.tasks.set(agent_id, task);
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
