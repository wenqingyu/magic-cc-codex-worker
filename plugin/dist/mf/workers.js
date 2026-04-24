import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
export class WorkersMirror {
    repoRoot;
    constructor(repoRoot) {
        this.repoRoot = repoRoot;
    }
    get file() {
        return join(this.repoRoot, "ops", "workers.json");
    }
    async load() {
        if (!existsSync(this.file))
            return { version: 1, workers: {} };
        try {
            const raw = await readFile(this.file, "utf8");
            const parsed = JSON.parse(raw);
            return {
                version: 1,
                workers: parsed.workers ?? {},
            };
        }
        catch {
            return { version: 1, workers: {} };
        }
    }
    async persist(data) {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
        await rename(tmp, this.file);
    }
    async upsertFromRecord(rec) {
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
    async remove(agent_id) {
        const data = await this.load();
        delete data.workers[`magic-codex:${agent_id}`];
        await this.persist(data);
    }
}
//# sourceMappingURL=workers.js.map