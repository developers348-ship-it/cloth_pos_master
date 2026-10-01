import { prisma } from "@/lib/prisma";
import {
  applyCollectionToInstallments,
  generateInstallmentSchedule,
  outstandingForPlan,
  type InstallmentPlanKind,
  type RepaymentType,
} from "@/lib/installments";

/**
 * Prisma-side glue between an invoice/GRN and its installment plan. The money
 * maths itself lives in lib/installments.ts (pure, unit-testable); this file
 * only turns it into `$transaction([...])` ops.
 *
 * A plan hangs off exactly one of a SaleInvoice (customer credit, collected as
 * a Recovery) or a GRN (vendor credit, settled as a Payment) — both columns are
 * nullable and `@unique` in the schema. Everything below takes whichever one
 * applies, so the sales and purchase routes share one implementation.
 */

/** Which document a plan belongs to. Exactly one field is set. */
export type PlanOwner = { invoiceId: string; grnId?: never } | { grnId: string; invoiceId?: never };

/** Guard rail on generated row count — a typo like 9999 periods shouldn't be writable. */
const MAX_PERIODS = 120;

/**
 * Validates the repayment selector coming off the checkout screen. Returns the
 * normalised values to store on the invoice, or an error for a 400.
 *
 * PROMISE_DAY is inherently a single payment, so its period count is forced to
 * 1 regardless of what the client sent.
 */
export function validateRepaymentPlan(params: {
  repaymentType?: string | null;
  installmentPeriods?: number | string | null;
  promiseDays?: number | string | null;
}):
  | { ok: true; repaymentType: RepaymentType; periods: number | null }
  | { ok: false; error: string } {
  const raw = params.repaymentType || "NONE";

  if (raw === "NONE") return { ok: true, repaymentType: "NONE", periods: null };

  if (raw !== "PROMISE_DAY" && raw !== "WEEKLY" && raw !== "MONTHLY") {
    return { ok: false, error: `Unknown repaymentType "${raw}"` };
  }

  if (raw === "PROMISE_DAY") {
    const days = Number(params.promiseDays ?? 0);
    if (!(days > 0)) {
      return { ok: false, error: "Promise Days is required for a promise-day repayment plan" };
    }
    return { ok: true, repaymentType: raw, periods: 1 };
  }

  const periods = Number(params.installmentPeriods ?? 0);
  if (!Number.isFinite(periods) || periods < 1) {
    return { ok: false, error: "Number of installments must be at least 1" };
  }
  if (periods > MAX_PERIODS) {
    return { ok: false, error: `Number of installments cannot exceed ${MAX_PERIODS}` };
  }
  return { ok: true, repaymentType: raw, periods: Math.floor(periods) };
}

/**
 * The InstallmentPlan create op (with its schedule nested) for an invoice or a
 * GRN, or an empty array when there's nothing to finance — no repayment type
 * chosen, or the document already fully settled by credit and money paid at the
 * counter.
 *
 * Returned as an array so callers can spread it into their ops list without
 * a null check.
 */
export function buildPlanOps(params: PlanOwner & {
  branchId: string;
  partyId: string;
  repaymentType: string | null;
  periods?: number | null;
  promiseDays?: number | null;
  netBill: number;
  creditApplied?: number;
  paidNow?: number;
  startDate?: Date;
}) {
  const { branchId, partyId, invoiceId, grnId, repaymentType, netBill } = params;

  if (!repaymentType || repaymentType === "NONE") return [];

  const principal = outstandingForPlan({
    netBill,
    creditApplied: params.creditApplied ?? 0,
    paidNow: params.paidNow ?? 0,
  });
  if (principal <= 0) return [];

  const kind = repaymentType as InstallmentPlanKind;
  const startDate = params.startDate ?? new Date();
  const periods = kind === "PROMISE_DAY" ? 1 : Math.max(1, Number(params.periods ?? 1));

  const schedule = generateInstallmentSchedule({
    principal,
    kind,
    periods,
    startDate,
    promiseDays: params.promiseDays ?? null,
  });
  if (schedule.length === 0) return [];

  return [
    prisma.installmentPlan.create({
      data: {
        branchId,
        partyId,
        invoiceId: invoiceId ?? null,
        grnId: grnId ?? null,
        kind,
        principal,
        periods: schedule.length,
        startDate,
        installments: {
          create: schedule.map((row) => ({
            seq: row.seq,
            dueDate: row.dueDate,
            amount: row.amount,
          })),
        },
      },
    }),
  ];
}

/**
 * Ops to remove a document's installment plan — for invoice void/delete, and
 * for GRN edit/delete (an edited GRN rebuilds its schedule from the new
 * amounts, the same way it rebuilds its ledger entries).
 *
 * Any money already collected against the schedule stays put: the
 * Recovery/Payment rows, their party LedgerEntry and their AccountEntry are all
 * real movements of real cash and are not reversed here. Only the link from
 * those account entries to the vanishing installment rows is cleared (an FK
 * would otherwise block the delete). The party keeps the balance those payments
 * created, which is the right position for money that genuinely changed hands.
 *
 * Installment rows themselves go via the schema's `onDelete: Cascade` on
 * `planId`.
 */
export async function buildPlanTeardownOps(owner: PlanOwner) {
  const plan = await prisma.installmentPlan.findUnique({
    where: owner.invoiceId ? { invoiceId: owner.invoiceId } : { grnId: owner.grnId },
    select: { id: true, installments: { select: { id: true } } },
  });
  if (!plan) return [];

  const ops: any[] = [];
  const installmentIds = plan.installments.map((i) => i.id);
  if (installmentIds.length > 0) {
    ops.push(prisma.accountEntry.updateMany({
      where: { installmentId: { in: installmentIds } },
      data: { installmentId: null },
    }));
    ops.push(prisma.installment.updateMany({
      where: { id: { in: installmentIds } },
      data: { recoveryId: null, paymentId: null },
    }));
  }
  ops.push(prisma.installmentPlan.delete({ where: { id: plan.id } }));
  return ops;
}

/**
 * Rebuilds an invoice plan's per-installment paid state from the collections
 * that are *left* once some settlements are removed — what Mark Unpaid needs
 * after deleting the recoveries it created.
 *
 * The schedule rows don't store which settlement contributed what, so the state
 * is replayed rather than decremented: every row is reset, then each surviving
 * installment collection is re-applied through the same
 * `applyCollectionToInstallments` cascade (from the row it was booked against,
 * in date order) that produced the state in the first place. That means an
 * installment part-paid from the Installments tab and then finished off by Mark
 * Paid goes back to exactly its part-paid state, instead of being wrongly
 * zeroed.
 *
 * A collection is identified by its `INSTALLMENT_COLLECTION` AccountEntry,
 * which carries both the amount and the row the cashier clicked.
 */
export async function buildPlanReplayOps(params: {
  invoiceId: string;
  /** Settlements being deleted in the same transaction — excluded from the replay. */
  excludeRecoveryIds?: string[];
}) {
  const { invoiceId, excludeRecoveryIds = [] } = params;

  const plan = await prisma.installmentPlan.findUnique({
    where: { invoiceId },
    select: { id: true, installments: { select: { id: true, seq: true, amount: true } } },
  });
  if (!plan || plan.installments.length === 0) return [];

  const rows = [...plan.installments]
    .map((r) => ({ id: r.id, seq: r.seq, amount: Number(r.amount), paidAmount: 0 }))
    .sort((a, b) => a.seq - b.seq);

  const collections = await prisma.accountEntry.findMany({
    where: {
      type: "INSTALLMENT_COLLECTION",
      installmentId: { in: rows.map((r) => r.id) },
      ...(excludeRecoveryIds.length > 0 ? { recoveryId: { notIn: excludeRecoveryIds } } : {}),
    },
    select: { installmentId: true, debit: true, date: true, recoveryId: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const settled = new Map<string, { recoveryId: string | null; paidAt: Date }>();

  for (const c of collections) {
    const from = rows.find((r) => r.id === c.installmentId);
    if (!from) continue;
    const { updates } = applyCollectionToInstallments(
      rows.filter((r) => r.seq >= from.seq && r.paidAmount < r.amount),
      Number(c.debit)
    );
    for (const u of updates) {
      const row = rows.find((r) => r.id === u.id)!;
      row.paidAmount = u.paidAmount;
      settled.set(u.id, { recoveryId: c.recoveryId, paidAt: c.date });
    }
  }

  return rows.map((r) => {
    const mark = settled.get(r.id);
    const isPaid = r.paidAmount + 0.005 >= r.amount;
    return prisma.installment.update({
      where: { id: r.id },
      data: {
        paidAmount: r.paidAmount,
        status: r.paidAmount <= 0.005 ? "PENDING" : isPaid ? "PAID" : "PARTIAL",
        paidAt: isPaid && mark ? mark.paidAt : null,
        recoveryId: mark?.recoveryId ?? null,
      },
    });
  });
}
