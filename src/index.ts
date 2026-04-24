// Shebang is injected by the esbuild --banner flag at build time.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Registry } from "./registry.js";
import { Worktrees } from "./worktree.js";
import { Orchestrator } from "./orchestrator.js";
import { CodexChild } from "./mcp/codex-client.js";
import { resolveDelegationPolicy } from "./delegation.js";
import { detectMf } from "./mf/detect.js";
import { readMfConventions } from "./mf/conventions.js";
import { LinearClient } from "./mf/linear.js";
import { WorkersMirror } from "./mf/workers.js";
import { GhClient } from "./mf/github.js";
import type { AgentRecord } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function detectRepoRoot(): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    return process.cwd();
  }
}

function agentSummary(rec: AgentRecord) {
  return {
    agent_id: rec.agent_id,
    role: rec.role,
    status: rec.status,
    thread_id: rec.thread_id,
    worktree_path: rec.worktree?.path ?? null,
    issue_id: rec.issue_id,
    pr_number: rec.pr_number,
    created_at: rec.created_at,
    started_at: rec.started_at,
    ended_at: rec.ended_at,
    last_output_preview: rec.last_output?.slice(0, 500) ?? null,
    error_summary: rec.error?.message ?? null,
  };
}

function countByStatus(records: AgentRecord[]) {
  const counts: Record<string, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

const SpawnInputZ = z.object({
  role: z.enum(["implementer", "reviewer", "planner", "generic"]),
  prompt: z.string().min(1),
  issue_id: z.string().optional(),
  pr_number: z.number().optional(),
  base_ref: z.string().optional(),
  repo_root: z.string().optional(),
  overrides: z
    .object({
      model: z.string().optional(),
      sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
      approval_policy: z.enum(["untrusted", "on-failure", "on-request", "never"]).optional(),
      timeout_seconds: z.number().optional(),
      developer_instructions_append: z.string().optional(),
      developer_instructions_replace: z.string().optional(),
    })
    .optional(),
});
const StatusInputZ = z.object({ agent_id: z.string().optional() });
const ResultInputZ = z.object({ agent_id: z.string() });
const ResumeInputZ = z.object({
  agent_id: z.string(),
  prompt: z.string().min(1),
  overrides: z.object({ timeout_seconds: z.number().optional() }).optional(),
});
const CancelInputZ = z.object({
  agent_id: z.string(),
  force: z.boolean().optional(),
});
const ListInputZ = z.object({
  role: z.enum(["implementer", "reviewer", "planner", "generic"]).optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
  issue_id: z.string().optional(),
  has_pr: z.boolean().optional(),
  stale_after_seconds: z.number().optional(),
});
const MergeInputZ = z.object({
  agent_id: z.string(),
  strategy: z.enum(["squash", "ff", "rebase"]).optional(),
  message: z.string().optional(),
  keep_worktree: z.boolean().optional(),
});
const DiscardInputZ = z.object({ agent_id: z.string() });

async function main() {
  const repoRoot = await detectRepoRoot();
  const stateDir = process.env.MAGIC_CODEX_STATE_DIR
    ? resolve(repoRoot, process.env.MAGIC_CODEX_STATE_DIR)
    : join(repoRoot, ".magic-codex");
  const rolesDir = join(__dirname, "roles", "defaults");
  const projectConfigPath = join(repoRoot, "magic-codex.toml");
  const userConfigPath = join(homedir(), ".magic-codex", "config.toml");

  const registry = new Registry(stateDir);
  const worktrees = new Worktrees(repoRoot);
  const mf = detectMf(repoRoot);
  const mfConventions = mf.detected ? await readMfConventions() : "";
  const linear = mf.detected ? new LinearClient() : undefined;
  const workersMirror = mf.detected && mf.has_workers_json
    ? new WorkersMirror(repoRoot)
    : undefined;
  const gh = new GhClient({ cwd: repoRoot });
  const orch = new Orchestrator({
    registry,
    worktrees,
    codexFactory: () => new CodexChild(),
    rolesDir,
    repoRoot,
    projectCommittedRolesPath: projectConfigPath,
    userGlobalRolesPath: userConfigPath,
    mf,
    linear,
    workersMirror,
    gh,
    mfConventions,
  });

  const server = new Server(
    { name: "magic-codex", version: "0.3.5" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "spawn",
        description:
          "Launch a Codex agent in the background. Returns immediately with agent_id; poll via `status`. Role picks the model, sandbox, and worktree policy. For long-running work (>60s) always prefer spawn + status polling over the synchronous 'codex' tool.",
        inputSchema: {
          type: "object",
          required: ["role", "prompt"],
          properties: {
            role: {
              type: "string",
              enum: ["implementer", "reviewer", "planner", "generic"],
              description:
                "implementer: writes code in an isolated worktree. reviewer: read-only critique. planner: plans without implementing. generic: caller-supplied behavior.",
            },
            prompt: { type: "string" },
            issue_id: { type: "string", description: "Optional Linear issue ID (e.g. TEAM-123)." },
            pr_number: { type: "number", description: "Optional PR number for reviewer role." },
            base_ref: {
              type: "string",
              description:
                "Optional base ref for the worktree branch. Defaults to 'main'. Ignored for roles without worktree.",
            },
            repo_root: {
              type: "string",
              description:
                "Absolute path to the git repo root the worker should operate in. When omitted, auto-detected from the MCP server's launch cwd via `git rev-parse --show-toplevel`. REQUIRED in multi-repo workspaces where the server's cwd isn't inside a git repo — otherwise all `git worktree` operations will fail. Example: '/Users/alice/projects/my-app'.",
            },
            overrides: {
              type: "object",
              properties: {
                model: { type: "string" },
                sandbox: {
                  type: "string",
                  enum: ["read-only", "workspace-write", "danger-full-access"],
                },
                approval_policy: {
                  type: "string",
                  enum: ["untrusted", "on-failure", "on-request", "never"],
                },
                timeout_seconds: { type: "number" },
                developer_instructions_append: { type: "string" },
                developer_instructions_replace: { type: "string" },
              },
            },
          },
        },
      },
      {
        name: "status",
        description:
          "Get per-agent or all-agents status. With agent_id: single record. Without: every agent + summary counts. Includes last_output_preview (first 500 chars); use `result` for full output.",
        inputSchema: {
          type: "object",
          properties: { agent_id: { type: "string" } },
        },
      },
      {
        name: "result",
        description: "Get the full last_output of an agent.",
        inputSchema: {
          type: "object",
          required: ["agent_id"],
          properties: { agent_id: { type: "string" } },
        },
      },
      {
        name: "resume",
        description:
          "Continue a previously-completed (or failed/cancelled) agent by sending a follow-up prompt. Requires the agent to have produced a thread_id during its initial run. Returns immediately with status=running; poll via `status`.",
        inputSchema: {
          type: "object",
          required: ["agent_id", "prompt"],
          properties: {
            agent_id: { type: "string" },
            prompt: { type: "string" },
            overrides: {
              type: "object",
              properties: { timeout_seconds: { type: "number" } },
            },
          },
        },
      },
      {
        name: "cancel",
        description:
          "Cancel a running agent. Kills the codex subprocess and marks status=cancelled (not failed). Worktree is preserved unless force=true.",
        inputSchema: {
          type: "object",
          required: ["agent_id"],
          properties: {
            agent_id: { type: "string" },
            force: {
              type: "boolean",
              description: "Also remove the worktree and delete its branch.",
            },
          },
        },
      },
      {
        name: "list",
        description:
          "List agents with optional filters: role, status, issue_id, has_pr, stale_after_seconds (agents whose terminal state is older than N seconds). No filters = all agents.",
        inputSchema: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["implementer", "reviewer", "planner", "generic"],
            },
            status: {
              type: "string",
              enum: ["queued", "running", "completed", "failed", "cancelled"],
            },
            issue_id: { type: "string" },
            has_pr: { type: "boolean" },
            stale_after_seconds: { type: "number" },
          },
        },
      },
      {
        name: "merge",
        description:
          "Merge a completed agent's worktree branch back into its base_ref. Default strategy is squash; ff/rebase also supported. Worktree is removed after successful merge unless keep_worktree=true.",
        inputSchema: {
          type: "object",
          required: ["agent_id"],
          properties: {
            agent_id: { type: "string" },
            strategy: { type: "string", enum: ["squash", "ff", "rebase"] },
            message: { type: "string", description: "Commit message for squash merges." },
            keep_worktree: { type: "boolean" },
          },
        },
      },
      {
        name: "discard",
        description:
          "Remove a terminal agent's worktree and delete its branch. Cancel running agents first.",
        inputSchema: {
          type: "object",
          required: ["agent_id"],
          properties: { agent_id: { type: "string" } },
        },
      },
      {
        name: "get_delegation_policy",
        description:
          "Return the user's configured delegation policy (minimal/balance/max) and the guidance for each level. CALL THIS AT THE START OF EVERY SESSION where you might spawn Codex agents — the current level tells you how aggressively to offload work from Claude to Codex.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === "spawn") {
      const parsed = SpawnInputZ.parse(args);
      const result = await orch.spawn(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (name === "status") {
      const parsed = StatusInputZ.parse(args);
      if (parsed.agent_id) {
        const rec = await registry.get(parsed.agent_id);
        const payload = rec ? agentSummary(rec) : { error: "not found" };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as Record<string, unknown>,
        };
      }
      const all = await registry.list();
      const payload = {
        agents: all.map(agentSummary),
        summary: countByStatus(all),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }
    if (name === "result") {
      const parsed = ResultInputZ.parse(args);
      const rec = await registry.get(parsed.agent_id);
      if (!rec) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "not found" }) }],
          isError: true,
        };
      }
      const payload = {
        agent_id: rec.agent_id,
        status: rec.status,
        output: rec.last_output,
        error: rec.error,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }
    if (name === "resume") {
      const parsed = ResumeInputZ.parse(args);
      const result = await orch.resume(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (name === "cancel") {
      const parsed = CancelInputZ.parse(args);
      const result = await orch.cancel(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (name === "list") {
      const parsed = ListInputZ.parse(args);
      const all = await registry.list();
      const now = Date.now();
      const filtered = all.filter((rec) => {
        if (parsed.role && rec.role !== parsed.role) return false;
        if (parsed.status && rec.status !== parsed.status) return false;
        if (parsed.issue_id && rec.issue_id !== parsed.issue_id) return false;
        if (parsed.has_pr !== undefined) {
          const hasPr = rec.pr_number != null;
          if (hasPr !== parsed.has_pr) return false;
        }
        if (parsed.stale_after_seconds !== undefined && rec.ended_at) {
          const ageSec = (now - Date.parse(rec.ended_at)) / 1000;
          if (ageSec < parsed.stale_after_seconds) return false;
        }
        return true;
      });
      const payload = {
        agents: filtered.map(agentSummary),
        summary: countByStatus(filtered),
        total: filtered.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }
    if (name === "merge") {
      const parsed = MergeInputZ.parse(args);
      const result = await orch.merge(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (name === "discard") {
      const parsed = DiscardInputZ.parse(args);
      const result = await orch.discard(parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (name === "get_delegation_policy") {
      const policy = await resolveDelegationPolicy({
        projectConfigPath,
        userConfigPath,
        envOverride: process.env.MAGIC_CODEX_DELEGATION_LEVEL,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(policy, null, 2) }],
        structuredContent: policy as unknown as Record<string, unknown>,
      };
    }
    throw new Error(`unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("magic-codex MCP server listening on stdio");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("magic-codex MCP fatal:", err);
  process.exit(1);
});
