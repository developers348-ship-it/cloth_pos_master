import { prisma } from "@/lib/prisma";
import { moneyInFromInvoice, shopDayWindow } from "@/lib/utils";
import { invoiceOutstanding, invoicePaymentStatus } from "@/lib/invoice-settlement";
import { summarizePlan } from "@/lib/installments";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/sales?branchId=&from=&to=&partyId=&userId=&paymentStatus=&recordStatus=&q=&page=&pageSize=
 *
 * Returns SaleInvoices with party name, user name, computed columns, and line items.
 * `paymentStatus` (PAID|PARTIAL|UNPAID) filters on the computed payment status.
 * `recordStatus` (ACTIVE|VOIDED|ALL) filters on the invoice's real DB status; defaults to ACTIVE (SAVED only).
 * `q` searches party name and (on an exact numeric match) invoice number.
 *
 * `paymentStatus` and `recovered`/`outstanding` are derived from a join against
 * `Recovery`, not a column, so they can't be pushed into the `where` clause the
 * way the rest of the filters are. To still paginate exactly (page 2 must never
 * skip or repeat a row) and keep the summary tiles correct for the *whole*
 * filtered range rather than just the page on screen, this runs in two passes:
 * a lean, unbounded pass over every matching invoice (no line items, no
 * installment schedule — just the numbers `paymentStatus`/totals need) to work
 * out the exact filtered set and its totals, then one bounded query that fetches
 * the heavy nested data (items, installment plan, refund links) for only the
 * page actually being shown. `all=true` (the CSV export button) skips the
 * bounding on that second pass and fetches the heavy data for every row.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const partyId = searchParams.get("partyId");
  const userId = searchParams.get("userId");
  const paymentStatus = searchParams.get("paymentStatus");
  const recordStatus = searchParams.get("recordStatus") ?? "ACTIVE";
  const q = searchParams.get("q")?.trim();
  const all = searchParams.get("all") === "true";
  const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const where: any = { branchId };
  if (recordStatus === "ACTIVE") where.status = "SAVED";
  else if (recordStatus === "VOIDED") where.status = "VOIDED";
  if (partyId) where.partyId = partyId;
  if (userId) where.userId = userId;
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);
  if (dateWindow) where.date = dateWindow;
  if (q) {
    const asInvoiceNo = /^\d+$/.test(q) ? Number(q) : undefined;
    where.OR = [
      { party: { name: { contains: q, mode: "insensitive" } } },
      ...(asInvoiceNo !== undefined ? [{ invoiceNo: asInvoiceNo }] : []),
    ];
  }

  // Pass 1 — every matching invoice, lean fields only.
  const leanInvoices = await prisma.saleInvoice.findMany({
    where,
    select: {
      id: true, invoiceNo: true, date: true, partyId: true, partyOption: true,
      status: true, grossSale: true, packageDiscount: true, returnAmount: true,
      netBill: true, cashReceived: true, cardAmount: true, bankAmount: true,
      creditApplied: true,
      // Cost of goods, for the Profit total/column — see the comment on
      // `computed` below. Same shape as app/api/reports/dashboard/route.ts:
      // no cost snapshot on a sale line, so this is valued at the item's
      // *current* purchasePrice, not what it was bought at.
      items: {
        select: { qty: true, isReturn: true, item: { select: { purchasePrice: true } } },
      },
    },
    orderBy: { date: "desc" },
  });

  // Money collected against these invoices after the sale — Mark Paid payments
  // and installment collections both carry the invoice's id (see
  // lib/accounts.ts `buildSettlementOps`). One query for the whole set rather
  // than a per-row lookup; `accountEntries.installmentId` is what separates a
  // Mark Paid recovery (undoable here, via Mark Unpaid) from a collection taken
  // in the Installments tab (reversed from there).
  const recoveries = leanInvoices.length === 0 ? [] : await prisma.recovery.findMany({
    where: { invoiceId: { in: leanInvoices.map((i) => i.id) } },
    select: {
      invoiceId: true, amount: true,
      accountEntries: { select: { installmentId: true } },
    },
  });

  const recoveredByInvoice = new Map<string, { total: number; markPaid: number }>();
  for (const rec of recoveries) {
    if (!rec.invoiceId) continue;
    const bucket = recoveredByInvoice.get(rec.invoiceId) ?? { total: 0, markPaid: 0 };
    const amount = Number(rec.amount);
    bucket.total += amount;
    if (rec.accountEntries.length > 0 && rec.accountEntries.every((e) => !e.installmentId)) {
      bucket.markPaid += amount;
    }
    recoveredByInvoice.set(rec.invoiceId, bucket);
  }

  // On a net-return invoice money is paid *out* — see `moneyInFromInvoice`.
  const moneyIn = moneyInFromInvoice;

  let computed = leanInvoices.map((inv) => {
    const recovered = recoveredByInvoice.get(inv.id) ?? { total: 0, markPaid: 0 };
    const settlement = {
      netBill: Number(inv.netBill),
      creditApplied: Number(inv.creditApplied),
      cashReceived: Number(inv.cashReceived),
      cardAmount: Number(inv.cardAmount),
      bankAmount: Number(inv.bankAmount),
      recovered: recovered.total,
    };
    const outstanding = invoiceOutstanding(settlement);
    // A returned line's goods are back on the shelf, so its cost is credited
    // back — the same netting the revenue side already does via returnAmount.
    const cogs = inv.items.reduce((sum, line) => {
      const cost = Number(line.qty) * Number(line.item.purchasePrice);
      return sum + (line.isReturn ? -cost : cost);
    }, 0);
    return {
      id: inv.id,
      grossSale: Number(inv.grossSale),
      packageDiscount: Number(inv.packageDiscount),
      returnAmount: Number(inv.returnAmount),
      netBill: settlement.netBill,
      cashReceived: settlement.cashReceived,
      cardAmount: settlement.cardAmount,
      recovered: recovered.total,
      recoveredMarkPaid: recovered.markPaid,
      outstanding,
      cogs,
      profit: settlement.netBill - cogs,
      paymentStatus: invoicePaymentStatus(settlement),
    };
  });

  if (paymentStatus) {
    computed = computed.filter((r) => r.paymentStatus === paymentStatus);
  }

  const total = computed.length;
  const totals = {
    invoiceCount: total,
    grossSale: computed.reduce((s, r) => s + r.grossSale, 0),
    packageDiscount: computed.reduce((s, r) => s + r.packageDiscount, 0),
    returnAmount: computed.reduce((s, r) => s + r.returnAmount, 0),
    netBill: computed.reduce((s, r) => s + r.netBill, 0),
    cashReceived: computed.reduce((s, r) => s + moneyIn(r.netBill, r.cashReceived), 0),
    cardAmount: computed.reduce((s, r) => s + moneyIn(r.netBill, r.cardAmount), 0),
    recovered: computed.reduce((s, r) => s + r.recovered, 0),
    outstanding: computed.reduce((s, r) => s + r.outstanding, 0),
    cogs: computed.reduce((s, r) => s + r.cogs, 0),
    profit: computed.reduce((s, r) => s + r.profit, 0),
  };

  // Pass 2 — heavy nested data, only for the invoices actually being shown.
  const pageComputed = all ? computed : computed.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const pageIds = pageComputed.map((r) => r.id);

  // `select`, not `include`: SaleInvoice carries ~40 columns (the unit totals,
  // the offline-sync bookkeeping, notes) and the list uses a third of them.
  const heavy = pageIds.length === 0 ? [] : await prisma.saleInvoice.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true, invoiceNo: true, date: true, partyId: true, partyOption: true,
      status: true, bankAmount: true, creditApplied: true,
      // What the customer handed back in change — stored since the very first
      // migration, independent of the cashReceived/bankAmount/cardAmount
      // netting fix (2026-09-11). Surfaced so a tendered amount larger than
      // the invoice's settled total reads as "change was given", not as an
      // unexplained mismatch — see docs/orders.md's Cash Received note.
      change: true,
      party: { select: { name: true, accountId: true } },
      user: { select: { name: true } },
      items: {
        select: {
          qty: true, isReturn: true, rate: true, amount: true,
          item: { select: { name: true, unit: true } },
        },
      },
      // The plan itself, not just whether one exists: the row shows its kind
      // (Promise Day / Weekly / Monthly) and next due date, so the repayment
      // arrangement is visible where the invoice is, not only in the Ledger
      // page's Installments tab.
      installmentPlan: {
        select: {
          id: true, kind: true, periods: true,
          installments: { select: { seq: true, dueDate: true, amount: true, paidAmount: true, status: true } },
        },
      },
      // Both directions of the refund link: `refundOf` is set on the net-return
      // invoice a refund created, `refunds` on the sale that was refunded. The
      // list tags each side from these (see app/api/sales/[id]/refund/route.ts).
      refundOf: { select: { invoiceNo: true } },
      refunds: { select: { invoiceNo: true }, take: 1 },
    },
  });
  const heavyById = new Map(heavy.map((h) => [h.id, h]));

  // `pageComputed` (not `heavy`) sets the order — `id: { in }` doesn't
  // guarantee one, and the derived settlement fields from pass 1 have to be
  // merged back onto the invoice they belong to either way.
  const rows = pageComputed.map((c) => {
    const inv = heavyById.get(c.id)!;
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      date: inv.date,
      partyId: inv.partyId,
      partyName: inv.party.name,
      accountId: inv.party.accountId,
      cashier: inv.user?.name ?? "—",
      partyOption: inv.partyOption,
      itemCount: inv.items.filter((i) => !i.isReturn).length,
      items: inv.items.map((i) => ({
        name: i.item.name,
        unit: i.item.unit,
        qty: Number(i.qty),
        rate: Number(i.rate),
        amount: Number(i.amount),
        isReturn: i.isReturn,
      })),
      grossSale: c.grossSale,
      packageDiscount: c.packageDiscount,
      returnAmount: c.returnAmount,
      netBill: c.netBill,
      cashReceived: c.cashReceived,
      cardAmount: c.cardAmount,
      bankAmount: Number(inv.bankAmount),
      creditApplied: Number(inv.creditApplied),
      /** Collected after the sale, against this invoice. */
      recovered: c.recovered,
      /** The part of `recovered` that Mark Unpaid can reverse. */
      recoveredMarkPaid: c.recoveredMarkPaid,
      outstanding: c.outstanding,
      /** What the customer handed back — see the select comment above. */
      change: Number(inv.change),
      /** Estimate: cost of goods valued at the item's *current* purchasePrice. */
      cogs: c.cogs,
      profit: c.profit,
      hasPlan: !!inv.installmentPlan,
      /** Kind, next due date and remaining, or null when there is no plan. */
      plan: inv.installmentPlan
        ? summarizePlan({
            kind: inv.installmentPlan.kind,
            periods: inv.installmentPlan.periods,
            installments: inv.installmentPlan.installments.map((i) => ({
              seq: i.seq, dueDate: i.dueDate,
              amount: Number(i.amount), paidAmount: Number(i.paidAmount),
              status: i.status,
            })),
          })
        : null,
      /** Set when this row *is* a refund: the sale it reverses. */
      refundOfInvoiceNo: inv.refundOf?.invoiceNo ?? null,
      /** Set when this row is a sale that has been refunded: the refund's number. */
      refundedByInvoiceNo: inv.refunds[0]?.invoiceNo ?? null,
      recordStatus: inv.status as "SAVED" | "HELD" | "VOIDED",
      paymentStatus: c.paymentStatus,
    };
  });

  return NextResponse.json({ invoices: rows, totals, total, page, pageSize });
}
