import { describe, expect, it, vi } from "vitest";

// Both modules under test import the Prisma singleton for their op builders;
// only their pure validators are exercised here.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { validateGrnPayment } from "@/lib/accounts";
import { pickItemFields } from "@/lib/items";

/**
 * The two guards that stand between a form and the database: what a GRN is
 * allowed to claim was paid, and which columns an item write may touch. Both
 * exist because the unguarded version caused a real fault — money recorded in
 * no account, and an item edit that always failed.
 */

describe("validateGrnPayment", () => {
  const ok = (r: ReturnType<typeof validateGrnPayment>) => {
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    return r;
  };

  it("defaults to putting the whole bill on vendor credit", () => {
    const r = ok(validateGrnPayment({ netBill: 5000 }));
    expect(r).toMatchObject({ paymentMethod: "LEND", cashAmount: 0, bankAmount: 0, bankAccountId: null });
  });

  it("zeroes stale amounts left in hidden fields when LEND is chosen", () => {
    // A figure typed and then switched away from must not quietly leave the till.
    const r = ok(validateGrnPayment({
      paymentMethod: "LEND", cashAmount: 3000, bankAmount: 2000, bankAccountId: "acc1", netBill: 5000,
    }));
    expect([r.cashAmount, r.bankAmount, r.bankAccountId]).toEqual([0, 0, null]);
  });

  it("drops the bank side of a cash-only payment", () => {
    const r = ok(validateGrnPayment({
      paymentMethod: "CASH", cashAmount: 1000, bankAmount: 500, bankAccountId: "acc1", netBill: 5000,
    }));
    expect([r.cashAmount, r.bankAmount, r.bankAccountId]).toEqual([1000, 0, null]);
  });

  it("drops the cash side of a bank-only payment", () => {
    const r = ok(validateGrnPayment({
      paymentMethod: "BANK", cashAmount: 1000, bankAmount: 500, bankAccountId: "acc1", netBill: 5000,
    }));
    expect([r.cashAmount, r.bankAmount, r.bankAccountId]).toEqual([0, 500, "acc1"]);
  });

  it("keeps both sides of a split payment", () => {
    const r = ok(validateGrnPayment({
      paymentMethod: "CASH_AND_BANK", cashAmount: 1000, bankAmount: 500, bankAccountId: "acc1", netBill: 5000,
    }));
    expect([r.cashAmount, r.bankAmount]).toEqual([1000, 500]);
  });

  it("refuses a bank amount with no account behind it", () => {
    // Otherwise the GRN records money paid that appears in no account balance.
    const r = validateGrnPayment({ paymentMethod: "BANK", bankAmount: 500, netBill: 5000 });
    expect(r.ok).toBe(false);
  });

  it("refuses paying more than the bill", () => {
    const r = validateGrnPayment({ paymentMethod: "CASH", cashAmount: 6000, netBill: 5000 });
    expect(r.ok).toBe(false);
  });

  it("allows paying the bill exactly", () => {
    expect(validateGrnPayment({ paymentMethod: "CASH", cashAmount: 5000, netBill: 5000 }).ok).toBe(true);
  });

  it("measures a net-return refund against the magnitude of the bill", () => {
    expect(validateGrnPayment({ paymentMethod: "CASH", cashAmount: 500, netBill: -500 }).ok).toBe(true);
    expect(validateGrnPayment({ paymentMethod: "CASH", cashAmount: 900, netBill: -500 }).ok).toBe(false);
  });

  it("clamps a negative amount to zero", () => {
    expect(ok(validateGrnPayment({ paymentMethod: "CASH", cashAmount: -100, netBill: 5000 })).cashAmount).toBe(0);
  });

  it("rejects an unknown method", () => {
    expect(validateGrnPayment({ paymentMethod: "CHEQUE", netBill: 5000 }).ok).toBe(false);
  });
});

describe("pickItemFields", () => {
  it("keeps only real Item columns", () => {
    // `currentStock` comes off the items list projection and lives on ItemStock.
    // Passing it through is what made every item edit fail.
    const data = pickItemFields(
      { name: "Lawn 3pc", salePrice: 250, currentStock: 49, stockLevels: [], id: "x" },
      { partial: true }
    );
    expect(data).toEqual({ name: "Lawn 3pc", salePrice: 250 });
  });

  it("never writes isActive, whatever the body says", () => {
    // Deactivating is DELETE's job, and it carries its own permission.
    expect(pickItemFields({ name: "x", isActive: false }, { partial: true })).toEqual({ name: "x" });
  });

  it("leaves untouched fields alone on a partial update", () => {
    // The GRN barcode-attach path sends just this, and must not blank the item.
    expect(pickItemFields({ barcode: "ABC123" }, { partial: true })).toEqual({ barcode: "ABC123" });
  });

  it("coerces numeric strings", () => {
    const data = pickItemFields({ salePrice: "250.50", minLevel: "3" }, { partial: true });
    expect(data).toEqual({ salePrice: 250.5, minLevel: 3 });
  });

  it("ignores a blank numeric field on a partial update", () => {
    // A cleared box shouldn't silently zero a price on a partial save.
    expect(pickItemFields({ salePrice: "" }, { partial: true })).toEqual({});
  });

  it("defaults a blank numeric field to zero on create", () => {
    expect(pickItemFields({ name: "x", discountRS: "" }, { partial: false }))
      .toEqual({ name: "x", discountRS: 0 });
  });

  it("maps blank optional text to null rather than an empty string", () => {
    expect(pickItemFields({ description: "", barcode: "  ", categoryId: "" }, { partial: true }))
      .toEqual({ description: null, barcode: null, categoryId: null });
  });

  it("clears altSalePrice to null rather than 0", () => {
    expect(pickItemFields({ altSalePrice: "" }, { partial: true })).toEqual({ altSalePrice: null });
    expect(pickItemFields({ altSalePrice: 300 }, { partial: true })).toEqual({ altSalePrice: 300 });
  });

  it("refuses to blank the name", () => {
    expect(pickItemFields({ name: "   " }, { partial: true })).toEqual({});
  });

  it("trims the name", () => {
    expect(pickItemFields({ name: "  Lawn  " }, { partial: true })).toEqual({ name: "Lawn" });
  });

  it("accepts only real units", () => {
    expect(pickItemFields({ unit: "GAZ" }, { partial: true })).toEqual({ unit: "GAZ" });
    expect(pickItemFields({ unit: "TONNE" }, { partial: true })).toEqual({});
  });

  it("refuses BUNDLE as the item's own unit", () => {
    // Stock is never held in bundles — a bundle is expanded into pieces at the
    // GRN. Letting it through here would put a quantity on the shelf that no
    // other screen could price.
    expect(pickItemFields({ unit: "BUNDLE" }, { partial: true })).toEqual({});
  });

  it("allows BUNDLE as the buy unit, where it is meaningful", () => {
    expect(pickItemFields({ purchaseUnit: "BUNDLE" }, { partial: true })).toEqual({
      purchaseUnit: "BUNDLE",
    });
  });

  it("clears the buy unit rather than inventing one", () => {
    expect(pickItemFields({ purchaseUnit: "" }, { partial: true })).toEqual({ purchaseUnit: null });
    expect(pickItemFields({ purchaseUnit: "TONNE" }, { partial: true })).toEqual({ purchaseUnit: null });
  });

  it("takes a bundle size only as a whole positive count", () => {
    expect(pickItemFields({ piecesPerBundle: 12 }, { partial: true })).toEqual({ piecesPerBundle: 12 });
    // 0, blank and a fraction all mean "not sold in bundles", which is null —
    // and null is what stops BUNDLE being offered as a buy unit at all.
    expect(pickItemFields({ piecesPerBundle: 0 }, { partial: true })).toEqual({ piecesPerBundle: null });
    expect(pickItemFields({ piecesPerBundle: "" }, { partial: true })).toEqual({ piecesPerBundle: null });
    expect(pickItemFields({ piecesPerBundle: 2.5 }, { partial: true })).toEqual({ piecesPerBundle: null });
    expect(pickItemFields({ piecesPerBundle: -3 }, { partial: true })).toEqual({ piecesPerBundle: null });
  });

  it("drops a non-numeric price instead of writing NaN", () => {
    expect(pickItemFields({ salePrice: "abc" }, { partial: true })).toEqual({});
  });

  it("returns nothing for an empty body, so the route can 400", () => {
    expect(pickItemFields({}, { partial: true })).toEqual({});
  });
});
