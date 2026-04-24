import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type {
  AgentRecord,
  AgentRole,
  ApprovalPolicy,
  RegistrySnapshot,
  SandboxMode,
} from "./types.js";

export interface CreateInput {
  role: AgentRole;
  cwd: string;
  model: string;
  sandbox: SandboxMode;
  approval_policy: ApprovalPolicy;
  last_prompt: string;
  issue_id?: string | null;
  pr_number?: number | null;
}

const ROLE_PREFIX: Record<AgentRole, string> = {
  implementer: "impl",
  reviewer: "rvw",
  planner: "plan",
  generic: "gen",
};

export class Registry {
  private state: RegistrySnapshot = { version: 1, agents: {} };
  private loaded = false;
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly stateDir: string) {}

  private get stateFile() {
    return join(this.stateDir, "state.json");
  }

  private async load() {
    if (this.loaded) return;
    await mkdir(this.stateDir, { recursive: true });
    if (existsSync(this.stateFile)) {
      const raw = await readFile(this.stateFile, "utf8");
      this.state = JSON.parse(raw) as RegistrySnapshot;
    }
    this.loaded = true;
  }

  private async persist() {
    const tmp = `${this.stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await rename(tmp, this.stateFile);
  }

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(op, op);
    this.writeLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async create(input: CreateInput): Promise<AgentRecord> {
    return this.serialize(async () => {
      await this.load();
      const idSuffix = nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
      const agent_id = `codex-${ROLE_PREFIX[input.role]}-${idSuffix}`;
      const now = new Date().toISOString();
      const rec: AgentRecord = {
        agent_id,
        role: input.role,
        thread_id: null,
        status: "queued",
        cwd: input.cwd,
        worktree: null,
        model: input.model,
        sandbox: input.sandbox,
        approval_policy: input.approval_policy,
        issue_id: input.issue_id ?? null,
        pr_number: input.pr_number ?? null,
        created_at: now,
        started_at: null,
        ended_at: null,
        last_prompt: input.last_prompt,
        last_output: null,
        error: null,
        pid: null,
      };
      this.state.agents[agent_id] = rec;
      await this.persist();
      return rec;
    });
  }

  async get(agent_id: string): Promise<AgentRecord | null> {
    await this.load();
    return this.state.agents[agent_id] ?? null;
  }

  async update(agent_id: string, patch: Partial<AgentRecord>): Promise<AgentRecord> {
    return this.serialize(async () => {
      await this.load();
      const existing = this.state.agents[agent_id];
      if (!existing) throw new Error(`agent ${agent_id} not found`);
      const merged: AgentRecord = { ...existing, ...patch, agent_id };
      this.state.agents[agent_id] = merged;
      await this.persist();
      return merged;
    });
  }

  async list(): Promise<AgentRecord[]> {
    await this.load();
    return Object.values(this.state.agents);
  }
}
