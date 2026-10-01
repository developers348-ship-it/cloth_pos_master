import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { buildSettlementOps, resolveSettlementAccount } from "@/lib/accounts";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";
import { allocateFifo, allocationErrorMessage, validateAllocations, type Allocation } from "@/lib/settlement-allocation";
import { getOpenGrns } from "@/lib/open-documents";

/**
 * GET /api/ledger/payment?branchId=&from=&to=&partyId=
 * POST /api/ledger/payment  — record payment made to vendor
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const partyId = searchParams.get("partyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: any = {};
  if (branchId) where.branchId = branchId;
  if (partyId) where.partyId = partyId;
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);
  if (dateWindow) where.date = dateWindow;

  const rows = await prisma.payment.findMany({
    where,
    include: {
      party: { select: { name: true, accountId: true, type: true } },
      account: { select: { name: true } },
      // The bill this payment was made against — `grnId` is already on the row,
      // the number is what the tab shows. Null for a payment made against the
      // vendor's balance as a whole.
      grn: { select: { grnNo: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  // Number() on the way out — see the note in the Recovery route: a Decimal
  // reaches the client as a string and made the tab footer concatenate instead
  // of add.
  const payments = rows.map((p) => ({
    ...p,
    amount: Number(p.amount),
    bankName: p.account?.name ?? p.bankName,
    grnNo: p.grn?.grnNo ?? null,
  }));

  return NextResponse.json({ payments });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("RECORD_PAYMENT");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, partyId, date, amount, paymentMethod, accountId, notes } = body;
  /**
   * Optional per-GRN split from the Ledger screen: `[{ id, amount }]`. Omitted
   * means "spread it oldest-first", which the server does itself below — so a
   * quick payment with no interest in the breakdown still lands on real bills.
   */
  const requestedAllocations: Allocation[] = Array.isArray(body.allocations)
    ? body.allocations.map((a: any) => ({ id: String(a.id), amount: Number(a.amount) }))
    : [];

  if (!branchId || !partyId || !amount) {
    return NextResponse.json({ error: "branchId, partyId, and amount are required" }, { status: 400 });
  }
  if (!(Number(amount) > 0)) {
    return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
  }

  const method = paymentMethod ?? "CASH";
  const account = await resolveSettlementAccount(branchId, method, accountId);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: 400 });
  }

  // The vendor's open bills, re-read here rather than taken from the client:
  // the cap on how much may be paid has to come from the database, or a stale
  // screen could authorise paying more than is owed.
  const openGrns = await getOpenGrns(branchId, partyId);

  const allocations = requestedAllocations.length > 0
    ? requestedAllocations
    : allocateFifo(openGrns, Number(amount)).allocations;

  const allocationError = validateAllocations({
    documents: openGrns,
    allocations,
    amount: Number(amount),
  });
  if (allocationError) {
    return NextResponse.json({ error: allocationErrorMessage(allocationError) }, { status: 400 });
  }

  const paymentDate = date ? new Date(date) : new Date();

  // One Payment row per GRN settled, each carrying that bill's id — the mirror
  // of the recovery route. `Payment.grnId` is a single FK and `grnSettledAmount`
  // sums the rows pointing at a GRN, so a split payment is naturally several
  // rows and the per-bill attribution needs no join table.
  const ops: any[] = [];
  const ids: string[] = [];
  for (const alloc of allocations) {
    const id = randomUUID();
    ids.push(id);
    const grnNo = openGrns.find((d) => d.id === alloc.id)?.no;
    // Payment + party LedgerEntry + the cash/bank AccountEntry, from the same
    // shared builder the recovery and installment-collection routes use.
    ops.push(...buildSettlementOps({
      kind: "payment",
      id,
      branchId,
      partyId,
      date: paymentDate,
      amount: alloc.amount,
      paymentMethod: method,
      accountId: account.accountId,
      notes: notes || (grnNo ? `Payment against GRN-${grnNo}` : null),
      grnId: alloc.id,
    }).ops);
  }

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  await prisma.$transaction(ops);

  return NextResponse.json({ ids, allocations }, { status: 201 });
}
