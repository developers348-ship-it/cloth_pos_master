import { prisma } from "@/lib/prisma";
import { isAllowed } from "@/lib/permissions";
import { getEffectivePermissions } from "@/lib/permissions-server";
import { impersonationBlockReason } from "@/lib/impersonation";

/**
 * The server half of "login as user": one check, run in both places that can
 * start an impersonation.
 *
 * `POST /api/impersonate` runs it to answer the admin with a reason when it
 * refuses, and to write the audit row. The JWT callback in auth.ts runs it
 * again before it will rewrite the token, because the token is what actually
 * grants the access — a client that called `update()` on its own, skipping the
 * route entirely, must hit exactly the same wall.
 */

export type ImpersonationActor = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ImpersonationTarget = ImpersonationActor & {
  branchId: string | null;
  branchName: string | null;
};

export type ImpersonationCheck =
  | { ok: true; target: ImpersonationTarget }
  | { ok: false; error: string; status: number };

/** The identity fields a token needs, for either half of the swap. */
async function loadUser(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      branches: {
        take: 1,
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  });
}

/**
 * May `actor` sign in as `targetUserId`, and who is that?
 *
 * `alreadyImpersonating` refuses to chain one impersonation onto another: the
 * way back is a single "Back to admin", and a stack of identities would make
 * both the banner and the audit trail lie about who is at the till.
 */
export async function checkImpersonation(
  actor: { id: string; role: string },
  targetUserId: string,
  alreadyImpersonating: boolean
): Promise<ImpersonationCheck> {
  if (alreadyImpersonating) {
    return {
      ok: false,
      error: "Return to your own account before signing in as someone else",
      status: 409,
    };
  }

  const matrix = await getEffectivePermissions();
  if (!isAllowed(matrix, actor.role, "IMPERSONATE_USER")) {
    return {
      ok: false,
      error: `Your role (${actor.role}) is not allowed to sign in as another user`,
      status: 403,
    };
  }

  const target = await loadUser(targetUserId);
  if (!target) return { ok: false, error: "User not found", status: 404 };

  const blocked = impersonationBlockReason(actor, target);
  if (blocked) return { ok: false, error: blocked, status: 403 };

  const branch = target.branches[0]?.branch ?? null;

  return {
    ok: true,
    target: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
    },
  };
}

/**
 * The admin's own row, re-read on the way back rather than restored from the
 * token — their role or their branch may have been edited while they were away,
 * and the token they return to should be the one they would get by logging in.
 * Null when the account has since been deleted or deactivated, which leaves the
 * caller to sign them out rather than hand back an identity that no longer
 * exists.
 */
export async function loadReturningActor(actorId: string): Promise<ImpersonationTarget | null> {
  const actor = await loadUser(actorId);
  if (!actor || !actor.isActive) return null;

  const branch = actor.branches[0]?.branch ?? null;
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    branchId: branch?.id ?? null,
    branchName: branch?.name ?? null,
  };
}
