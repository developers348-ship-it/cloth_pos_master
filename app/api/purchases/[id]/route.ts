import { prisma } from "@/lib/prisma";
import { buildGrnAccountEntryOps, validateGrnPayment } from "@/lib/accounts";
import { buildPlanOps, buildPlanTeardownOps, validateRepaymentPlan } from "@/lib/repayment-plan";
import { computePurchaseLedgerSplit } from "@/lib/utils";
import { grnOutstanding, grnPaymentStatus, grnSettledAmount } from "@/lib/grn-settlement";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * GET /api/purchases/:id
 *
 * One GRN in full. Two callers, one shape:
 * - the **GRN form** on the Purchases screen, which loads a saved GRN back into
 *   its fields for editing (it reads the raw columns and `items`);
 * - the **GRN detail page** (`/dashboard/purchases/:id`) and its printed
 *   document, which additionally need who received it, which bank account the
 *   money left, the vendor's contact block and running balance, the payments
 *   made against the bill since, and the repayment schedule.
 *
 * The extra blocks are additive — every raw column the form reads is still
 * spread at the top level — so one fetch serves both and the two can't drift on
 * what a field means. `GET /api/reports/purchases` deliberately carries only
 * what its columns show; loading all of this for a thousand rows to read one is
 * the reason the document is a lookup by id.
 *
 * Read-only, so no permission gate — see the note in lib/authz.ts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: {
      party: true,
      user: { select: { name: true } },
      bankAccount: { select: { name: true, type: true } },
      items: {
        include: {
          item: {
            select: { id: true, name: true, unit: true, purchaseUnit: true, piecesPerBundle: true, barcode: true, systemBarcode: true, salePrice: true, purchasePrice: true },
          },
        },
      },
      // Money paid to the vendor against *this* bill since it was received —
      // through its installment plan, and (since `Payment.grnId`) through the
      // Ledger page's Payment tab. See lib/grn-settlement.ts.
      installmentPlan: {
        include: {
          installments: {
            orderBy: { seq: "asc" },
            include: { payment: { include: { account: { select: { name: true } } } } },
          },
        },
      },
      // Ledger-page payments booked directly against this bill.
      payments: { include: { account: { select: { name: true } } } },
    },
  });

  if (!grn) return NextResponse.json({ error: "GRN not found" }, { status: 404 });

  // The vendor's balance **as at this GRN**, not as of today — the same replay
  // the sale invoice does (app/api/sales/[id]/route.ts) and for the same
  // reason: a document that prints "previous balance" has to mean the balance
  // before *this* bill, or reprinting an old GRN shows a figure that has moved
  // since and the paper stops adding up (previous + this bill != closing).
  //
  // Rows are ordered on (date, createdAt) and split at this GRN's own first
  // row; createdAt is what keeps two same-day GRNs in the order they were
  // entered. A GRN with no ledger row of its own (netBill 0 and nothing paid
  // writes none) has nothing to anchor on, so the split falls back to its date.
  const partyLedger = await prisma.ledgerEntry.findMany({
    where: { branchId: grn.branchId, partyId: grn.partyId },
    select: { date: true, createdAt: true, debit: true, credit: true, grnId: true },
  });
  const sortKey = (e: { date: Date; createdAt: Date }) =>
    `${e.date.toISOString()}|${e.createdAt.toISOString()}`;
  const ownKeys = partyLedger.filter((e) => e.grnId === grn.id).map(sortKey).sort();
  const ownKey: string | null = ownKeys[0] ?? null;

  // `credit - debit`, the opposite way round from the customer side, because a
  // vendor balance is a **payable**: a purchase writes `credit: netBill` (we
  // now owe it) and a payment writes the debit that clears it, so this way a
  // positive figure means "we owe the vendor this much" and the document can
  // print it under that label without a sign flip.
  //
  // It is the rest of the app's `opening + debit - credit` negated.
  // `Party.previousBalance` is stored in that app-wide sign (negative = we owe
  // the party, see lib/party-balance.ts), so it is negated here too: an opening
  // payable of Rs. 50,000 is stored as -50000 and prints as 50,000 owed.
  const opening = -Number(grn.party.previousBalance ?? 0);
  let balanceBefore = opening;
  let balanceAfter = opening;
  for (const e of partyLedger) {
    const delta = Number(e.credit) - Number(e.debit);
    if (e.grnId === grn.id) {
      balanceAfter += delta;
      continue;
    }
    if (ownKey === null ? e.date < grn.date : sortKey(e) < ownKey) {
      balanceBefore += delta;
      balanceAfter += delta;
    }
  }

  const installments = grn.installmentPlan?.installments ?? [];

  // One row per Payment, not per installment: a single payment can settle
  // several installments at once (`applyCollectionToInstallments` walks the
  // schedule from seq 1), and what the document lists is the money that moved.
  const paymentsById = new Map<string, {
    id: string; date: Date; amount: number; paymentMethod: string;
    accountName: string | null; notes: string | null;
  }>();
  for (const inst of installments) {
    const p = inst.payment;
    if (!p || paymentsById.has(p.id)) continue;
    paymentsById.set(p.id, {
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      accountName: p.account?.name ?? p.bankName ?? null,
      notes: p.notes,
    });
  }
  // Payments made straight against this bill (not through its schedule). The
  // same Map dedupes them, so a payment that also settled installments is
  // listed once.
  for (const p of grn.payments) {
    if (paymentsById.has(p.id)) continue;
    paymentsById.set(p.id, {
      id: p.id,
      date: p.date,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      accountName: p.account?.name ?? p.bankName ?? null,
      notes: p.notes,
    });
  }

  const payments = [...paymentsById.values()].sort((a, b) => +a.date - +b.date);

  const settlement = {
    netBill: Number(grn.netBill),
    cashPaid: Number(grn.cashAmount),
    bankPaid: Number(grn.bankAmount),
    collected: installments.reduce((s, i) => s + Number(i.paidAmount), 0),
    // Only payments carrying this GRN's id — a payment against the vendor's
    // balance as a whole belongs to no single bill and stays out of this.
    paid: grn.payments.reduce((s, p) => s + Number(p.amount), 0),
  };

  return NextResponse.json({
    grn: {
      // Every raw column, so the GRN form's loader keeps working unchanged.
      ...grn,

      receivedBy: grn.user?.name ?? null,
      bankAccountName: grn.bankAccount?.name ?? null,

      vendor: {
        id: grn.party.id,
        accountId: grn.party.accountId,
        name: grn.party.name,
        type: grn.party.type,
        phone: grn.party.phone,
        mobile: grn.party.mobile,
        address: grn.party.address,
        city: grn.party.city,
        /** As at this GRN, not as of today — see the replay note above. */
        balanceBefore,
        balanceAfter,
      },

      lines: grn.items.map((gi) => ({
        id: gi.id,
        itemId: gi.itemId,
        name: gi.item.name,
        unit: gi.item.unit,
        barcode: gi.item.barcode,
        systemBarcode: gi.item.systemBarcode,
        isReturn: gi.type === "RETURN",
        qty: Number(gi.qty),
        costRate: Number(gi.costRate),
        saleRate: Number(gi.saleRate),
        disPct: Number(gi.disPct),
        amount: Number(gi.amount),
      })),

      totals: {
        saleAmount: Number(grn.saleAmount),
        billAmount: Number(grn.billAmount),
        returnAmount: Number(grn.returnAmount),
        discountPct: Number(grn.discountPct),
        adjustment: Number(grn.adjustment),
        netBill: Number(grn.netBill),
        totalPurchaseQty: Number(grn.totalPurchaseQty),
        totalReturnQty: Number(grn.totalReturnQty),
      },

      payment: {
        method: grn.paymentMethod,
        cashPaid: settlement.cashPaid,
        bankPaid: settlement.bankPaid,
        collected: settlement.collected,
        paid: settlement.paid,
        settled: grnSettledAmount(settlement),
        outstanding: grnOutstanding(settlement),
        status: grnPaymentStatus(settlement),
      },

      payments,

      plan: grn.installmentPlan
        ? {
            id: grn.installmentPlan.id,
            kind: grn.installmentPlan.kind,
            principal: Number(grn.installmentPlan.principal),
            periods: grn.installmentPlan.periods,
            startDate: grn.installmentPlan.startDate,
            installments: installments.map((i) => ({
              seq: i.seq,
              dueDate: i.dueDate,
              amount: Number(i.amount),
              paidAmount: Number(i.paidAmount),
              status: i.status,
              paidAt: i.paidAt,
            })),
          }
        : null,
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("EDIT_GRN");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();

  const {
    partyId, billNo, remarks, date, lines,
    saleAmount, billAmount, returnAmount, discountPct,
    adjustment, netBill, totalPurchaseQty, totalReturnQty,
    paymentMethod, cashAmount, bankAmount, bankAccountId,
    repaymentType, installmentPeriods, promiseDays,
    isReturn,
  } = body;

  const payment = validateGrnPayment({
    paymentMethod, cashAmount, bankAmount, bankAccountId, netBill: netBill ?? 0,
  });
  if (!payment.ok) {
    return NextResponse.json({ error: payment.error }, { status: 400 });
  }

  const planCheck = validateRepaymentPlan({ repaymentType, installmentPeriods, promiseDays });
  if (!planCheck.ok) {
    return NextResponse.json({ error: planCheck.error }, { status: 400 });
  }

  const paidNow = payment.cashAmount + payment.bankAmount;

  // Read happens outside the transaction, then everything else is built into a
  // sequential-array $transaction([...]) — see note in app/api/sales/route.ts
  // for why the interactive callback form isn't used (breaks against
  // Supabase's pooler).
  const original = await prisma.gRN.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!original) return NextResponse.json({ error: "GRN not found" }, { status: 404 });

  const ops: any[] = [];

  for (const line of original.items) {
    const wasPurchase = line.type === "PURCHASE";
    const delta = wasPurchase ? -Number(line.qty) : Number(line.qty);
    ops.push(prisma.itemStock.updateMany({
      where: { itemId: line.itemId, branchId: original.branchId },
      data: { qty: { increment: delta } },
    }));
  }

  ops.push(prisma.gRNItem.deleteMany({ where: { grnId: id } }));
  ops.push(prisma.ledgerEntry.deleteMany({ where: { grnId: id } }));
  // An edit re-derives the money side from the new amounts, so the old
  // account entries and installment schedule come out first. Payments already
  // collected against the old schedule are kept — see buildPlanTeardownOps.
  ops.push(prisma.accountEntry.deleteMany({ where: { grnId: id } }));
  ops.push(...await buildPlanTeardownOps({ grnId: id }));

  ops.push(prisma.gRN.update({
    where: { id },
    data: {
      partyId,
      date: date ? new Date(date) : undefined,
      billNo: billNo || null,
      remarks: remarks || null,
      saleAmount: saleAmount ?? 0,
      billAmount: billAmount ?? netBill ?? 0,
      returnAmount: returnAmount ?? 0,
      discountPct: discountPct ?? 0,
      adjustment: adjustment ?? 0,
      netBill: netBill ?? 0,
      totalPurchaseQty: totalPurchaseQty ?? 0,
      totalReturnQty: totalReturnQty ?? 0,
      paymentMethod: payment.paymentMethod,
      cashAmount: payment.cashAmount,
      bankAmount: payment.bankAmount,
      bankAccountId: payment.bankAccountId,
      promiseDays: promiseDays || null,
      repaymentType: planCheck.repaymentType,
      installmentPeriods: planCheck.periods,
      ...(isReturn !== undefined ? { isReturn: !!isReturn } : {}),
      items: {
        create: lines.map((l: any) => ({
          itemId: l.itemId,
          type: l.isReturn ? "RETURN" : "PURCHASE",
          qty: l.qty,
          costRate: l.costRate,
          saleRate: l.saleRate,
          disPct: l.disPct ?? 0,
          amount: l.amount,
        })),
      },
    },
  }));

  for (const line of lines) {
    const isPurchase = !line.isReturn;
    const delta = isPurchase ? line.qty : -line.qty;
    ops.push(prisma.itemStock.upsert({
      where: { itemId_branchId: { itemId: line.itemId, branchId: original.branchId } },
      update: { qty: { increment: delta } },
      create: { itemId: line.itemId, branchId: original.branchId, qty: Math.max(0, delta) },
    }));
  }

  // Same fix as the create path: `!== 0` so a net-return GRN books a
  // PURCHASE_RETURN instead of writing nothing at all.
  if ((netBill ?? 0) !== 0 || paidNow > 0) {
    ops.push(prisma.ledgerEntry.create({
      data: {
        branchId: original.branchId,
        partyId,
        ...computePurchaseLedgerSplit(netBill ?? 0, paidNow),
        reference: "GRN-" + original.grnNo,
        grnId: id,
        notes: (isReturn ?? original.isReturn ? "Purchase Return" : "Purchase") + " GRN #" + original.grnNo + " (edited)",
      },
    }));
  }

  ops.push(...await buildGrnAccountEntryOps({
    branchId: original.branchId, grnId: id, grnNo: original.grnNo, partyId,
    netBill: netBill ?? 0,
    cashAmount: payment.cashAmount, bankAmount: payment.bankAmount,
    bankAccountId: payment.bankAccountId,
  }));

  ops.push(...buildPlanOps({
    branchId: original.branchId, partyId, grnId: id,
    repaymentType: planCheck.repaymentType,
    periods: planCheck.periods,
    promiseDays,
    netBill: netBill ?? 0,
    paidNow,
  }));

  await prisma.$transaction(ops);

  return NextResponse.json({ id, grnNo: original.grnNo });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("DELETE_GRN");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!grn) return NextResponse.json({ error: "GRN not found" }, { status: 404 });

  const ops: any[] = [];
  for (const line of grn.items) {
    const wasPurchase = line.type === "PURCHASE";
    const delta = wasPurchase ? -Number(line.qty) : Number(line.qty);
    ops.push(prisma.itemStock.updateMany({
      where: { itemId: line.itemId, branchId: grn.branchId },
      data: { qty: { increment: delta } },
    }));
  }
  ops.push(prisma.ledgerEntry.deleteMany({ where: { grnId: id } }));
  ops.push(prisma.accountEntry.deleteMany({ where: { grnId: id } }));
  // Must precede the GRN delete: InstallmentPlan.grnId is a FK.
  ops.push(...await buildPlanTeardownOps({ grnId: id }));
  ops.push(prisma.gRN.delete({ where: { id } }));

  await prisma.$transaction(ops);

  return NextResponse.json({ success: true });
}