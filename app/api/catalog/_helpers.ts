import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Generic catalog CRUD — used by categories, brands, groups
// Each is routed via its own file that calls these helpers

export async function getCatalog(model: "itemCategory" | "itemBrand" | "itemGroup") {
  const items = await (prisma[model] as any).findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items });
}

export async function createCatalog(
  model: "itemCategory" | "itemBrand" | "itemGroup",
  req: NextRequest
) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const item = await (prisma[model] as any).create({ data: { name: name.trim() } });
    return NextResponse.json(item, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Name already exists" }, { status: 409 });
  }
}

export async function updateCatalog(
  model: "itemCategory" | "itemBrand" | "itemGroup",
  id: string,
  req: NextRequest
) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const item = await (prisma[model] as any).update({
      where: { id },
      data: { name: name.trim() },
    });
    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ error: "Name already exists or not found" }, { status: 409 });
  }
}

export async function deleteCatalog(
  model: "itemCategory" | "itemBrand" | "itemGroup",
  id: string
) {
  await (prisma[model] as any).update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
