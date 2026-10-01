import { prisma } from "@/lib/prisma";
import { buildSaleAccountEntryOps } from "@/lib/accounts";
import { getPartyBalance, validateCreditApplied } from "@/lib/party-balance";
import { saleValidationMessage, validateSalePayment } from "@/lib/sale-validation";
import { buildPlanOps, validateRepaymentPlan } from "@/lib/repayment-plan";
import { moneyKeptFromTender, computeSaleLedgerSplit } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const status = searchParams.get("status");
  const limit = Number(searchParams.get("limit") ?? "50");

  const where: any = {};
  if (branchId) where.branchId = branchId;
  if (status) where.status = status;

  const invoices = await prisma.saleInvoice.findMany({
    where,
    include: {
      party: { select: { name: true, accountId: true } },
      items: { include: { item: { select: { name: true, unit: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("CREATE_INVOICE");
  if (!gate.ok) return gate.response;

  const body = await req.json();

  const {
    branchId, userId, partyId, partyOption, printUrdu, promiseDays,
    lines, packageDiscount, adjustment, adjustType, courierCharges,
    cardAmount, cashReceived,
    paymentMethod, bankAccountId, bankAmount, creditApplied,
    repaymentType, installmentPeriods,
    grossSale, saleAmount, returnAmount, slipAmount, netBill, change,
    soldPcs, soldGaz, soldMtr, returnPcs, returnGaz, returnMtr,
    notes,
  } = body;

  // Spending a customer's store credit writes off part of a bill with no money
  // changing hands, so it carries its own permission on top of CREATE_INVOICE —
  // only checked when credit is actually being applied, so an ordinary sale
  // needs nothing extra.
  if (Number(creditApplied ?? 0) > 0) {
    const creditGate = await requirePermission("APPLY_STORE_CREDIT");
    if (!creditGate.ok) return creditGate.response;
  }

  // Same pattern for the two discount channels: only checked when a line or
  // the bill actually carries one, so a stale tab or a hand-rolled request
  // can't grant a discount the checkout screen would not have offered.
  if ((lines as Array<{ disRS?: number; disPct?: number }> | undefined)?.some(
    (l) => Number(l.disRS ?? 0) > 0 || Number(l.disPct ?? 0) > 0
  )) {
    const discountGate = await requirePermission("APPLY_ITEM_DISCOUNT");
    if (!discountGate.ok) return discountGate.response;
  }
  if (Number(packageDiscount ?? 0) > 0) {
    const packageGate = await requirePermission("APPLY_PACKAGE_DISCOUNT");
    if (!packageGate.ok) return packageGate.response;
  }

  // Store credit is the one payment channel that moves value with no matching
  // cash movement, so it is re-derived from the party's live ledger instead of
  // being taken on the client's word (see lib/party-balance.ts).
  const creditCheck = await validateCreditApplied({
    partyId, branchId, netBill, creditApplied: Number(creditApplied ?? 0),
  });
  if (!creditCheck.ok) {
    return NextResponse.json({ error: creditCheck.error }, { status: 400 });
  }

  // Payment-completeness and price-tier-vs-settlement rules, from the same
  // pure module the checkout screen blocks Save with (lib/sale-validation.ts),
  // so a stale tab or a hand-rolled request can't write an invoice the UI
  // would have refused. Notably this is what stops a credit sale being parked
  // on the shared walking customer, where the debt belongs to nobody.
  const sellingParty = await getPartyBalance(partyId, branchId);
  if (!sellingParty) {
    return NextResponse.json({ error: "Party not found" }, { status: 400 });
  }
  const paidAtTill =
    Number(cashReceived ?? 0) + Number(cardAmount ?? 0) + Number(bankAmount ?? 0);
  const paymentIssue = validateSalePayment({
    partyOption,
    paymentMethod: paymentMethod ?? "CASH",
    netBill: Number(netBill ?? 0),
    outstanding: Math.max(
      0,
      Number(netBill ?? 0) - Number(creditCheck.creditApplied ?? 0) - paidAtTill
    ),
    cashReceived: Number(cashReceived ?? 0),
    bankAmount: Number(bankAmount ?? 0),
    bankAccountId,
    isWalkingCustomer: sellingParty.isDefault,
    isRefund: Number(netBill ?? 0) < 0,
  });
  if (paymentIssue) {
    return NextResponse.json({ error: saleValidationMessage(paymentIssue) }, { status: 400 });
  }

  const planCheck = validateRepaymentPlan({ repaymentType, installmentPeriods, promiseDays });
  if (!planCheck.ok) {
    return NextResponse.json({ error: planCheck.error }, { status: 400 });
  }

  // The client sends what the customer *handed over* on each channel; change
  // handed back is not the store's money. Netting it here (rather than at each
  // of the call sites below) means the `cashReceived`/`bankAmount`/`cardAmount`
  // columns never store a tender, so every reader of them — reports, dashboard,
  // settlement status, restore — is correct without knowing this rule exists.
  // The netting spans all three channels because `change` is derived from all
  // three: taking it off cash alone let a card/bank overpayment reach the
  // ledger in full and credit the customer a balance worth the change.
  const { cashKept, bankKept, cardKept, totalKept: paidNow } = moneyKeptFromTender({
    netBill: Number(netBill ?? 0),
    cardAmount: Number(cardAmount ?? 0),
    cashReceived: Number(cashReceived ?? 0),
    bankAmount: Number(bankAmount ?? 0),
    change: Number(change ?? 0),
  });

  /** Just the shape this route reads off an incoming invoice line. */
  type SaleLineInput = { itemId: string; qty?: number; isReturn?: boolean };

  // ── Over-selling ───────────────────────────────────────────────────────────
  // The sales screen already caps each quantity box at what is on the shelf,
  // but a cap that lives only in the browser is not a cap: a stale tab, a
  // resumed held invoice priced against older stock, or a hand-rolled request
  // all get past it. Re-checked here for the same reason `validateSalePayment`
  // runs in both places.
  //
  // Only rows that **exist** are enforced. An item with no `ItemStock` row for
  // this branch is not "zero in stock", it is "stock never tracked here" —
  // blocking on that would stop every sale in a second branch. That gap is the
  // known `updateMany` issue written up at the end of docs/items.md; it is not
  // this guard's to close, and guessing here would turn a silent accounting
  // hole into a till that refuses to sell.
  const saleLines: SaleLineInput[] = (lines ?? []).filter(
    (l: SaleLineInput) => l.itemId && !l.isReturn
  );
  if (saleLines.length > 0) {
    const wanted = new Map<string, number>();
    for (const l of saleLines) {
      wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + Number(l.qty ?? 0));
    }
    const stocks = await prisma.itemStock.findMany({
      where: { branchId, itemId: { in: [...wanted.keys()] } },
      select: { itemId: true, qty: true, item: { select: { name: true, unit: true } } },
    });
    for (const row of stocks) {
      const need = wanted.get(row.itemId) ?? 0;
      const have = Number(row.qty);
      // A hair of tolerance: a converted quantity can land a ten-thousandth
      // over the shelf figure through rounding, and refusing a sale over
      // 0.0001 of a gaz would be absurd.
      if (need > have + 0.0001) {
        return NextResponse.json(
          {
            error: `Not enough stock for ${row.item.name}: ${have} ${row.item.unit} available, ${need} requested`,
            itemId: row.itemId,
          },
          { status: 400 }
        );
      }
    }
  }

  // Get next invoice number
  const last = await prisma.saleInvoice.findFirst({
    where: { branchId },
    orderBy: { invoiceNo: "desc" },
    select: { invoiceNo: true },
  });
  const invoiceNo = (last?.invoiceNo ?? 0) + 1;
  // Generated up front so the ledger entry below can reference it without
  // needing the invoice create's result — see note below on why.
  const invoiceId = randomUUID();

  // NOTE: this uses Prisma's sequential-array $transaction([...]) form, not the
  // interactive callback form (`$transaction(async (tx) => ...)`). The callback
  // form needs to hold one DB connection open across multiple round trips, which
  // breaks with "Transaction not found" (P2028) against Supabase's pooled
  // connection (pgbouncer in transaction mode) — the pooler can hand the
  // connection to someone else between statements. The array form sends
  // everything as one batch, which pgbouncer's transaction pooling supports.
  const ops = [
    prisma.saleInvoice.create({
      data: {
        id: invoiceId,
        invoiceNo,
        branchId,
        partyId,
        userId,
        partyOption,
        printUrdu: printUrdu ?? false,
        promiseDays: promiseDays || null,
        packageDiscount,
        adjustment,
        adjustType,
        courierCharges,
        cardAmount: cardKept,
        cashReceived: cashKept,
        paymentMethod: paymentMethod ?? "CASH",
        bankAccountId: bankAccountId || null,
        bankAmount: bankKept,
        creditApplied: creditCheck.creditApplied,
        repaymentType: planCheck.repaymentType,
        installmentPeriods: planCheck.periods,
        grossSale,
        saleAmount,
        returnAmount,
        slipAmount,
        netBill,
        change,
        soldPcs,
        soldGaz,
        soldMtr,
        returnPcs,
        returnGaz,
        returnMtr,
        scannedCount: lines.length,
        notes: notes?.trim() || null,
        status: "SAVED",
        // This write already went straight to the real database (there's no
        // local offline queue in this app yet — see PROJECT_SCOPE.md), so the
        // record is synced the moment this succeeds. Marking it PENDING here
        // left it stuck forever since nothing but a genuine online-reconnect
        // event or a manual click on the sync badge ever flips it.
        syncStatus: "SYNCED",
        items: {
          create: lines.map((l: any) => ({
            itemId: l.itemId,
            isReturn: l.isReturn,
            qty: l.qty,
            pcs: l.unit === "PCS" ? l.qty : 0,
            gaz: l.unit === "GAZ" ? l.qty : 0,
            mtr: l.unit === "MTR" ? l.qty : 0,
            rate: l.rate,
            disRS: l.disRS,
            disPct: l.disPct,
            amount: l.amount,
          })),
        },
      },
    }),
    ...lines.map((line: any) => {
      const delta = line.isReturn ? line.qty : -line.qty;
      return prisma.itemStock.updateMany({
        where: { itemId: line.itemId, branchId },
        data: { qty: { increment: delta } },
      });
    }),
    // `creditApplied` is deliberately absent from the credit side here. The
    // customer's store credit already exists in this ledger as a negative
    // balance, so billing the full `netBill` as debit is itself what consumes
    // it — a customer holding 450 credit who buys 1000 and pays 550 cash nets
    // out to exactly 0. Adding the 450 to the credit side as well would leave
    // the balance at −450 and hand the credit back to them a second time.
    prisma.ledgerEntry.create({
      data: {
        branchId,
        partyId,
        type: "SALE",
        ...computeSaleLedgerSplit(netBill, paidNow),
        reference: `INV-${invoiceNo}`,
        invoiceId,
        notes: `Sale Invoice #${invoiceNo}`,
      },
    }),
  ];

  ops.push(...await buildSaleAccountEntryOps({
    branchId, invoiceId, invoiceNo, partyId, netBill,
    cashReceived: cashKept, bankAmount: bankKept, bankAccountId, cardAmount: cardKept,
  }));

  // An installment plan is only generated for what's actually left owing after
  // credit and counter payments - a fully settled invoice has nothing to
  // finance, however the repayment selector was left.
  ops.push(...buildPlanOps({
    branchId, partyId, invoiceId,
    repaymentType: planCheck.repaymentType,
    periods: planCheck.periods,
    promiseDays,
    netBill,
    creditApplied: creditCheck.creditApplied,
    paidNow,
  }));

  const [invoice] = await prisma.$transaction(ops);

  return NextResponse.json({ invoiceNo: invoice.invoiceNo, id: invoice.id }, { status: 201 });
}
