import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { buildExpenseAccountEntryOps, resolveExpensePayment } from "@/lib/expenses";
import type { Permission } from "@/lib/permissions";

/**
 * Which key a mutation on this row needs. Mirrors POST /api/expenses: a
 * drawing or injection is gated on WITHDRAW_PROFIT rather than the plain
 * expense keys, so the narrow permission stays narrow on the way out as well
 * as the way in — being allowed to edit costs must not become a way to rewrite
 * what the owner took.
 */
function keyFor(kind: string, action: "EDIT" | "DELETE"): Permission {
  if (kind !== "EXPENSE") return "WITHDRAW_PROFIT";
  return action === "EDIT" ? "EDIT_EXPENSE" : "DELETE_EXPENSE";
}

/**
 * PATCH /api/expenses/[id]
 * Body: any of { date, categoryId, title, amount, status, paymentMethod,
 *                accountId, payeeUserId, payeeName, reference, notes }
 *
 * `kind` is deliberately **not** editable. Flipping a paid salary into an owner
 * drawing would move it out of the profit calculation retroactively, which is
 * a different record, not an edit of this one — delete it and record the right
 * one instead.
 *
 * Any change to the money (amount, account, method, date, or paid/unpaid) is
 * applied by **dropping this expense's AccountEntry rows and rebuilding them**
 * rather than patching them in place. There is at most one, it is derived
 * entirely from the fields above, and rebuilding is the only way an edit that
 * flips PAID → UNPAID (the entry must vanish) and one that flips back (it must
 * reappear) go through the same code path.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  const gate = await requirePermission(keyFor(existing.kind, "EDIT"));
  if (!gate.ok) return gate.response;

  const body = await req.json();
  if (body.kind !== undefined && body.kind !== existing.kind) {
    return NextResponse.json(
      { error: "An expense's kind cannot be changed — delete it and record the correct one" },
      { status: 400 }
    );
  }

  const amount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }

  const title = body.title !== undefined ? String(body.title).trim() : existing.title;
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const date = body.date !== undefined ? new Date(body.date) : existing.date;

  let categoryId = existing.categoryId;
  if (existing.kind === "EXPENSE" && body.categoryId !== undefined) {
    if (!body.categoryId) {
      return NextResponse.json({ error: "Select a category" }, { status: 400 });
    }
    const category = await prisma.expenseCategory.findUnique({ where: { id: body.categoryId } });
    if (!category || category.branchId !== existing.branchId) {
      return NextResponse.json({ error: "Category not found in this branch" }, { status: 404 });
    }
    categoryId = category.id;
  }

  // The payment half is resolved from the *merged* view of old and new, so a
  // PATCH that only changes the amount keeps paying out of the same account
  // instead of silently falling back to cash.
  const payment = await resolveExpensePayment({
    branchId: existing.branchId,
    status: body.status !== undefined ? body.status : existing.status,
    paymentMethod: body.paymentMethod !== undefined ? body.paymentMethod : existing.paymentMethod,
    accountId: body.accountId !== undefined ? body.accountId : existing.accountId,
  });
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 400 });

  let payeeUserId = existing.payeeUserId;
  let payeeName = body.payeeName !== undefined ? String(body.payeeName).trim() || null : existing.payeeName;
  if (body.payeeUserId !== undefined) {
    if (!body.payeeUserId) {
      payeeUserId = null;
    } else {
      const user = await prisma.user.findFirst({
        where: { id: body.payeeUserId, branches: { some: { branchId: existing.branchId } } },
        select: { id: true, name: true },
      });
      if (!user) {
        return NextResponse.json({ error: "Selected staff member is not in this branch" }, { status: 400 });
      }
      payeeUserId = user.id;
      payeeName = payeeName || user.name;
    }
  }

  const reference = body.reference !== undefined ? String(body.reference).trim() || null : existing.reference;
  const notes = body.notes !== undefined ? String(body.notes).trim() || null : existing.notes;

  // `any[]` matches the existing money-moving routes (see app/api/purchases/route.ts):
  // the array holds heterogeneous unresolved Prisma promises, which the
  // sequential-array $transaction overload can't infer from a wider type.
  const ops: any[] = [
    prisma.accountEntry.deleteMany({ where: { expenseId: id } }),
    prisma.expense.update({
      where: { id },
      data: {
        date,
        categoryId,
        title,
        amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        accountId: payment.accountId,
        // An edit that leaves it paid keeps the original settlement timestamp;
        // one that pays a previously-unpaid row stamps it now.
        paidAt:
          payment.status === "PAID"
            ? existing.status === "PAID"
              ? existing.paidAt ?? date
              : new Date()
            : null,
        payeeUserId,
        payeeName,
        reference,
        notes,
      },
    }),
  ];

  if (payment.status === "PAID") {
    ops.push(
      ...buildExpenseAccountEntryOps({
        branchId: existing.branchId,
        expenseId: id,
        accountId: payment.accountId,
        kind: existing.kind,
        amount,
        date,
        reference,
        notes: notes || title,
      })
    );
  }

  await prisma.$transaction(ops);

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, type: true } },
      payeeUser: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    expense: expense && { ...expense, amount: Number(expense.amount) },
  });
}

/**
 * DELETE /api/expenses/[id]
 *
 * Removes the expense and the account posting behind it, so the money goes
 * back into the account balance. Unlike a bank account, an expense carries no
 * dependents worth protecting — its AccountEntry exists only because of it —
 * so this is a real delete rather than a deactivate.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  const gate = await requirePermission(keyFor(existing.kind, "DELETE"));
  if (!gate.ok) return gate.response;

  await prisma.$transaction([
    prisma.accountEntry.deleteMany({ where: { expenseId: id } }),
    prisma.expense.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
