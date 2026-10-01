import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/contacts?branchId=&type=CASH|CREDIT|VENDOR&city=
 *
 * Returns all active parties for the Contact List report.
 * Also computes outstanding balance from LedgerEntries.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const type = searchParams.get("type");
  const city = searchParams.get("city");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const partyWhere: any = { isActive: true };
  if (type) partyWhere.type = type;
  if (city) partyWhere.city = { contains: city, mode: "insensitive" };

  const parties = await prisma.party.findMany({
    where: partyWhere,
    select: {
      id: true,
      accountId: true,
      name: true,
      address: true,
      city: true,
      phone: true,
      mobile: true,
      type: true,
      previousBalance: true,
      creditLimit: true,
    },
    orderBy: { name: "asc" },
  });

  // Compute outstanding balance per party
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

  const contacts = parties.map((p) => {
    const l = aggMap.get(p.id) ?? { debit: 0, credit: 0 };
    const balance = Number(p.previousBalance ?? 0) + l.debit - l.credit;
    return {
      accountId: p.accountId,
      name: p.name,
      type: p.type,
      address: p.address ?? "",
      city: p.city ?? "",
      phone: p.phone ?? "",
      mobile: p.mobile ?? "",
      creditLimit: Number(p.creditLimit),
      balance,
    };
  });

  return NextResponse.json({ contacts, total: contacts.length });
}
