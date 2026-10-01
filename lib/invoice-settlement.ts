/**
 * How much of a sale invoice has actually been settled, and the payment status
 * derived from it.
 *
 * Deliberately pure (no Prisma import) so the money logic can be unit-tested on
 * its own in Phase 9 — the same way lib/installments.ts is. Shared by
 * GET /api/reports/sales (the badge and the payment-status filter) and
 * POST/DELETE /api/sales/[id]/payment (the Mark Paid / Mark Unpaid actions), so
 * the outstanding figure the cashier sees and the one the server settles can't
 * drift apart.
 */

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

/** Cent-level tolerance, matching lib/installments.ts. */
const EPSILON = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type InvoiceSettlement = {
  netBill: number;
  /** Store credit written off against the bill at checkout. */
  creditApplied?: number;
  /** Taken at the counter when the invoice was rung up. */
  cashReceived?: number;
  cardAmount?: number;
  bankAmount?: number;
  /**
   * Money collected later against this specific invoice — the sum of the
   * `Recovery` rows carrying its `invoiceId` (Mark Paid, and installment
   * collections on its plan). Plain party-level recoveries are not attributable
   * to one invoice and are deliberately not counted here.
   */
  recovered?: number;
};

/**
 * Everything that has reduced this invoice's balance: credit applied, money
 * taken at the counter, and money collected against it since.
 */
export function invoiceSettledAmount(inv: InvoiceSettlement): number {
  return round2(
    (inv.creditApplied ?? 0) +
    (inv.cashReceived ?? 0) +
    (inv.cardAmount ?? 0) +
    (inv.bankAmount ?? 0) +
    (inv.recovered ?? 0)
  );
}

/**
 * What is still owed on the invoice, never negative.
 *
 * A net-return invoice (`netBill <= 0`) owes nothing — the store owes the
 * customer, and that refund is handled as a refund at the counter or left as
 * store credit on their ledger, not as an invoice balance.
 */
export function invoiceOutstanding(inv: InvoiceSettlement): number {
  if (inv.netBill <= 0) return 0;
  return Math.max(0, round2(inv.netBill - invoiceSettledAmount(inv)));
}

/**
 * The money the customer actually handed over, and so the most a refund of this
 * invoice can pay back out: the counter payments plus anything collected against
 * it since.
 *
 * `creditApplied` is deliberately **not** part of it. No money came in for store
 * credit, so there is none to hand back — the refund's ledger row returns that
 * part as credit instead (see app/api/sales/[id]/refund/route.ts). This lives
 * here, next to `invoiceSettledAmount`, because the refund modal shows the
 * figure and the route enforces it; computing it twice is how the two would
 * drift apart.
 */
export function invoiceRefundable(inv: InvoiceSettlement): number {
  return round2(
    (inv.cashReceived ?? 0) +
    (inv.cardAmount ?? 0) +
    (inv.bankAmount ?? 0) +
    (inv.recovered ?? 0)
  );
}

/**
 * PAID / PARTIAL / UNPAID for the sales list.
 *
 * Before Phase 7 this was computed from `cashReceived + cardAmount` alone, so a
 * bank-paid invoice, one settled with store credit, and one whose installments
 * had all been collected each still showed as UNPAID.
 */
export function invoicePaymentStatus(inv: InvoiceSettlement): PaymentStatus {
  if (inv.netBill <= 0) return "PAID";
  if (invoiceOutstanding(inv) <= EPSILON) return "PAID";
  return invoiceSettledAmount(inv) > EPSILON ? "PARTIAL" : "UNPAID";
}
