import { prisma } from "@/lib/prisma";
import {
  DEFAULT_INCHES_PER_GAZ,
  DEFAULT_INCHES_PER_MTR,
  SETTING_INCHES_PER_GAZ,
  SETTING_INCHES_PER_MTR,
  type UnitConfig,
} from "@/lib/units";

/**
 * The gaz/metre lengths, read from the `Setting` key/value table.
 *
 * Split out of `lib/units.ts` so that module stays Prisma-free and unit-
 * testable — the same split `lib/items.ts` makes for `findBarcodeOwner`.
 *
 * Cached for the same reason `lib/permissions-server.ts` caches its matrix:
 * this is read on every GRN save and every stock render, and it changes about
 * once in the life of a shop.
 */

const CACHE_TTL_MS = 60_000;
let cached: { cfg: UnitConfig; at: number } | null = null;

/** Called by the settings route after a save. */
export function invalidateUnitConfigCache() {
  cached = null;
}

function parseLength(value: string | undefined, fallback: number): number {
  const n = Number(value);
  // A zero or negative length would make every conversion either a division by
  // zero or a sign flip, so a corrupt row falls back rather than propagating.
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getUnitConfig(): Promise<UnitConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.cfg;

  let cfg: UnitConfig = {
    inchesPerGaz: DEFAULT_INCHES_PER_GAZ,
    inchesPerMtr: DEFAULT_INCHES_PER_MTR,
  };

  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [SETTING_INCHES_PER_GAZ, SETTING_INCHES_PER_MTR] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    cfg = {
      inchesPerGaz: parseLength(byKey.get(SETTING_INCHES_PER_GAZ), DEFAULT_INCHES_PER_GAZ),
      inchesPerMtr: parseLength(byKey.get(SETTING_INCHES_PER_MTR), DEFAULT_INCHES_PER_MTR),
    };
  } catch {
    // An unreachable Setting row must not take the till down — 36 and 40 are
    // the values every existing install would have written anyway.
  }

  cached = { cfg, at: Date.now() };
  return cfg;
}

export async function saveUnitConfig(cfg: UnitConfig): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: SETTING_INCHES_PER_GAZ },
      update: { value: String(cfg.inchesPerGaz) },
      create: { key: SETTING_INCHES_PER_GAZ, value: String(cfg.inchesPerGaz) },
    }),
    prisma.setting.upsert({
      where: { key: SETTING_INCHES_PER_MTR },
      update: { value: String(cfg.inchesPerMtr) },
      create: { key: SETTING_INCHES_PER_MTR, value: String(cfg.inchesPerMtr) },
    }),
  ]);
  invalidateUnitConfigCache();
}
