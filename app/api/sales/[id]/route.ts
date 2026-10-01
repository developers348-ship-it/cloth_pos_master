import { prisma } from "@/lib/prisma";
import { buildSaleAccountEntryOps } from "@/lib/accounts";
import { computeSaleLedgerSplit } from "@/lib/utils";
import { buildPlanOps, buildPlanTeardownOps } from "@/lib/repayment-plan";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import {
  invoiceSettledAmount, invoiceOutstanding, invoiceRefundable, invoicePaymentStatus,
} from "@/lib/invoice-settlement";

/**
 * GET /api/sales/:id
 *
 * One invoice in full — what the sales list's **Order Detail** view and its
 * printed invoice need. `GET /api/reports/sales` deliberately carries only what
 * its columns show; a paper invoice also has to state the per-line discounts,
 * the adjustment / courier / slip figures, which bank account the money went
 * into, the customer's contact block and running balance, every payment taken
 * since the sale, and the installment schedule. Fetching those per row would
 * have meant loading them for a thousand invoices to look at one, so the detail
 * is a lookup by id instead.
 *
 * Read-only, so no permission gate — see the note in lib/authz.ts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const inv = await prisma.saleInvoice.findUnique({
    where: { id },
    include: {
      party: true,
      user: { select: { name: true } },
      bankAccount: { select: { name: true, type: true } },
      items: {
        include: { item: { select: { name: true, unit: true, barcode: true } } },
        orderBy: { id: "asc" },
      },
      // Money collected against this invoice after the sale. `installmentId` on
      // the account entries is what tells a Mark Paid receipt from a collection
      // taken in Ledger → Installments (see app/api/reports/sales/route.ts).
      recoveries: {
        orderBy: { date: "asc" },
        include: {
          account: { select: { name: true, type: true } },
          accountEntries: { select: { installmentId: true } },
        },
      },
      installmentPlan: { include: { installments: { orderBy: { seq: "asc" } } } },
      refundOf: { select: { id: true, invoiceNo: true } },
      refunds: { select: { id: true, invoiceNo: true } },
    },
  });

  if (!inv) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // The customer's balance **as at this invoice**, not as of today. The
  // Contacts report's `previousBalance + Σdebit − Σcredit` is the right figure
  // for a list of who owes what now, but an invoice that prints "previous
  // balance" has to mean the balance before *this* sale — otherwise reprinting
  // last month's invoice shows a figure that has moved since, and the document
  // no longer adds up (previous + this bill ≠ closing).
  //
  // So the party's rows are replayed in (date, createdAt) order and split at
  // this invoice's own first row: everything before it is the opening balance,
  // its own rows are this invoice's effect, and everything after is ignored.
  // Ordering on createdAt as well as date is what keeps same-day invoices in
  // the order they were rung up instead of lumping them together.
  const partyLedger = await prisma.ledgerEntry.findMany({
    where: { branchId: inv.branchId, partyId: inv.partyId },
    select: { date: true, createdAt: true, debit: true, credit: true, invoiceId: true },
  });
  const sortKey = (e: { date: Date; createdAt: Date }) =>
    `${e.date.toISOString()}|${e.createdAt.toISOString()}`;
  // A voided invoice has had its ledger rows deleted, so there is nothing to
  // anchor on; fall back to the invoice date, which is the best available split.
  const ownKeys = partyLedger.filter((e) => e.invoiceId === inv.id).map(sortKey).sort();
  const ownKey: string | null = ownKeys[0] ?? null;

  const opening = Number(inv.party.previousBalance ?? 0);
  let balanceBefore = opening;
  let balanceAfter = opening;
  for (const e of partyLedger) {
    const delta = Number(e.debit) - Number(e.credit);
    if (e.invoiceId === inv.id) {
      balanceAfter += delta;
      continue;
    }
    if (ownKey === null ? e.date < inv.date : sortKey(e) < ownKey) {
      balanceBefore += delta;
      balanceAfter += delta;
    }
  }

  const recoveries = inv.recoveries.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    paymentMethod: r.paymentMethod,
    accountName: r.account?.name ?? r.bankName ?? null,
    notes: r.notes,
    /** Booked by Mark Paid rather than by an installment collection. */
    isMarkPaid: r.accountEntries.length > 0 && r.accountEntries.every((e) => !e.installmentId),
  }));

  const settlement = {
    netBill: Number(inv.netBill),
    creditApplied: Number(inv.creditApplied),
    cashReceived: Number(inv.cashReceived),
    cardAmount: Number(inv.cardAmount),
    bankAmount: Number(inv.bankAmount),
    recovered: recoveries.reduce((s, r) => s + r.amount, 0),
  };

  return NextResponse.json({
    invoice: {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      date: inv.date,
      status: inv.status,
      partyOption: inv.partyOption,
      paymentMethod: inv.paymentMethod,
      printUrdu: inv.printUrdu,
      notes: inv.notes,
      cashier: inv.user?.name ?? null,
      bankAccountName: inv.bankAccount?.name ?? inv.chooseBank ?? null,

      party: {
        id: inv.party.id,
        accountId: inv.party.accountId,
        name: inv.party.name,
        type: inv.party.type,
        phone: inv.party.phone,
        mobile: inv.party.mobile,
        address: inv.party.address,
        city: inv.party.city,
        creditLimit: Number(inv.party.creditLimit),
        /** The customer's balance before this invoice was rung up. */
        balanceBefore,
        /** …and after it, i.e. `balanceBefore` plus this invoice's ledger effect. */
        balanceAfter,
      },

      items: inv.items.map((li) => ({
        id: li.id,
        name: li.item.name,
        unit: li.item.unit,
        barcode: li.item.barcode,
        isReturn: li.isReturn,
        qty: Number(li.qty),
        pcs: Number(li.pcs),
        gaz: Number(li.gaz),
        mtr: Number(li.mtr),
        rate: Number(li.rate),
        disRS: Number(li.disRS),
        disPct: Number(li.disPct),
        amount: Number(li.amount),
      })),

      totals: {
        grossSale: Number(inv.grossSale),
        packageDiscount: Number(inv.packageDiscount),
        saleAmount: Number(inv.saleAmount),
        returnAmount: Number(inv.returnAmount),
        adjustment: Number(inv.adjustment),
        adjustType: inv.adjustType,
        slipAmount: Number(inv.slipAmount),
        courierCharges: Number(inv.courierCharges),
        netBill: settlement.netBill,
        soldPcs: Number(inv.soldPcs),
        soldGaz: Number(inv.soldGaz),
        soldMtr: Number(inv.soldMtr),
        returnPcs: Number(inv.returnPcs),
        returnGaz: Number(inv.returnGaz),
        returnMtr: Number(inv.returnMtr),
      },

      payment: {
        cashReceived: settlement.cashReceived,
        cardAmount: settlement.cardAmount,
        bankAmount: settlement.bankAmount,
        creditApplied: settlement.creditApplied,
        change: Number(inv.change),
        recovered: settlement.recovered,
        settled: invoiceSettledAmount(settlement),
        outstanding: invoiceOutstanding(settlement),
        refundable: invoiceRefundable(settlement),
        status: invoicePaymentStatus(settlement),
      },

      recoveries,

      plan: inv.installmentPlan && {
        id: inv.installmentPlan.id,
        kind: inv.installmentPlan.kind,
        principal: Number(inv.installmentPlan.principal),
        periods: inv.installmentPlan.periods,
        startDate: inv.installmentPlan.startDate,
        installments: inv.installmentPlan.installments.map((i) => ({
          seq: i.seq,
          dueDate: i.dueDate,
          amount: Number(i.amount),
          paidAmount: Number(i.paidAmount),
          status: i.status,
          paidAt: i.paidAt,
        })),
      },

      repaymentType: inv.repaymentType,
      installmentPeriods: inv.installmentPeriods,
      refundOf: inv.refundOf,
      refundedBy: inv.refunds[0] ?? null,
    },
  });
}

/**
 * PATCH /api/sales/:id  { status: "SAVED" | "VOIDED" }
 *
 * Toggles an invoice between SAVED (active) and VOIDED (cancelled, kept for
 * record). Voiding reverses the invoice's stock and ledger effects; restoring
 * (VOIDED -> SAVED) re-applies them.
 *
 * Money collected against the invoice *after* the sale (Mark Paid payments and
 * installment collections, both `Recovery` rows) is deliberately left standing
 * through a void: that cash genuinely changed hands, so the customer ends up
 * holding it as a credit balance until it is refunded or spent. Those rows are
 * untouched by the deleteMany calls below because a settlement's ledger and
 * account entries carry `recoveryId`, never `invoiceId`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Voiding and restoring are the same permission: both swing an invoice's
  // stock and ledger effects in or out, and being able to do one without the
  // other would be an odd half-permission.
  const gate = await requirePermission("VOID_INVOICE");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (status !== "SAVED" && status !== "VOIDED") {
    return NextResponse.json({ error: "status must be SAVED or VOIDED" }, { status: 400 });
  }

  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: { items: true, refunds: { select: { invoiceNo: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === status) {
    return NextResponse.json({ id: invoice.id, status: invoice.status });
  }
  // A refund has already put this invoice's goods back on the shelf and paid the
  // customer out (see the refund route). Voiding would reverse the same stock a
  // second time, so the refund has to be deleted first.
  if (invoice.refunds.length > 0) {
    return NextResponse.json(
      { error: `This invoice was refunded by INV-${invoice.refunds[0].invoiceNo}. Delete that refund first.` },
      { status: 400 }
    );
  }

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  const ops: any[] = [];
  if (status === "VOIDED") {
    for (const line of invoice.items) {
      const delta = line.isReturn ? -Number(line.qty) : Number(line.qty);
      ops.push(prisma.itemStock.updateMany({
        where: { itemId: line.itemId, branchId: invoice.branchId },
        data: { qty: { increment: delta } },
      }));
    }
    ops.push(prisma.ledgerEntry.deleteMany({ where: { invoiceId: id } }));
    ops.push(prisma.accountEntry.deleteMany({ where: { invoiceId: id } }));
    ops.push(...await buildPlanTeardownOps({ invoiceId: id }));
  } else {
    for (const line of invoice.items) {
      const delta = line.isReturn ? Number(line.qty) : -Number(line.qty);
      ops.push(prisma.itemStock.updateMany({
        where: { itemId: line.itemId, branchId: invoice.branchId },
        data: { qty: { increment: delta } },
      }));
    }
    ops.push(prisma.ledgerEntry.create({
      data: {
        branchId: invoice.branchId,
        partyId: invoice.partyId,
        type: "SALE",
        ...computeSaleLedgerSplit(
          Number(invoice.netBill),
          Number(invoice.cashReceived) + Number(invoice.cardAmount) + Number(invoice.bankAmount)
        ),
        reference: `INV-${invoice.invoiceNo}`,
        invoiceId: invoice.id,
        notes: `Sale Invoice #${invoice.invoiceNo}`,
      },
    }));
    ops.push(...await buildSaleAccountEntryOps({
      branchId: invoice.branchId, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo,
      partyId: invoice.partyId, netBill: Number(invoice.netBill),
      cashReceived: Number(invoice.cashReceived), bankAmount: Number(invoice.bankAmount),
      bankAccountId: invoice.bankAccountId, cardAmount: Number(invoice.cardAmount),
    }));
    // Rebuilt from the invoice's own stored repayment settings, the same way
    // the ledger and account entries above are rebuilt. Note that collections
    // taken before the void are not re-applied to the fresh schedule - that
    // money stays on the party's ledger as a recovery, so their balance is
    // still right, but the new schedule starts from zero paid.
    ops.push(...buildPlanOps({
      branchId: invoice.branchId,
      partyId: invoice.partyId,
      invoiceId: invoice.id,
      repaymentType: invoice.repaymentType,
      periods: invoice.installmentPeriods,
      promiseDays: invoice.promiseDays,
      netBill: Number(invoice.netBill),
      creditApplied: Number(invoice.creditApplied),
      paidNow: Number(invoice.cashReceived) + Number(invoice.cardAmount) + Number(invoice.bankAmount),
      startDate: invoice.date,
    }));
  }
  ops.push(prisma.saleInvoice.update({ where: { id }, data: { status } }));

  const results = await prisma.$transaction(ops);
  const updated = results[results.length - 1];

  return NextResponse.json({ id: updated.id, status: updated.status });
}

/**
 * DELETE /api/sales/:id
 *
 * Permanently removes an invoice. Reverses its stock effect (unless it was
 * already VOIDED, in which case that reversal already happened) and deletes
 * its ledger entries before deleting the invoice itself.
 *
 * Recoveries collected against the invoice survive, as they do on a void — the
 * `Recovery.invoiceId` FK is ON DELETE SET NULL, so they simply lose the link
 * and stay on the party's ledger as money received.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("DELETE_INVOICE");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: { items: true, refunds: { select: { invoiceNo: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // Same reason as the void guard above — and deleting the *refund* is the
  // supported way to undo one, which this route handles like any other invoice:
  // its mirrored lines reverse, putting the goods back out and the money back in.
  if (invoice.refunds.length > 0) {
    return NextResponse.json(
      { error: `This invoice was refunded by INV-${invoice.refunds[0].invoiceNo}. Delete that refund first.` },
      { status: 400 }
    );
  }

  const ops: any[] = [];
  if (invoice.status !== "VOIDED") {
    for (const line of invoice.items) {
      const delta = line.isReturn ? -Number(line.qty) : Number(line.qty);
      ops.push(prisma.itemStock.updateMany({
        where: { itemId: line.itemId, branchId: invoice.branchId },
        data: { qty: { increment: delta } },
      }));
    }
  }
  ops.push(prisma.ledgerEntry.deleteMany({ where: { invoiceId: id } }));
  ops.push(prisma.accountEntry.deleteMany({ where: { invoiceId: id } }));
  // Must precede the invoice delete: InstallmentPlan.invoiceId is a FK.
  ops.push(...await buildPlanTeardownOps({ invoiceId: id }));
  ops.push(prisma.saleInvoice.delete({ where: { id } }));

  await prisma.$transaction(ops);

  return NextResponse.json({ success: true });
}
