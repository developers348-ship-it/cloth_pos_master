import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_CONFIG,
  UnitConversionError,
  allowedTxUnits,
  convertGrnLine,
  convertQty,
  convertRate,
  formatStock,
  resolveGrnLine,
  restatedStock,
} from "@/lib/units";

const CFG = DEFAULT_UNIT_CONFIG; // 36 in/gaz, 40 in/mtr

describe("convertQty — length", () => {
  it("1 gaz is 0.9 metres", () => {
    expect(convertQty(1, "GAZ", "MTR", CFG)).toBeCloseTo(0.9, 10);
  });

  it("1 metre is 1.111 gaz", () => {
    expect(convertQty(1, "MTR", "GAZ", CFG)).toBeCloseTo(1.1111, 4);
  });

  it("round-trips exactly", () => {
    const there = convertQty(24, "GAZ", "MTR", CFG);
    expect(convertQty(there, "MTR", "GAZ", CFG)).toBeCloseTo(24, 10);
  });

  it("is the identity when the units match", () => {
    // The overwhelmingly common case — buy and sell in the same unit — must not
    // go anywhere near a division.
    expect(convertQty(17.35, "GAZ", "GAZ", CFG)).toBe(17.35);
  });

  it("follows the settings rather than a hard-coded 0.9", () => {
    // A shop using the true metric metre.
    const metric = { inchesPerGaz: 36, inchesPerMtr: 39.37 };
    expect(convertQty(1, "GAZ", "MTR", metric)).toBeCloseTo(0.9144, 4);
  });
});

describe("convertQty — count", () => {
  it("expands bundles into pieces", () => {
    expect(convertQty(5, "BUNDLE", "PCS", { ...CFG, piecesPerBundle: 12 })).toBe(60);
  });

  it("collapses pieces into bundles, fractions and all", () => {
    // Bundles are a counting convenience, not a sealed pack: 66 pieces is five
    // and a half bundles and the screen is allowed to say so.
    expect(convertQty(66, "PCS", "BUNDLE", { ...CFG, piecesPerBundle: 12 })).toBe(5.5);
  });

  it("refuses without a pieces-per-bundle", () => {
    expect(() => convertQty(5, "BUNDLE", "PCS", CFG)).toThrow(UnitConversionError);
    expect(() => convertQty(5, "BUNDLE", "PCS", { ...CFG, piecesPerBundle: 0 })).toThrow(
      UnitConversionError
    );
  });
});

describe("convertQty — cross-family", () => {
  it("refuses to turn cloth into pieces", () => {
    expect(() => convertQty(10, "GAZ", "PCS", CFG)).toThrow(UnitConversionError);
    expect(() => convertQty(10, "BUNDLE", "MTR", { ...CFG, piecesPerBundle: 12 })).toThrow(
      UnitConversionError
    );
  });
});

describe("convertRate", () => {
  it("re-expresses a per-gaz cost per metre", () => {
    expect(convertRate(100, "GAZ", "MTR", CFG)).toBeCloseTo(111.111, 3);
  });

  it("re-expresses a per-bundle cost per piece", () => {
    expect(convertRate(1200, "BUNDLE", "PCS", { ...CFG, piecesPerBundle: 12 })).toBe(100);
  });

  it("conserves what a line is worth — the property the whole design rests on", () => {
    // qty_from x rate_from === qty_to x rate_to. If this ever fails, a GRN's
    // converted cost stops reconciling with the vendor's bill and the
    // dashboard's profit figure drifts.
    for (const [qty, rate] of [
      [24, 100],
      [7.5, 249.99],
      [1, 1],
      [333, 12.25],
    ] as const) {
      const qtyMtr = convertQty(qty, "GAZ", "MTR", CFG);
      const rateMtr = convertRate(rate, "GAZ", "MTR", CFG);
      expect(qtyMtr * rateMtr).toBeCloseTo(qty * rate, 8);
    }
  });
});

describe("convertGrnLine — the worked example", () => {
  it("buy 24 gaz at 100, sell by the metre", () => {
    const line = convertGrnLine(
      { qty: 24, costRate: 100, buyUnit: "GAZ", sellUnit: "MTR" },
      CFG
    );
    expect(line.stockQty).toBe(21.6);
    expect(line.costPerSellUnit).toBe(111.11);

    // The vendor billed 2,400 and the stock must be worth that. Not exact to
    // the paisa, because the rate is stored at 2dp — but within it.
    expect(line.stockQty * line.costPerSellUnit).toBeCloseTo(24 * 100, 1);
  });

  it("buy 5 bundles of 12 at 1,200, sell by the piece", () => {
    const line = convertGrnLine(
      { qty: 5, costRate: 1200, buyUnit: "BUNDLE", sellUnit: "PCS", piecesPerBundle: 12 },
      CFG
    );
    expect(line.stockQty).toBe(60);
    expect(line.costPerSellUnit).toBe(100);
    expect(line.stockQty * line.costPerSellUnit).toBe(5 * 1200);
  });

  it("passes a same-unit line through untouched", () => {
    const line = convertGrnLine(
      { qty: 24, costRate: 100, buyUnit: "GAZ", sellUnit: "GAZ" },
      CFG
    );
    expect(line.stockQty).toBe(24);
    expect(line.costPerSellUnit).toBe(100);
  });
});

describe("stock precision", () => {
  it("nine metres out of ten gaz leaves an empty shelf, not 0.001", () => {
    // The reason ItemStock.qty carries 4 decimals. At 3dp one metre stores as
    // 1.111 gaz, nine of them come to 9.999, and the screen offers a metre of
    // cloth that is not there.
    const nineMetresInGaz = convertQty(9, "MTR", "GAZ", CFG);
    const remaining = Number((10 - nineMetresInGaz).toFixed(4));
    expect(remaining).toBe(0);
  });
});

describe("restatedStock", () => {
  it("moves the quantity with the unit", () => {
    expect(restatedStock(21.6, "MTR", "GAZ", CFG)).toBeCloseTo(24, 4);
  });

  it("returns null when there is nothing to do", () => {
    expect(restatedStock(21.6, "MTR", "MTR", CFG)).toBeNull();
    expect(restatedStock(21.6, "MTR", "PCS", CFG)).toBeNull();
    expect(restatedStock(21.6, "NONSENSE", "GAZ", CFG)).toBeNull();
  });
});

describe("allowedTxUnits", () => {
  it("offers both length units", () => {
    expect(allowedTxUnits({ unit: "GAZ" })).toEqual(["GAZ", "MTR"]);
    expect(allowedTxUnits({ unit: "MTR" })).toEqual(["GAZ", "MTR"]);
  });

  it("offers BUNDLE only once an item says how big a bundle is", () => {
    expect(allowedTxUnits({ unit: "PCS" })).toEqual(["PCS"]);
    expect(allowedTxUnits({ unit: "PCS", piecesPerBundle: 12 })).toEqual(["PCS", "BUNDLE"]);
  });
});

describe("formatStock", () => {
  it("adds the bought-as line when the units differ", () => {
    const out = formatStock(21.6, { unit: "MTR", purchaseUnit: "GAZ" }, CFG);
    expect(out.primary).toBe("21.6 MTR");
    expect(out.secondary).toBe("GAZ: 24");
  });

  it("stays quiet when the item is bought and sold the same way", () => {
    expect(formatStock(24, { unit: "GAZ", purchaseUnit: "GAZ" }, CFG).secondary).toBeNull();
    expect(formatStock(24, { unit: "GAZ" }, CFG).secondary).toBeNull();
  });

  it("keeps the stock figure on screen even if purchaseUnit went stale", () => {
    const out = formatStock(24, { unit: "GAZ", purchaseUnit: "PCS" }, CFG);
    expect(out.primary).toBe("24 GAZ");
    expect(out.secondary).toBeNull();
  });
});

describe("resolveGrnLine", () => {
  const gazItem = { unit: "GAZ", purchaseUnit: "GAZ", piecesPerBundle: null };

  it("resolves the buy-gaz / sell-metre receipt end to end", () => {
    const r = resolveGrnLine(
      { itemId: "i1", qty: 24, costRate: 100, saleRate: 130, buyUnit: "GAZ", sellUnit: "MTR" },
      gazItem,
      CFG
    );
    expect(r.stockQty).toBe(21.6);
    expect(r.costPerSellUnit).toBe(111.11);
    expect(r.sellUnit).toBe("MTR");
    expect(r.buyUnit).toBe("GAZ");
    // The sale rate is already quoted per the sell unit and is never converted
    // — it is a price the shop chose, not one derived from the cost.
    expect(r.saleRate).toBe(130);
  });

  it("leaves the unit alone when the payload does not name one", () => {
    // A typo or an older client must never silently re-denominate stock.
    const r = resolveGrnLine({ itemId: "i1", qty: 10, costRate: 50 }, gazItem, CFG);
    expect(r.sellUnit).toBe("GAZ");
    expect(r.stockQty).toBe(10);
    expect(r.costPerSellUnit).toBe(50);
  });

  it("ignores a sell unit it does not recognise rather than guessing", () => {
    const r = resolveGrnLine(
      { itemId: "i1", qty: 10, costRate: 50, sellUnit: "YARDS" },
      gazItem,
      CFG
    );
    expect(r.sellUnit).toBe("GAZ");
  });

  it("takes a bundle size from the line when the item has none yet", () => {
    // The receipt is exactly where a bundle size becomes known, so it has to be
    // settable there — otherwise the first bundle can never be booked in.
    const r = resolveGrnLine(
      { itemId: "i2", qty: 5, costRate: 1200, buyUnit: "BUNDLE", sellUnit: "PCS", piecesPerBundle: 12 },
      { unit: "PCS", purchaseUnit: null, piecesPerBundle: null },
      CFG
    );
    expect(r.stockQty).toBe(60);
    expect(r.costPerSellUnit).toBe(100);
    expect(r.piecesPerBundle).toBe(12);
  });

  it("refuses a bundle with no size anywhere", () => {
    expect(() =>
      resolveGrnLine(
        { itemId: "i2", qty: 5, costRate: 1200, buyUnit: "BUNDLE", sellUnit: "PCS" },
        { unit: "PCS", purchaseUnit: null, piecesPerBundle: null },
        CFG
      )
    ).toThrow(UnitConversionError);
  });

  it("refuses to receive cloth against a countable item", () => {
    expect(() =>
      resolveGrnLine(
        { itemId: "i2", qty: 5, costRate: 10, buyUnit: "GAZ", sellUnit: "PCS" },
        { unit: "PCS", purchaseUnit: null, piecesPerBundle: null },
        CFG
      )
    ).toThrow(UnitConversionError);
  });

  it("carries isReturn through, because it decides the sign of the stock move", () => {
    const r = resolveGrnLine(
      { itemId: "i1", qty: 3, costRate: 100, isReturn: true, buyUnit: "GAZ", sellUnit: "MTR" },
      gazItem,
      CFG
    );
    expect(r.isReturn).toBe(true);
    expect(r.stockQty).toBe(2.7);
  });
});
