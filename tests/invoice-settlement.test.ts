import { describe, expect, it } from "vitest";
import {
  invoiceOutstanding,
  invoicePaymentStatus,
  invoiceRefundable,
  invoiceSettledAmount,
} from "@/lib/invoice-settlement";

/**
 * The sales list's PAID/PARTIAL/UNPAID badge and the figure Mark Paid collects
 * both come from here. The cases marked "regression" are the ones the old
 * formula got wrong — it counted only `cashReceived + cardAmount`, so a
 * bank-paid invoice, one settled with store credit, and one whose installments
 * had all been collected each read UNPAID.
 */

describe("invoiceSettledAmount", () => {
  it("adds up every channel that reduces the balance", () => {
    expect(invoiceSettledAmount({
      netBill: 10000, creditApplied: 450, cashReceived: 550,
      cardAmount: 1000, bankAmount: 2000, recovered: 6000,
    })).toBe(10000);
  });

  it("treats missing channels as zero", () => {
    expect(invoiceSettledAmount({ netBill: 1000 })).toBe(0);
  });

  it("rounds to paisa rather than carrying float noise", () => {
    expect(invoiceSettledAmount({ netBill: 100, cashReceived: 0.1, bankAmount: 0.2 })).toBe(0.3);
  });
});

describe("invoiceOutstanding", () => {
  it("is the bill less everything settled", () => {
    expect(invoiceOutstanding({ netBill: 5000, cashReceived: 2000 })).toBe(3000);
  });

  it("is zero once fully settled", () => {
    expect(invoiceOutstanding({ netBill: 5000, cashReceived: 2000, recovered: 3000 })).toBe(0);
  });

  it("never goes negative when more was taken than billed", () => {
    expect(invoiceOutstanding({ netBill: 1000, cashReceived: 1200 })).toBe(0);
  });

  it("is zero on a net-return invoice", () => {
    // The store owes the customer; that is a refund or store credit, not an
    // invoice balance to chase.
    expect(invoiceOutstanding({ netBill: -800 })).toBe(0);
    expect(invoiceOutstanding({ netBill: 0 })).toBe(0);
  });

  it("counts store credit toward settling the bill", () => {
    expect(invoiceOutstanding({ netBill: 1000, creditApplied: 450 })).toBe(550);
  });
});

describe("invoicePaymentStatus", () => {
  it("is PAID when the counter took the lot", () => {
    expect(invoicePaymentStatus({ netBill: 1000, cashReceived: 1000 })).toBe("PAID");
  });

  it("is PAID for a bank-only sale (regression)", () => {
    expect(invoicePaymentStatus({ netBill: 1000, bankAmount: 1000 })).toBe("PAID");
  });

  it("is PAID when store credit covered it (regression)", () => {
    expect(invoicePaymentStatus({ netBill: 750, creditApplied: 750 })).toBe("PAID");
  });

  it("is PAID once collections against it add up (regression)", () => {
    expect(invoicePaymentStatus({ netBill: 3000, recovered: 3000 })).toBe("PAID");
  });

  it("is UNPAID on a credit sale with nothing taken", () => {
    expect(invoicePaymentStatus({ netBill: 5000 })).toBe("UNPAID");
  });

  it("is PARTIAL once anything has been taken", () => {
    expect(invoicePaymentStatus({ netBill: 5000, cashReceived: 1 })).toBe("PARTIAL");
    expect(invoicePaymentStatus({ netBill: 5000, recovered: 2500 })).toBe("PARTIAL");
  });

  it("is PAID on a net-return invoice", () => {
    expect(invoicePaymentStatus({ netBill: -800 })).toBe("PAID");
  });

  it("does not leave an invoice PARTIAL over rounding noise", () => {
    // A third of 1000 collected three times must close the invoice.
    expect(invoicePaymentStatus({ netBill: 1000, recovered: 333.33 + 333.33 + 333.34 })).toBe("PAID");
    expect(invoicePaymentStatus({ netBill: 333.34, cashReceived: 333.335 })).toBe("PAID");
  });

  it("does not count sub-paisa dust as a part payment", () => {
    expect(invoicePaymentStatus({ netBill: 1000, cashReceived: 0.001 })).toBe("UNPAID");
  });
});

describe("the Mark Paid / Mark Unpaid round trip", () => {
  // Mirrors the flow verified end-to-end against the real routes: 1000 bill,
  // 200 taken at the counter, then collected in two goes and reversed.
  const invoice = { netBill: 1000, cashReceived: 200 };

  it("starts PARTIAL with 800 outstanding", () => {
    expect(invoicePaymentStatus(invoice)).toBe("PARTIAL");
    expect(invoiceOutstanding(invoice)).toBe(800);
  });

  it("stays PARTIAL after a part payment", () => {
    const after = { ...invoice, recovered: 300 };
    expect(invoicePaymentStatus(after)).toBe("PARTIAL");
    expect(invoiceOutstanding(after)).toBe(500);
  });

  it("closes once the rest is collected", () => {
    const after = { ...invoice, recovered: 800 };
    expect(invoicePaymentStatus(after)).toBe("PAID");
    expect(invoiceOutstanding(after)).toBe(0);
  });

  it("returns to its previous position when the collections are reversed", () => {
    const reversed = { ...invoice, recovered: 800 - 800 };
    expect(invoicePaymentStatus(reversed)).toBe("PARTIAL");
    expect(invoiceOutstanding(reversed)).toBe(800);
  });
});

/**
 * The ceiling on a full-order refund's payout — shown in the Refund modal and
 * enforced by POST /api/sales/[id]/refund, which is why it lives in the shared
 * module rather than being computed twice.
 */
describe("invoiceRefundable", () => {
  it("adds up every channel money actually arrived through", () => {
    expect(invoiceRefundable({
      netBill: 10000, cashReceived: 550, cardAmount: 1000,
      bankAmount: 2000, recovered: 6000,
    })).toBe(9550);
  });

  it("excludes store credit — no money came in for it, so none can go back out", () => {
    expect(invoiceRefundable({ netBill: 1000, creditApplied: 450, cashReceived: 550 })).toBe(550);
  });

  it("is 0 for an unpaid credit sale: the refund cancels the debt, it pays nothing", () => {
    expect(invoiceRefundable({ netBill: 1000 })).toBe(0);
  });

  it("counts money collected after the sale, which a refund also has to give back", () => {
    expect(invoiceRefundable({ netBill: 1000, cashReceived: 200, recovered: 800 })).toBe(1000);
  });

  it("is never more than the settled amount", () => {
    const inv = { netBill: 1000, creditApplied: 450, cashReceived: 550 };
    expect(invoiceRefundable(inv)).toBeLessThanOrEqual(invoiceSettledAmount(inv));
  });

  it("rounds to the cent", () => {
    expect(invoiceRefundable({ netBill: 100, cashReceived: 0.1, bankAmount: 0.2 })).toBe(0.3);
  });
});
