import { auth } from "@/auth";
import { isAllowed, type Permission } from "@/lib/permissions";
import { getEffectivePermissions } from "@/lib/permissions-server";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

/**
 * Server-side permission enforcement.
 *
 * Until Phase 8 the app *defined* permissions in two places and enforced them
 * in neither — any logged-in user could void or delete any invoice straight
 * from the sales list, and the API would happily oblige. This module is the one
 * gate: every route that moves money or destroys a record starts with
 * `requirePermission(...)`, and the matching UI affordance goes through
 * `usePermissions()` in lib/permissions-client.tsx so the two can't disagree.
 *
 * Read-only list and report endpoints are deliberately left open. The shop runs
 * on one shared terminal and hiding figures from the staff standing at it was
 * never the goal — the goal is that nobody can *change* the books without the
 * role for it.
 *
 * The matrix itself is loaded by lib/permissions-server.ts and re-exported here
 * so the existing `from "@/lib/authz"` imports keep working; see that file for
 * why it had to move out.
 */

export {
  PERMISSIONS_SETTING_KEY,
  invalidatePermissionsCache,
  getEffectivePermissions,
} from "@/lib/permissions-server";

export type AuthzResult =
  | { ok: true; session: Session; userId: string; role: string }
  | { ok: false; response: NextResponse };

/**
 * Guards one route handler. Returns the session on success, or the response to
 * return on failure — 401 when nobody is signed in, 403 when they are but the
 * role doesn't carry the permission.
 *
 *   const gate = await requirePermission("DELETE_INVOICE");
 *   if (!gate.ok) return gate.response;
 */
export async function requirePermission(permission: Permission): Promise<AuthzResult> {
  // `auth()` is overloaded in next-auth v5 (it also wraps middleware), so the
  // no-argument session form is narrowed explicitly here.
  const session = (await auth()) as Session | null;
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user || !role) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You are not signed in" }, { status: 401 }),
    };
  }

  const matrix = await getEffectivePermissions();
  if (!isAllowed(matrix, role, permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Your role (${role}) is not allowed to do this` },
        { status: 403 }
      ),
    };
  }

  return { ok: true, session, userId: (session.user as { id?: string }).id ?? "", role };
}

/**
 * For a route whose required permission depends on the request body — the sales
 * PATCH is void *or* restore, and creating an invoice only needs
 * APPLY_STORE_CREDIT when store credit is actually being spent.
 */
export async function requireAllPermissions(permissions: [Permission, ...Permission[]]): Promise<AuthzResult> {
  let last = await requirePermission(permissions[0]);
  for (const permission of permissions.slice(1)) {
    if (!last.ok) return last;
    last = await requirePermission(permission);
  }
  return last;
}
