import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { clampReceiptFontSize } from "@/lib/receipt-font";

// GET /api/settings/store?branchId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  if (!branchId) {
    // Return first branch as default
    const branch = await prisma.branch.findFirst({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ branch });
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  return NextResponse.json({ branch });
}

// PUT /api/settings/store
export async function PUT(req: NextRequest) {
  const gate = await requirePermission("EDIT_STORE_SETTINGS");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, ...data } = body;

  // Remove fields that shouldn't be updated
  const { orgId, id, createdAt, updatedAt, ...updateData } = data;

  // The font size arrives from a text input, so it can be "", "abc" or 400.
  // Prisma would reject the first two and happily store the third, which would
  // print one word per line, so it is clamped rather than trusted.
  if ("receiptFontSize" in updateData) {
    updateData.receiptFontSize = clampReceiptFontSize(updateData.receiptFontSize);
  }

  const branch = await prisma.branch.update({
    where: { id: branchId },
    data: updateData,
  });

  return NextResponse.json({ branch });
}
