import { prisma } from "@/lib/prisma";
import { validateCreditApplied } from "@/lib/party-balance";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * PATCH /api/sales/:id/party   { partyId }
 *
 * Reassigns a saved invoice to a different customer — the fix for a wrongly
 * selected party, which previously meant voiding and re-ringing the whole sale.
 *
 * Everything booked against the invoice moves with it, not just the invoice row:
 * its SALE LedgerEntry (so the old customer stops owing the bill and the new one
 * starts), the cash/bank AccountEntry rows' party attribution, any installment
 * plan, and any money collected against the invoice since (Mark Paid recoveries
 * and installment collections, together with their own ledger and account
 * entries). A wrongly selected customer means the whole document belonged to
 * someone else, so a half-moved invoice would leave both balances wrong.
 *
 * The cash/bank amounts themselves never move — the money is in the same
 * account either way; only who it came from changes.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("CHANGE_INVOICE_CUSTOMER");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();
  const partyId: string | undefined = body?.partyId;

  if (!partyId) {
    return NextResponse.json({ error: "partyId is required" }, { status: 400 });
  }

  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    select: {
      id: true, invoiceNo: true, branchId: true, partyId: true,
      netBill: true, creditApplied: true, status: true,
      installmentPlan: { select: { id: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.partyId === partyId) {
    return NextResponse.json({ error: "That is already this invoice's customer" }, { status: 400 });
  }

  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, accountId: true, type: true, isDefault: true, isActive: true },
  });
  if (!party) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (!party.isActive) {
    return NextResponse.json({ error: "That customer is inactive" }, { status: 400 });
  }
  if (party.type === "VENDOR") {
    return NextResponse.json(
      { error: "Vendor balances are settled through purchases — a sale can't be billed to a vendor" },
      { status: 400 }
    );
  }

  const creditApplied = Number(invoice.creditApplied);

  // The shared Walking Customer can't hold store credit or a repayment plan
  // (lib/party-balance.ts) — moving credit or a schedule onto it would park one
  // person's obligation on an anonymous account every later walk-in shares.
  if (party.isDefault && (creditApplied > 0.005 || invoice.installmentPlan)) {
    return NextResponse.json({
      error: invoice.installmentPlan
        ? "An invoice with an installment plan can't be moved to the walking customer"
        : "An invoice that used store credit can't be moved to the walking customer",
    }, { status: 400 });
  }

  // Store credit was consumed from the *old* customer. Moving the bill hands
  // that credit back to them, so the new customer has to genuinely hold as much
  // — otherwise the move would write off a bill against credit nobody has. Their
  // live balance excludes this invoice (its ledger row still sits on the old
  // party at this point), which is exactly the position to check against.
  if (creditApplied > 0.005) {
    const creditCheck = await validateCreditApplied({
      partyId,
      branchId: invoice.branchId,
      creditApplied,
      netBill: Number(invoice.netBill),
    });
    if (!creditCheck.ok) {
      return NextResponse.json(
        { error: `${creditCheck.error} — clear the store credit on this invoice before moving it` },
        { status: 400 }
      );
    }
  }

  const recoveries = await prisma.recovery.findMany({
    where: { invoiceId: id },
    select: { id: true },
  });
  const recoveryIds = recoveries.map((r) => r.id);

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  const ops: any[] = [
    prisma.saleInvoice.update({ where: { id }, data: { partyId } }),
    // A voided invoice has no ledger/account rows to move (they were deleted on
    // void and are rebuilt from invoice.partyId on restore); the updateMany
    // calls below are simply no-ops in that case.
    prisma.ledgerEntry.updateMany({ where: { invoiceId: id }, data: { partyId } }),
    prisma.accountEntry.updateMany({ where: { invoiceId: id }, data: { partyId } }),
    prisma.installmentPlan.updateMany({ where: { invoiceId: id }, data: { partyId } }),
  ];

  if (recoveryIds.length > 0) {
    ops.push(
      prisma.recovery.updateMany({ where: { id: { in: recoveryIds } }, data: { partyId } }),
      prisma.ledgerEntry.updateMany({ where: { recoveryId: { in: recoveryIds } }, data: { partyId } }),
      prisma.accountEntry.updateMany({ where: { recoveryId: { in: recoveryIds } }, data: { partyId } }),
    );
  }

  await prisma.$transaction(ops);

  return NextResponse.json({
    id: invoice.id,
    partyId: party.id,
    partyName: party.name,
    accountId: party.accountId,
    movedSettlements: recoveryIds.length,
  });
}
