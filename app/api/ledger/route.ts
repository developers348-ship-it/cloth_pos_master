import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ledger?branchId=&partyId=&from=&to=&page=&pageSize=&all=
 *
 * Returns LedgerEntry rows for a party (optionally filtered by date range),
 * with a computed running balance column, one page at a time. `totals`
 * (totalDebit/totalCredit/closingBalance) always covers the *whole* filtered
 * range, not just the page, so paging through a long statement doesn't make
 * them jump around. `all=true` (the Print/CSV actions, which need the whole
 * statement rather than one page of it) returns every row.
 *
 * `party.openingBalance` is the balance as it stood at the start of `from`:
 * party.previousBalance plus every entry dated before the window. Using
 * previousBalance alone made a statement for "this month" ignore everything
 * that happened last month, so its opening and closing figures were wrong.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const partyId = searchParams.get("partyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const all = searchParams.get("all") === "true";
  const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  if (!branchId || !partyId) {
    return NextResponse.json({ error: "branchId and partyId are required" }, { status: 400 });
  }

  const where: any = { branchId, partyId };
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);
  if (dateWindow) where.date = dateWindow;

  // `id` breaks ties between same-day entries so the page split is stable —
  // without it, two rows sharing a `date` could land on either side of a page
  // boundary depending on how Postgres happens to return them.
  const orderBy = [{ date: "asc" as const }, { id: "asc" as const }];
  const skip = (page - 1) * pageSize;

  const [party, entries, total, rangeAgg, priorAgg] = await Promise.all([
    prisma.party.findUnique({
      where: { id: partyId },
      select: { name: true, accountId: true, previousBalance: true, type: true },
    }),
    prisma.ledgerEntry.findMany({
      where,
      orderBy,
      ...(all ? {} : { skip, take: pageSize }),
    }),
    prisma.ledgerEntry.count({ where }),
    // The whole filtered range's debit/credit — independent of the page, so
    // `totals` (and the closing balance derived from it) stay correct no
    // matter which page is on screen.
    prisma.ledgerEntry.aggregate({ where, _sum: { debit: true, credit: true } }),
    // Everything before the window, carried into the opening balance.
    dateWindow?.gte
      ? prisma.ledgerEntry.aggregate({
          where: { branchId, partyId, date: { lt: dateWindow.gte } },
          _sum: { debit: true, credit: true },
        })
      : null,
  ]);

  if (!party) {
    return NextResponse.json({ error: "Party not found" }, { status: 404 });
  }

  const openingBalance = Number(party.previousBalance ?? 0)
    + Number(priorAgg?._sum.debit ?? 0) - Number(priorAgg?._sum.credit ?? 0);
  const totalDebit = Number(rangeAgg._sum.debit ?? 0);
  const totalCredit = Number(rangeAgg._sum.credit ?? 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;

  // The running balance shown against each row has to start from what came
  // before *this page*, not from the party's opening balance — otherwise page
  // 2 of a statement would show every balance short by everything on page 1.
  // Page 1 starts from the opening balance directly; any later page sums
  // every entry strictly before its own first row (same order this list
  // uses) and adds that to the opening balance instead.
  let runningBalance = openingBalance;
  if (!all && skip > 0 && entries.length > 0) {
    const cursor = entries[0];
    const beforeAgg = await prisma.ledgerEntry.aggregate({
      where: {
        ...where,
        OR: [
          { date: { lt: cursor.date } },
          { date: cursor.date, id: { lt: cursor.id } },
        ],
      },
      _sum: { debit: true, credit: true },
    });
    runningBalance += Number(beforeAgg._sum.debit ?? 0) - Number(beforeAgg._sum.credit ?? 0);
  }

  const rows = entries.map((e) => {
    runningBalance += Number(e.debit) - Number(e.credit);
    return {
      id: e.id,
      date: e.date,
      type: e.type,
      reference: e.reference,
      // The document behind the line, so the Reference cell can link to the
      // invoice/GRN detail page. Only the SALE/PURCHASE (and return) rows carry
      // one: a RECEIPT/PAYMENT row is deliberately not tied to a document by FK
      // — see `buildSettlementOps` in lib/accounts.ts — and its reference is a
      // REC-/PAY- number, not a bill.
      invoiceId: e.invoiceId,
      grnId: e.grnId,
      debit: Number(e.debit),
      credit: Number(e.credit),
      balance: runningBalance,
      notes: e.notes,
    };
  });

  return NextResponse.json({
    party: {
      name: party.name,
      accountId: party.accountId,
      type: party.type,
      openingBalance,
    },
    entries: rows,
    totals: { totalDebit, totalCredit, closingBalance },
    total, page, pageSize,
  });
}
