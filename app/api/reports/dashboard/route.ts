import { prisma } from "@/lib/prisma";
import { moneyInFromInvoice, shopDateKey, shopDayWindow, shopMonthKey } from "@/lib/utils";
import { getExpenseTotals, netProfit } from "@/lib/expenses";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/dashboard?branchId=&from=&to=
 *
 * The sales-and-profit summary behind the dashboard's date filter: headline
 * totals for the range plus a bucketed series for the chart.
 *
 * **Profit is an estimate, and the estimate is the honest one available.** A
 * sale line stores no cost snapshot (see `SaleInvoiceItem` in the schema), so
 * cost of goods is valued at the item's *current* `purchasePrice`. Re-cost an
 * item today and last month's profit moves with it. Fixing that properly means
 * writing a `costRate` onto each sale line at checkout — a schema change and a
 * backfill, and worth doing before anyone reports these numbers to a tax
 * authority. The UI carries the same caveat next to the figure.
 *
 * Returns are netted out of cost as well as revenue: the goods came back into
 * stock, so their cost comes back out of COGS.
 *
 * **Gross vs net profit.** `profit` here is the trading margin: sale minus cost
 * of goods, and nothing else. `netProfit` takes the period's recorded operating
 * costs off it (see lib/expenses.ts) — salaries, rent, utilities. Owner
 * withdrawals are deliberately excluded from both: taking earnings out of the
 * shop moves money without consuming anything, and netting them off profit
 * would double-count money that has already left the cash balance.
 */

/** Bucket a range by day up to this length, by month beyond it. */
const DAILY_BUCKET_MAX_DAYS = 92;

type Bucket = {
  key: string; sales: number; profit: number; cogs: number; invoices: number;
  /** Operating costs dated in this bucket — paid or not. */
  expenses: number;
  /** profit − expenses, so the table can show the bottom line per bucket. */
  netProfit: number;
};

/**
 * Day/month keys on the **shop's** calendar — the same convention
 * app/api/reports/cash/route.ts groups by. These were the UTC date, which
 * filed every sale rung up before 05:00 under the previous day.
 */
const dayKey = shopDateKey;
const monthKey = shopMonthKey;

/** Every bucket in the range, so a day with no sales is a zero, not a gap. */
function emptyBuckets(from: Date, to: Date, granularity: "day" | "month"): string[] {
  const keys: string[] = [];
  // Walk calendar days from the shop day each instant falls on. The window's
  // `gte` is 19:00Z the day before — reading its UTC date added an empty
  // bucket at the front of every range.
  // Months step from the 1st: `setUTCMonth(+1)` on the 31st overflows past a
  // short month (Jan 31 → Mar 3) and dropped February's bucket.
  const cursor = new Date(
    granularity === "day" ? `${shopDateKey(from)}T00:00:00Z` : `${shopMonthKey(from)}-01T00:00:00Z`
  );
  const end = new Date(`${shopDateKey(to)}T00:00:00Z`);
  // Guard rail: a nonsense range (from after to, or a decade of days) must not
  // spin here — the loop is bounded rather than trusting the query string.
  let guard = 0;
  while (cursor <= end && guard++ < 800) {
    keys.push(granularity === "day" ? dayKey(cursor) : monthKey(cursor));
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return granularity === "month" ? Array.from(new Set(keys)) : keys;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const where: any = { branchId, status: "SAVED" };
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const window = shopDayWindow(from, to);
  const fromDate = window?.gte ?? null;
  const toDate = window?.lte ?? null;
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate) where.date.gte = fromDate;
    if (toDate) where.date.lte = toDate;
  }

  // Costs for the same range are fetched alongside the invoices rather than
  // after them — neither depends on the other's result, only on the same
  // branchId/date window, so there is no reason to pay for the round trips
  // one after another.
  const expenseWhere: any = {
    branchId,
    kind: "EXPENSE",
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
  };

  const [invoices, expenseRows, expenseTotals] = await Promise.all([
    prisma.saleInvoice.findMany({
      where,
      select: {
        date: true,
        grossSale: true,
        packageDiscount: true,
        returnAmount: true,
        netBill: true,
        cashReceived: true,
        cardAmount: true,
        bankAmount: true,
        items: {
          select: {
            qty: true,
            isReturn: true,
            item: { select: { purchasePrice: true } },
          },
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.expense.findMany({
      where: expenseWhere,
      select: { date: true, amount: true },
    }),
    getExpenseTotals(branchId, fromDate, toDate),
  ]);

  const spanDays =
    fromDate && toDate
      ? Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
      : invoices.length > 0
        ? Math.round(
            (invoices[invoices.length - 1].date.getTime() - invoices[0].date.getTime()) / 86_400_000
          ) + 1
        : 1;
  const granularity: "day" | "month" = spanDays > DAILY_BUCKET_MAX_DAYS ? "month" : "day";

  const seriesStart = fromDate ?? invoices[0]?.date ?? new Date();
  const seriesEnd = toDate ?? invoices[invoices.length - 1]?.date ?? new Date();
  const buckets = new Map<string, Bucket>();
  for (const key of emptyBuckets(seriesStart, seriesEnd, granularity)) {
    buckets.set(key, { key, sales: 0, profit: 0, cogs: 0, invoices: 0, expenses: 0, netProfit: 0 });
  }

  const totals = {
    invoiceCount: 0,
    grossSale: 0,
    discount: 0,
    returnAmount: 0,
    netSale: 0,
    cogs: 0,
    profit: 0,
    cashReceived: 0,
    cardAmount: 0,
    bankAmount: 0,
    marginPct: 0,
    // Cost management (lib/expenses.ts). `expenses` is accrual — a cost dated
    // in the range counts whether or not it has been paid yet.
    expenses: 0,
    unpaidExpenses: 0,
    withdrawals: 0,
    injections: 0,
    netProfit: 0,
    netMarginPct: 0,
  };

  for (const inv of invoices) {
    const netBill = Number(inv.netBill);
    // A returned line's goods are back on the shelf, so its cost is credited
    // back — the same netting the revenue side already does via returnAmount.
    const cogs = inv.items.reduce((sum, line) => {
      const cost = Number(line.qty) * Number(line.item.purchasePrice);
      return sum + (line.isReturn ? -cost : cost);
    }, 0);

    totals.invoiceCount += 1;
    totals.grossSale += Number(inv.grossSale);
    totals.discount += Number(inv.packageDiscount);
    totals.returnAmount += Number(inv.returnAmount);
    totals.netSale += netBill;
    totals.cogs += cogs;
    // Signed: a net-return invoice's amounts are money paid out.
    totals.cashReceived += moneyInFromInvoice(netBill, Number(inv.cashReceived));
    totals.cardAmount += moneyInFromInvoice(netBill, Number(inv.cardAmount));
    totals.bankAmount += moneyInFromInvoice(netBill, Number(inv.bankAmount));

    const key = granularity === "day" ? dayKey(inv.date) : monthKey(inv.date);
    const bucket = buckets.get(key) ?? { key, sales: 0, profit: 0, cogs: 0, invoices: 0, expenses: 0, netProfit: 0 };
    bucket.sales += netBill;
    bucket.cogs += cogs;
    bucket.profit += netBill - cogs;
    bucket.invoices += 1;
    buckets.set(key, bucket);
  }

  totals.profit = totals.netSale - totals.cogs;
  totals.marginPct = totals.netSale !== 0 ? (totals.profit / totals.netSale) * 100 : 0;

  // ── Operating costs for the same range ──────────────────────────────────────
  // Bucketed by the cost's own `date` (when it was incurred), never `paidAt`,
  // so paying September's rent in October leaves it a September cost. Rows are
  // fetched rather than grouped in SQL because they have to land in the same
  // day/month buckets the invoices did, and the bucket keys are built in UTC
  // here rather than by the database's timezone. (Fetched above, alongside the
  // invoices, so this is bucketing already-loaded rows, not a new round trip.)
  for (const row of expenseRows) {
    const key = granularity === "day" ? dayKey(row.date) : monthKey(row.date);
    const bucket = buckets.get(key);
    // A cost dated outside the series window (possible only when the range is
    // open-ended and the buckets were derived from the invoice dates) still
    // belongs in the totals, just not on the chart.
    if (bucket) bucket.expenses += Number(row.amount);
  }

  totals.expenses = expenseTotals.expenses;
  totals.unpaidExpenses = expenseTotals.unpaidExpenses;
  totals.withdrawals = expenseTotals.withdrawals;
  totals.injections = expenseTotals.injections;
  totals.netProfit = netProfit(totals.profit, totals.expenses);
  totals.netMarginPct = totals.netSale !== 0 ? (totals.netProfit / totals.netSale) * 100 : 0;

  for (const bucket of buckets.values()) {
    bucket.netProfit = bucket.profit - bucket.expenses;
  }

  const series = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));

  return NextResponse.json({ granularity, series, totals });
}
