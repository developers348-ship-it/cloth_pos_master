import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { buildExpenseAccountEntryOps, resolveExpensePayment } from "@/lib/expenses";

/**
 * POST /api/expenses/[id]/pay
 * Body: { paymentMethod: "CASH" | "BANK", accountId?, paidAt? }
 *
 * Settles a cost that was recorded as owed. Its own route rather than a PATCH
 * with `status: "PAID"` because this is the everyday action — "the salaries
 * have gone out" — and it needs to be one click with one confirmation, not a
 * trip through the whole edit form.
 *
 * The cost itself does not move: `date` (when it was incurred) is untouched, so
 * paying September's rent in October leaves it a September cost in the profit
 * figures, and only `paidAt` and the account balance change.
 *
 * Gated on the same key that recording it needed, so paying an owner drawing
 * that was booked as owed still requires WITHDRAW_PROFIT.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  const gate = await requirePermission(
    expense.kind === "EXPENSE" ? "CREATE_EXPENSE" : "WITHDRAW_PROFIT"
  );
  if (!gate.ok) return gate.response;

  if (expense.status === "PAID") {
    return NextResponse.json({ error: "This cost is already paid" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  const payment = await resolveExpensePayment({
    branchId: expense.branchId,
    status: "PAID",
    paymentMethod: body.paymentMethod,
    accountId: body.accountId,
  });
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 400 });
  // Narrowing: status was forced to PAID above, so the account is resolved.
  if (payment.status !== "PAID") {
    return NextResponse.json({ error: "Select how this cost was paid" }, { status: 400 });
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  const amount = Number(expense.amount);

  await prisma.$transaction([
    prisma.expense.update({
      where: { id },
      data: {
        status: "PAID",
        paymentMethod: payment.paymentMethod,
        accountId: payment.accountId,
        paidAt,
      },
    }),
    // The account entry is dated when the money actually left, not when the
    // cost was incurred — the account statement has to agree with the bank's.
    ...buildExpenseAccountEntryOps({
      branchId: expense.branchId,
      expenseId: id,
      accountId: payment.accountId,
      kind: expense.kind,
      amount,
      date: paidAt,
      reference: expense.reference,
      notes: expense.notes || expense.title,
    }),
  ]);

  const updated = await prisma.expense.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, type: true } },
      payeeUser: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    expense: updated && { ...updated, amount: Number(updated.amount) },
  });
}
