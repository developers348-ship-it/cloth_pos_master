import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getPartyBalance } from "@/lib/party-balance";
import { getOpenGrns, getOpenInvoices } from "@/lib/open-documents";
import { grnOutstanding, grnPaymentStatus, grnSettledAmount } from "@/lib/grn-settlement";
import {
  invoiceOutstanding,
  invoicePaymentStatus,
  invoiceSettledAmount,
} from "@/lib/invoice-settlement";
import { summarizePlan } from "@/lib/installments";
import { shopDayWindow } from "@/lib/utils";

/**
 * GET /api/parties/[id]/detail?branchId=&from=&to=
 *
 * Everything the Party Detail page shows, in one request: the profile, the live
 * balance, lifetime trading totals, and — inside the date window — the party's
 * invoices, purchase bills, ledger statement, settlements and repayment plans.
 *
 * One endpoint rather than six because the page is one screen. Six fetches
 * would each re-read the same party row, and the tabs would light up one at a
 * time as they landed; this way the page is either loading or complete.
 *
 * **Lifetime figures ignore the window on purpose.** The header cards answer
 * "what is this customer worth, and what do they still owe" — questions about
 * the whole relationship, not about March. Only the tables below them narrow.
 * The two are labelled differently in the UI for exactly that reason.
 *
 * Ungated, matching `GET /api/ledger` and the parties list: the read-only
 * endpoints are deliberately open (see lib/authz.ts), and this shows the same
 * party ledger the Ledger page already shows to anyone signed in.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cap on rows per table, matching the 500 the open-document queries take. */
const ROW_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) {
    return NextResponse.json({ error: "Party not found" }, { status: 404 });
  }

  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const window = shopDayWindow(from, to);
  const fromDate = window?.gte ?? null;
  const inWindow = window ? { date: window } : {};

  const scope = { branchId, partyId: id };

  const [
    balance,
    openInvoices,
    openGrns,
    invoiceRows,
    grnRows,
    ledgerEntries,
    priorLedger,
    recoveries,
    payments,
    plans,
    lifetimeSales,
    lifetimePurchases,
    lifetimeRecovered,
    lifetimePaid,
    firstLedger,
    lastLedger,
  ] = await Promise.all([
    getPartyBalance(id, branchId),
    getOpenInvoices(branchId, id),
    getOpenGrns(branchId, id),

    prisma.saleInvoice.findMany({
      where: { ...scope, ...inWindow },
      orderBy: { date: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true, invoiceNo: true, date: true, status: true, netBill: true,
        grossSale: true, packageDiscount: true, returnAmount: true,
        creditApplied: true, cashReceived: true, cardAmount: true, bankAmount: true,
        paymentMethod: true, partyOption: true, notes: true,
        user: { select: { name: true } },
        _count: { select: { items: true } },
        recoveries: { select: { amount: true } },
        installmentPlan: {
          select: {
            kind: true, periods: true,
            installments: {
              select: { seq: true, dueDate: true, amount: true, paidAmount: true, status: true },
            },
          },
        },
        refundOf: { select: { invoiceNo: true } },
        refunds: { select: { invoiceNo: true }, take: 1 },
      },
    }),

    prisma.gRN.findMany({
      where: { ...scope, ...inWindow },
      orderBy: { date: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true, grnNo: true, date: true, billNo: true, remarks: true,
        netBill: true, billAmount: true, returnAmount: true,
        cashAmount: true, bankAmount: true, paymentMethod: true,
        user: { select: { name: true } },
        _count: { select: { items: true } },
        payments: { select: { amount: true } },
        installmentPlan: {
          select: {
            kind: true, periods: true,
            installments: {
              select: { seq: true, dueDate: true, amount: true, paidAmount: true, status: true },
            },
          },
        },
      },
    }),

    prisma.ledgerEntry.findMany({
      where: { ...scope, ...inWindow },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: ROW_LIMIT,
      select: {
        id: true, date: true, type: true, reference: true, notes: true,
        debit: true, credit: true, invoiceId: true, grnId: true,
      },
    }),

    // Everything before the window, as one aggregate rather than by fetching
    // the rows — the statement has to open at the party's *true* balance on the
    // day before `from`, or filtering to "today" shows a closing figure that
    // disagrees with the balance card above it.
    fromDate
      ? prisma.ledgerEntry.aggregate({
          where: { ...scope, date: { lt: fromDate } },
          _sum: { debit: true, credit: true },
        })
      : null,

    prisma.recovery.findMany({
      where: { ...scope, ...inWindow },
      orderBy: { date: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true, date: true, amount: true, paymentMethod: true, notes: true,
        account: { select: { name: true } },
        invoice: { select: { id: true, invoiceNo: true } },
      },
    }),

    prisma.payment.findMany({
      where: { ...scope, ...inWindow },
      orderBy: { date: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true, date: true, amount: true, paymentMethod: true, notes: true,
        account: { select: { name: true } },
        grn: { select: { id: true, grnNo: true } },
      },
    }),

    // Plans are never date-filtered: a schedule opened in January is exactly
    // what someone looking at this party in March needs to see.
    prisma.installmentPlan.findMany({
      where: scope,
      orderBy: { startDate: "desc" },
      select: {
        id: true, kind: true, periods: true, principal: true, startDate: true,
        invoice: { select: { id: true, invoiceNo: true } },
        grn: { select: { id: true, grnNo: true } },
        installments: {
          orderBy: { seq: "asc" },
          select: {
            id: true, seq: true, dueDate: true, amount: true,
            paidAmount: true, status: true, paidAt: true,
          },
        },
      },
    }),

    // ── Lifetime aggregates, deliberately outside the date window ───────────
    // Only SAVED invoices count, matching `getOpenInvoices`: a VOIDED sale is
    // not trade and a HELD one was never rung up.
    prisma.saleInvoice.aggregate({
      where: { ...scope, status: "SAVED" },
      _count: true,
      _sum: { netBill: true, grossSale: true, returnAmount: true, packageDiscount: true },
    }),
    prisma.gRN.aggregate({
      where: scope,
      _count: true,
      _sum: { netBill: true, billAmount: true, returnAmount: true },
    }),
    prisma.recovery.aggregate({ where: scope, _count: true, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: scope, _count: true, _sum: { amount: true } }),
    prisma.ledgerEntry.findFirst({
      where: scope, orderBy: { date: "asc" }, select: { date: true },
    }),
    prisma.ledgerEntry.findFirst({
      where: scope, orderBy: { date: "desc" }, select: { date: true },
    }),
  ]);

  // ── Invoices, with the same settlement maths the sales report uses ─────────
  const invoices = invoiceRows.map((inv) => {
    const settlement = {
      netBill: Number(inv.netBill),
      creditApplied: Number(inv.creditApplied),
      cashReceived: Number(inv.cashReceived),
      cardAmount: Number(inv.cardAmount),
      bankAmount: Number(inv.bankAmount),
      recovered: inv.recoveries.reduce((s, r) => s + Number(r.amount), 0),
    };
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      date: inv.date,
      recordStatus: inv.status as "SAVED" | "HELD" | "VOIDED",
      cashier: inv.user?.name ?? "—",
      itemCount: inv._count.items,
      partyOption: inv.partyOption,
      paymentMethod: inv.paymentMethod,
      notes: inv.notes,
      grossSale: Number(inv.grossSale),
      packageDiscount: Number(inv.packageDiscount),
      returnAmount: Number(inv.returnAmount),
      netBill: settlement.netBill,
      settled: invoiceSettledAmount(settlement),
      outstanding: invoiceOutstanding(settlement),
      paymentStatus: invoicePaymentStatus(settlement),
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
      /** Set when this row is a sale that has since been refunded. */
      refundedByInvoiceNo: inv.refunds[0]?.invoiceNo ?? null,
    };
  });

  // ── Purchase bills, likewise ───────────────────────────────────────────────
  const grns = grnRows.map((g) => {
    const settlement = {
      netBill: Number(g.netBill),
      cashPaid: Number(g.cashAmount),
      bankPaid: Number(g.bankAmount),
      collected: (g.installmentPlan?.installments ?? [])
        .reduce((s, i) => s + Number(i.paidAmount), 0),
      paid: g.payments.reduce((s, p) => s + Number(p.amount), 0),
    };
    return {
      id: g.id,
      grnNo: g.grnNo,
      date: g.date,
      billNo: g.billNo,
      remarks: g.remarks,
      receivedBy: g.user?.name ?? "—",
      itemCount: g._count.items,
      paymentMethod: g.paymentMethod,
      billAmount: Number(g.billAmount),
      returnAmount: Number(g.returnAmount),
      netBill: settlement.netBill,
      settled: grnSettledAmount(settlement),
      outstanding: grnOutstanding(settlement),
      paymentStatus: grnPaymentStatus(settlement),
      plan: g.installmentPlan
        ? summarizePlan({
            kind: g.installmentPlan.kind,
            periods: g.installmentPlan.periods,
            installments: g.installmentPlan.installments.map((i) => ({
              seq: i.seq, dueDate: i.dueDate,
              amount: Number(i.amount), paidAmount: Number(i.paidAmount),
              status: i.status,
            })),
          })
        : null,
    };
  });

  // ── Ledger statement, opening at the balance carried into the window ───────
  const openingBalance =
    Number(party.previousBalance ?? 0) +
    Number(priorLedger?._sum.debit ?? 0) -
    Number(priorLedger?._sum.credit ?? 0);

  let running = openingBalance;
  const ledgerRows = ledgerEntries.map((e) => {
    const debit = Number(e.debit);
    const credit = Number(e.credit);
    running += debit - credit;
    return {
      id: e.id,
      date: e.date,
      type: e.type,
      reference: e.reference,
      notes: e.notes,
      // The document behind the line, so the reference cell can link to the
      // invoice/GRN detail page. Only SALE/PURCHASE (and their returns) carry
      // one — a RECEIPT/PAYMENT row is deliberately not tied to a document by
      // FK; see `buildSettlementOps` in lib/accounts.ts.
      invoiceId: e.invoiceId,
      grnId: e.grnId,
      debit,
      credit,
      balance: round2(running),
    };
  });

  // ── Settlements: money in and money out, as one chronological list ─────────
  // A party can be on both sides (a vendor the store also sells to), and two
  // separate tables would hide that the same person paid on Monday and was
  // paid on Tuesday.
  const settlements = [
    ...recoveries.map((r) => ({
      id: r.id,
      kind: "RECOVERY" as const,
      date: r.date,
      amount: Number(r.amount),
      paymentMethod: r.paymentMethod,
      accountName: r.account?.name ?? null,
      notes: r.notes,
      invoiceId: r.invoice?.id ?? null,
      invoiceNo: r.invoice?.invoiceNo ?? null,
      grnId: null as string | null,
      grnNo: null as number | null,
    })),
    ...payments.map((p) => ({
      id: p.id,
      kind: "PAYMENT" as const,
      date: p.date,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      accountName: p.account?.name ?? null,
      notes: p.notes,
      invoiceId: null as string | null,
      invoiceNo: null as number | null,
      grnId: p.grn?.id ?? null,
      grnNo: p.grn?.grnNo ?? null,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Repayment plans, with their full schedules ─────────────────────────────
  const planRows = plans.map((p) => {
    const installments = p.installments.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      amount: Number(i.amount),
      paidAmount: Number(i.paidAmount),
      status: i.status,
      paidAt: i.paidAt,
    }));
    return {
      id: p.id,
      kind: p.kind,
      periods: p.periods,
      principal: Number(p.principal),
      startDate: p.startDate,
      invoiceId: p.invoice?.id ?? null,
      invoiceNo: p.invoice?.invoiceNo ?? null,
      grnId: p.grn?.id ?? null,
      grnNo: p.grn?.grnNo ?? null,
      installments,
      summary: summarizePlan({ kind: p.kind, periods: p.periods, installments }),
    };
  });

  const salesOutstanding = round2(openInvoices.reduce((s, d) => s + d.outstanding, 0));
  const purchaseOutstanding = round2(openGrns.reduce((s, d) => s + d.outstanding, 0));

  return NextResponse.json({
    party: {
      id: party.id,
      accountId: party.accountId,
      name: party.name,
      address: party.address,
      city: party.city,
      phone: party.phone,
      mobile: party.mobile,
      type: party.type,
      notes: party.notes,
      previousBalance: Number(party.previousBalance ?? 0),
      creditLimit: Number(party.creditLimit ?? 0),
      promiseDays: party.promiseDays,
      isDefault: party.isDefault,
      isActive: party.isActive,
      createdAt: party.createdAt,
    },
    /** Live, lifetime. Signed: > 0 the party owes the store, < 0 the store owes them. */
    balance,
    /**
     * The whole relationship, never narrowed by the date filter — the header
     * cards answer "what do they still owe", not "what did they owe in March".
     */
    lifetime: {
      invoiceCount: lifetimeSales._count,
      salesGross: Number(lifetimeSales._sum.grossSale ?? 0),
      salesNet: Number(lifetimeSales._sum.netBill ?? 0),
      salesReturns: Number(lifetimeSales._sum.returnAmount ?? 0),
      salesDiscount: Number(lifetimeSales._sum.packageDiscount ?? 0),
      /** Still owed to the store across every unsettled invoice. */
      salesOutstanding,
      openInvoiceCount: openInvoices.length,

      grnCount: lifetimePurchases._count,
      purchaseGross: Number(lifetimePurchases._sum.billAmount ?? 0),
      purchaseNet: Number(lifetimePurchases._sum.netBill ?? 0),
      purchaseReturns: Number(lifetimePurchases._sum.returnAmount ?? 0),
      /** Still owed to the vendor across every unsettled bill. */
      purchaseOutstanding,
      openGrnCount: openGrns.length,

      recoveryCount: lifetimeRecovered._count,
      recoveryTotal: Number(lifetimeRecovered._sum.amount ?? 0),
      paymentCount: lifetimePaid._count,
      paymentTotal: Number(lifetimePaid._sum.amount ?? 0),

      firstActivity: firstLedger?.date ?? null,
      lastActivity: lastLedger?.date ?? null,
    },
    /** The window the tables below were read over. Null dates mean "all time". */
    window: { from: from || null, to: to || null },
    invoices,
    grns,
    ledger: {
      openingBalance: round2(openingBalance),
      entries: ledgerRows,
      totals: {
        totalDebit: round2(ledgerRows.reduce((s, r) => s + r.debit, 0)),
        totalCredit: round2(ledgerRows.reduce((s, r) => s + r.credit, 0)),
        closingBalance: round2(running),
      },
    },
    settlements,
    plans: planRows,
    /** In-window sums, for the tab footers. */
    windowTotals: {
      salesNet: round2(invoices.reduce((s, r) => s + r.netBill, 0)),
      salesOutstanding: round2(invoices.reduce((s, r) => s + r.outstanding, 0)),
      purchaseNet: round2(grns.reduce((s, r) => s + r.netBill, 0)),
      purchaseOutstanding: round2(grns.reduce((s, r) => s + r.outstanding, 0)),
      received: round2(
        settlements.filter((s) => s.kind === "RECOVERY").reduce((s, r) => s + r.amount, 0)
      ),
      paidOut: round2(
        settlements.filter((s) => s.kind === "PAYMENT").reduce((s, r) => s + r.amount, 0)
      ),
    },
  });
}
