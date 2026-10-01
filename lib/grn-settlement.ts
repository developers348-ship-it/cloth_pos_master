/**
 * How much of a GRN (purchase bill) has actually been settled, and the payment
 * status derived from it — the purchase-side mirror of lib/invoice-settlement.ts.
 *
 * Deliberately pure (no Prisma import) so the money logic can be unit-tested on
 * its own. Shared by GET /api/reports/purchases (the badge and the
 * payment-status filter) and GET /api/purchases/:id (the GRN detail document),
 * so the outstanding figure the records list shows and the one the printed GRN
 * states can't drift apart.
 */

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

/** Cent-level tolerance, matching lib/invoice-settlement.ts. */
const EPSILON = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type GrnSettlement = {
  netBill: number;
  /** Handed to the vendor at receipt time (`GRN.cashAmount`). */
  cashPaid?: number;
  /** Paid from a bank account at receipt time (`GRN.bankAmount`). */
  bankPaid?: number;
  /**
   * Paid to the vendor since, against this GRN's installment plan — the sum of
   * `Installment.paidAmount` on the plan hanging off its `grnId`.
   */
  collected?: number;
  /**
   * Paid to the vendor from the Ledger page's Payment tab against this specific
   * bill — the sum of the `Payment` rows carrying its `grnId`.
   *
   * `Payment.grnId` did not exist until the `payment_grn_link` migration, so
   * an ad-hoc vendor payment was attributable to no bill at all: a GRN with no
   * repayment plan stayed UNPAID however much had been paid out. The vendor's
   * *balance* was right either way — it was only the per-bill attribution that
   * was missing. Payments made against the vendor's balance as a whole still
   * leave `grnId` null and are still not counted here, because they belong to
   * no single bill.
   */
  paid?: number;
};

/**
 * Everything that has reduced this bill: paid at receipt, collected through its
 * plan, and paid against it from the Ledger page since.
 */
export function grnSettledAmount(grn: GrnSettlement): number {
  return round2(
    (grn.cashPaid ?? 0) +
    (grn.bankPaid ?? 0) +
    (grn.collected ?? 0) +
    (grn.paid ?? 0)
  );
}

/**
 * What is still owed to the vendor on this bill, never negative.
 *
 * A net-return GRN (`netBill <= 0`) owes nothing — the vendor owes *us*, and
 * that is settled as a refund at receipt time or left on their ledger as a
 * claim, not as a bill balance. Same rule as `invoiceOutstanding`.
 */
export function grnOutstanding(grn: GrnSettlement): number {
  if (grn.netBill <= 0) return 0;
  return Math.max(0, round2(grn.netBill - grnSettledAmount(grn)));
}

/** PAID / PARTIAL / UNPAID for the GRN records list. */
export function grnPaymentStatus(grn: GrnSettlement): PaymentStatus {
  if (grn.netBill <= 0) return "PAID";
  if (grnOutstanding(grn) <= EPSILON) return "PAID";
  return grnSettledAmount(grn) > EPSILON ? "PARTIAL" : "UNPAID";
}
