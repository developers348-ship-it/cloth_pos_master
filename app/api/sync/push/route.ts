import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/sync/push
 * Body: { branchId }
 *
 * Marks all PENDING SaleInvoices and GRNs as SYNCED for the branch.
 * In a real offline-first scenario, the client would send the actual records;
 * here we trust that since API routes write directly to Postgres, records are
 * already correct — we just need to flip the syncStatus flag.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branchId } = body;

  if (!branchId) {
    return NextResponse.json({ error: "branchId required" }, { status: 400 });
  }

  const [invoiceResult, grnResult] = await Promise.all([
    prisma.saleInvoice.updateMany({
      where: { branchId, syncStatus: "PENDING" },
      data: { syncStatus: "SYNCED" },
    }),
    prisma.gRN.updateMany({
      where: { branchId, syncStatus: "PENDING" },
      data: { syncStatus: "SYNCED" },
    }),
  ]);

  const synced = invoiceResult.count + grnResult.count;

  return NextResponse.json({ synced, invoices: invoiceResult.count, grns: grnResult.count });
}
