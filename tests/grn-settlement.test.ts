import { describe, expect, it } from "vitest";
import {
  grnOutstanding,
  grnPaymentStatus,
  grnSettledAmount,
} from "@/lib/grn-settlement";

/**
 * The GRN Records list's PAID/PARTIAL/UNPAID badge and the Outstanding figure
 * the printed GRN states both come from here.
 *
 * The net-return cases are the ones worth pinning: on a GRN that gave back more
 * than it took, `cashPaid`/`bankPaid` are money coming back *from* the vendor,
 * so the same numbers mean the opposite thing and the bill itself owes nothing.
 */

describe("grnSettledAmount", () => {
  it("adds what was paid at receipt to what has been paid since", () => {
    expect(grnSettledAmount({
      netBill: 10000, cashPaid: 2000, bankPaid: 3000, collected: 5000,
    })).toBe(10000);
  });

  it("treats missing channels as zero", () => {
    expect(grnSettledAmount({ netBill: 1000 })).toBe(0);
  });

  it("rounds to paisa rather than carrying float noise", () => {
    expect(grnSettledAmount({ netBill: 100, cashPaid: 0.1, bankPaid: 0.2 })).toBe(0.3);
  });
});

describe("grnOutstanding", () => {
  it("is the bill less everything paid", () => {
    expect(grnOutstanding({ netBill: 5000, cashPaid: 2000 })).toBe(3000);
  });

  it("counts installment collections, not just the payment at receipt", () => {
    expect(grnOutstanding({ netBill: 5000, cashPaid: 2000, collected: 3000 })).toBe(0);
  });

  it("never goes negative when more was handed over than billed", () => {
    expect(grnOutstanding({ netBill: 1000, cashPaid: 1200 })).toBe(0);
  });

  it("is zero on a net-return GRN, however much came back", () => {
    // The vendor owes us; that claim lives on their ledger, not as a balance on
    // this bill — the same rule `invoiceOutstanding` applies to a refund.
    expect(grnOutstanding({ netBill: -500 })).toBe(0);
    expect(grnOutstanding({ netBill: -500, cashPaid: 200 })).toBe(0);
  });

  it("is the whole bill on a LEND GRN with nothing paid", () => {
    expect(grnOutstanding({ netBill: 7500 })).toBe(7500);
  });
});

describe("grnPaymentStatus", () => {
  it("is UNPAID when the whole bill went on vendor credit", () => {
    expect(grnPaymentStatus({ netBill: 5000 })).toBe("UNPAID");
  });

  it("is PARTIAL when some of it was paid at receipt", () => {
    expect(grnPaymentStatus({ netBill: 5000, cashPaid: 1000 })).toBe("PARTIAL");
  });

  it("is PARTIAL when only an installment has been collected", () => {
    expect(grnPaymentStatus({ netBill: 5000, collected: 1200 })).toBe("PARTIAL");
  });

  it("is PAID once the bill is settled by any mix of channels", () => {
    expect(grnPaymentStatus({ netBill: 5000, cashPaid: 1000, bankPaid: 1500, collected: 2500 })).toBe("PAID");
  });

  it("is PAID on a net-return GRN", () => {
    expect(grnPaymentStatus({ netBill: -500 })).toBe("PAID");
  });

  it("is PAID on a zero-value GRN", () => {
    expect(grnPaymentStatus({ netBill: 0 })).toBe("PAID");
  });

  it("treats a sub-paisa remainder as settled", () => {
    expect(grnPaymentStatus({ netBill: 1000, cashPaid: 999.999 })).toBe("PAID");
  });
});

describe("paid — Ledger-page payments booked against one bill", () => {
  /**
   * `Payment.grnId` did not exist until the `payment_grn_link` migration, so a
   * vendor payment attached to no bill: a GRN with no repayment plan stayed
   * UNPAID however much had been paid out. Payments left unattached (against
   * the vendor's balance as a whole) still stay out of this.
   */
  it("counts toward the settled amount", () => {
    expect(grnSettledAmount({ netBill: 10000, cashPaid: 2000, paid: 3000 })).toBe(5000);
  });

  it("reduces the outstanding", () => {
    expect(grnOutstanding({ netBill: 10000, cashPaid: 2000, paid: 3000 })).toBe(5000);
  });

  it("can settle a bill that has no repayment plan at all", () => {
    expect(grnPaymentStatus({ netBill: 10000, paid: 10000 })).toBe("PAID");
  });

  it("shows PARTIAL for a part payment on an unplanned bill", () => {
    expect(grnPaymentStatus({ netBill: 10000, paid: 4000 })).toBe("PARTIAL");
  });

  it("still reads UNPAID when nothing has been attached", () => {
    expect(grnPaymentStatus({ netBill: 10000 })).toBe("UNPAID");
  });

  it("adds up alongside the plan collections and the receipt-time payment", () => {
    expect(grnSettledAmount({
      netBill: 10000, cashPaid: 1000, bankPaid: 2000, collected: 3000, paid: 4000,
    })).toBe(10000);
  });

  it("never drives the outstanding negative on an over-payment", () => {
    expect(grnOutstanding({ netBill: 1000, paid: 1500 })).toBe(0);
  });
});
