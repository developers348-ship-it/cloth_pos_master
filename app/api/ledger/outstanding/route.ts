import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ledger/outstanding?branchId=&type=receivable|payable
 *
 * Groups LedgerEntries by partyId, computes net balance (debit − credit + previousBalance),
 * and returns only parties with a non-zero outstanding.
 *
 * type=receivable  → CREDIT parties (customers who owe us)
 * type=payable     → VENDOR parties (we owe them)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const type = searchParams.get("type") ?? "receivable";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const partyType = type === "payable" ? "VENDOR" : "CREDIT";

  // Get all parties of the relevant type
  const parties = await prisma.party.findMany({
    where: { type: partyType, isActive: true },
    select: {
      id: true,
      accountId: true,
      name: true,
      city: true,
      phone: true,
      mobile: true,
      previousBalance: true,
      type: true,
    },
  });

  if (parties.length === 0) {
    return NextResponse.json({ outstanding: [], type });
  }

  // Aggregate debit/credit per party in this branch
  const partyIds = parties.map((p) => p.id);
  const agg = await prisma.ledgerEntry.groupBy({
    by: ["partyId"],
    where: { branchId, partyId: { in: partyIds } },
    _sum: { debit: true, credit: true },
  });

  const aggMap = new Map(
    agg.map((a) => [
      a.partyId,
      {
        debit: Number(a._sum.debit ?? 0),
        credit: Number(a._sum.credit ?? 0),
      },
    ])
  );

  const outstanding = parties.map((p) => {
    const ledger = aggMap.get(p.id) ?? { debit: 0, credit: 0 };
    // Opening balance (previousBalance is DR for customers, CR for vendors)
    const opening = Number(p.previousBalance ?? 0);
    const balance = opening + ledger.debit - ledger.credit;
    return {
      partyId: p.id,
      accountId: p.accountId,
      name: p.name,
      city: p.city,
      phone: p.phone ?? p.mobile,
      type: p.type,
      totalDebit: ledger.debit,
      totalCredit: ledger.credit,
      balance: Math.abs(balance),
      // For receivables: positive balance means they owe us
      // For payables: positive balance means we owe them
    };
  });

  // Only return parties with a meaningful balance
  const filtered = outstanding.filter((o) => o.balance > 0.005);
  // Sort by balance descending
  filtered.sort((a, b) => b.balance - a.balance);

  const totalBalance = filtered.reduce((s, o) => s + o.balance, 0);

  return NextResponse.json({ outstanding: filtered, type, totalBalance });
}
