import { describe, expect, it } from "vitest";
import { validateSalePayment, saleValidationMessage, type SaleValidationInput } from "@/lib/sale-validation";

/**
 * These rules block a save on the checkout screen AND in POST /api/sales, so a
 * mistake here either lets a mis-priced invoice through or jams the till.
 */

const base: SaleValidationInput = {
  partyOption: "CASH",
  paymentMethod: "CASH",
  netBill: 1000,
  outstanding: 0,
  cashReceived: 1000,
  bankAmount: 0,
  bankAccountId: null,
  isWalkingCustomer: false,
  isRefund: false,
};

const check = (over: Partial<SaleValidationInput> = {}) => validateSalePayment({ ...base, ...over });

describe("payment-method completeness", () => {
  it("passes a fully paid cash sale", () => {
    expect(check()).toBeNull();
  });

  it("requires a bank account when the bank is used", () => {
    expect(check({ paymentMethod: "BANK", cashReceived: 0, bankAmount: 1000 })?.code)
      .toBe("BANK_ACCOUNT_REQUIRED");
  });

  it("requires a bank amount once a bank account is picked", () => {
    expect(check({ paymentMethod: "BANK", cashReceived: 0, bankAmount: 0, bankAccountId: "acc1", outstanding: 1000 })?.code)
      .toBe("BANK_AMOUNT_REQUIRED");
  });

  it("requires both halves of Cash & Bank", () => {
    expect(check({ paymentMethod: "CASH_AND_BANK", cashReceived: 0, bankAmount: 1000, bankAccountId: "acc1" })?.code)
      .toBe("CASH_AMOUNT_REQUIRED");
    expect(check({ paymentMethod: "CASH_AND_BANK", cashReceived: 600, bankAmount: 400, bankAccountId: "acc1" }))
      .toBeNull();
  });

  it("does NOT demand a cash amount on the plain Cash method", () => {
    // Cash is the screen's default method, and a pure credit sale legitimately
    // leaves the field at zero — demanding it here would jam every loan.
    expect(check({ partyOption: "CC", cashReceived: 0, outstanding: 1000 })).toBeNull();
  });
});

describe("Cash price tier must be settled", () => {
  it("blocks an underpaid cash sale and reports what is due", () => {
    const issue = check({ cashReceived: 400, outstanding: 600 });
    expect(issue?.code).toBe("CASH_SALE_NOT_SETTLED");
    expect(issue?.outstanding).toBe(600);
    expect(saleValidationMessage(issue!)).toContain("600.00");
  });

  it("accepts an over-tender, since change is handed back", () => {
    expect(check({ cashReceived: 1500, outstanding: 0 })).toBeNull();
  });

  it("treats sub-paisa rounding noise as settled", () => {
    expect(check({ outstanding: 0.004 })).toBeNull();
  });
});

describe("CC (credit) price tier", () => {
  it("refuses a credit sale on the shared walking customer", () => {
    // A debt parked on the walking customer belongs to nobody, so it could
    // never be recovered from anyone.
    expect(check({ partyOption: "CC", isWalkingCustomer: true, cashReceived: 0, outstanding: 1000 })?.code)
      .toBe("CREDIT_NEEDS_NAMED_PARTY");
  });

  it("allows an unpaid credit sale", () => {
    expect(check({ partyOption: "CC", cashReceived: 0, outstanding: 1000 })).toBeNull();
  });

  it("allows a part-paid credit sale", () => {
    expect(check({ partyOption: "CC", cashReceived: 300, outstanding: 700 })).toBeNull();
  });

  it("blocks a fully paid credit sale so the tier can be switched", () => {
    expect(check({ partyOption: "CC", outstanding: 0 })?.code).toBe("CREDIT_SALE_FULLY_PAID");
  });

  it("checks the party before the settlement, so the actionable error comes first", () => {
    expect(check({ partyOption: "CC", isWalkingCustomer: true, outstanding: 0 })?.code)
      .toBe("CREDIT_NEEDS_NAMED_PARTY");
  });

  it("still applies to legacy CR/1INCH tiers, not just CC", () => {
    expect(check({ partyOption: "CR", outstanding: 0 })?.code).toBe("CREDIT_SALE_FULLY_PAID");
  });
});

describe("directions where the settlement rules do not apply", () => {
  it("exempts a net-return invoice", () => {
    // Money flows outward, so "settled" and "fully paid" both invert.
    expect(check({ netBill: -800, isRefund: true, cashReceived: 800, outstanding: 0 })).toBeNull();
    expect(check({ partyOption: "CC", netBill: -800, isRefund: true, cashReceived: 800, outstanding: 0 }))
      .toBeNull();
  });

  it("exempts a zero-value bill", () => {
    expect(check({ partyOption: "CC", netBill: 0, cashReceived: 0, outstanding: 0 })).toBeNull();
  });

  it("still checks method completeness on a refund", () => {
    // A refund paid out of a bank with no account selected posts to no balance.
    expect(check({ netBill: -800, isRefund: true, paymentMethod: "BANK", cashReceived: 0, bankAmount: 800 })?.code)
      .toBe("BANK_ACCOUNT_REQUIRED");
  });
});
