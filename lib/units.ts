/**
 * Unit conversion — gaz/metre and bundle/piece.
 *
 * ## The one rule that makes this simple
 *
 * **Stock is always held in the unit the item is sold in.** The conversion
 * happens exactly once, at the GRN, when goods are received: a roll bought as
 * 24 gaz but sold by the metre lands in stock as 21.6 metres, and its purchase
 * price is re-expressed per metre at the same moment.
 *
 * Everything downstream — the sales screen, the ledger, stock valuation, the
 * dashboard's profit figure — then reads a quantity and a price that are
 * already in the same unit, and needs no knowledge of any of this. That is why
 * the alternative (carrying a buy unit and a sell unit through every table and
 * every report) was not built: it spreads a purchase-time concern across the
 * whole application.
 *
 * `Item.unit` is therefore the **sell** unit and the unit `ItemStock.qty` is
 * measured in. `Item.purchaseUnit` is informational only — it drives the
 * "bought as GAZ: 24.00" line under a stock figure, and pre-selects the GRN's
 * buy-unit dropdown. Nothing calculates from it.
 *
 * ## Why inches rather than a pair of factors
 *
 * The settings hold **inches per gaz (36)** and **inches per metre (40)**, and
 * the 0.9 / 1.111 factors are derived. Storing the two factors directly would
 * let them be edited into disagreeing with each other — 0.9 and 1.2, say — and
 * then a quantity converted out and back would not come home. Deriving both
 * from one pair of lengths makes that unrepresentable.
 *
 * Prisma-free on purpose, like `lib/items.ts`: importing the client here would
 * spin up a `PrismaClient` inside the unit tests.
 */

export const STOCK_UNITS = ["PCS", "GAZ", "MTR"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** `BUNDLE` can be bought and counted, but stock is never *held* in it. */
export const TX_UNITS = ["PCS", "GAZ", "MTR", "BUNDLE"] as const;
export type TxUnit = (typeof TX_UNITS)[number];

export const DEFAULT_INCHES_PER_GAZ = 36;
export const DEFAULT_INCHES_PER_MTR = 40;

export const SETTING_INCHES_PER_GAZ = "units.inchesPerGaz";
export const SETTING_INCHES_PER_MTR = "units.inchesPerMtr";

export type UnitConfig = {
  inchesPerGaz: number;
  inchesPerMtr: number;
  /** Required only when converting to or from `BUNDLE`. */
  piecesPerBundle?: number | null;
};

export const DEFAULT_UNIT_CONFIG: UnitConfig = {
  inchesPerGaz: DEFAULT_INCHES_PER_GAZ,
  inchesPerMtr: DEFAULT_INCHES_PER_MTR,
};

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === "string" && (STOCK_UNITS as readonly string[]).includes(value);
}

export function isTxUnit(value: unknown): value is TxUnit {
  return typeof value === "string" && (TX_UNITS as readonly string[]).includes(value);
}

export type UnitFamily = "COUNT" | "LENGTH";

export function unitFamily(unit: TxUnit): UnitFamily {
  return unit === "GAZ" || unit === "MTR" ? "LENGTH" : "COUNT";
}

/**
 * Cloth cannot be converted into pieces and pieces cannot be converted into
 * metres, so a cross-family conversion is a bug in the caller rather than a
 * number to be guessed at. Both write paths catch this and answer 400.
 */
export class UnitConversionError extends Error {}

/** How many inches one unit of length is, per the configured settings. */
function inchesPer(unit: "GAZ" | "MTR", cfg: UnitConfig): number {
  const n = unit === "GAZ" ? cfg.inchesPerGaz : cfg.inchesPerMtr;
  if (!Number.isFinite(n) || n <= 0) {
    throw new UnitConversionError(`Invalid inches-per-${unit} setting: ${n}`);
  }
  return n;
}

/**
 * Quantity in `from` units expressed in `to` units.
 *
 * Deliberately **not** rounded — callers round once, at the point they store
 * or display, so a conversion used in the middle of a calculation never
 * accumulates a rounding step of its own.
 */
export function convertQty(qty: number, from: TxUnit, to: TxUnit, cfg: UnitConfig): number {
  if (from === to) return qty;
  if (unitFamily(from) !== unitFamily(to)) {
    throw new UnitConversionError(`Cannot convert ${from} to ${to} — different unit families`);
  }

  if (unitFamily(from) === "LENGTH") {
    return (qty * inchesPer(from as "GAZ" | "MTR", cfg)) / inchesPer(to as "GAZ" | "MTR", cfg);
  }

  const ppb = Number(cfg.piecesPerBundle ?? 0);
  if (!Number.isFinite(ppb) || ppb <= 0) {
    throw new UnitConversionError(
      "Converting to or from BUNDLE needs a positive 'pieces per bundle' on the item"
    );
  }
  return from === "BUNDLE" ? qty * ppb : qty / ppb;
}

/**
 * A *price* per `from` unit expressed per `to` unit.
 *
 * Derived from `convertQty` rather than written out separately so the two can
 * never disagree: the identity it preserves is
 *
 *     qty_from x rate_from === qty_to x rate_to
 *
 * i.e. converting a line's unit never changes what the line is worth. That is
 * what keeps a GRN's converted cost reconciling back to the vendor's bill.
 */
export function convertRate(rate: number, from: TxUnit, to: TxUnit, cfg: UnitConfig): number {
  if (from === to) return rate;
  const perOne = convertQty(1, from, to, cfg);
  if (perOne === 0) throw new UnitConversionError(`Degenerate conversion ${from} -> ${to}`);
  return rate / perOne;
}

/**
 * Optional fabric kind on an item. Its only job is the length of a "suit",
 * which the sales screen's Suit button enters as the quantity so the operator
 * doesn't key 4.5 in by hand every time.
 */
export const CLOTH_TYPES = ["COTTON", "WASH_WEAR"] as const;
export type ClothType = (typeof CLOTH_TYPES)[number];

export const SUIT_METRES: Record<ClothType, number> = {
  COTTON: 4.5,
  WASH_WEAR: 4,
};

export function isClothType(value: unknown): value is ClothType {
  return typeof value === "string" && (CLOTH_TYPES as readonly string[]).includes(value);
}

/**
 * One suit of this item, in the unit it is sold in — 4.5 m of cotton is 5 gaz
 * on an item sold by the gaz. Null when there is no suit to offer: no cloth
 * type set, or the item is sold by the piece.
 */
export function suitQty(
  clothType: unknown,
  sellUnit: string,
  cfg: UnitConfig
): number | null {
  if (!isClothType(clothType)) return null;
  if (sellUnit !== "MTR" && sellUnit !== "GAZ") return null;
  return roundQty(convertQty(SUIT_METRES[clothType], "MTR", sellUnit, cfg));
}

/** The units an item may legitimately be transacted in. */
export function allowedTxUnits(item: {
  unit: string;
  piecesPerBundle?: number | null;
}): TxUnit[] {
  const base = isStockUnit(item.unit) ? item.unit : "PCS";
  if (unitFamily(base) === "LENGTH") return ["GAZ", "MTR"];
  return Number(item.piecesPerBundle ?? 0) > 0 ? ["PCS", "BUNDLE"] : ["PCS"];
}

/**
 * Quantities are stored at 4 decimals (`ItemStock.qty`), not the 3 the column
 * used to carry. One metre of a gaz-stocked item is 1.1111 gaz, so at 3dp nine
 * metres would leave a phantom 0.001 gaz on hand and the screen would offer
 * "0.999 MTR" where the shelf is empty. The extra digit keeps every 2dp
 * display exact.
 */
export const QTY_DP = 4;

export function roundQty(n: number): number {
  return Math.round(n * 10 ** QTY_DP) / 10 ** QTY_DP;
}

/** Money columns are `Decimal(12,2)`, so rates round to paisa. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Trailing-zero-trimmed, for display. `21.6` not `21.6000`. */
export function formatQty(n: number, dp = 2): string {
  const rounded = Number(n.toFixed(dp));
  return rounded.toLocaleString(undefined, { maximumFractionDigits: dp });
}

/**
 * The stock line and the "bought as" line beneath it.
 *
 * `secondary` is null whenever it would say nothing — no purchase unit
 * recorded, or the item is bought and sold in the same unit, which is the
 * common case and the one that must stay visually quiet.
 */
export function formatStock(
  qty: number,
  item: { unit: string; purchaseUnit?: string | null; piecesPerBundle?: number | null },
  cfg: UnitConfig
): { primary: string; secondary: string | null } {
  const unit = isStockUnit(item.unit) ? item.unit : "PCS";
  const primary = `${formatQty(qty)} ${unit}`;

  const bought = item.purchaseUnit;
  if (!isTxUnit(bought) || bought === unit) return { primary, secondary: null };

  try {
    const inBought = convertQty(qty, unit, bought, {
      ...cfg,
      piecesPerBundle: item.piecesPerBundle,
    });
    return { primary, secondary: `${bought}: ${formatQty(inBought)}` };
  } catch {
    // A stale purchaseUnit from another family (the item's unit was changed by
    // hand) must not take a stock figure off the screen.
    return { primary, secondary: null };
  }
}

/**
 * Everything the GRN write path needs from one received line.
 *
 * Kept here, pure, so the identical arithmetic runs on the purchases screen's
 * live preview and in `POST /api/purchases` without either restating it — and
 * so it is testable without a database.
 */
export function convertGrnLine(
  input: {
    qty: number;
    costRate: number;
    buyUnit: TxUnit;
    sellUnit: StockUnit;
    piecesPerBundle?: number | null;
  },
  cfg: UnitConfig
): { stockQty: number; costPerSellUnit: number } {
  const lineCfg = { ...cfg, piecesPerBundle: input.piecesPerBundle };
  return {
    stockQty: roundQty(convertQty(input.qty, input.buyUnit, input.sellUnit, lineCfg)),
    costPerSellUnit: roundMoney(
      convertRate(input.costRate, input.buyUnit, input.sellUnit, lineCfg)
    ),
  };
}

export type GrnLineInput = {
  itemId: string;
  qty?: number;
  costRate?: number;
  saleRate?: number;
  isReturn?: boolean;
  /** What the vendor billed in. Defaults to the item's recorded purchase unit. */
  buyUnit?: string | null;
  /** What the goods will be sold in. Defaults to the item's current unit. */
  sellUnit?: string | null;
  /** Lets a bundle size be set at the moment the first bundle is received. */
  piecesPerBundle?: number | null;
};

export type ResolvedGrnLine = {
  itemId: string;
  isReturn: boolean;
  /** As billed, in `buyUnit` — this is what the GRN's money is computed from. */
  qty: number;
  costRate: number;
  buyUnit: TxUnit;
  /** The item's unit after this receipt; stock is measured in it. */
  sellUnit: StockUnit;
  /** `qty` converted into `sellUnit` — what actually moves stock. */
  stockQty: number;
  /** `costRate` restated per `sellUnit` — what `Item.purchasePrice` becomes. */
  costPerSellUnit: number;
  /** Per `sellUnit`, straight from the line; 0 means "leave the price alone". */
  saleRate: number;
  piecesPerBundle: number | null;
};

/**
 * One received line, resolved into the numbers the write path needs.
 *
 * This is the single place the buy-unit/sell-unit difference is dealt with in
 * the whole application. The purchases screen runs it for its live preview and
 * `POST /api/purchases` runs it again on the server — the server never trusts
 * the client's converted figures, for the same reason the sale totals are
 * re-derived in `lib/sale-validation.ts`.
 *
 * Throws `UnitConversionError` for a line that cannot be converted (cloth into
 * pieces, or a bundle with no size); the route turns that into a 400.
 */
export function resolveGrnLine(
  line: GrnLineInput,
  item: { unit: string; purchaseUnit?: string | null; piecesPerBundle?: number | null },
  cfg: UnitConfig
): ResolvedGrnLine {
  const currentUnit: StockUnit = isStockUnit(item.unit) ? item.unit : "PCS";

  // Blank/unknown from the client means "unchanged", never a silent default to
  // some other unit — a typo in the payload must not re-denominate stock.
  const sellUnit: StockUnit = isStockUnit(line.sellUnit) ? line.sellUnit : currentUnit;
  const buyUnit: TxUnit = isTxUnit(line.buyUnit)
    ? line.buyUnit
    : isTxUnit(item.purchaseUnit)
      ? item.purchaseUnit
      : sellUnit;

  const lineSize = Number(line.piecesPerBundle ?? 0);
  const piecesPerBundle =
    Number.isInteger(lineSize) && lineSize > 0
      ? lineSize
      : Number(item.piecesPerBundle ?? 0) > 0
        ? Number(item.piecesPerBundle)
        : null;

  const qty = Number(line.qty ?? 0);
  const costRate = Number(line.costRate ?? 0);
  const { stockQty, costPerSellUnit } = convertGrnLine(
    { qty, costRate, buyUnit, sellUnit, piecesPerBundle },
    cfg
  );

  return {
    itemId: line.itemId,
    isReturn: Boolean(line.isReturn),
    qty,
    costRate,
    buyUnit,
    sellUnit,
    stockQty,
    costPerSellUnit,
    saleRate: Number(line.saleRate ?? 0),
    piecesPerBundle,
  };
}

/**
 * Re-labelling an item's sell unit re-labels the stock it already holds, so
 * the quantity has to move with it: an item sitting on 21.6 MTR that starts
 * being sold by the gaz holds 24 GAZ, not 24 MTR. Without this the figure is
 * silently wrong from the moment the unit changes — and the GRN changes it
 * whenever a line's sell unit differs from the item's current one.
 *
 * Returns null when nothing needs to move (same unit, or a conversion that
 * cannot be made), so callers can skip the write.
 */
export function restatedStock(
  qty: number,
  fromUnit: string,
  toUnit: string,
  cfg: UnitConfig & { piecesPerBundle?: number | null }
): number | null {
  if (!isStockUnit(fromUnit) || !isStockUnit(toUnit)) return null;
  if (fromUnit === toUnit) return null;
  if (unitFamily(fromUnit) !== unitFamily(toUnit)) return null;
  try {
    return roundQty(convertQty(qty, fromUnit, toUnit, cfg));
  } catch {
    return null;
  }
}
