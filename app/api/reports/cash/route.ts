import { prisma } from "@/lib/prisma";
import { moneyInFromInvoice, shopDateKey, shopDayWindow } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/cash?branchId=&from=&to=
 *
 * Returns a daily breakdown of cash / card / bank / credit sales and
 * recoveries for the date range, one row per **shop** day.
 *
 * - Every sale amount is what the shop *kept* (change is netted off at save)
 *   and is signed through `moneyInFromInvoice`, so a cash refund subtracts.
 * - `creditSales` is what was billed but not paid at the counter: net bill
 *   less cash, card, bank and store credit applied. It used to leave bank and
 *   store credit in, so a bank-paid sale showed up as a credit sale.
 * - `totalCashIn` is cash only — cash sales plus recoveries collected in cash.
 *   Bank recoveries are in `recoveries` but never in the drawer's total.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateFilter: any = shopDayWindow(from, to) ?? {};

  const invoiceWhere: any = { branchId, status: "SAVED" };
  if (from || to) invoiceWhere.date = dateFilter;

  const recoveryWhere: any = { branchId };
  if (from || to) recoveryWhere.date = dateFilter;

  // Different tables, same date filter, neither depends on the other's
  // result — one round trip each, at the same time, instead of in sequence.
  const [invoices, recoveries] = await Promise.all([
    prisma.saleInvoice.findMany({
      where: invoiceWhere,
      select: {
        date: true,
        cashReceived: true,
        cardAmount: true,
        bankAmount: true,
        creditApplied: true,
        netBill: true,
        partyOption: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.recovery.findMany({
      where: recoveryWhere,
      select: { date: true, amount: true, paymentMethod: true },
      orderBy: { date: "asc" },
    }),
  ]);

  type Day = {
    cashSales: number; cardSales: number; bankSales: number; creditSales: number;
    recoveries: number; cashRecoveries: number;
  };
  const dayMap = new Map<string, Day>();
  const dayFor = (k: string): Day => {
    let day = dayMap.get(k);
    if (!day) {
      day = { cashSales: 0, cardSales: 0, bankSales: 0, creditSales: 0, recoveries: 0, cashRecoveries: 0 };
      dayMap.set(k, day);
    }
    return day;
  };

  for (const inv of invoices) {
    const day = dayFor(shopDateKey(inv.date));
    const netBill = Number(inv.netBill);
    const cash = moneyInFromInvoice(netBill, Number(inv.cashReceived));
    const card = moneyInFromInvoice(netBill, Number(inv.cardAmount));
    const bank = moneyInFromInvoice(netBill, Number(inv.bankAmount));
    day.cashSales += cash;
    day.cardSales += card;
    day.bankSales += bank;
    const credit = netBill - Number(inv.creditApplied) - cash - card - bank;
    if (credit > 0.005) day.creditSales += credit;
  }

  for (const rec of recoveries) {
    const day = dayFor(shopDateKey(rec.date));
    const amount = Number(rec.amount);
    day.recoveries += amount;
    if (rec.paymentMethod !== "BANK") day.cashRecoveries += amount;
  }

  const days = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      ...d,
      totalCashIn: d.cashSales + d.cashRecoveries,
    }));

  const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((s, d) => s + pick(d), 0);
  const totals = {
    cashSales: sum((d) => d.cashSales),
    cardSales: sum((d) => d.cardSales),
    bankSales: sum((d) => d.bankSales),
    creditSales: sum((d) => d.creditSales),
    recoveries: sum((d) => d.recoveries),
    cashRecoveries: sum((d) => d.cashRecoveries),
    totalCashIn: sum((d) => d.totalCashIn),
  };

  return NextResponse.json({ days, totals });
}
