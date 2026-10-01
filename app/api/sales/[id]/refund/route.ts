import { prisma } from "@/lib/prisma";
import { buildSaleAccountEntryOps } from "@/lib/accounts";
import { computeSaleLedgerSplit } from "@/lib/utils";
import { buildPlanTeardownOps } from "@/lib/repayment-plan";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { invoiceRefundable } from "@/lib/invoice-settlement";
import { randomUUID } from "crypto";

/** Cent-level tolerance, matching lib/invoice-settlement.ts. */
const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POST /api/sales/:id/refund
 * Body: { amount?, paymentMethod: "CASH" | "BANK", accountId?, date?, notes? }
 *
 * Refunds a whole order: the goods come back on the shelf and the customer is
 * paid out.
 *
 * **This creates a second invoice rather than editing the first.** The refund
 * is its own net-return invoice — every line of the original copied with
 * `isReturn` flipped, `netBill` the exact negative of the sale's — linked back
 * through `refundOfInvoiceId`. Reversing the original in place would have been
 * one row less to read, but it would also date today's cash payout to the day
 * of the sale (the cash report groups invoice money by `invoice.date`, see
 * app/api/reports/cash/route.ts) and erase the fact that the sale happened at
 * all. This is the same shape as a net-return invoice rung up at the counter,
 * so `buildSaleAccountEntryOps` and `computeSaleLedgerSplit` already do the
 * right thing with it — see docs/sales-checkout.md's refund-correctness notes.
 *
 * How the money lands:
 * - **Stock** — each mirrored line moves the opposite way, so the pair of
 *   invoices nets to no stock movement at all.
 * - **Cash/bank** — the payout posts `SALE_REFUND` account entries (credit =
 *   money out) dated when the refund is given, not when the sale was made.
 * - **Party ledger** — one `SALE_RETURN` row, `debit = −netBill + payout`. That
 *   is what makes every case come out right without special-casing: a sale paid
 *   in full and refunded in full nets to 0; an unpaid credit sale refunded with
 *   no payout cancels its debt exactly; a sale part-settled with store credit
 *   refunds the *money* and hands the credit back as credit.
 * - **Installments** — any plan on the original is torn down; there is nothing
 *   left to collect. Collections already taken stay on the party's ledger (they
 *   carry `recoveryId`, never `invoiceId`) and are counted in `refundable`
 *   below, so the customer is paid back for them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // PROCESS_SALE_RETURN has existed in lib/permissions.ts since before there
  // was anything to gate with it; this is that feature.
  const gate = await requirePermission("PROCESS_SALE_RETURN");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { paymentMethod = "CASH", accountId, date, notes } = body ?? {};

  if (paymentMethod !== "CASH" && paymentMethod !== "BANK") {
    return NextResponse.json({ error: "paymentMethod must be CASH or BANK" }, { status: 400 });
  }

  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: {
      items: true,
      refunds: { select: { id: true, invoiceNo: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (invoice.status !== "SAVED") {
    return NextResponse.json(
      { error: "Only an active invoice can be refunded. Restore it first." },
      { status: 400 }
    );
  }
  if (invoice.refundOfInvoiceId) {
    return NextResponse.json(
      { error: "This invoice is itself a refund — delete it to undo the refund." },
      { status: 400 }
    );
  }
  if (invoice.refunds.length > 0) {
    return NextResponse.json(
      { error: `Already refunded by INV-${invoice.refunds[0].invoiceNo}` },
      { status: 400 }
    );
  }

  const netBill = Number(invoice.netBill);
  if (netBill <= EPSILON) {
    return NextResponse.json(
      { error: "This invoice is already a return — there is nothing to refund." },
      { status: 400 }
    );
  }

  // What the customer actually handed over: the counter payments plus anything
  // collected against the invoice since (Mark Paid, installment collections).
  // `creditApplied` is deliberately excluded — no money came in for it, and the
  // ledger row below gives that part back as store credit rather than cash.
  const recovered = await prisma.recovery.aggregate({
    where: { invoiceId: id },
    _sum: { amount: true },
  });
  const refundable = invoiceRefundable({
    netBill,
    cashReceived: Number(invoice.cashReceived),
    cardAmount: Number(invoice.cardAmount),
    bankAmount: Number(invoice.bankAmount),
    recovered: Number(recovered._sum.amount ?? 0),
  });

  const payout = body?.amount === undefined || body?.amount === null
    ? refundable
    : round2(Number(body.amount));

  if (!Number.isFinite(payout) || payout < 0) {
    return NextResponse.json({ error: "Enter a valid refund amount" }, { status: 400 });
  }
  if (payout > refundable + EPSILON) {
    return NextResponse.json(
      { error: `The customer paid Rs. ${refundable.toFixed(2)} on this invoice — you cannot refund more than that.` },
      { status: 400 }
    );
  }
  // Without an account the entry is skipped, which would leave the payout on
  // the invoice but in no account balance — the same refusal POST /api/sales
  // makes for a bank amount with no account.
  if (paymentMethod === "BANK" && payout > 0 && !accountId) {
    return NextResponse.json({ error: "Select a bank account for the refund" }, { status: 400 });
  }

  const cashOut = paymentMethod === "CASH" ? payout : 0;
  const bankOut = paymentMethod === "BANK" ? payout : 0;
  const refundDate = date ? new Date(date) : new Date();

  const last = await prisma.saleInvoice.findFirst({
    where: { branchId: invoice.branchId },
    orderBy: { invoiceNo: "desc" },
    select: { invoiceNo: true },
  });
  const invoiceNo = (last?.invoiceNo ?? 0) + 1;
  // Generated up front so the ledger and account rows can reference the invoice
  // without waiting on the create's result — see the note in
  // app/api/sales/route.ts on why this is one sequential-array $transaction.
  const refundId = randomUUID();

  const ops: any[] = [
    prisma.saleInvoice.create({
      data: {
        id: refundId,
        invoiceNo,
        branchId: invoice.branchId,
        partyId: invoice.partyId,
        // Whoever gave the refund, not whoever made the sale. `requirePermission`
        // types its `userId` as possibly empty, and this column is a required FK,
        // so fall back to the sale's own cashier rather than failing the insert.
        userId: gate.userId || invoice.userId,
        date: refundDate,
        partyOption: invoice.partyOption,
        printUrdu: invoice.printUrdu,
        refundOfInvoiceId: invoice.id,
        // The value of the goods coming back sits entirely in `returnAmount`,
        // with `grossSale` left at 0 on purpose: a refund must not inflate the
        // period's gross sales, and the report's Returns total is exactly where
        // this belongs.
        grossSale: 0,
        packageDiscount: 0,
        saleAmount: 0,
        returnAmount: netBill,
        adjustment: 0,
        adjustType: "sub",
        slipAmount: -netBill,
        courierCharges: 0,
        netBill: -netBill,
        // On a net-return invoice these fields mean money paid *out* — the same
        // reading the Sales page gives them when it relabels "Amt Received" to
        // "Refund (Cash)".
        paymentMethod,
        cashReceived: cashOut,
        bankAmount: bankOut,
        bankAccountId: paymentMethod === "BANK" ? accountId : null,
        cardAmount: 0,
        creditApplied: 0,
        change: 0,
        repaymentType: "NONE",
        // Unit totals mirror too, so the report's returned-quantity figures
        // pick the goods back up.
        soldPcs: invoice.returnPcs,
        soldGaz: invoice.returnGaz,
        soldMtr: invoice.returnMtr,
        returnPcs: invoice.soldPcs,
        returnGaz: invoice.soldGaz,
        returnMtr: invoice.soldMtr,
        scannedCount: invoice.items.length,
        status: "SAVED",
        syncStatus: "SYNCED",
        notes: notes?.trim()
          ? `Refund of INV-${invoice.invoiceNo} — ${notes.trim()}`
          : `Refund of INV-${invoice.invoiceNo}`,
        items: {
          create: invoice.items.map((line) => ({
            itemId: line.itemId,
            isReturn: !line.isReturn,
            qty: line.qty,
            pcs: line.pcs,
            gaz: line.gaz,
            mtr: line.mtr,
            rate: line.rate,
            disRS: line.disRS,
            disPct: line.disPct,
            amount: line.amount,
          })),
        },
      },
    }),
  ];

  // Mirrored lines move stock the opposite way to the sale: a sold line comes
  // back in, a line the customer had returned goes back out.
  for (const line of invoice.items) {
    const delta = line.isReturn ? -Number(line.qty) : Number(line.qty);
    ops.push(prisma.itemStock.updateMany({
      where: { itemId: line.itemId, branchId: invoice.branchId },
      data: { qty: { increment: delta } },
    }));
  }

  ops.push(prisma.ledgerEntry.create({
    data: {
      branchId: invoice.branchId,
      partyId: invoice.partyId,
      date: refundDate,
      // Finally writes a ledger type the schema has always defined and nothing
      // ever produced (the Ledger page has rendered it as "Sale Return" all
      // along) — a refund is not a sale and shouldn't read as one.
      type: "SALE_RETURN",
      ...computeSaleLedgerSplit(-netBill, payout),
      reference: `INV-${invoiceNo}`,
      invoiceId: refundId,
      notes: `Refund of Sale Invoice #${invoice.invoiceNo}`,
    },
  }));

  ops.push(...await buildSaleAccountEntryOps({
    branchId: invoice.branchId,
    invoiceId: refundId,
    invoiceNo,
    partyId: invoice.partyId,
    netBill: -netBill,
    cashReceived: cashOut,
    bankAmount: bankOut,
    bankAccountId: paymentMethod === "BANK" ? accountId : null,
    cardAmount: 0,
  }));

  // Nothing is left to collect on a refunded order. Collections already taken
  // are untouched — they're real money that changed hands, and `refundable`
  // above already counted them so they get paid back.
  ops.push(...await buildPlanTeardownOps({ invoiceId: invoice.id }));

  const [refund] = await prisma.$transaction(ops);

  return NextResponse.json({
    id: refund.id,
    invoiceNo: refund.invoiceNo,
    refundOfInvoiceNo: invoice.invoiceNo,
    payout,
    refundable,
    storeCredit: round2(refundable - payout + Number(invoice.creditApplied)),
  }, { status: 201 });
}
