import { NextRequest } from "next/server";
import { updateCatalog, deleteCatalog } from "@/app/api/catalog/_helpers";
import { requirePermission } from "@/lib/authz";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("EDIT_ITEM");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  return updateCatalog("itemGroup", id, req);
}
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("DELETE_ITEM");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  return deleteCatalog("itemGroup", id);
}
