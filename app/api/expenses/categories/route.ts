import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { ensureExpenseCategories } from "@/lib/expenses";

/**
 * GET /api/expenses/categories?branchId=&includeInactive=
 *
 * The branch's cost headings, seeding the default set on first call — the same
 * lazy provisioning `GET /api/accounts` does for the house Cash and Card
 * accounts, so the page has something to offer on the very first visit.
 *
 * `includeInactive=1` is passed only by the manage-categories view: a
 * deactivated heading must still be listed there so it can be reactivated, but
 * must never appear in the new-expense dropdown.
 *
 * Gated on VIEW_EXPENSES like the list itself — the category names alone say
 * what the shop spends money on.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("VIEW_EXPENSES");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const includeInactive = searchParams.get("includeInactive") === "1";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  await ensureExpenseCategories(branchId);

  const categories = await prisma.expenseCategory.findMany({
    where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { expenses: true } } },
  });

  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      note: c.note,
      isActive: c.isActive,
      expenseCount: c._count.expenses,
    })),
  });
}

/**
 * POST /api/expenses/categories
 * Body: { branchId, name, note? }
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("MANAGE_EXPENSE_CATEGORIES");
  if (!gate.ok) return gate.response;

  const { branchId, name, note } = await req.json();
  if (!branchId || !name?.trim()) {
    return NextResponse.json({ error: "branchId and name are required" }, { status: 400 });
  }

  const trimmed = name.trim();
  const clash = await prisma.expenseCategory.findFirst({
    where: { branchId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (clash) {
    // Reactivating beats a duplicate: the shop is almost certainly trying to
    // bring back a heading it deactivated, and the [branchId, name] unique
    // index would refuse the insert anyway.
    return NextResponse.json(
      {
        error: clash.isActive
          ? `"${clash.name}" already exists`
          : `"${clash.name}" exists but is deactivated — reactivate it instead`,
      },
      { status: 409 }
    );
  }

  const category = await prisma.expenseCategory.create({
    data: { branchId, name: trimmed, note: note?.trim() || null },
  });

  return NextResponse.json({ category }, { status: 201 });
}
