import { NextRequest, NextResponse } from "next/server";
import {
  BRANDING_SIZES,
  brandingInitial,
  isBrandingAsset,
  parseDataUrl,
  readBrandingAsset,
  resolveBrandingBranch,
} from "@/lib/branding";
import { renderInitialIcon, renderUploadedIcon } from "@/lib/branding-image";

/**
 * GET /api/branding/:asset — `favicon | logo | icon192 | icon512`
 *
 * Serves the store's branding image: the uploaded one if there is one, else the
 * generated first-character disc. Referenced by `app/manifest.ts` (the PWA
 * icons) and by anything on screen that wants the logo.
 *
 * **Deliberately unauthenticated.** The browser fetches the manifest's icons
 * with no session, and on the login screen there is none to have. A store's
 * name and logo are on its shopfront and printed on every invoice it hands out,
 * so there is nothing here to protect. Writing it is a different matter — that
 * is `/api/settings/branding`, gated on `EDIT_STORE_SETTINGS`.
 *
 * `force-dynamic` because branding changes at runtime: without it Next would
 * treat this as a static route handler, render it once at build time and serve
 * the icon the store had when it was deployed.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (!isBrandingAsset(asset)) {
    return NextResponse.json({ error: "Unknown branding asset" }, { status: 404 });
  }

  const branch = await resolveBrandingBranch();
  const size = BRANDING_SIZES[asset];

  // No branch at all (a database that has not been seeded): still answer with
  // an image rather than a 404, so a broken icon is never what tells someone
  // their database is empty.
  if (!branch) {
    return withIconHeaders(renderInitialIcon("?", size));
  }

  const stored = await readBrandingAsset(branch.id, asset);
  const parsed = parseDataUrl(stored);

  if (parsed) {
    // SVG and ICO are handed back as-is. Re-drawing them through `next/og`
    // would rasterise an SVG (losing the reason to use one) and satori cannot
    // read an ICO at all; both are already valid icon formats, at every size.
    if (parsed.mime === "image/svg+xml" || parsed.mime.includes("icon")) {
      return new NextResponse(new Uint8Array(parsed.bytes), {
        headers: { ...ICON_HEADERS, "Content-Type": parsed.mime },
      });
    }
    return withIconHeaders(renderUploadedIcon(stored!, size));
  }

  // Nothing uploaded for this asset. The logo has one more thing to try: the
  // `logoUrl` text field, which predates uploads and may hold an external URL.
  if (asset === "logo" && branch.logoUrl && /^https?:\/\//i.test(branch.logoUrl)) {
    return NextResponse.redirect(branch.logoUrl, 307);
  }

  return withIconHeaders(renderInitialIcon(brandingInitial(branch.name), size));
}

/**
 * `must-revalidate` rather than a long max-age: an icon changes the moment a
 * shopkeeper uploads one, and a cached tab icon that outlives the change reads
 * as "the upload didn't work". These are small images on a shop LAN, so
 * revalidating costs little.
 */
const ICON_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

function withIconHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ICON_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
