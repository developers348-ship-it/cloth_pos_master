import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) {
    return NextResponse.json({ error: "branchId required" }, { status: 400 });
  }

  const last = await prisma.gRN.findFirst({
    where: { branchId },
    orderBy: { grnNo: "desc" },
    select: { grnNo: true },
  });

  return NextResponse.json({ grnNo: (last?.grnNo ?? 0) + 1 });
}
