import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * PATCH /api/accounts/[id]
 * Update a Bank account's name/bank name/account number/opening balance, or
 * toggle isActive. The default Cash account can have its opening balance
 * edited but never be deactivated or renamed away from being the branch's
 * cash account — deactivating it would orphan every cash sale posting.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("EDIT_ACCOUNT");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();
  const { name, bankName, accountNumber, openingBalance, isActive } = body;

  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (account.isDefaultCash && isActive === false) {
    return NextResponse.json({ error: "The default Cash account cannot be deactivated" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (bankName !== undefined) data.bankName = bankName?.trim() || null;
  if (accountNumber !== undefined) data.accountNumber = accountNumber?.trim() || null;
  if (openingBalance !== undefined) data.openingBalance = openingBalance;
  if (isActive !== undefined) data.isActive = isActive;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.account.update({ where: { id }, data });
  return NextResponse.json({ account: updated });
}

/**
 * DELETE /api/accounts/[id]
 *
 * Only ever removes a bank account that nothing has been posted through. Once
 * an account carries entries, deleting it would leave the sales, GRNs and
 * recoveries that reference it pointing at nothing and silently drop that money
 * from every balance — deactivating is the correct move there, and the error
 * says so. The house Cash and Card accounts are never deletable at all: they
 * are recreated on the next money-moving request anyway.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("DELETE_ACCOUNT");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (account.type !== "BANK") {
    return NextResponse.json(
      { error: "Only bank accounts can be deleted" },
      { status: 400 }
    );
  }

  // Entries are the account's own statement; the other four are rows elsewhere
  // that name it as where their money went. Any one of them makes the account
  // load-bearing.
  const [entries, invoices, grns, recoveries, payments] = await Promise.all([
    prisma.accountEntry.count({ where: { accountId: id } }),
    prisma.saleInvoice.count({ where: { bankAccountId: id } }),
    prisma.gRN.count({ where: { bankAccountId: id } }),
    prisma.recovery.count({ where: { accountId: id } }),
    prisma.payment.count({ where: { accountId: id } }),
  ]);
  const used = entries + invoices + grns + recoveries + payments;

  if (used > 0) {
    return NextResponse.json(
      {
        error: `${account.name} has ${used} transaction${used === 1 ? "" : "s"} against it and cannot be deleted. Deactivate it instead — it will stop appearing in payment dropdowns but its history stays intact.`,
      },
      { status: 409 }
    );
  }

  await prisma.account.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
