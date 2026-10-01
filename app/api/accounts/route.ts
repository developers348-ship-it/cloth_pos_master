import { prisma } from "@/lib/prisma";
import { getOrCreateCardAccount, getOrCreateCashAccount, listAccountsWithBalances } from "@/lib/accounts";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * GET /api/accounts?branchId=&includeInactive=
 * Lists the branch's Cash + Card + Bank accounts with live balances. Lazily
 * provisions the house accounts on first call for a branch.
 *
 * Deliberately ungated: every till fetches this to fill the bank-account
 * dropdown at checkout, so requiring VIEW_ACCOUNTS here would stop a cashier
 * banking a payment. The page that shows these as a managed list checks
 * VIEW_ACCOUNTS client-side; the mutating routes below are what is enforced.
 *
 * `includeInactive=1` is what the Accounts page passes — a deactivated account
 * must still be listed there (so it can be reactivated) but must never appear
 * in a payment dropdown, which is why the default stays active-only.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const includeInactive = searchParams.get("includeInactive") === "1";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  // Both house accounts are provisioned here so they show on the Accounts page
  // from the first visit, rather than only appearing once a sale happens to use
  // them.
  await getOrCreateCashAccount(branchId);
  await getOrCreateCardAccount(branchId);
  const accounts = await listAccountsWithBalances(branchId, { includeInactive });

  return NextResponse.json({ accounts });
}

/**
 * POST /api/accounts
 * Creates a new Bank account for a branch. Cash and Card accounts are never
 * user-creatable — only the lazy find-or-create in lib/accounts.ts makes those.
 * Body: { branchId, name, bankName?, accountNumber?, openingBalance? }
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("CREATE_ACCOUNT");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, name, bankName, accountNumber, openingBalance } = body;

  if (!branchId || !name?.trim()) {
    return NextResponse.json({ error: "branchId and name are required" }, { status: 400 });
  }

  const account = await prisma.account.create({
    data: {
      branchId,
      type: "BANK",
      name: name.trim(),
      bankName: bankName?.trim() || null,
      accountNumber: accountNumber?.trim() || null,
      openingBalance: openingBalance || 0,
    },
  });

  return NextResponse.json({ account }, { status: 201 });
}
