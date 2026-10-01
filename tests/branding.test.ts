import { describe, expect, it, vi } from "vitest";

// lib/branding.ts imports Prisma for its read/write helpers; the pure parts
// below don't touch it. Same stub the repayment-plan tests use.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const {
  MAX_BRANDING_BYTES,
  brandingInitial,
  brandingKey,
  brandingShortName,
  isBrandingAsset,
  parseDataUrl,
  toDataUrl,
  validateBrandingUpload,
} = await import("@/lib/branding");

/**
 * The store's branding. `brandingInitial` is what a shop sees in its browser
 * tab until someone uploads an icon, and `parseDataUrl` guards the one place
 * where a database row is handed to a browser as an image — so both are worth
 * pinning.
 */

describe("brandingInitial", () => {
  it("takes the first letter of the name, upper-cased", () => {
    expect(brandingInitial("Sidhey Sheikh Cloth Center")).toBe("S");
    expect(brandingInitial("acme")).toBe("A");
  });

  it("skips leading whitespace", () => {
    expect(brandingInitial("   warburton")).toBe("W");
  });

  it("prefers the first Latin character over a leading non-Latin one", () => {
    // The generated icon is drawn by next/og, whose bundled font has no Urdu
    // glyphs — a leading Urdu character would render as a hollow box.
    expect(brandingInitial("دکان Sidhey")).toBe("S");
  });

  it("falls back to the real first character when there is no Latin one", () => {
    expect(brandingInitial("دکان")).toBe("د");
  });

  it("takes a multi-byte character whole", () => {
    // `name[0]` here would return half a surrogate pair and render as garbage.
    expect(brandingInitial("😀 shop")).toBe("S");
    expect(brandingInitial("😀")).toBe("😀");
  });

  it("falls back to ? for an empty or missing name", () => {
    expect(brandingInitial("")).toBe("?");
    expect(brandingInitial("   ")).toBe("?");
    expect(brandingInitial(null)).toBe("?");
    expect(brandingInitial(undefined)).toBe("?");
  });

  it("handles a digit-first name", () => {
    expect(brandingInitial("24/7 Store")).toBe("2");
  });
});

describe("brandingShortName", () => {
  it("leaves a short name alone", () => {
    expect(brandingShortName("Acme POS")).toBe("Acme POS");
  });

  it("reduces a long multi-word name to its initials", () => {
    expect(brandingShortName("Sidhey Sheikh Cloth Center")).toBe("SSCC");
  });

  it("truncates a long single word, there being nothing better to do", () => {
    expect(brandingShortName("Supercalifragilistic")).toBe("Supercalifra");
  });

  it("falls back to POS when there is no name", () => {
    expect(brandingShortName("")).toBe("POS");
    expect(brandingShortName(null)).toBe("POS");
  });

  it("never exceeds the launcher's dozen characters", () => {
    const long = brandingShortName("A B C D E F G H I J K L M N O P");
    expect(long.length).toBeLessThanOrEqual(12);
  });
});

describe("parseDataUrl", () => {
  it("round-trips what toDataUrl produced", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const parsed = parseDataUrl(toDataUrl("image/png", bytes));
    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.bytes.equals(bytes)).toBe(true);
  });

  it("reads an svg mime, slash and plus and all", () => {
    expect(parseDataUrl(toDataUrl("image/svg+xml", Buffer.from("<svg/>")))?.mime)
      .toBe("image/svg+xml");
  });

  it("rejects anything that is not a base64 data URL", () => {
    // The logo column may hold a plain http URL from before uploads existed;
    // the serving route redirects to those instead of treating them as bytes.
    expect(parseDataUrl("https://example.com/logo.png")).toBeNull();
    expect(parseDataUrl("data:image/png,notbase64")).toBeNull();
    expect(parseDataUrl("")).toBeNull();
    expect(parseDataUrl(null)).toBeNull();
    expect(parseDataUrl(undefined)).toBeNull();
  });

  it("rejects a data URL with an empty payload", () => {
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
  });
});

describe("validateBrandingUpload", () => {
  it("accepts the image types the serving route can hand back", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon"]) {
      expect(validateBrandingUpload({ type, size: 2048 }).ok, type).toBe(true);
    }
  });

  it("refuses a type the browser would not render as an icon", () => {
    const res = validateBrandingUpload({ type: "application/pdf", size: 2048 });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("Unsupported");
  });

  it("names the type even when the browser sent none", () => {
    const res = validateBrandingUpload({ type: "", size: 10 });
    expect(res.ok === false && res.error).toContain("unknown");
  });

  it("refuses an oversized image", () => {
    const res = validateBrandingUpload({ type: "image/png", size: MAX_BRANDING_BYTES + 1 });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("limit");
  });

  it("accepts one exactly at the limit", () => {
    expect(validateBrandingUpload({ type: "image/png", size: MAX_BRANDING_BYTES }).ok).toBe(true);
  });

  it("refuses an empty file", () => {
    expect(validateBrandingUpload({ type: "image/png", size: 0 }).ok).toBe(false);
  });
});

describe("asset keys", () => {
  it("namespaces a setting row by branch and asset", () => {
    expect(brandingKey("branch_1", "favicon")).toBe("branding:branch_1:favicon");
  });

  it("gates the asset name coming off a URL", () => {
    // The serving route takes this straight from the path, so an unknown value
    // must not reach a Setting lookup.
    expect(isBrandingAsset("favicon")).toBe(true);
    expect(isBrandingAsset("icon512")).toBe(true);
    expect(isBrandingAsset("../../etc/passwd")).toBe(false);
    expect(isBrandingAsset("role_permissions")).toBe(false);
  });
});
