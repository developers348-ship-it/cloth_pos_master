import { getPartyBalance } from "@/lib/party-balance";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/parties/[id]/balance?branchId=
 *
 * Live balance for one party in one branch — the single-party counterpart to
 * GET /api/ledger/outstanding (which aggregates every party of a type).
 * Read by the Sales page to show how much store credit a customer is holding
 * and how much of it can be applied to the bill on screen.
 *
 * `balance` is signed: positive means the party owes the store, negative means
 * the store owes the party. `availableCredit` is that negative side expressed
 * as a positive spendable amount (0 for parties that can't spend credit).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const balance = await getPartyBalance(id, branchId);
  if (!balance) {
    return NextResponse.json({ error: "Party not found" }, { status: 404 });
  }

  return NextResponse.json(balance);
}
