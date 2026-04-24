import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRecord } from "../types.js";

/**
 * Mirrors magic-codex agents into ops/workers.json using a schema compatible
 * with Magic Flow's worker registry. MF's dispatcher and /mf-status read this.
 */

export interface WorkerEntry {
  worker_id: string;
  kind: "magic-codex";
  agent_id: string;
  role: string;
  status: string;
  issue_id: string | null;
  pr_number: number | null;
  branch: string | null;
  worktree_path: string | null;
  thread_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface WorkersFile {
  version: 1;
  workers: Record<string, WorkerEntry>;
}

export class WorkersMirror {
  constructor(private readonly repoRoot: string) {}

  private get file() {
    return join(this.repoRoot, "ops", "workers.json");
  }

  private async load(): Promise<WorkersFile> {
    if (!existsSync(this.file)) return { version: 1, workers: {} };
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkersFile>;
      return {
        version: 1,
        workers: parsed.workers ?? {},
      };
    } catch {
      return { version: 1, workers: {} };
    }
  }

  private async persist(data: WorkersFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  async upsertFromRecord(rec: AgentRecord): Promise<void> {
    const data = await this.load();
    const worker_id = `magic-codex:${rec.agent_id}`;
    data.workers[worker_id] = {
      worker_id,
      kind: "magic-codex",
      agent_id: rec.agent_id,
      role: rec.role,
      status: rec.status,
      issue_id: rec.issue_id,
      pr_number: rec.pr_number,
      branch: rec.worktree?.branch ?? null,
      worktree_path: rec.worktree?.path ?? null,
      thread_id: rec.thread_id,
      created_at: rec.created_at,
      started_at: rec.started_at,
      ended_at: rec.ended_at,
    };
    await this.persist(data);
  }

  async remove(agent_id: string): Promise<void> {
    const data = await this.load();
    delete data.workers[`magic-codex:${agent_id}`];
    await this.persist(data);
  }
}
