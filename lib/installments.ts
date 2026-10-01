import { SHOP_UTC_OFFSET_MINUTES, shopStartOfToday } from "@/lib/utils";
/**
 * Installment schedule generation and collection maths.
 *
 * Deliberately pure (no Prisma import) so the money logic can be unit-tested
 * on its own in Phase 9 — the API routes here only turn these results into
 * transaction ops.
 */

export type InstallmentPlanKind = "PROMISE_DAY" | "WEEKLY" | "MONTHLY";
/** `SaleInvoice.repaymentType` / `GRN.repaymentType` — the plan kinds plus "no plan". */
export type RepaymentType = "NONE" | InstallmentPlanKind;

export type InstallmentScheduleRow = { seq: number; dueDate: Date; amount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cent-level tolerance, so Decimal rounding noise never decides a comparison. */
const EPSILON = 0.005;

// Calendar arithmetic runs on the **shop's** clock (`getUTC*` on a shifted
// copy), not the machine's. It used local `setDate`/`setMonth`, so the server
// (UTC) and a browser in Pakistan could date the same plan differently: a sale
// at 02:00 on the 1st is still the 30th/31st in UTC, and a monthly plan
// clamped to the wrong month-end.
const SHOP_OFFSET_MS = SHOP_UTC_OFFSET_MINUTES * 60_000;
const toShop = (d: Date) => new Date(d.getTime() + SHOP_OFFSET_MS);
const fromShop = (d: Date) => new Date(d.getTime() - SHOP_OFFSET_MS);

function addDays(from: Date, days: number): Date {
  const d = toShop(from);
  d.setUTCDate(d.getUTCDate() + days);
  return fromShop(d);
}

/**
 * Month arithmetic that clamps instead of overflowing: one month on from
 * Jan 31 is Feb 28 (or 29), not the Mar 3 that a naive `setMonth` produces.
 */
function addMonths(from: Date, months: number): Date {
  const d = toShop(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return fromShop(d);
}

function dueDateFor(
  kind: InstallmentPlanKind,
  startDate: Date,
  seq: number,
  promiseDays?: number | null
): Date {
  if (kind === "PROMISE_DAY") return addDays(startDate, promiseDays ?? 0);
  // seq is 1-based, so the first weekly/monthly installment falls one whole
  // period after the sale rather than on the day of it.
  if (kind === "WEEKLY") return addDays(startDate, 7 * seq);
  return addMonths(startDate, seq);
}

/**
 * Splits `principal` into a due-dated schedule.
 *
 * PROMISE_DAY is always a single lump due `promiseDays` after the start date;
 * WEEKLY/MONTHLY split equally over `periods`. The remainder left by rounding
 * to paisa is absorbed into the **last** installment, so the schedule sums to
 * exactly the principal (1000 over 3 is 333.33 + 333.33 + 333.34, never
 * 999.99). Returns [] when there is nothing to schedule.
 */
export function generateInstallmentSchedule(params: {
  principal: number;
  kind: InstallmentPlanKind;
  periods: number;
  startDate: Date;
  promiseDays?: number | null;
}): InstallmentScheduleRow[] {
  const { principal, kind, startDate, promiseDays } = params;
  if (!(principal > EPSILON)) return [];

  const periods = kind === "PROMISE_DAY"
    ? 1
    : Math.max(1, Math.floor(params.periods || 1));

  // Floored so the remainder is always positive and lands on the last row.
  const per = Math.floor((principal / periods) * 100) / 100;

  const rows: InstallmentScheduleRow[] = [];
  for (let seq = 1; seq <= periods; seq++) {
    rows.push({
      seq,
      dueDate: dueDateFor(kind, startDate, seq, promiseDays),
      amount: seq === periods ? round2(principal - per * (periods - 1)) : per,
    });
  }
  return rows;
}

/**
 * How much of an invoice/GRN is left to be repaid over time — the part a plan
 * is generated for. Credit applied and money taken at the counter are already
 * settled, so only the shortfall is financed.
 */
export function outstandingForPlan(params: {
  netBill: number;
  creditApplied?: number;
  paidNow?: number;
}): number {
  const { netBill, creditApplied = 0, paidNow = 0 } = params;
  if (netBill <= 0) return 0;
  return Math.max(0, round2(netBill - creditApplied - paidNow));
}

export type InstallmentLike = { id: string; seq: number; amount: number; paidAmount: number };

export type InstallmentCollectionUpdate = {
  id: string;
  seq: number;
  /** Amount of this collection that landed on this installment. */
  applied: number;
  /** The installment's new cumulative paid amount. */
  paidAmount: number;
  status: "PARTIAL" | "PAID";
};

/**
 * Spreads one collected amount across installments in `seq` order.
 *
 * A customer settling more than the single installment that was clicked is an
 * everyday case (paying two at once, or clearing the whole plan), so the extra
 * **cascades onto the following unpaid installments** rather than being
 * rejected. Anything still left after the last one comes back as `leftover`:
 * the money is real and is still recorded against the party's ledger, it just
 * no longer belongs to any scheduled row.
 *
 * Callers pass only the rows that should absorb the money (typically the
 * clicked installment and every unpaid one after it).
 */
export function applyCollectionToInstallments(
  rows: InstallmentLike[],
  amount: number
): { updates: InstallmentCollectionUpdate[]; leftover: number } {
  let remaining = round2(amount);
  const updates: InstallmentCollectionUpdate[] = [];

  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (remaining <= EPSILON) break;
    const owed = round2(row.amount - row.paidAmount);
    if (owed <= EPSILON) continue;

    const applied = Math.min(owed, remaining);
    const paidAmount = round2(row.paidAmount + applied);
    updates.push({
      id: row.id,
      seq: row.seq,
      applied: round2(applied),
      paidAmount,
      status: paidAmount + EPSILON >= row.amount ? "PAID" : "PARTIAL",
    });
    remaining = round2(remaining - applied);
  }

  return { updates, leftover: Math.max(0, remaining) };
}

/**
 * An installment is overdue once its due date is in the past and it still owes
 * something. Compared against the start of today so an installment due *today*
 * is not yet late.
 */
export function isOverdue(dueDate: Date | string, status: string): boolean {
  if (status === "PAID") return false;
  // The shop's midnight, not the device's — otherwise whether a plan reads as
  // overdue depends on where the person looking at it happens to be.
  return new Date(dueDate) < shopStartOfToday();
}

export type PlanSummaryRow = {
  seq: number;
  dueDate: Date | string;
  amount: number;
  paidAmount: number;
  status: string;
};

export type PlanSummary = {
  kind: InstallmentPlanKind;
  periods: number;
  /** Total still owed across the whole schedule. */
  remaining: number;
  /** Installments already fully paid, and the schedule length. */
  paidCount: number;
  /** Earliest unsettled installment, or null once the plan is cleared. */
  nextDueDate: Date | string | null;
  nextDueAmount: number;
  /** True when that next installment's date has already passed. */
  nextOverdue: boolean;
  /** Any unsettled installment already past its date. */
  overdueCount: number;
};

/**
 * One-line state of a repayment plan, for the places that list a bill rather
 * than the schedule itself — the Sales and Purchases report rows and the party
 * ledger header. The Ledger page's Installments tab shows the full schedule and
 * doesn't need this.
 *
 * Pure, and shared by the sales and purchase report routes, so an invoice's
 * badge and a GRN's badge can't come to mean different things.
 */
export function summarizePlan(plan: {
  kind: string;
  periods: number;
  installments: PlanSummaryRow[];
}): PlanSummary {
  const rows = [...plan.installments].sort((a, b) => a.seq - b.seq);
  const unsettled = rows.filter((r) => r.status !== "PAID");
  const next = unsettled[0] ?? null;

  return {
    kind: plan.kind as InstallmentPlanKind,
    periods: plan.periods,
    remaining:
      Math.round(unsettled.reduce((s, r) => s + (r.amount - r.paidAmount), 0) * 100) / 100,
    paidCount: rows.length - unsettled.length,
    nextDueDate: next?.dueDate ?? null,
    nextDueAmount: next ? Math.round((next.amount - next.paidAmount) * 100) / 100 : 0,
    nextOverdue: next ? isOverdue(next.dueDate, next.status) : false,
    overdueCount: unsettled.filter((r) => isOverdue(r.dueDate, r.status)).length,
  };
}
