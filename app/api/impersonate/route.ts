import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkImpersonation, loadReturningActor } from "@/lib/impersonation-server";
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";

/**
 * "Login as user" — start (POST) and end (DELETE).
 *
 * Neither verb sets a cookie. They validate the request and write the audit
 * row; the client then calls next-auth's `update()`, and the JWT callback in
 * auth.ts re-runs the same check before it will rewrite the token. So the
 * route is not the security boundary — it exists to give the admin a reason
 * when the answer is no, and to leave a record of who became whom.
 */

type SessionUser = {
  id?: string;
  name?: string | null;
  role?: string;
  actor?: { id: string; name?: string | null; role?: string } | null;
};

async function currentUser(): Promise<SessionUser | null> {
  const session = (await auth()) as Session | null;
  const user = session?.user as SessionUser | undefined;
  if (!user?.id || !user.role) return null;
  return user;
}

/**
 * The audit trail is the point of routing this through an endpoint at all, but
 * a failed insert must not strand the admin mid-swap — the swap itself is the
 * token rewrite that happens next.
 */
async function record(
  req: NextRequest,
  actorId: string,
  action: "IMPERSONATE_START" | "IMPERSONATE_END",
  target: { id: string; name: string; role: string }
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action,
        entity: "User",
        entityId: target.id,
        newValues: { name: target.name, role: target.role },
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  } catch (e) {
    console.error(`[impersonate] audit write failed for ${action}`, e);
  }
}

/** POST /api/impersonate — body: { userId } */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "You are not signed in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const userId = body?.userId ? String(body.userId) : "";
  if (!userId) return NextResponse.json({ error: "Which user?" }, { status: 400 });

  const check = await checkImpersonation(
    { id: user.id!, role: user.role! },
    userId,
    Boolean(user.actor)
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  await record(req, user.id!, "IMPERSONATE_START", check.target);

  return NextResponse.json({
    user: {
      id: check.target.id,
      name: check.target.name,
      email: check.target.email,
      role: check.target.role,
      branchName: check.target.branchName,
    },
  });
}

/** DELETE /api/impersonate — back to the admin who started it. */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "You are not signed in" }, { status: 401 });

  const actor = user.actor;
  if (!actor?.id) {
    return NextResponse.json({ error: "You are not signed in as anyone else" }, { status: 409 });
  }

  // Checked here so the admin is told *before* the swap that there is nothing
  // to go back to, rather than being dropped on a login screen by the token
  // callback finding the same thing.
  const returning = await loadReturningActor(actor.id);
  if (!returning) {
    return NextResponse.json(
      { error: "Your own account is no longer active — sign out and back in", signOut: true },
      { status: 409 }
    );
  }

  await record(req, actor.id, "IMPERSONATE_END", {
    id: user.id!,
    name: user.name ?? "",
    role: user.role!,
  });

  return NextResponse.json({ user: { id: returning.id, name: returning.name, role: returning.role } });
}
