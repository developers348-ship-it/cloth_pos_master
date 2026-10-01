import { prisma } from "@/lib/prisma";
import { buildSettlementOps, resolveSettlementAccount } from "@/lib/accounts";
import { applyCollectionToInstallments } from "@/lib/installments";
import { invoiceOutstanding, invoicePaymentStatus } from "@/lib/invoice-settlement";
import { buildPlanReplayOps } from "@/lib/repayment-plan";
import { computeSaleLedgerSplit } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";

/**
 * Mark Paid / Mark Unpaid for one sale invoice, from the sales list.
 *
 * `paymentStatus` is not a stored flag — it is derived from what the invoice
 * has actually been settled by (see lib/invoice-settlement.ts). So marking an
 * invoice paid means *recording the money*: a `Recovery` dated the day it was
 * collected, carrying this invoice's id, posted through the same
 * `buildSettlementOps` the Ledger page's Record Recovery and the installment
 * collect endpoint use. The invoice's own `cashReceived`/`bankAmount` are left
 * alone on purpose — they are the record of what was taken at the counter on
 * the day of the sale, and rewriting them would move today's cash into the
 * invoice's original date in the cash report and day book.
 *
 * Mark Unpaid is not the mirror of that: it reverses the recorded recoveries
 * *and* the counter payment, because its meaning is "this invoice was never
 * paid" rather than "money went back out today". See the DELETE handler.
 */

/** Loads the invoice plus everything that has settled it. */
async function loadInvoice(id: string) {
  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: {
      party: { select: { id: true, name: true, accountId: true } },
      installmentPlan: {
        select: {
          id: true, periods: true, kind: true,
          installments: { select: { id: true, seq: true, amount: true, paidAmount: true, status: true } },
        },
      },
      recoveries: {
        select: {
          id: true, amount: true, date: true,
          accountEntries: { select: { installmentId: true } },
        },
      },
    },
  });
  if (!invoice) return null;

  const settlement = {
    netBill: Number(invoice.netBill),
    creditApplied: Number(invoice.creditApplied),
    cashReceived: Number(invoice.cashReceived),
    cardAmount: Number(invoice.cardAmount),
    bankAmount: Number(invoice.bankAmount),
    recovered: invoice.recoveries.reduce((s, r) => s + Number(r.amount), 0),
  };

  // Recoveries booked by Mark Paid settle the invoice as a whole and so carry no
  // installment link on their account entry; the ones raised by the Installments
  // tab do. Only the former are Mark Unpaid's to undo — an installment
  // collection is reversed from where it was taken.
  const markPaidRecoveries = invoice.recoveries.filter(
    (r) => r.accountEntries.length > 0 && r.accountEntries.every((e) => !e.installmentId)
  );

  return { invoice, settlement, markPaidRecoveries };
}

/**
 * POST /api/sales/:id/payment
 * Body: { amount?, paymentMethod: "CASH"|"BANK", accountId?, date?, notes? }
 *
 * Records money collected against the invoice — the whole outstanding balance
 * by default, or `amount` for a part payment. Any installment schedule on the
 * invoice is settled by the same cascade the Installments tab uses, so a plan
 * that has just been paid off in full stops showing dues.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("MARK_INVOICE_PAID");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();
  const { amount, paymentMethod, accountId, date, notes } = body;

  const loaded = await loadInvoice(id);
  if (!loaded) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const { invoice, settlement } = loaded;

  if (invoice.status === "VOIDED") {
    return NextResponse.json(
      { error: "This invoice is voided — restore it before recording a payment" },
      { status: 400 }
    );
  }

  const outstanding = invoiceOutstanding(settlement);
  if (outstanding <= 0.005) {
    return NextResponse.json({ error: "This invoice is already fully paid" }, { status: 400 });
  }

  const collected = amount === undefined || amount === null ? outstanding : Number(amount);
  if (!(collected > 0)) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }
  // Unlike the installment collect endpoint, an overpayment is rejected rather
  // than left on account: this action is scoped to one invoice, and money beyond
  // its balance belongs on the party's ledger through the Ledger page instead.
  if (collected - outstanding > 0.005) {
    return NextResponse.json(
      { error: `Amount exceeds this invoice's outstanding balance (${outstanding.toFixed(2)})` },
      { status: 400 }
    );
  }

  const method = paymentMethod === "BANK" ? "BANK" : "CASH";
  const account = await resolveSettlementAccount(invoice.branchId, method, accountId);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: 400 });
  }

  const settlementId = randomUUID();
  const collectedAt = date ? new Date(date) : new Date();

  const { ops, reference } = buildSettlementOps({
    kind: "recovery",
    id: settlementId,
    branchId: invoice.branchId,
    partyId: invoice.partyId,
    date: collectedAt,
    amount: collected,
    paymentMethod: method,
    accountId: account.accountId,
    notes: notes || `Payment against Invoice #${invoice.invoiceNo}`,
    invoiceId: invoice.id,
  });

  // The schedule (if any) absorbs the money from the first unpaid row onwards —
  // this action settles the invoice as a whole, so there is no clicked row to
  // start from as there is in the Installments tab.
  const plan = invoice.installmentPlan;
  if (plan) {
    const { updates } = applyCollectionToInstallments(
      plan.installments
        .filter((r) => r.status !== "PAID")
        .map((r) => ({ id: r.id, seq: r.seq, amount: Number(r.amount), paidAmount: Number(r.paidAmount) })),
      collected
    );
    for (const u of updates) {
      ops.push(prisma.installment.update({
        where: { id: u.id },
        data: {
          paidAmount: u.paidAmount,
          status: u.status,
          paidAt: u.status === "PAID" ? collectedAt : null,
          recoveryId: settlementId,
        },
      }));
    }
  }

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  await prisma.$transaction(ops);

  const after = { ...settlement, recovered: (settlement.recovered ?? 0) + collected };
  return NextResponse.json({
    id: settlementId,
    reference,
    amount: collected,
    outstanding: invoiceOutstanding(after),
    paymentStatus: invoicePaymentStatus(after),
  }, { status: 201 });
}

/**
 * DELETE /api/sales/:id/payment
 *
 * Mark Unpaid — puts the invoice back to owing its balance. Two things are
 * reversed, either of which is enough on its own to make the action available:
 *
 * 1. **Recorded recoveries** booked by Mark Paid — the `Recovery` rows, their
 *    party LedgerEntry and their cash/bank AccountEntry all go, and any
 *    installment schedule is replayed back to the state the remaining
 *    collections leave it in.
 * 2. **Money taken at the counter** — the invoice's own `cashReceived` /
 *    `cardAmount` / `bankAmount` are zeroed, their SALE_RECEIPT/SALE_REFUND
 *    account entries deleted, and the SALE ledger row's credit side rewritten
 *    to nothing owed-back, so the party ledger shows the full bill outstanding.
 *
 *    This *does* rewrite money on the invoice's original date — the cash report
 *    and day book for that day change accordingly. That is the intended
 *    meaning here: the payment is being declared not to have happened, as
 *    opposed to a later refund, which belongs on today's date instead.
 *
 * `creditApplied` is deliberately left alone: store credit was consumed when
 * the invoice was billed, and handing it back is a ledger correction, not a
 * payment reversal. An invoice settled partly by credit therefore comes back as
 * PARTIAL rather than UNPAID.
 *
 * Installment collections taken from Ledger → Installments are never touched —
 * those are reversed from where they were taken.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("MARK_INVOICE_UNPAID");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const loaded = await loadInvoice(id);
  if (!loaded) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const { invoice, settlement, markPaidRecoveries } = loaded;

  const counterPaid =
    settlement.cashReceived + settlement.cardAmount + settlement.bankAmount;
  const recoveryIds = markPaidRecoveries.map((r) => r.id);
  const reversedRecoveries = markPaidRecoveries.reduce((s, r) => s + Number(r.amount), 0);

  if (recoveryIds.length === 0 && counterPaid <= 0.005) {
    const viaInstallments = invoice.recoveries.length > 0;
    return NextResponse.json({
      error: viaInstallments
        ? "This invoice was settled by installment collections — reverse those from Ledger → Installments"
        : "Nothing to undo — no payment is recorded against this invoice",
    }, { status: 400 });
  }

  const ops: any[] = [];

  if (recoveryIds.length > 0) {
    // Clear the FK from the schedule first; the replay below sets the rows'
    // final state, and Installment.recoveryId would otherwise block the delete.
    ops.push(
      prisma.installment.updateMany({
        where: { recoveryId: { in: recoveryIds } },
        data: { recoveryId: null },
      }),
      ...await buildPlanReplayOps({ invoiceId: id, excludeRecoveryIds: recoveryIds }),
      prisma.accountEntry.deleteMany({ where: { recoveryId: { in: recoveryIds } } }),
      prisma.ledgerEntry.deleteMany({ where: { recoveryId: { in: recoveryIds } } }),
      prisma.recovery.deleteMany({ where: { id: { in: recoveryIds } } }),
    );
  }

  if (counterPaid > 0.005) {
    ops.push(
      prisma.saleInvoice.update({
        where: { id },
        data: { cashReceived: 0, cardAmount: 0, bankAmount: 0 },
      }),
      // Only the sale's own receipt rows carry `invoiceId`; a settlement's
      // account entry is linked by `recoveryId` instead (see docs/orders.md),
      // so this cannot touch a collection that really happened.
      prisma.accountEntry.deleteMany({
        where: { invoiceId: id, type: { in: ["SALE_RECEIPT", "SALE_REFUND"] } },
      }),
      prisma.ledgerEntry.updateMany({
        where: { invoiceId: id, type: "SALE" },
        data: computeSaleLedgerSplit(settlement.netBill, 0),
      }),
    );
  }

  await prisma.$transaction(ops);

  const after = {
    ...settlement,
    recovered: (settlement.recovered ?? 0) - reversedRecoveries,
    cashReceived: 0,
    cardAmount: 0,
    bankAmount: 0,
  };
  const reversed = reversedRecoveries + counterPaid;
  return NextResponse.json({
    reversed,
    reversedRecoveries,
    reversedCounter: counterPaid,
    count: recoveryIds.length,
    outstanding: invoiceOutstanding(after),
    paymentStatus: invoicePaymentStatus(after),
  });
}
