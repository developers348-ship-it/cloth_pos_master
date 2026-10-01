import { describe, expect, it } from "vitest";
import { calculateInvoiceTotals, cashKeptFromTender, computePurchaseLedgerSplit, computeSaleLedgerSplit, moneyInFromInvoice, moneyKeptFromTender } from "@/lib/utils";

/**
 * `calculateInvoiceTotals` decides every figure on the checkout screen and is
 * what the server stores, so a change here silently changes what customers are
 * charged. The refund and store-credit branches are the ones worth pinning:
 * both were bugs fixed in Phases 3 and 4, and both are easy to reintroduce.
 */

type Line = Parameters<typeof calculateInvoiceTotals>[0]["items"][number];

const line = (over: Partial<Line> = {}): Line => ({
  qty: 1, rate: 1000, disRS: 0, disPct: 0, isReturn: false, unit: "PCS", ...over,
});

const totals = (over: Partial<Parameters<typeof calculateInvoiceTotals>[0]> = {}) =>
  calculateInvoiceTotals({
    items: [line()],
    packageDiscount: 0,
    adjustment: 0,
    adjustType: "sub",
    courierCharges: 0,
    cardAmount: 0,
    cashReceived: 0,
    ...over,
  });

describe("calculateInvoiceTotals — line maths", () => {
  it("multiplies rate by quantity", () => {
    expect(totals({ items: [line({ qty: 3, rate: 250 })] }).grossSale).toBe(750);
  });

  it("prefers a rupee discount over a percentage when both are set", () => {
    // The rupee box wins by design — a cashier typing an absolute figure means it.
    expect(totals({ items: [line({ rate: 1000, disRS: 100, disPct: 50 })] }).grossSale).toBe(900);
  });

  it("applies a percentage discount across the whole line, not per unit", () => {
    expect(totals({ items: [line({ qty: 2, rate: 500, disPct: 10 })] }).grossSale).toBe(900);
  });

  it("splits sold and returned quantities by unit", () => {
    const t = totals({
      items: [
        line({ qty: 2, unit: "PCS" }),
        line({ qty: 3.5, unit: "GAZ" }),
        line({ qty: 1.25, unit: "MTR", isReturn: true }),
      ],
    });
    expect([t.soldPcs, t.soldGaz, t.soldMtr]).toEqual([2, 3.5, 0]);
    expect([t.returnPcs, t.returnGaz, t.returnMtr]).toEqual([0, 0, 1.25]);
  });
});

describe("calculateInvoiceTotals — bill assembly", () => {
  it("walks gross → package discount → returns → adjustment → courier", () => {
    const t = totals({
      items: [line({ rate: 5000 }), line({ rate: 1000, isReturn: true })],
      packageDiscount: 500,
      adjustment: 200,
      adjustType: "sub",
      courierCharges: 150,
    });
    expect(t.grossSale).toBe(5000);
    expect(t.saleAmount).toBe(4500); // gross − package discount
    expect(t.returnAmount).toBe(1000);
    expect(t.slipAmount).toBe(3300); // 4500 − 1000 − 200
    expect(t.netBill).toBe(3450); // + courier
  });

  it("adds the adjustment when adjustType is add", () => {
    expect(totals({ adjustment: 200, adjustType: "add" }).netBill).toBe(1200);
  });

  it("reports no change when exactly the bill is handed over", () => {
    expect(totals({ cashReceived: 1000 }).change).toBe(0);
  });

  it("reports change on an overpayment", () => {
    expect(totals({ cashReceived: 1500 }).change).toBe(500);
  });

  it("never reports negative change on an underpayment", () => {
    expect(totals({ cashReceived: 400 }).change).toBe(0);
  });

  it("counts card and bank alongside cash", () => {
    const t = totals({ items: [line({ rate: 3000 })], cashReceived: 500, cardAmount: 1000, bankAmount: 1500 });
    expect(t.change).toBe(0);
    expect(t.netBill).toBe(3000);
  });
});

describe("calculateInvoiceTotals — net-return (refund) invoices", () => {
  const refund = (over = {}) =>
    totals({ items: [line({ rate: 800, isReturn: true })], ...over });

  it("goes negative and flags itself as a refund", () => {
    const t = refund();
    expect(t.netBill).toBe(-800);
    expect(t.isRefund).toBe(true);
  });

  it("owes nothing at the till", () => {
    expect(refund().amountDue).toBe(0);
  });

  it("shows no change when the exact refund is paid out", () => {
    // Phase 3 bug: `change` was measured against netBill itself, so paying out
    // the refund read as an 800 overpayment.
    expect(refund({ cashReceived: 800 }).change).toBe(0);
  });

  it("only shows change once more than the refund has been paid out", () => {
    expect(refund({ cashReceived: 950 }).change).toBe(150);
  });

  it("refuses to apply store credit", () => {
    // There is nothing to reduce — the store owes the customer on this invoice.
    expect(refund({ creditApplied: 500 }).creditApplied).toBe(0);
  });
});

describe("calculateInvoiceTotals — store credit", () => {
  it("reduces what has to be collected", () => {
    const t = totals({ items: [line({ rate: 1000 })], creditApplied: 450 });
    expect(t.creditApplied).toBe(450);
    expect(t.amountDue).toBe(550);
    expect(t.netBill).toBe(1000); // the bill itself is unchanged
  });

  it("settles the bill with no change due when the rest is paid in cash", () => {
    const t = totals({ items: [line({ rate: 1000 })], creditApplied: 450, cashReceived: 550 });
    expect(t.change).toBe(0);
  });

  it("clamps credit to the bill so it can never become a cash payout", () => {
    const t = totals({ items: [line({ rate: 600 })], creditApplied: 1000 });
    expect(t.creditApplied).toBe(600);
    expect(t.amountDue).toBe(0);
    expect(t.change).toBe(0);
  });

  it("ignores a negative credit figure", () => {
    expect(totals({ creditApplied: -200 }).creditApplied).toBe(0);
  });
});

describe("computeSaleLedgerSplit", () => {
  it("bills the whole invoice and credits what was paid", () => {
    expect(computeSaleLedgerSplit(1000, 250)).toEqual({ debit: 1000, credit: 250 });
  });

  it("leaves the full bill owing when nothing was paid", () => {
    expect(computeSaleLedgerSplit(5000, 0)).toEqual({ debit: 5000, credit: 0 });
  });

  it("nets a refund into the debit side instead of double-subtracting", () => {
    // −800 owed to the customer, 800 handed over → the party is square.
    expect(computeSaleLedgerSplit(-800, 800)).toEqual({ debit: 0, credit: 0 });
  });

  it("leaves the unpaid part of a refund as store credit", () => {
    // Nothing paid out, so the customer is owed 800: a negative balance.
    expect(computeSaleLedgerSplit(-800, 0)).toEqual({ debit: -800, credit: 0 });
  });
});

describe("cashKeptFromTender — change handed back is not the store's money", () => {
  /**
   * Regression cover for a defect that lived from Phase 2 until now: the
   * invoice stored `cashReceived` as the amount **tendered**, and the ledger
   * split, the Cash account entry and the installment plan were all handed
   * that tendered figure. A 1000 bill paid with a 1500 note therefore credited
   * the customer 1500 (leaving them 500 of store credit they never earned) and
   * debited the cash account 1500 though only 1000 stayed in the till.
   */
  it("nets change off the tender", () => {
    expect(cashKeptFromTender({ netBill: 1000, cashReceived: 1500, change: 500 })).toBe(1000);
  });

  it("leaves an exact tender alone", () => {
    expect(cashKeptFromTender({ netBill: 1000, cashReceived: 1000, change: 0 })).toBe(1000);
  });

  it("leaves a part payment alone", () => {
    expect(cashKeptFromTender({ netBill: 1000, cashReceived: 400, change: 0 })).toBe(400);
  });

  it("never returns a negative figure when change exceeds the cash tendered", () => {
    // Change can be inflated by a bank/card overpayment, which is not settled
    // out of the drawer — the cash side must not go below zero.
    expect(cashKeptFromTender({ netBill: 1000, cashReceived: 200, change: 500 })).toBe(0);
  });

  it("does NOT net an over-refund on a net-return invoice", () => {
    // Here `cashReceived` is money paid *out* and `change` means
    // "over-refunded" — that cash genuinely left the drawer as well.
    expect(cashKeptFromTender({ netBill: -800, cashReceived: 950, change: 150 })).toBe(950);
  });

  it("credits the ledger only with what was kept", () => {
    const kept = cashKeptFromTender({ netBill: 1000, cashReceived: 1500, change: 500 });
    expect(computeSaleLedgerSplit(1000, kept)).toEqual({ debit: 1000, credit: 1000 });
  });

  it("is exposed on the totals object so the screen and the server agree", () => {
    const t = totals({ items: [line({ rate: 1000 })], cashReceived: 1500 });
    expect(t.change).toBe(500);
    expect(t.cashKept).toBe(1000);
  });
});

describe("computePurchaseLedgerSplit", () => {
  it("credits the payable and debits what was handed over", () => {
    expect(computePurchaseLedgerSplit(10000, 4000)).toEqual({
      type: "PURCHASE", debit: 4000, credit: 10000,
    });
  });

  it("types a net return as PURCHASE_RETURN with both columns positive", () => {
    // The vendor owes us the returned value; direction is carried by the type.
    expect(computePurchaseLedgerSplit(-500, 0)).toEqual({
      type: "PURCHASE_RETURN", debit: 500, credit: 0,
    });
  });

  it("credits a refund taken back against that claim", () => {
    expect(computePurchaseLedgerSplit(-500, 200)).toEqual({
      type: "PURCHASE_RETURN", debit: 500, credit: 200,
    });
  });
});

describe("moneyKeptFromTender — change never becomes customer balance", () => {
  const line = [{ itemId: "i", isReturn: false, qty: 1, unit: "PCS", rate: 1000, disRS: 0, disPct: 0, amount: 1000 }];

  /** Bill 1000 settled by the given tender; returns the resulting party balance. */
  function balanceAfter(tender: { cardAmount?: number; cashReceived?: number; bankAmount?: number }) {
    const t = calculateInvoiceTotals({
      items: line as any,
      packageDiscount: 0, adjustment: 0, adjustType: "add", courierCharges: 0,
      cardAmount: tender.cardAmount ?? 0,
      cashReceived: tender.cashReceived ?? 0,
      bankAmount: tender.bankAmount ?? 0,
      creditApplied: 0,
    } as any);
    const split = computeSaleLedgerSplit(t.netBill, t.totalKept);
    return { change: t.change, balance: split.debit - split.credit, totals: t };
  }

  it("a 1000 bill paid with a 1200 bank transfer leaves no balance", () => {
    // Regression: change was netted off cash only, so cash clamped at 0 and the
    // full 1200 reached the ledger — gifting 200 of store credit.
    const r = balanceAfter({ bankAmount: 1200 });
    expect(r.change).toBe(200);
    expect(r.balance).toBe(0);
    expect(r.totals.bankKept).toBe(1000);
  });

  it("a 1000 bill paid with a 1200 card leaves no balance", () => {
    const r = balanceAfter({ cardAmount: 1200 });
    expect(r.change).toBe(200);
    expect(r.balance).toBe(0);
    expect(r.totals.cardKept).toBe(1000);
  });

  it("still nets a plain cash overpayment off cash", () => {
    const r = balanceAfter({ cashReceived: 1500 });
    expect(r.change).toBe(500);
    expect(r.balance).toBe(0);
    expect(r.totals.cashKept).toBe(1000);
  });

  it("absorbs change cash first, then spills onto bank", () => {
    // 300 cash + 900 bank on a 1000 bill = 200 change, only 300 of it in cash.
    const r = balanceAfter({ cashReceived: 300, bankAmount: 900 });
    expect(r.change).toBe(200);
    expect(r.totals.cashKept).toBe(100);
    expect(r.totals.bankKept).toBe(900);
    expect(r.balance).toBe(0);
  });

  it("spills past cash onto bank when cash cannot cover the change", () => {
    const kept = moneyKeptFromTender({
      netBill: 1000, cardAmount: 0, cashReceived: 200, bankAmount: 1300, change: 500,
    });
    expect(kept).toEqual({ cardKept: 0, cashKept: 0, bankKept: 1000, totalKept: 1000 });
  });

  it("keeps every channel non-negative and summing to totalKept", () => {
    const kept = moneyKeptFromTender({
      netBill: 1000, cardAmount: 400, cashReceived: 300, bankAmount: 500, change: 200,
    });
    expect(kept.cardKept).toBeGreaterThanOrEqual(0);
    expect(kept.cashKept + kept.bankKept + kept.cardKept).toBe(kept.totalKept);
    expect(kept.totalKept).toBe(1000);
  });

  it("nets nothing on a net-return invoice — the over-refund left the till too", () => {
    const kept = moneyKeptFromTender({
      netBill: -800, cardAmount: 0, cashReceived: 950, bankAmount: 0, change: 150,
    });
    expect(kept.cashKept).toBe(950);
    expect(kept.totalKept).toBe(950);
  });
});

describe("moneyInFromInvoice — a refund is cash out, not cash received", () => {
  it("counts a sale's kept cash as money in", () => {
    // 4000 bill, 5000 handed over, 1000 change: 4000 is stored and 4000 counts.
    const { cashKept } = moneyKeptFromTender({ netBill: 4000, cardAmount: 0, cashReceived: 5000, bankAmount: 0, change: 1000 });
    expect(moneyInFromInvoice(4000, cashKept)).toBe(4000);
  });

  it("subtracts a net-return invoice's payout", () => {
    expect(moneyInFromInvoice(-500, 500)).toBe(-500);
  });

  it("a day with a 4000 sale and a 500 cash refund took in 3500", () => {
    const day = [
      { netBill: 4000, cash: 4000 },
      { netBill: -500, cash: 500 },
    ];
    expect(day.reduce((s, r) => s + moneyInFromInvoice(r.netBill, r.cash), 0)).toBe(3500);
  });
});
