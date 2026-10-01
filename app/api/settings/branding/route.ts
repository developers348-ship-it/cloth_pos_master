import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import {
  clearBrandingAsset,
  isBrandingAsset,
  readBrandingSummary,
  toDataUrl,
  validateBrandingUpload,
  writeBrandingAsset,
} from "@/lib/branding";

/**
 * The store's branding images — favicon, logo and the two PWA icons.
 *
 * Replaces `POST /api/settings/icon`, which wrote the two PWA icons into
 * `/public` with `fs.writeFile`. That route could not work on Vercel (read-only
 * filesystem at runtime) and lost the icon on every deploy anywhere else; the
 * reasoning is in full at the top of `lib/branding.ts`. Bytes now go in a
 * `Setting` row instead, which needed no migration and is picked up by the
 * existing backup.
 *
 * - `GET    ?branchId=` — which assets are set, their type, size and date
 * - `POST` — multipart `asset` + `file`
 * - `DELETE ?branchId=&asset=` — back to the generated first-character disc
 */

/** Reading which icons exist is not gated, matching the other settings GETs. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }
  return NextResponse.json({ assets: await readBrandingSummary(branchId) });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("EDIT_STORE_SETTINGS");
  if (!gate.ok) return gate.response;

  const form = await req.formData();
  const asset = String(form.get("asset") ?? "");
  const branchId = String(form.get("branchId") ?? "");
  const file = form.get("file");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }
  if (!isBrandingAsset(asset)) {
    return NextResponse.json({ error: "Unknown branding asset" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was uploaded" }, { status: 400 });
  }

  const check = validateBrandingUpload(file);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // Read the bytes only after the size check has passed, so an oversized upload
  // is refused without being pulled into memory first.
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeBrandingAsset(branchId, asset, toDataUrl(file.type, bytes));

  return NextResponse.json({ asset, mime: file.type, bytes: bytes.length });
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePermission("EDIT_STORE_SETTINGS");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const asset = searchParams.get("asset") ?? "";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }
  if (!isBrandingAsset(asset)) {
    return NextResponse.json({ error: "Unknown branding asset" }, { status: 400 });
  }

  await clearBrandingAsset(branchId, asset);
  return NextResponse.json({ asset, cleared: true });
}
