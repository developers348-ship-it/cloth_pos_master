/**
 * Checkout payment validation — the rules that decide whether an invoice may
 * be saved at all.
 *
 * Deliberately Prisma-free and side-effect-free so the same function runs on
 * the checkout screen (to block the Save button with a specific message) and
 * inside `POST /api/sales` (so a stale tab or a hand-rolled request can't get
 * round it). Anything that needs the database — is this the walking customer?
 * — is passed in as a plain flag by both callers.
 *
 * ## Why `partyOption` participates at all
 *
 * `partyOption` is a **price tier**, not a payment method: `CASH` prices lines
 * at `salePrice`, `CC` ("Credit Customer") at `altSalePrice`. But the tier and
 * the settlement are two halves of one decision in this shop — the credit
 * price exists *because* the money is not arriving today. So a fully-settled
 * CC sale and an unsettled CASH sale are both mis-keyed invoices, and the
 * consequence is a wrong price on a real bill, not just a wrong label.
 *
 * Switching tier re-prices every line, which is why the screen resolves
 * `CREDIT_SALE_FULLY_PAID` with a confirm-then-review step rather than
 * silently flipping the tier during save.
 */

/** Money comparisons tolerate sub-paisa Decimal noise, as elsewhere in this app. */
const EPSILON = 0.005;

export type SaleValidationCode =
  | "BANK_ACCOUNT_REQUIRED"
  | "BANK_AMOUNT_REQUIRED"
  | "CASH_AMOUNT_REQUIRED"
  | "CASH_SALE_NOT_SETTLED"
  | "CREDIT_NEEDS_NAMED_PARTY"
  | "CREDIT_SALE_FULLY_PAID";

export type SaleValidationIssue = {
  code: SaleValidationCode;
  /** Filled for CASH_SALE_NOT_SETTLED — what is still owed at the till. */
  outstanding?: number;
};

export type SaleValidationInput = {
  /** Price tier: "CASH" | "CC" (older invoices may hold CR/1INCH/5INCH). */
  partyOption: string;
  paymentMethod: "CASH" | "BANK" | "CASH_AND_BANK" | string;
  netBill: number;
  /** `netBill − creditApplied − card − cash − bank`, floored at 0. */
  outstanding: number;
  cashReceived: number;
  bankAmount: number;
  bankAccountId: string | null | undefined;
  /** True for the shared `isDefault` Walking Customer. */
  isWalkingCustomer: boolean;
  /** `netBill < 0` — more returned than sold, so money flows outward. */
  isRefund: boolean;
};

/**
 * First blocking problem with an invoice's payment, or `null` when it may be
 * saved. One issue at a time on purpose: the cashier fixes the field named,
 * re-saves, and gets the next one, rather than reading a wall of errors.
 */
export function validateSalePayment(input: SaleValidationInput): SaleValidationIssue | null {
  const {
    partyOption, paymentMethod, netBill, outstanding,
    cashReceived, bankAmount, bankAccountId, isWalkingCustomer, isRefund,
  } = input;

  const usesBank = paymentMethod === "BANK" || paymentMethod === "CASH_AND_BANK";

  // ── Mechanical completeness of the chosen method ────────────────────────
  // A bank amount with no account posts to no balance at all, and a bank
  // method with no amount means the method was picked and then not filled in.
  if (usesBank && !bankAccountId) return { code: "BANK_ACCOUNT_REQUIRED" };
  if (usesBank && bankAmount <= EPSILON) return { code: "BANK_AMOUNT_REQUIRED" };
  // Only enforced for "Cash & Bank": plain "Cash" is the screen's default
  // method, and a pure credit sale legitimately leaves it at zero.
  if (paymentMethod === "CASH_AND_BANK" && cashReceived <= EPSILON) {
    return { code: "CASH_AMOUNT_REQUIRED" };
  }

  // ── Tier-vs-settlement rules ────────────────────────────────────────────
  // A net-return invoice pays money *out*, so "settled" and "fully paid" both
  // mean the opposite there; and a zero-value bill has nothing to settle.
  if (isRefund || netBill <= EPSILON) return null;

  if (partyOption === "CASH") {
    if (outstanding > EPSILON) return { code: "CASH_SALE_NOT_SETTLED", outstanding };
    return null;
  }

  // Credit tier from here on.
  // The walking customer is shared by every anonymous sale, so a debt parked
  // on it belongs to nobody and can never be recovered from anyone.
  if (isWalkingCustomer) return { code: "CREDIT_NEEDS_NAMED_PARTY" };
  if (outstanding <= EPSILON) return { code: "CREDIT_SALE_FULLY_PAID" };

  return null;
}

/** English messages for the server's 400 responses. The UI uses translations. */
const SERVER_MESSAGES: Record<SaleValidationCode, string> = {
  BANK_ACCOUNT_REQUIRED: "Select a bank account for the bank amount",
  BANK_AMOUNT_REQUIRED: "Enter the amount received in the bank",
  CASH_AMOUNT_REQUIRED: "Enter the cash amount received",
  CASH_SALE_NOT_SETTLED: "A Cash sale must be paid in full before it can be saved",
  CREDIT_NEEDS_NAMED_PARTY: "The walking customer cannot take a credit sale — select or add a customer",
  CREDIT_SALE_FULLY_PAID: "A fully paid sale must use the Cash price list, not Credit Customer",
};

export function saleValidationMessage(issue: SaleValidationIssue): string {
  if (issue.code === "CASH_SALE_NOT_SETTLED") {
    return `${SERVER_MESSAGES.CASH_SALE_NOT_SETTLED} (Rs. ${(issue.outstanding ?? 0).toFixed(2)} still due)`;
  }
  return SERVER_MESSAGES[issue.code];
}
