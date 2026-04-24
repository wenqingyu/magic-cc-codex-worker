import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
const ROLE_PREFIX = {
    implementer: "impl",
    reviewer: "rvw",
    planner: "plan",
    generic: "gen",
};
export class Registry {
    stateDir;
    state = { version: 1, agents: {} };
    loaded = false;
    writeLock = Promise.resolve();
    constructor(stateDir) {
        this.stateDir = stateDir;
    }
    get stateFile() {
        return join(this.stateDir, "state.json");
    }
    async load() {
        if (this.loaded)
            return;
        await mkdir(this.stateDir, { recursive: true });
        if (existsSync(this.stateFile)) {
            const raw = await readFile(this.stateFile, "utf8");
            this.state = JSON.parse(raw);
        }
        this.loaded = true;
    }
    async persist() {
        const tmp = `${this.stateFile}.tmp`;
        await writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
        await rename(tmp, this.stateFile);
    }
    serialize(op) {
        const next = this.writeLock.then(op, op);
        this.writeLock = next.then(() => undefined, () => undefined);
        return next;
    }
    async create(input) {
        return this.serialize(async () => {
            await this.load();
            const idSuffix = nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
            const agent_id = `codex-${ROLE_PREFIX[input.role]}-${idSuffix}`;
            const now = new Date().toISOString();
            const rec = {
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
    async get(agent_id) {
        await this.load();
        return this.state.agents[agent_id] ?? null;
    }
    async update(agent_id, patch) {
        return this.serialize(async () => {
            await this.load();
            const existing = this.state.agents[agent_id];
            if (!existing)
                throw new Error(`agent ${agent_id} not found`);
            const merged = { ...existing, ...patch, agent_id };
            this.state.agents[agent_id] = merged;
            await this.persist();
            return merged;
        });
    }
    async list() {
        await this.load();
        return Object.values(this.state.agents);
    }
}
//# sourceMappingURL=registry.js.map