import type { Registry } from "./registry.js";
import type { Worktrees } from "./worktree.js";
import type { AgentRecord, AgentRole, ApprovalPolicy, SandboxMode } from "./types.js";
import type { CodexChild } from "./mcp/codex-client.js";
import { loadRole } from "./roles/loader.js";
import { renderTemplate } from "./roles/templater.js";

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
  overrides?: SpawnOverrides;
}

export interface SpawnResult {
  agent_id: string;
  status: AgentRecord["status"];
  worktree_path: string | null;
  role: AgentRole;
}

export interface OrchestratorOptions {
  registry: Registry;
  worktrees: Worktrees;
  codexFactory: () => CodexChild;
  rolesDir: string;
  repoRoot: string;
  projectCommittedRolesPath?: string;
  userGlobalRolesPath?: string;
}

export class Orchestrator {
  private readonly tasks = new Map<string, Promise<void>>();

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

    const model = preset.model ?? "gpt-5.2-codex";
    const baseRef = input.base_ref ?? "main";

    const rec = await this.opts.registry.create({
      role: input.role,
      cwd: this.opts.repoRoot,
      model,
      sandbox: preset.sandbox,
      approval_policy: preset.approval_policy,
      last_prompt: input.prompt,
      issue_id: input.issue_id ?? null,
      pr_number: input.pr_number ?? null,
    });

    let cwd = this.opts.repoRoot;
    let worktreeInfo: AgentRecord["worktree"] = null;
    if (preset.worktree) {
      const branch = `codex/${rec.agent_id.replace(/^codex-/, "")}`;
      worktreeInfo = await this.opts.worktrees.create({
        agent_id: rec.agent_id,
        branch,
        base_ref: baseRef,
      });
      cwd = worktreeInfo.path;
      await this.opts.registry.update(rec.agent_id, { cwd, worktree: worktreeInfo });
    }

    const templateCtx: Record<string, string | number | undefined> = {
      agent_id: rec.agent_id,
      role: input.role,
      cwd,
      worktree_path: worktreeInfo?.path ?? "",
      branch: worktreeInfo?.branch ?? "",
      base_ref: worktreeInfo?.base_ref ?? "",
      issue_id: input.issue_id ?? undefined,
      pr_number: input.pr_number ?? undefined,
      mf_conventions: "",
      pr_context: "",
    };

    let instructions = renderTemplate(preset.developer_instructions, templateCtx);
    if (input.overrides?.developer_instructions_replace) {
      instructions = input.overrides.developer_instructions_replace;
    } else if (input.overrides?.developer_instructions_append) {
      instructions += "\n\n" + input.overrides.developer_instructions_append;
    }

    const child = this.opts.codexFactory();
    const startedAt = new Date().toISOString();
    await this.opts.registry.update(rec.agent_id, {
      status: "running",
      started_at: startedAt,
    });

    const timeoutMs = preset.timeout_seconds * 1000;

    const task = (async () => {
      try {
        await child.start();
        await this.opts.registry.update(rec.agent_id, { pid: child.pid });
        const callPromise = child.call({
          prompt: input.prompt,
          cwd,
          model,
          sandbox: preset.sandbox,
          approval_policy: preset.approval_policy,
          developer_instructions: instructions,
        });
        const result = await withTimeout(callPromise, timeoutMs);
        await this.opts.registry.update(rec.agent_id, {
          status: "completed",
          thread_id: result.threadId || null,
          last_output: result.content,
          ended_at: new Date().toISOString(),
          pid: null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await this.opts.registry.update(rec.agent_id, {
          status: "failed",
          error: { message },
          ended_at: new Date().toISOString(),
          pid: null,
        });
      } finally {
        await child.stop().catch(() => undefined);
      }
    })();
    this.tasks.set(rec.agent_id, task);

    return {
      agent_id: rec.agent_id,
      status: "running",
      worktree_path: worktreeInfo?.path ?? null,
      role: input.role,
    };
  }

  async waitForAgent(agent_id: string): Promise<void> {
    const task = this.tasks.get(agent_id);
    if (task) await task;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${Math.round(ms / 1000)}s`)), ms);
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
