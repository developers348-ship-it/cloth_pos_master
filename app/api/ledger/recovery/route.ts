import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { buildSettlementOps, resolveSettlementAccount } from "@/lib/accounts";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";
import { allocateFifo, allocationErrorMessage, validateAllocations, type Allocation } from "@/lib/settlement-allocation";
import { getOpenInvoices } from "@/lib/open-documents";

/**
 * GET /api/ledger/recovery?branchId=&from=&to=&partyId=
 * POST /api/ledger/recovery  — record cash collected from CR customer
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

  const rows = await prisma.recovery.findMany({
    where,
    include: {
      party: { select: { name: true, accountId: true, type: true } },
      account: { select: { name: true } },
      // `invoiceId` is already on the row; the number is what the tab shows,
      // and the pair is what makes the reference a link to the invoice page.
      invoice: { select: { invoiceNo: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  // `amount` is a Prisma Decimal, which serializes to JSON as a *string*. The
  // Recovery tab's footer sums these with reduce(), so leaving them as Decimals
  // string-concatenated the column (500 + 300 rendered as "500300"). Every
  // other endpoint in this app maps money to Number on the way out; this one
  // and its Payment twin were the two that didn't.
  const recoveries = rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    bankName: r.account?.name ?? r.bankName,
    invoiceNo: r.invoice?.invoiceNo ?? null,
  }));

  return NextResponse.json({ recoveries });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("RECORD_RECOVERY");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, partyId, date, amount, paymentMethod, accountId, notes } = body;
  /**
   * Optional per-invoice split from the Ledger screen: `[{ id, amount }]`.
   * Omitted (or empty) means "spread it oldest-first", which the server does
   * itself below — so an older client, or a quick collection with no interest
   * in the breakdown, still lands on real invoices.
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

  // The party's open invoices, re-read here rather than taken from the client:
  // the cap on how much may be collected has to come from the database, or a
  // stale screen could authorise collecting more than the customer owes.
  const openInvoices = await getOpenInvoices(branchId, partyId);

  const allocations = requestedAllocations.length > 0
    ? requestedAllocations
    : allocateFifo(openInvoices, Number(amount)).allocations;

  const allocationError = validateAllocations({
    documents: openInvoices,
    allocations,
    amount: Number(amount),
  });
  if (allocationError) {
    return NextResponse.json({ error: allocationErrorMessage(allocationError) }, { status: 400 });
  }

  const collectionDate = date ? new Date(date) : new Date();

  // One Recovery row per invoice settled, each carrying that invoice's id.
  // `Recovery.invoiceId` is a single FK, and every reader of it
  // (`invoiceOutstanding`, the payment-status badge, Mark Unpaid) sums the rows
  // that point at an invoice — so a split collection is naturally modelled as
  // several rows, and the per-bill attribution the shop asked for comes for
  // free rather than needing a new join table.
  const ops: any[] = [];
  const ids: string[] = [];
  for (const alloc of allocations) {
    const id = randomUUID();
    ids.push(id);
    const invoiceNo = openInvoices.find((d) => d.id === alloc.id)?.no;
    // Recovery + party LedgerEntry + the cash/bank AccountEntry, all from the
    // one shared builder so this and an installment collection stay in step.
    // Before Phase 5 this route moved the party balance but never the
    // cash/bank balance.
    ops.push(...buildSettlementOps({
      kind: "recovery",
      id,
      branchId,
      partyId,
      date: collectionDate,
      amount: alloc.amount,
      paymentMethod: method,
      accountId: account.accountId,
      notes: notes || (invoiceNo ? `Recovery against INV-${invoiceNo}` : null),
      invoiceId: alloc.id,
    }).ops);
  }

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  await prisma.$transaction(ops);

  return NextResponse.json({ ids, allocations }, { status: 201 });
}
