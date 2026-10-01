import { prisma } from "@/lib/prisma";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";

/**
 * Loads the effective permission matrix — the compiled defaults with the
 * SUPER_ADMIN-editable DB override layered on top.
 *
 * This lives apart from lib/authz.ts (which re-exports it, so every existing
 * `from "@/lib/authz"` import still works) purely so it can be used from
 * `auth.ts` as well. lib/authz.ts imports `auth` from there; a matrix loader
 * that lived in the same file would make that import cycle back on itself the
 * moment the JWT callback needed to check a permission — which it now does, to
 * decide whether a token may start impersonating someone.
 */

export const PERMISSIONS_SETTING_KEY = "role_permissions";

export type PermissionMatrix = Record<string, string[]>;

/**
 * The stored override changes about once a year, but a permission check runs on
 * every mutating request, so the matrix is cached in process rather than read
 * from the DB each time. Short TTL plus an explicit bust on save means an edit
 * in Settings → Roles takes effect immediately on the instance that saved it and
 * within seconds anywhere else.
 */
const CACHE_TTL_MS = 15_000;
let cached: { matrix: PermissionMatrix; at: number } | null = null;

/** Called by the permissions route after a save or reset. */
export function invalidatePermissionsCache() {
  cached = null;
}

/**
 * Defaults with the DB override layered on **per key**, not wholesale. The
 * stored matrix was written before Phase 7/8 added their keys, so a plain
 * `override ?? defaults` would silently deny every new permission to everyone
 * but SUPER_ADMIN.
 */
export async function getEffectivePermissions(): Promise<PermissionMatrix> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.matrix;

  let matrix: PermissionMatrix = DEFAULT_PERMISSIONS;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: PERMISSIONS_SETTING_KEY } });
    if (setting) {
      const stored = JSON.parse(setting.value) as PermissionMatrix;
      matrix = { ...DEFAULT_PERMISSIONS, ...stored };
    }
  } catch {
    // A malformed override or an unreachable Setting row must not take the till
    // down; fall back to the defaults compiled into the app.
    matrix = DEFAULT_PERMISSIONS;
  }

  cached = { matrix, at: Date.now() };
  return matrix;
}
