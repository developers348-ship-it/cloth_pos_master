import type { MetadataRoute } from "next";
import { BRAND_COLOR, brandingShortName, resolveBrandingBranch } from "@/lib/branding";

/**
 * The PWA manifest, built from the store's own settings.
 *
 * **This replaced `public/manifest.json`**, which was a hand-written file
 * naming a hard-coded shop ("Sidhey Sheikh Cloth Center POS") and pointing at
 * `/icon-192.png` and `/icon-512.png` — two files that were never in the
 * repository, so every install fell back to a screenshot of the page. Renaming
 * the store in Settings did nothing to it.
 *
 * The static file had to go rather than sit alongside this, being the same
 * document served twice from two places.
 *
 * ## It is served at `/manifest.webmanifest`, not `/manifest.json`
 *
 * Verified against Next 16.3.4 by request, because it is not what the bundled
 * docs imply: `manifest.md` lists `manifest.json | manifest.webmanifest` as the
 * names for a *static* manifest file, but a code-generated `manifest.ts` is
 * only ever served at the `.webmanifest` path. `/manifest.json` 404s.
 *
 * Two things had to follow the rename, and both would have failed silently:
 * the `<link rel="manifest">` in `app/layout.tsx`, and the `PRECACHE_URLS`
 * list in `public/sw.js` — `cache.addAll()` is atomic, so one 404 in that list
 * rejects the whole install and the service worker never activates at all.
 *
 * `force-dynamic` for the same reason as `app/icon.tsx` — a manifest route is
 * cached by default, which would freeze the shop's name and icons at deploy
 * time.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branch = await resolveBrandingBranch();
  const name = branch?.name?.trim() || "POS";

  return {
    name: `${name} POS`,
    short_name: brandingShortName(name),
    description: [name, branch?.city].filter(Boolean).join(", ") + " — Point of Sale",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "landscape",
    theme_color: BRAND_COLOR,
    background_color: "#f9fafb",
    scope: "/",
    lang: "en",
    categories: ["business", "productivity"],
    /*
      Each size is declared twice, once per `purpose`, rather than as the
      space-separated `"any maskable"` the old static manifest used. Two
      reasons, and they agree: Next's `Manifest` type only accepts a single
      purpose per entry, and separate entries are the better declaration anyway
      — `"any maskable"` promises one image is correct both cropped and
      uncropped, which is only true of art drawn inside the safe zone.

      The generated disc *is* drawn inside it (see `renderInitialIcon`), but an
      uploaded icon is whatever the shop uploaded, so claiming it is maskable
      would be a promise this can't keep.
    */
    icons: [
      { src: "/api/branding/icon192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/branding/icon192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/api/branding/icon512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/branding/icon512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
