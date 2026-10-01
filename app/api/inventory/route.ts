import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const search = searchParams.get("search") ?? "";
  const lowStockOnly = searchParams.get("lowStock") === "true";
  // Paging is optional: without `limit` the whole list comes back, as before.
  const limit = Math.max(0, Number(searchParams.get("limit")) || 0);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  if (!branchId) {
    return NextResponse.json({ error: "branchId required" }, { status: 400 });
  }

  const items = await prisma.item.findMany({
    where: {
      isActive: true,
      ...(search ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
          { systemBarcode: { contains: search } },
        ],
      } : {}),
    },
    include: {
      stockLevels: {
        where: { branchId },
        select: { qty: true, updatedAt: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = items
    .map((item) => {
      const stock = item.stockLevels[0];
      const qty = Number(stock?.qty ?? 0);
      const minLevel = Number(item.minLevel);
      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        barcode: item.barcode,
        systemBarcode: item.systemBarcode,
        purchasePrice: Number(item.purchasePrice),
        salePrice: Number(item.salePrice),
        minLevel,
        qty,
        updatedAt: stock?.updatedAt ?? null,
        status: qty <= 0 ? "OUT" : qty <= minLevel ? "LOW" : "OK",
      };
    });

  // Status is derived from stock, not stored, so both the counts and the
  // low-stock filter have to run here, after the query, and paging after them.
  // The counts cover every item the search matched — not just the low-only
  // filter or the page in view — so the summary tiles don't change as you page.
  const counts = { ok: 0, low: 0, out: 0 };
  for (const item of result) {
    if (item.status === "OK") counts.ok++;
    else if (item.status === "LOW") counts.low++;
    else counts.out++;
  }

  const filtered = lowStockOnly ? result.filter((item) => item.status !== "OK") : result;
  const paged = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;

  return NextResponse.json({ items: paged, total: filtered.length, counts });
}
