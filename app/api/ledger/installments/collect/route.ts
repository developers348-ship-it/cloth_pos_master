import { prisma } from "@/lib/prisma";
import { buildSettlementOps, resolveSettlementAccount } from "@/lib/accounts";
import { applyCollectionToInstallments } from "@/lib/installments";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";

/**
 * POST /api/ledger/installments/collect
 * Body: { installmentId, amount, paymentMethod: "CASH"|"BANK", accountId?, notes?, date? }
 *
 * Collects money against a scheduled installment. One transaction covers the
 * installment row(s), the Recovery/Payment record, the party LedgerEntry and
 * the cash/bank AccountEntry — the last three via the same
 * `buildSettlementOps` the plain recovery/payment routes use, so a collection
 * and a manual recovery post identically.
 *
 * A customer/vendor settling more than the clicked installment is normal, so
 * the amount **cascades onto the following unpaid installments** instead of
 * being rejected. Anything left after the last one is reported as `leftover`:
 * the money is still recorded against the party's balance, it just no longer
 * maps to a scheduled row.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("COLLECT_INSTALLMENT");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { installmentId, amount, paymentMethod, accountId, notes, date } = body;

  if (!installmentId || amount === undefined || amount === null) {
    return NextResponse.json({ error: "installmentId and amount are required" }, { status: 400 });
  }
  const collected = Number(amount);
  if (!(collected > 0)) {
    return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
  }

  const target = await prisma.installment.findUnique({
    where: { id: installmentId },
    include: { plan: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Installment not found" }, { status: 404 });
  }
  if (target.status === "PAID") {
    return NextResponse.json({ error: "This installment is already paid" }, { status: 400 });
  }

  const plan = target.plan;
  // A plan hangs off either a SaleInvoice or a GRN (the schema makes both
  // nullable and unique). Customer plans are collected as money in; vendor
  // plans are settled as money out.
  const kind: "recovery" | "payment" = plan.invoiceId ? "recovery" : "payment";

  const method = paymentMethod ?? "CASH";
  const account = await resolveSettlementAccount(plan.branchId, method, accountId);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: 400 });
  }

  // The clicked installment plus every later unpaid one, in order — the rows
  // an overpayment is allowed to cascade onto. Earlier unpaid installments are
  // deliberately left alone: the cashier picked this row.
  const cascadeRows = await prisma.installment.findMany({
    where: {
      planId: plan.id,
      status: { in: ["PENDING", "PARTIAL"] },
      seq: { gte: target.seq },
    },
    orderBy: { seq: "asc" },
  });

  const { updates, leftover } = applyCollectionToInstallments(
    cascadeRows.map((r) => ({
      id: r.id,
      seq: r.seq,
      amount: Number(r.amount),
      paidAmount: Number(r.paidAmount),
    })),
    collected
  );

  const settlementId = randomUUID();
  const collectedAt = date ? new Date(date) : new Date();

  const { ops, reference } = buildSettlementOps({
    kind,
    id: settlementId,
    branchId: plan.branchId,
    partyId: plan.partyId,
    date: collectedAt,
    amount: collected,
    paymentMethod: method,
    accountId: account.accountId,
    notes: notes || `Installment ${target.seq}/${plan.periods} — ${plan.kind}`,
    installmentId: target.id,
    // Links the money to the invoice the plan finances, so the sales list's
    // payment status reflects installments collected here.
    invoiceId: plan.invoiceId,
  });

  for (const u of updates) {
    ops.push(prisma.installment.update({
      where: { id: u.id },
      data: {
        paidAmount: u.paidAmount,
        status: u.status,
        paidAt: u.status === "PAID" ? collectedAt : null,
        // Links the row back to the money that settled it. On a cascade every
        // touched row points at this one settlement.
        recoveryId: kind === "recovery" ? settlementId : null,
        paymentId: kind === "payment" ? settlementId : null,
      },
    }));
  }

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  await prisma.$transaction(ops);

  return NextResponse.json({
    id: settlementId,
    kind,
    reference,
    amount: collected,
    applied: updates.map((u) => ({ installmentId: u.id, seq: u.seq, applied: u.applied, status: u.status })),
    leftover,
  }, { status: 201 });
}
