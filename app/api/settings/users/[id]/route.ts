import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission } from "@/lib/authz";
import { normalizeEmail, validateUserInput } from "@/lib/users";

/**
 * One user's row.
 *
 * PATCH used to accept only `role`, `isActive` and `password`, which is why
 * Settings → Users offered no way to fix a misspelled name or a wrong email:
 * there was nothing behind such a form. It now takes `name` and `email` too,
 * and both verbs enforce the three ways an admin can otherwise lock the shop
 * out of its own POS:
 *
 *   - changing your own role (you would lose the screen you are standing on),
 *   - deactivating or deleting yourself,
 *   - removing the last active SUPER_ADMIN, after which nobody can edit roles
 *     or restore a backup ever again.
 */

/** The safety rails above, evaluated once for both PATCH and DELETE. */
async function assertNotLockingOurselvesOut(
  target: { id: string; role: string; isActive: boolean },
  currentUserId: string,
  change: { role?: string; isActive?: boolean; deleting?: boolean }
): Promise<string | null> {
  const isSelf = target.id === currentUserId;

  if (isSelf && change.deleting) return "You cannot delete your own account";
  if (isSelf && change.isActive === false) return "You cannot deactivate your own account";
  if (isSelf && change.role !== undefined && change.role !== target.role) {
    return "You cannot change your own role — ask another admin to do it";
  }

  const losingLastSuperAdmin =
    target.role === "SUPER_ADMIN" &&
    target.isActive &&
    (change.deleting === true ||
      change.isActive === false ||
      (change.role !== undefined && change.role !== "SUPER_ADMIN"));

  if (losingLastSuperAdmin) {
    const others = await prisma.user.count({
      where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
    });
    if (others === 0) {
      return "This is the only active Super Admin — promote someone else first";
    }
  }

  return null;
}

/**
 * PATCH /api/settings/users/[id]
 * Body may carry any of: name, email, role, isActive, password.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("EDIT_USER");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { name, email, role, isActive, password } = body;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const invalid = validateUserInput({
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(role !== undefined ? { role } : {}),
    // An empty password field on the edit form means "leave it alone", not
    // "set an empty password", so it is only validated when actually filled in.
    ...(password ? { password } : {}),
  });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const blocked = await assertNotLockingOurselvesOut(target, gate.userId, { role, isActive });
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  // Only checked when the role is actually moving — an edit that leaves it
  // alone needs nothing beyond EDIT_USER.
  if (role !== undefined && role !== target.role) {
    const roleGate = await requirePermission("ASSIGN_ROLES");
    if (!roleGate.ok) return roleGate.response;
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  if (email !== undefined) {
    const nextEmail = normalizeEmail(email);
    const clash = await prisma.user.findFirst({
      where: { email: nextEmail, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json({ error: "Another user already has that email" }, { status: 409 });
    }
    data.email = nextEmail;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    include: { branches: { include: { branch: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      branches: user.branches.map((ub) => ({ id: ub.branch.id, name: ub.branch.name })),
    },
  });
}

/**
 * DELETE /api/settings/users/[id]
 *
 * Removes the row outright. This used to be a soft delete — the same thing the
 * deactivate toggle does — so "Delete" and "Deactivate" were two buttons for
 * one action and a user could never actually be removed.
 *
 * A user who has recorded a sale, a GRN or an audit entry is referenced by
 * those records and cannot be removed without destroying the books, so the
 * attempt is refused with the count and the caller is pointed at deactivate.
 * `?soft=1` deactivates instead, for a caller that has decided to do just that.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("DELETE_USER");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const soft = new URL(req.url).searchParams.get("soft") === "1";

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      _count: { select: { invoices: true, grns: true, auditLogs: true } },
    },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const blocked = await assertNotLockingOurselvesOut(
    target,
    gate.userId,
    soft ? { isActive: false } : { deleting: true }
  );
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  if (soft) {
    const user = await prisma.user.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ deleted: false, user: { id: user.id, isActive: user.isActive } });
  }

  const history =
    target._count.invoices + target._count.grns + target._count.auditLogs;
  if (history > 0) {
    return NextResponse.json(
      {
        error:
          `${target.name} is recorded on ${history} existing entr${history === 1 ? "y" : "ies"} ` +
          `(${target._count.invoices} sales, ${target._count.grns} purchases, ${target._count.auditLogs} audit records). ` +
          `Deleting the account would break those records — deactivate it instead, which blocks the login and keeps the history.`,
        canDeactivate: true,
      },
      { status: 409 }
    );
  }

  // Their branch links and sessions go with them (both cascade); an expense
  // that named them as payee or recorder keeps the money and drops the name.
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ deleted: true, id });
}
