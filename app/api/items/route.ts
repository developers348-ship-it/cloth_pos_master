import { prisma } from "@/lib/prisma";
import { barcodeConflictMessage, findBarcodeOwner, findNameOwner, nameConflictMessage, pickItemFields } from "@/lib/items";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Accept both 'q' (sales page) and 'search' (purchases page) as search param
  const q = searchParams.get("q") ?? searchParams.get("search") ?? "";
  const branchId = searchParams.get("branchId");
  const limit = Number(searchParams.get("limit") ?? "20");
  // 1-based. Defaulting to 1 keeps every existing caller (the sales/purchases
  // party-search autocomplete, which never passes `page`) on exactly the same
  // first-`limit`-rows behaviour as before this was added.
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const where: any = { isActive: true };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q, mode: "insensitive" } },
      { systemBarcode: { contains: q } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: "asc" },
      include: {
        stockLevels: branchId
          ? { where: { branchId } }
          : false,
      },
    }),
    prisma.item.count({ where }),
  ]);

  // The Items page feeds these rows straight into the edit form, so the
  // projection has to carry every field that form writes back — otherwise
  // saving an edit would silently blank the ones it never received.
  const result = items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    unit: item.unit,
    purchaseUnit: item.purchaseUnit ?? null,
    piecesPerBundle: item.piecesPerBundle ?? null,
    clothType: item.clothType ?? null,
    barcode: item.barcode ?? null,
    systemBarcode: item.systemBarcode,
    categoryId: item.categoryId ?? "",
    brandId: item.brandId ?? "",
    groupId: item.groupId ?? "",
    purchasePrice: Number(item.purchasePrice),
    salePrice: Number(item.salePrice),
    altSalePrice: item.altSalePrice ? Number(item.altSalePrice) : undefined,
    discountRS: Number(item.discountRS),
    discountPct: Number(item.discountPct),
    openingStock: Number(item.openingStock),
    minLevel: Number(item.minLevel),
    isActive: item.isActive,
    // Derived from ItemStock, not a column on Item — never send it back in an
    // update payload (see lib/items.ts).
    currentStock: branchId && item.stockLevels?.length
      ? Number((item.stockLevels as any[])[0]?.qty ?? 0)
      : 0,
  }));

  return NextResponse.json({ items: result, total, page, pageSize: limit });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("ADD_ITEM");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const { branchId, openingStock } = body;

  // Same whitelist as the update route, so create and edit accept exactly the
  // same shape and neither can be used to set columns it shouldn't.
  const data = pickItemFields(body, { partial: false });
  if (!data.name) {
    return NextResponse.json({ error: "Item name is required" }, { status: 400 });
  }

  if (Number(data.salePrice ?? 0) > 0) {
    const priceGate = await requirePermission("EDIT_SALE_PRICE");
    if (!priceGate.ok) return priceGate.response;
  }

  if (typeof data.name === "string") {
    const owner = await findNameOwner(prisma, data.name);
    if (owner) {
      return NextResponse.json(
        { error: nameConflictMessage(owner), conflictItemId: owner.id },
        { status: 409 }
      );
    }
  }

  // A barcode has to resolve to exactly one item or a scan is a coin toss.
  // Nothing in the schema enforces that (see lib/items.ts `findBarcodeOwner`).
  if (typeof data.barcode === "string" && data.barcode) {
    const owner = await findBarcodeOwner(prisma, data.barcode);
    if (owner) {
      return NextResponse.json(
        { error: barcodeConflictMessage(data.barcode, owner), conflictItemId: owner.id },
        { status: 409 }
      );
    }
  }

  const item = await prisma.item.create({ data: data as Prisma.ItemUncheckedCreateInput });

  if (branchId) {
    await prisma.itemStock.create({
      data: { itemId: item.id, branchId, qty: Number(openingStock ?? 0) },
    });
  }

  return NextResponse.json(item, { status: 201 });
}
