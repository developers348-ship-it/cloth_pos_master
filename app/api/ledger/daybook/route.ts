import { prisma } from "@/lib/prisma";
import { shopDayWindow, getDateRangeForPreset } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ledger/daybook?branchId=&date=YYYY-MM-DD
 *
 * Returns all LedgerEntries for a branch on a given date, plus
 * an aggregated summary: cashIn, cashOut, creditSales, opening, closing balance.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const dateParam = searchParams.get("date");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  // One whole day on the shop's clock, not the server's. Without this the
  // day book ran 05:00-to-05:00 and a sale rung up before dawn landed in the
  // previous day's book. `getDateRangeForPreset("today")` names the day the
  // same way, so an omitted `?date=` means the shop's today.
  const day = dateParam || getDateRangeForPreset("today").from;
  const window = shopDayWindow(day, day)!;
  const dayStart = window.gte!;
  const dayEnd = window.lte!;

  // The day's entries and the prior-day aggregate don't depend on each other
  // — one covers `date < dayStart`, the other `dayStart..dayEnd` — so they run
  // as one round trip instead of two.
  const [entries, prevAgg] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        branchId,
        date: { gte: dayStart, lte: dayEnd },
      },
      include: {
        party: { select: { name: true, accountId: true, type: true } },
      },
      orderBy: { date: "asc" },
    }),
    // Previous day closing balance (sum of all entries before today)
    prisma.ledgerEntry.aggregate({
      where: { branchId, date: { lt: dayStart } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const openingBalance =
    Number(prevAgg._sum.debit ?? 0) - Number(prevAgg._sum.credit ?? 0);

  // Aggregated summary for the day
  let cashIn = 0;
  let cashOut = 0;
  let creditSales = 0;

  for (const e of entries) {
    if (e.type === "RECEIPT") {
      // Cash collected from customers
      cashIn += Number(e.credit);
    } else if (e.type === "SALE") {
      // Cash portion of sales (credit on ledger = cash received at time of sale)
      cashIn += Number(e.credit);
      // Unpaid (credit) portion = debit - credit
      const unpaid = Number(e.debit) - Number(e.credit);
      if (unpaid > 0) creditSales += unpaid;
    } else if (e.type === "PAYMENT") {
      // Cash paid out to vendors
      cashOut += Number(e.debit);
    }
  }

  const closingBalance = openingBalance + cashIn - cashOut;

  const rows = entries.map((e) => ({
    id: e.id,
    date: e.date,
    type: e.type,
    reference: e.reference,
    // Lets the Day Book's Reference cell link straight to the document — the
    // same two FKs the party ledger returns, null on settlement rows.
    invoiceId: e.invoiceId,
    grnId: e.grnId,
    partyName: e.party?.name ?? "—",
    partyType: e.party?.type ?? "—",
    debit: Number(e.debit),
    credit: Number(e.credit),
    notes: e.notes,
  }));

  return NextResponse.json({
    date: dayStart,
    summary: {
      cashIn,
      cashOut,
      creditSales,
      openingBalance,
      closingBalance,
    },
    entries: rows,
  });
}
