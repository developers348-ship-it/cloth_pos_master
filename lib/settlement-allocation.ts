/**
 * FIFO allocation of one collection across a party's open bills.
 *
 * Pure and Prisma-free, so the Ledger screen can pre-fill the split it is
 * about to send and `POST /api/ledger/recovery` can re-derive and validate the
 * very same numbers. Before this existed a recovery moved the party's *balance*
 * but attached to no bill at all, so a customer's ledger came back to zero
 * while every one of their invoices still read UNPAID.
 */

/** Cent-level tolerance, matching lib/invoice-settlement.ts. */
const EPSILON = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OpenDocument = {
  /** SaleInvoice.id or GRN.id. */
  id: string;
  /** Invoice/GRN number, for the reference on the written rows. */
  no: number;
  date: string | Date;
  netBill: number;
  /** Already settled — at the counter and by anything collected since. */
  settled: number;
  /** `netBill − settled`, never negative. */
  outstanding: number;
};

export type Allocation = { id: string; amount: number };

/**
 * Splits `amount` across `documents` oldest-first, filling each to its
 * outstanding before moving on. Anything left once every bill is covered comes
 * back as `unallocated` — the caller decides whether that is an error (it is,
 * for a recovery: see `validateAllocations`) or an on-account advance.
 *
 * Documents are sorted here rather than trusted in order, so a caller can't
 * change the split by reordering its list.
 */
export function allocateFifo(documents: OpenDocument[], amount: number): {
  allocations: Allocation[];
  unallocated: number;
} {
  let left = round2(Math.max(0, amount));
  const allocations: Allocation[] = [];

  const oldestFirst = [...documents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.no - b.no
  );

  for (const doc of oldestFirst) {
    if (left <= EPSILON) break;
    if (doc.outstanding <= EPSILON) continue;
    const take = round2(Math.min(left, doc.outstanding));
    allocations.push({ id: doc.id, amount: take });
    left = round2(left - take);
  }

  return { allocations, unallocated: left };
}

export type AllocationError =
  | { code: "UNKNOWN_DOCUMENT"; id: string }
  | { code: "DUPLICATE_DOCUMENT"; id: string }
  | { code: "NOT_POSITIVE"; id: string }
  | { code: "OVER_DOCUMENT"; id: string; no: number; outstanding: number; amount: number }
  | { code: "OVER_TOTAL"; total: number; amount: number }
  | { code: "OVER_OUTSTANDING"; amount: number; totalOutstanding: number };

/**
 * Checks a client-supplied split against the bills as the database currently
 * has them. Rejects rather than clamping, for the same reason
 * `validateCreditApplied` does: the row that gets written has to be the one the
 * cashier agreed with the customer, and a quietly reduced allocation would
 * leave a bill looking unpaid after the money was handed over.
 *
 * The over-collection rule the shop asked for lives here: **a recovery may not
 * exceed what the party actually owes.** It is checked against the sum of the
 * live outstanding figures, not against the typed total, so a stale screen
 * cannot authorise it.
 */
export function validateAllocations(params: {
  documents: OpenDocument[];
  allocations: Allocation[];
  /** The single amount being collected; the split must add up to it. */
  amount: number;
}): AllocationError | null {
  const { documents, allocations, amount } = params;

  const byId = new Map(documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  let total = 0;

  for (const alloc of allocations) {
    const doc = byId.get(alloc.id);
    if (!doc) return { code: "UNKNOWN_DOCUMENT", id: alloc.id };
    if (seen.has(alloc.id)) return { code: "DUPLICATE_DOCUMENT", id: alloc.id };
    seen.add(alloc.id);

    if (!(alloc.amount > EPSILON)) return { code: "NOT_POSITIVE", id: alloc.id };
    if (alloc.amount - doc.outstanding > EPSILON) {
      return {
        code: "OVER_DOCUMENT", id: alloc.id, no: doc.no,
        outstanding: doc.outstanding, amount: alloc.amount,
      };
    }
    total = round2(total + alloc.amount);
  }

  if (total - amount > EPSILON) return { code: "OVER_TOTAL", total, amount };

  const totalOutstanding = round2(documents.reduce((s, d) => s + d.outstanding, 0));
  if (amount - totalOutstanding > EPSILON) {
    return { code: "OVER_OUTSTANDING", amount, totalOutstanding };
  }

  return null;
}

export function allocationErrorMessage(err: AllocationError): string {
  switch (err.code) {
    case "UNKNOWN_DOCUMENT":
      return "One of the selected bills no longer belongs to this party";
    case "DUPLICATE_DOCUMENT":
      return "The same bill was allocated twice";
    case "NOT_POSITIVE":
      return "Every allocated amount must be greater than zero";
    case "OVER_DOCUMENT":
      return `Allocated ${err.amount.toFixed(2)} to #${err.no}, which only has ${err.outstanding.toFixed(2)} outstanding`;
    case "OVER_TOTAL":
      return `The split (${err.total.toFixed(2)}) is more than the amount being collected (${err.amount.toFixed(2)})`;
    case "OVER_OUTSTANDING":
      return `Cannot collect ${err.amount.toFixed(2)} — this party only owes ${err.totalOutstanding.toFixed(2)}`;
  }
}
