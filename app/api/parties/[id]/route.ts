import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("EDIT_PARTY");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const existing = await prisma.party.findUnique({ where: { id }, select: { isDefault: true, creditLimit: true, previousBalance: true } });
  if (existing?.isDefault) {
    return NextResponse.json({ error: "The default walking customer cannot be edited" }, { status: 400 });
  }
  const body = await req.json();
  // Whitelist, not a blacklist: the edit form sends back the whole row it was
  // opened with, and the Parties list adds a computed `balance` (plus
  // createdAt/updatedAt/isActive) that Prisma rejects as unknown or must not
  // be client-writable.
  const EDITABLE = ["name", "address", "city", "phone", "mobile", "type", "previousBalance", "creditLimit", "notes"] as const;
  const data: Record<string, unknown> = {};
  for (const k of EDITABLE) if (body[k] !== undefined) data[k] = body[k];

  // The opening balance is the starting point every live balance is computed
  // from, so changing it once trades exist silently rewrites the party's whole
  // history with no dated entry. Settling money goes through a Recovery or
  // Payment instead; a typo can still be corrected while nothing is posted.
  if (
    data.previousBalance !== undefined &&
    Math.abs(Number(data.previousBalance) - Number(existing?.previousBalance ?? 0)) > 0.005
  ) {
    const posted = await prisma.ledgerEntry.count({ where: { partyId: id } });
    if (posted > 0) {
      return NextResponse.json(
        { error: "Opening balance can't be changed once the party has transactions. Record a Recovery or Payment on the Ledger page instead." },
        { status: 400 }
      );
    }
  }

  // Only checked when the limit is actually moving up from what it was — an
  // edit that leaves it alone (or lowers it) needs nothing extra on top of
  // EDIT_PARTY.
  if (
    data.creditLimit !== undefined &&
    Number(data.creditLimit) > Number(existing?.creditLimit ?? 0)
  ) {
    const limitGate = await requirePermission("SET_CREDIT_LIMIT");
    if (!limitGate.ok) return limitGate.response;
  }

  const party = await prisma.party.update({ where: { id }, data });
  return NextResponse.json(party);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("DELETE_PARTY");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const invoiceCount = await prisma.saleInvoice.count({ where: { partyId: id } });
  if (invoiceCount > 0) return NextResponse.json({ error: "Party has transactions" }, { status: 400 });
  await prisma.party.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
