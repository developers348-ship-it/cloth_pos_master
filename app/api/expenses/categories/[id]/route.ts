import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * PATCH /api/expenses/categories/[id]
 * Body: any of { name, note, isActive }
 *
 * Renaming a heading rewrites how every past cost under it reads, which is why
 * this sits on MANAGE_EXPENSE_CATEGORIES rather than EDIT_EXPENSE.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("MANAGE_EXPENSE_CATEGORIES");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();

  const category = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (trimmed.toLowerCase() !== category.name.toLowerCase()) {
      const clash = await prisma.expenseCategory.findFirst({
        where: {
          branchId: category.branchId,
          name: { equals: trimmed, mode: "insensitive" },
          id: { not: id },
        },
      });
      if (clash) {
        return NextResponse.json({ error: `"${clash.name}" already exists` }, { status: 409 });
      }
    }
    data.name = trimmed;
  }
  if (body.note !== undefined) data.note = String(body.note).trim() || null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.expenseCategory.update({ where: { id }, data });
  return NextResponse.json({ category: updated });
}

/**
 * DELETE /api/expenses/categories/[id]
 *
 * Only removes a heading nothing has been booked under. Once costs reference
 * it, deleting would null their `categoryId` (`ON DELETE SET NULL`) and quietly
 * drop that spending out of every per-category total — deactivating is the
 * right move, and the 409 says so. Same rule, and the same reasoning, as
 * DELETE /api/accounts/[id].
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("MANAGE_EXPENSE_CATEGORIES");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const category = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const used = await prisma.expense.count({ where: { categoryId: id } });
  if (used > 0) {
    return NextResponse.json(
      {
        error: `${category.name} has ${used} cost${used === 1 ? "" : "s"} booked under it and cannot be deleted. Deactivate it instead — it will stop appearing when recording a new cost but its history stays intact.`,
      },
      { status: 409 }
    );
  }

  await prisma.expenseCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
