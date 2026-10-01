import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { getPartyBalances } from "@/lib/party-balance";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const type = searchParams.get("type"); // CASH | CREDIT | VENDOR
  const isDefault = searchParams.get("isDefault");
  const recent = searchParams.get("recent");
  const limit = Number(searchParams.get("limit") ?? "20");
  // 1-based; defaults to 1 so a caller that never passes `page` (the sales
  // checkout's party search) keeps seeing exactly the first `limit` rows.
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const branchId = searchParams.get("branchId");

  const where: any = { isActive: true };

  if (type) where.type = type;

  if (isDefault === "true") {
    where.isDefault = true;
  } else if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q, mode: "insensitive" } },
      // The account no. the GRN's vendor picker shows beside each name.
      ...(/^\d+$/.test(q) && Number(q) <= 2147483647 ? [{ accountId: Number(q) }] : []),
    ];
  } else if (recent === "true") {
    where.isDefault = false;
  }

  const [parties, total] = await Promise.all([
    prisma.party.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: recent === "true" && !q ? [{ createdAt: "desc" }] : [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.party.count({ where }),
  ]);

  // `Party.previousBalance` is the *opening* balance, frozen when the party was
  // created — it is not what the party owes today. Callers that need the live
  // figure ask for it explicitly (the Parties page does; the checkout's party
  // search doesn't, and skipping the groupBy keeps that lookup cheap).
  //
  // Sign convention, the same one used everywhere else in this app:
  // **> 0 the party owes the store, < 0 the store owes the party.**
  if (searchParams.get("withBalance") === "true" && branchId) {
    const balances = await getPartyBalances(parties, branchId);

    // The Parties page's Total Receivable / Total Payable tiles sum every
    // matching party, not just the page on screen — otherwise paging through
    // the list would make the totals jump around. That means a second,
    // lean pass over the *whole* filtered set (id + previousBalance only, no
    // pagination), reusing the same groupBy `getPartyBalances` uses for the
    // page itself.
    const allMatching = await prisma.party.findMany({
      where,
      select: { id: true, previousBalance: true },
    });
    const allBalances = await getPartyBalances(allMatching, branchId);
    const totals = { receivable: 0, payable: 0 };
    for (const bal of allBalances.values()) {
      if (bal > 0.005) totals.receivable += bal;
      else if (bal < -0.005) totals.payable += -bal;
    }

    return NextResponse.json({
      parties: parties.map((p) => ({ ...p, balance: balances.get(p.id) ?? Number(p.previousBalance ?? 0) })),
      total, page, pageSize: limit, totals,
    });
  }

  return NextResponse.json({ parties, total, page, pageSize: limit });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("ADD_PARTY");
  if (!gate.ok) return gate.response;

  const body = await req.json();

  // Setting a credit limit above zero carries its own permission on top of
  // ADD_PARTY, same as APPLY_STORE_CREDIT does for a sale — only checked when
  // a limit is actually being set.
  if (Number(body.creditLimit ?? 0) > 0) {
    const limitGate = await requirePermission("SET_CREDIT_LIMIT");
    if (!limitGate.ok) return limitGate.response;
  }

  const party = await prisma.party.create({ data: body });
  return NextResponse.json(party, { status: 201 });
}
