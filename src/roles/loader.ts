import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { AgentRole } from "../types.js";
import type { PartialRolePreset, RolePreset } from "./types.js";

export interface LoadRoleOptions {
  defaultsDir: string;
  userGlobalPath?: string;
  projectCommittedPath?: string;
  projectPersonalPath?: string;
  overrides?: PartialRolePreset;
}

async function readMaybe(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function readRoleFromMultiRoleFile(
  path: string | undefined,
  role: AgentRole,
): Promise<PartialRolePreset> {
  const raw = await readMaybe(path);
  if (raw === null) return {};
  const parsed = parseToml(raw) as unknown as { roles?: Record<string, PartialRolePreset> };
  return parsed.roles?.[role] ?? {};
}

export async function loadRole(role: AgentRole, opts: LoadRoleOptions): Promise<RolePreset> {
  const defaultPath = join(opts.defaultsDir, `${role}.toml`);
  const defaultsRaw = await readFile(defaultPath, "utf8");
  const defaults = (parseToml(defaultsRaw) as unknown as { role: RolePreset }).role;

  const userGlobal = await readRoleFromMultiRoleFile(opts.userGlobalPath, role);
  const projectCommitted = await readRoleFromMultiRoleFile(opts.projectCommittedPath, role);
  const projectPersonal = await readRoleFromMultiRoleFile(opts.projectPersonalPath, role);

  return {
    ...defaults,
    ...userGlobal,
    ...projectCommitted,
    ...projectPersonal,
    ...(opts.overrides ?? {}),
  };
}
