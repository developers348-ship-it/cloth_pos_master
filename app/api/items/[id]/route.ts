import { prisma } from "@/lib/prisma";
import { barcodeConflictMessage, findBarcodeOwner, findNameOwner, nameConflictMessage, pickItemFields } from "@/lib/items";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

/**
 * PUT /api/items/:id
 *
 * Only the columns in `pickItemFields` are written. The body used to be passed
 * to Prisma as-is, which meant the edit form's payload — a row from
 * `GET /api/items`, carrying the derived `currentStock` — failed validation and
 * no item could be edited at all.
 *
 * Partial bodies are fine and normal: the GRN's barcode-attach path sends
 * `{ barcode }` alone.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("EDIT_ITEM");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json();
  const data = pickItemFields(body, { partial: true });

  // ── Setting stock from the edit form ───────────────────────────────────────
  // `stockQty` is an **absolute** figure, not a delta: the form shows what is on
  // the shelf and the operator types what it should be. It is deliberately not
  // part of `pickItemFields` — stock lives on `ItemStock`, per branch, and is
  // not a column on `Item`.
  //
  // Gated on ADJUST_STOCK *in addition to* EDIT_ITEM. Without that second check
  // this route would be a way around the stock permission: a cashier who may
  // rename an item could set its quantity to anything by editing it.
  const wantsStock =
    body.stockQty !== undefined && body.stockQty !== null && body.stockQty !== "";
  const branchId = typeof body.branchId === "string" ? body.branchId : "";

  if (wantsStock) {
    const stockGate = await requirePermission("ADJUST_STOCK");
    if (!stockGate.ok) return stockGate.response;
    if (!branchId) {
      return NextResponse.json(
        { error: "branchId is required to change stock" },
        { status: 400 }
      );
    }
    const n = Number(body.stockQty);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "Quantity must be 0 or more" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(data).length === 0 && !wantsStock) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Gated on top of EDIT_ITEM, same shape as ADJUST_STOCK above — only
  // checked when the sale price is actually part of this edit, so a
  // barcode-only or description-only save needs nothing extra.
  if (data.salePrice !== undefined) {
    const priceGate = await requirePermission("EDIT_SALE_PRICE");
    if (!priceGate.ok) return priceGate.response;
  }

  // A rename can't land on another item's name; excluding this item lets an
  // edit that keeps (or re-cases) its own name through.
  if (typeof data.name === "string") {
    const owner = await findNameOwner(prisma, data.name, id);
    if (owner) {
      return NextResponse.json(
        { error: nameConflictMessage(owner), conflictItemId: owner.id },
        { status: 409 }
      );
    }
  }

  // Same rule as create, minus this item itself — saving an edit that leaves the
  // barcode alone must not report the item as its own duplicate. This also
  // covers the GRN's barcode-attach path, which sends `{ barcode }` on its own
  // and is exactly where a code gets pinned to a second item by accident.
  if (typeof data.barcode === "string" && data.barcode) {
    const owner = await findBarcodeOwner(prisma, data.barcode, id);
    if (owner) {
      return NextResponse.json(
        { error: barcodeConflictMessage(data.barcode, owner), conflictItemId: owner.id },
        { status: 409 }
      );
    }
  }

  const item =
    Object.keys(data).length > 0
      ? await prisma.item.update({ where: { id }, data })
      : await prisma.item.findUniqueOrThrow({ where: { id } });

  if (wantsStock) {
    const target = Number(body.stockQty);
    const existing = await prisma.itemStock.findUnique({
      where: { itemId_branchId: { itemId: id, branchId } },
      select: { qty: true },
    });
    const current = Number(existing?.qty ?? 0);
    const delta = target - current;

    if (delta !== 0) {
      // Recorded as a StockAdjustment for the same reason `/api/inventory/adjust`
      // does: stock that changes with no trace is stock nobody can reconcile.
      // The row stores the magnitude and a direction, so the absolute set is
      // written to the history as the movement it actually was.
      await prisma.$transaction([
        prisma.stockAdjustment.create({
          data: {
            branchId,
            itemId: id,
            type: delta > 0 ? "ADD" : "SUBTRACT",
            qty: Math.abs(delta),
            reason: "Set from item edit",
          },
        }),
        prisma.itemStock.upsert({
          where: { itemId_branchId: { itemId: id, branchId } },
          update: { qty: target },
          create: { itemId: id, branchId, qty: target },
        }),
      ]);
    }
  }

  return NextResponse.json(item);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("DELETE_ITEM");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  await prisma.item.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
