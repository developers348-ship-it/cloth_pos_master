import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/stock?branchId=&lowOnly=true|false
 *
 * Returns current stock levels per item with status badges.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const lowOnly = searchParams.get("lowOnly") === "true";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const stocks = await prisma.itemStock.findMany({
    where: { branchId, item: { isActive: true } },
    include: {
      item: {
        select: {
          id: true,
          name: true,
          category: true,
          brand: true,
          unit: true,
          purchaseUnit: true,
          piecesPerBundle: true,
          salePrice: true,
          purchasePrice: true,
          minLevel: true,
          openingStock: true,
          barcode: true,
        },
      },
    },
    orderBy: { item: { name: "asc" } },
  });

  const rows = stocks.map((s) => {
    const qty = Number(s.qty);
    const minLevel = Number(s.item.minLevel);
    let status: "OK" | "LOW" | "OUT" = "OK";
    if (qty <= 0) status = "OUT";
    else if (qty <= minLevel) status = "LOW";

    return {
      itemId: s.item.id,
      name: s.item.name,
      category: s.item.category ?? "—",
      brand: s.item.brand ?? "—",
      barcode: s.item.barcode ?? "",
      unit: s.item.unit,
      // Informational — the report renders a "bought as" line from it. Stock
      // and both prices are all in `unit`, so nothing here converts.
      purchaseUnit: s.item.purchaseUnit ?? null,
      piecesPerBundle: s.item.piecesPerBundle ?? null,
      purchasePrice: Number(s.item.purchasePrice),
      salePrice: Number(s.item.salePrice),
      openingStock: Number(s.item.openingStock),
      currentStock: qty,
      minLevel,
      status,
    };
  });

  const filtered = lowOnly ? rows.filter((r) => r.status !== "OK") : rows;

  const totals = {
    itemCount: filtered.length,
    // Retail Value is what the stock on hand would fetch: qty x sale price.
    totalValue: filtered.reduce((s, r) => s + r.currentStock * r.salePrice, 0),
    // The Sale Price column added up — the list price of one of everything,
    // independent of how many are in stock. Deliberately not qty-weighted;
    // that figure is `totalValue` above.
    totalSalePrice: filtered.reduce((s, r) => s + r.salePrice, 0),
    lowCount: rows.filter((r) => r.status === "LOW").length,
    outCount: rows.filter((r) => r.status === "OUT").length,
  };

  return NextResponse.json({ stock: filtered, totals });
}
