import { getOpenGrns, getOpenInvoices } from "@/lib/open-documents";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ledger/open-documents?branchId=&partyId=&side=sales|purchase
 *
 * The party's still-unsettled bills, oldest first, with a summary — what the
 * Ledger page's Recovery/Payment forms show the moment a party is picked, so
 * the cashier can see *where* the money is owed from before typing an amount.
 *
 * `side=sales` lists a customer's invoices (recoveries attach to these by
 * `Recovery.invoiceId`); `side=purchase` lists a vendor's GRNs. The queries
 * themselves live in lib/open-documents.ts, shared with the POST handlers that
 * validate an allocation against this same list.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const partyId = searchParams.get("partyId");
  const side = searchParams.get("side") ?? "sales";

  if (!branchId || !partyId) {
    return NextResponse.json({ error: "branchId and partyId are required" }, { status: 400 });
  }

  const documents = side === "purchase"
    ? await getOpenGrns(branchId, partyId)
    : await getOpenInvoices(branchId, partyId);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return NextResponse.json({
    side,
    documents,
    summary: {
      count: documents.length,
      totalOutstanding: round2(documents.reduce((s, d) => s + d.outstanding, 0)),
      totalBilled: round2(documents.reduce((s, d) => s + d.netBill, 0)),
      oldestDate: documents[0]?.date ?? null,
    },
  });
}
