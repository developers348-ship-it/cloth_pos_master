import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/sync/status?branchId=
 * Returns count of PENDING records per table.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) {
    return NextResponse.json({ invoices: 0, grns: 0, ledger: 0, total: 0 });
  }

  const [invoices, grns, ledger] = await Promise.all([
    prisma.saleInvoice.count({ where: { branchId, syncStatus: "PENDING" } }),
    prisma.gRN.count({ where: { branchId, syncStatus: "PENDING" } }),
    prisma.ledgerEntry.count({ where: { branchId } }), // LedgerEntry has no syncStatus; always 0
  ]);

  // LedgerEntry doesn't have syncStatus — entries are always server-side
  const total = invoices + grns;

  return NextResponse.json({ invoices, grns, ledger: 0, total });
}
