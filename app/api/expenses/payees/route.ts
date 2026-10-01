import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * GET /api/expenses/payees?branchId=
 *
 * The staff list behind the "paid to" dropdown on the cost form: just id and
 * name, for active users attached to this branch.
 *
 * Its own endpoint rather than reusing `GET /api/settings/users` because that
 * one is gated on `VIEW_USERS` (SUPER_ADMIN / ADMIN by default) and returns
 * emails and roles. A MANAGER or ACCOUNTANT who may record a salary needs to
 * pick who it was paid to without being able to read the user directory — so
 * this is gated on `VIEW_EXPENSES` and returns nothing else.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("VIEW_EXPENSES");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: { isActive: true, branches: { some: { branchId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ payees: users });
}
