import { prisma } from "@/lib/prisma";

/**
 * Store branding — the browser-tab icon, the PWA icons and the logo.
 *
 * ## Where the images live, and why not in `/public`
 *
 * In the **database**, as data URLs in the generic `Setting` key/value table
 * (the same table `role_permissions` uses). Not on disk.
 *
 * The obvious implementation is to write the upload into `/public` and serve it
 * as a static file, and that is what this app used to do for its two PWA icons
 * (`app/api/settings/icon/route.ts`, now deleted). It cannot work on Vercel:
 * the filesystem there is **read-only at runtime**, so the upload throws
 * `EROFS`. Even where a write does succeed — a container, a VPS — `/public` is
 * rebuilt from the repository on every deploy, so the icon silently reverts to
 * whatever is committed. The workaround is to commit the file by hand and
 * redeploy, which is not a setting a shopkeeper can change.
 *
 * Putting the bytes in the database fixes all of that at once: the upload works
 * on Vercel, it survives deploys, and — because `lib/backup.ts` introspects the
 * live catalogue rather than a model list — it is already included in the
 * backup and restore. It costs one row per asset and needed **no migration**,
 * because `Setting` was already there.
 *
 * Small images only (see `MAX_BRANDING_BYTES`). An icon is a few KB; this is
 * not a general file store, and nothing here should grow into one.
 */

export const BRANDING_ASSETS = ["favicon", "logo", "icon192", "icon512"] as const;
export type BrandingAsset = (typeof BRANDING_ASSETS)[number];

export function isBrandingAsset(value: string): value is BrandingAsset {
  return (BRANDING_ASSETS as readonly string[]).includes(value);
}

/** The teal the app is themed in — `viewport.themeColor`, and Tailwind `teal-600`. */
export const BRAND_COLOR = "#0d9488";

/**
 * 512 KB. A favicon is 1–5 KB and a 512×512 PNG icon rarely passes 100 KB, so
 * this is generous. It matters because the value goes in a database row and is
 * base64, which inflates the bytes by a third — and because the row is read on
 * the way to rendering an icon, a path that should stay cheap.
 */
export const MAX_BRANDING_BYTES = 512 * 1024;

export const ALLOWED_BRANDING_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;

/** The pixel size each asset is rendered at when it has to be generated. */
export const BRANDING_SIZES: Record<BrandingAsset, number> = {
  favicon: 64,
  logo: 256,
  icon192: 192,
  icon512: 512,
};

const KEY_PREFIX = "branding";

/** `Setting.key` for one branch's one asset. */
export function brandingKey(branchId: string, asset: BrandingAsset): string {
  return `${KEY_PREFIX}:${branchId}:${asset}`;
}

// ─── Pure helpers (unit-tested in tests/branding.test.ts) ─────────────────────

/**
 * The single character to draw in the fallback circle, from the store's name.
 *
 * **Prefers the first ASCII letter or digit**, falling back to the first
 * non-whitespace character. The preference exists because the generated icon is
 * drawn by `next/og`, whose bundled font has no Urdu glyphs — an Urdu first
 * character would come out as a hollow box. So "دکان Sidhey Sheikh" yields `S`
 * rather than `د`. A name with no Latin character at all still gets its real
 * first character (better than a blank circle), and the Settings tab tells the
 * shopkeeper to upload a favicon in that case.
 *
 * `Array.from` rather than `name[0]` so a multi-byte character is taken whole
 * instead of being cut in half into a lone surrogate.
 */
export function brandingInitial(name: string | null | undefined): string {
  const chars = Array.from((name ?? "").trim());
  const latin = chars.find((c) => /[A-Za-z0-9]/.test(c));
  if (latin) return latin.toUpperCase();
  const first = chars.find((c) => !/\s/.test(c));
  return first ? first.toUpperCase() : "?";
}

/**
 * A name short enough for a launcher tile or an iOS home screen — both truncate
 * at roughly a dozen characters.
 *
 * A short name is left alone. A long multi-word one becomes its initials
 * ("Sidhey Sheikh Cloth Center" → "SSCC"), which is what the hand-written
 * manifest used to hard-code. A long single word is simply cut, there being
 * nothing better to do with it.
 */
export function brandingShortName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "POS";
  if (trimmed.length <= 12) return trimmed;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.map((w) => brandingInitial(w)).join("").slice(0, 12);
  }
  return trimmed.slice(0, 12);
}

export type ParsedDataUrl = { mime: string; bytes: Buffer };

/**
 * Splits a stored `data:<mime>;base64,<payload>` value back into its parts.
 * Returns null for anything else — a plain http URL, a truncated row, junk — so
 * every caller has to handle "not an image I can serve" rather than trusting
 * the column.
 */
export function parseDataUrl(value: string | null | undefined): ParsedDataUrl | null {
  if (!value) return null;
  // `[\s\S]` rather than `.` with the `s` flag: tsconfig targets ES2017, where
  // `dotAll` is not available.
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,([\s\S]+)$/.exec(value);
  if (!match) return null;
  const [, mime, payload] = match;
  try {
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length === 0) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

export function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export type UploadCheck = { ok: true } | { ok: false; error: string };

/**
 * Gate on the upload before it reaches a database row. Both rules are about the
 * row, not about taste: an unknown type would be served back with a
 * `Content-Type` a browser won't render as an icon, and an oversized file makes
 * every icon request read a fat row.
 */
export function validateBrandingUpload(file: { type: string; size: number }): UploadCheck {
  if (!(ALLOWED_BRANDING_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: `Unsupported image type "${file.type || "unknown"}" — use PNG, JPEG, WebP, SVG or ICO` };
  }
  if (file.size > MAX_BRANDING_BYTES) {
    return { ok: false, error: `Image is ${Math.round(file.size / 1024)} KB — the limit is ${MAX_BRANDING_BYTES / 1024} KB` };
  }
  if (file.size === 0) {
    return { ok: false, error: "That file is empty" };
  }
  return { ok: true };
}

// ─── Database access ─────────────────────────────────────────────────────────

export async function readBrandingAsset(
  branchId: string,
  asset: BrandingAsset,
): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: brandingKey(branchId, asset) } });
  return row?.value ?? null;
}

/** Which assets this branch has uploaded, and how big each one is — for the Settings tab. */
export async function readBrandingSummary(branchId: string) {
  const rows = await prisma.setting.findMany({
    where: { key: { in: BRANDING_ASSETS.map((a) => brandingKey(branchId, a)) } },
    select: { key: true, value: true, updatedAt: true },
  });
  const byAsset = new Map(rows.map((r) => [r.key, r]));
  return BRANDING_ASSETS.map((asset) => {
    const row = byAsset.get(brandingKey(branchId, asset));
    const parsed = parseDataUrl(row?.value);
    return {
      asset,
      uploaded: parsed !== null,
      mime: parsed?.mime ?? null,
      bytes: parsed?.bytes.length ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function writeBrandingAsset(
  branchId: string,
  asset: BrandingAsset,
  dataUrl: string,
): Promise<void> {
  const key = brandingKey(branchId, asset);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: dataUrl },
    update: { value: dataUrl },
  });
}

export async function clearBrandingAsset(branchId: string, asset: BrandingAsset): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: brandingKey(branchId, asset) } });
}

/**
 * Which branch's branding to serve when nobody said.
 *
 * The tab icon and the manifest are fetched by the browser with no session and
 * no `branchId` — often before sign-in — so they can't ask the session which
 * branch is current. This app is effectively single-branch (there is no UI to
 * create, list or switch branches; Settings edits the session's branch only —
 * see docs/settings-accounts.md), so the oldest active branch *is* the store.
 * It mirrors the same fallback `GET /api/settings/store` already uses when
 * called without a `branchId`.
 *
 * If real multi-branch support ever arrives, this is one of the places that has
 * to learn how to tell them apart — a host mapping, or a branch in the path.
 */
export async function resolveBrandingBranch() {
  return prisma.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, city: true, logoUrl: true },
  });
}
