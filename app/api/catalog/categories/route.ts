import { NextRequest } from "next/server";
import { getCatalog, createCatalog } from "@/app/api/catalog/_helpers";
import { requirePermission } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  return getCatalog("itemCategory");
}
export async function POST(req: NextRequest) {
  const gate = await requirePermission("ADD_ITEM");
  if (!gate.ok) return gate.response;

  return createCatalog("itemCategory", req);
}
