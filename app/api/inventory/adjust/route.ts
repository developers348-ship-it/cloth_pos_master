import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

export async function POST(req: NextRequest) {
  const gate = await requirePermission("ADJUST_STOCK");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, itemId, type, qty, reason } = body;

  if (!branchId || !itemId || !type || !qty) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const delta = type === "ADD" ? Number(qty) : -Number(qty);

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  const [, updated] = await prisma.$transaction([
    prisma.stockAdjustment.create({
      data: {
        branchId,
        itemId,
        type: type as "ADD" | "SUBTRACT",
        qty: Number(qty),
        reason: reason || null,
      },
    }),
    prisma.itemStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      update: { qty: { increment: delta } },
      create: { itemId, branchId, qty: Math.max(0, delta) },
    }),
  ]);

  return NextResponse.json({ qty: Number(updated.qty) }, { status: 201 });
}
