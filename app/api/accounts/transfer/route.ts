import { prisma } from "@/lib/prisma";
import { buildTransferOps, getAccountBalance } from "@/lib/accounts";
import { requirePermission } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/accounts/transfer
 * Body: { branchId, fromAccountId, toAccountId, amount, date?, notes? }
 *
 * Moves money between two of the store's own accounts — the case it exists for
 * is settling the Card Machine balance into a bank account when the processor
 * deposits, but cash-to-bank deposit runs work the same way.
 *
 * Nothing about a party or an invoice is involved: no customer's balance moves,
 * only where the store's own money sits.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("TRANSFER_FUNDS");
  if (!gate.ok) return gate.response;

  const { branchId, fromAccountId, toAccountId, amount, date, notes } = await req.json();

  if (!branchId || !fromAccountId || !toAccountId) {
    return NextResponse.json(
      { error: "branchId, fromAccountId and toAccountId are required" },
      { status: 400 }
    );
  }
  if (fromAccountId === toAccountId) {
    return NextResponse.json({ error: "Pick two different accounts" }, { status: 400 });
  }

  const moved = Number(amount);
  if (!(moved > 0)) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }

  const [from, to] = await Promise.all([
    prisma.account.findUnique({ where: { id: fromAccountId } }),
    prisma.account.findUnique({ where: { id: toAccountId } }),
  ]);
  if (!from || from.branchId !== branchId) {
    return NextResponse.json({ error: "Source account not found in this branch" }, { status: 404 });
  }
  if (!to || to.branchId !== branchId) {
    return NextResponse.json({ error: "Destination account not found in this branch" }, { status: 404 });
  }
  if (!to.isActive) {
    return NextResponse.json({ error: "The destination account is inactive" }, { status: 400 });
  }

  // Moving out more than an account holds would misstate both sides — the money
  // has to exist somewhere before it can be somewhere else.
  const available = await getAccountBalance(fromAccountId);
  if (moved - available > 0.005) {
    return NextResponse.json(
      { error: `${from.name} only holds ${available.toFixed(2)}` },
      { status: 400 }
    );
  }

  const movedAt = date ? new Date(date) : new Date();
  const { ops, reference } = await buildTransferOps({
    branchId,
    fromAccountId,
    toAccountId,
    amount: moved,
    date: movedAt,
    notes: notes || `${from.name} → ${to.name}`,
  });

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  await prisma.$transaction(ops);

  return NextResponse.json({
    reference,
    amount: moved,
    from: { id: from.id, name: from.name, balance: await getAccountBalance(fromAccountId) },
    to: { id: to.id, name: to.name, balance: await getAccountBalance(toAccountId) },
  }, { status: 201 });
}
