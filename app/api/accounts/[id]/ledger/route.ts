import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import type { AccountEntryType, Prisma } from "@prisma/client";

/**
 * GET /api/accounts/[id]/ledger?from=&to=&type=
 *
 * One account's statement: every AccountEntry against it in the window, in date
 * order, with a running balance. The bank-side mirror of `GET /api/ledger`,
 * which does the same for a party.
 *
 * The running balance opens at the account's *true* balance on the day before
 * `from` — the stored opening balance plus everything posted before the window
 * — not at zero and not at the stored opening balance. Without that, filtering
 * to "today" would show a closing figure that disagrees with the balance on the
 * account card, which is the whole reason someone opens a statement.
 *
 * Unlike the list endpoint this is gated: a full bank statement is the one
 * figure here worth keeping off the shared counter terminal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("VIEW_ACCOUNT_LEDGER");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const type = searchParams.get("type");

  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const window = shopDayWindow(from, to);
  const fromDate = window?.gte ?? null;
  const toDate = window?.lte ?? null;

  const typeFiltered = !!type && type !== "ALL";

  const where: Prisma.AccountEntryWhereInput = { accountId: id };
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate) where.date.gte = fromDate;
    if (toDate) where.date.lte = toDate;
  }
  if (typeFiltered) where.type = type as AccountEntryType;

  // Everything before the window, in one aggregate rather than by fetching the
  // rows — same shape as the balance helpers in lib/accounts.ts.
  const prior = fromDate
    ? await prisma.accountEntry.aggregate({
        where: { accountId: id, date: { lt: fromDate } },
        _sum: { debit: true, credit: true },
      })
    : null;

  const openingBalance =
    Number(account.openingBalance) +
    Number(prior?._sum.debit ?? 0) -
    Number(prior?._sum.credit ?? 0);

  const entries = await prisma.accountEntry.findMany({
    where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      party: { select: { name: true } },
      invoice: { select: { invoiceNo: true } },
      grn: { select: { grnNo: true } },
    },
  });

  // A running balance is only meaningful over *every* movement in the window.
  // Under a type filter the rows are a subset, so a running total across them
  // would climb to a closing figure that matches no real balance — the column
  // is dropped instead of quietly lying (the UI hides it when `balance` is
  // null).
  let running = openingBalance;
  const rows = entries.map((e) => {
    const debit = Number(e.debit);
    const credit = Number(e.credit);
    running += debit - credit;
    return {
      id: e.id,
      date: e.date,
      type: e.type,
      reference: e.reference,
      partyName: e.party?.name ?? null,
      invoiceNo: e.invoice?.invoiceNo ?? null,
      grnNo: e.grn?.grnNo ?? null,
      notes: e.notes,
      debit,
      credit,
      balance: typeFiltered ? null : running,
    };
  });

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      type: account.type,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
    },
    /** Null under a type filter, for the same reason the row balances are. */
    openingBalance: typeFiltered ? null : openingBalance,
    typeFiltered,
    entries: rows,
    totals: {
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
      closingBalance: typeFiltered ? null : running,
    },
  });
}
