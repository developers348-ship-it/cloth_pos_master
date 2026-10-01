import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) return NextResponse.json({ invoiceNo: 1 });

  const last = await prisma.saleInvoice.findFirst({
    where: { branchId },
    orderBy: { invoiceNo: "desc" },
    select: { invoiceNo: true },
  });

  return NextResponse.json({ invoiceNo: (last?.invoiceNo ?? 0) + 1 });
}
