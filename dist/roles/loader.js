import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
async function readMaybe(path) {
    if (!path)
        return null;
    try {
        return await readFile(path, "utf8");
    }
    catch (e) {
        if (e.code === "ENOENT")
            return null;
        throw e;
    }
}
async function readRoleFromMultiRoleFile(path, role) {
    const raw = await readMaybe(path);
    if (raw === null)
        return {};
    const parsed = parseToml(raw);
    return parsed.roles?.[role] ?? {};
}
export async function loadRole(role, opts) {
    const defaultPath = join(opts.defaultsDir, `${role}.toml`);
    const defaultsRaw = await readFile(defaultPath, "utf8");
    const defaults = parseToml(defaultsRaw).role;
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
//# sourceMappingURL=loader.js.map