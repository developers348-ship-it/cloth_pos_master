import {
  BRANDING_SIZES,
  brandingInitial,
  parseDataUrl,
  readBrandingAsset,
  resolveBrandingBranch,
} from "@/lib/branding";
import { renderInitialIcon, renderUploadedIcon } from "@/lib/branding-image";

/**
 * The browser-tab icon, generated from the store's own branding.
 *
 * Next emits `<link rel="icon" href="/icon?…" type="image/png" sizes="64x64">`
 * for this file automatically — there is nothing to add to `layout.tsx`.
 *
 * **`app/favicon.ico` was removed for this.** The two conventions both emit an
 * icon link (the `.ico` with `sizes="any"`, this one with a real size), and
 * which one a browser then picks is a per-browser heuristic — so with both in
 * place the store's icon would appear in some browsers and the stock Next.js
 * logo in others. One source of the tab icon is the only version of this that
 * is predictable. `icon.tsx` is the one that can read the database; a
 * `favicon.ico` cannot be generated at all (Next's own note in
 * `node_modules/next/dist/docs/.../app-icons.md`).
 *
 * `force-dynamic` because branding changes at runtime. A code-generated icon is
 * statically optimised by default — rendered once at build and cached — which
 * would pin the tab icon to whatever the store was called when it was deployed.
 */
export const dynamic = "force-dynamic";

export const size = { width: BRANDING_SIZES.favicon, height: BRANDING_SIZES.favicon };
export const contentType = "image/png";

export default async function Icon() {
  const branch = await resolveBrandingBranch();
  if (!branch) return renderInitialIcon("?", size.width);

  const stored = await readBrandingAsset(branch.id, "favicon");
  // Only re-drawable formats go through satori here. An uploaded SVG or ICO is
  // served whole by `/api/branding/favicon`; this route has to answer with the
  // PNG it told the browser to expect, so for those it falls through to the
  // generated disc rather than emitting a PNG-labelled SVG.
  const parsed = parseDataUrl(stored);
  if (parsed && parsed.mime !== "image/svg+xml" && !parsed.mime.includes("icon")) {
    return renderUploadedIcon(stored!, size.width);
  }

  return renderInitialIcon(brandingInitial(branch.name), size.width);
}
