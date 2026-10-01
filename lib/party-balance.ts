import { prisma } from "@/lib/prisma";

export type PartyBalance = {
  partyId: string;
  accountId: number;
  name: string;
  type: string;
  isDefault: boolean;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  /**
   * Signed balance: > 0 means the party owes the store (a receivable),
   * < 0 means the store owes the party — i.e. the party is holding store
   * credit, typically from a return that was not refunded in cash.
   */
  balance: number;
  /** The negative side of `balance` as a positive number — what is spendable at checkout. */
  availableCredit: number;
  /** Whether store credit may be applied at checkout for this party at all. */
  creditEligible: boolean;
};

/**
 * Reason a party can't spend store credit at checkout, or null when it can.
 * The walking customer is shared by every anonymous sale, so credit parked on
 * it isn't attributable to one person — letting it be spent would leak one
 * customer's credit into an unrelated later sale. Vendors settle through the
 * purchase/payment side, not the sales counter.
 */
function creditIneligibleReason(party: { isDefault: boolean; type: string }): string | null {
  if (party.isDefault) return "The walking customer cannot hold or spend store credit";
  if (party.type === "VENDOR") return "Vendor balances are settled through purchases, not sales";
  return null;
}

/**
 * Live balance for a single party in one branch — the single-party version of
 * the aggregate in app/api/ledger/outstanding/route.ts, and the same
 * `opening + Σdebit − Σcredit` formula the ledger page's running balance uses.
 * Deliberately computed on read rather than kept as a counter, matching how
 * every other balance in this app works.
 *
 * Shared by GET /api/parties/[id]/balance (what the checkout UI reads) and the
 * POST /api/sales guard (which re-checks it server-side), so the number the
 * cashier sees and the number the server enforces can't drift apart.
 */
export async function getPartyBalance(
  partyId: string,
  branchId: string
): Promise<PartyBalance | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true, accountId: true, name: true, type: true,
      isDefault: true, previousBalance: true,
    },
  });
  if (!party) return null;

  const agg = await prisma.ledgerEntry.aggregate({
    where: { branchId, partyId },
    _sum: { debit: true, credit: true },
  });

  const openingBalance = Number(party.previousBalance ?? 0);
  const totalDebit = Number(agg._sum.debit ?? 0);
  const totalCredit = Number(agg._sum.credit ?? 0);
  const balance = openingBalance + totalDebit - totalCredit;
  const creditEligible = creditIneligibleReason(party) === null;

  return {
    partyId: party.id,
    accountId: party.accountId,
    name: party.name,
    type: party.type,
    isDefault: party.isDefault,
    openingBalance,
    totalDebit,
    totalCredit,
    balance,
    // Sub-cent noise from Decimal rounding shouldn't surface as spendable credit.
    availableCredit: creditEligible && balance < -0.005 ? -balance : 0,
    creditEligible,
  };
}

/**
 * Live balances for many parties at once, as one groupBy rather than a
 * `getPartyBalance` call each. Same `opening + Σdebit − Σcredit` formula and
 * the same sign convention: **> 0 the party owes the store, < 0 the store owes
 * the party**. Parties with no ledger rows at all still get an entry (their
 * opening balance), so a caller can index the map without a fallback.
 */
export async function getPartyBalances(
  parties: Array<{ id: string; previousBalance: unknown }>,
  branchId: string
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (parties.length === 0) return balances;

  const agg = await prisma.ledgerEntry.groupBy({
    by: ["partyId"],
    where: { branchId, partyId: { in: parties.map((p) => p.id) } },
    _sum: { debit: true, credit: true },
  });
  const ledger = new Map(
    agg.map((a) => [a.partyId, Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0)])
  );

  for (const p of parties) {
    balances.set(p.id, Number(p.previousBalance ?? 0) + (ledger.get(p.id) ?? 0));
  }
  return balances;
}

/**
 * Server-side guard for a `creditApplied` amount arriving from the checkout
 * client. Store credit moves value without any matching cash movement, so
 * unlike the cash/bank amounts it is re-derived from the database here instead
 * of being trusted — a stale or tampered client must not be able to write off
 * a bill against credit the party doesn't have.
 *
 * Returns an error message (for a 400) rather than silently clamping: the
 * saved invoice has to match the amount the cashier actually agreed to, and a
 * quietly reduced credit would leave the customer short at the till.
 */
export async function validateCreditApplied(params: {
  partyId: string;
  branchId: string;
  creditApplied: number;
  netBill: number;
}): Promise<{ ok: true; creditApplied: number } | { ok: false; error: string }> {
  const { partyId, branchId, creditApplied, netBill } = params;

  if (!creditApplied || creditApplied <= 0) return { ok: true, creditApplied: 0 };

  if (netBill <= 0) {
    return { ok: false, error: "Store credit cannot be applied to a net-return invoice" };
  }
  if (creditApplied - netBill > 0.005) {
    return { ok: false, error: "Store credit applied exceeds the invoice total" };
  }

  const partyBalance = await getPartyBalance(partyId, branchId);
  if (!partyBalance) return { ok: false, error: "Party not found" };

  const reason = creditIneligibleReason(partyBalance);
  if (reason) return { ok: false, error: reason };

  if (creditApplied - partyBalance.availableCredit > 0.005) {
    return {
      ok: false,
      error: `Store credit applied (${creditApplied.toFixed(2)}) exceeds this customer's available credit (${partyBalance.availableCredit.toFixed(2)})`,
    };
  }

  return { ok: true, creditApplied };
}
