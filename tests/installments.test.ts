import { describe, expect, it, vi } from "vitest";

// `lib/repayment-plan.ts` imports the Prisma singleton for its op builders. Only
// its pure validator is under test here, so the client is stubbed out rather
// than constructed — no test should open a database connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  applyCollectionToInstallments,
  generateInstallmentSchedule,
  isOverdue,
  outstandingForPlan,
  summarizePlan,
  type InstallmentLike,
} from "@/lib/installments";
import { validateRepaymentPlan } from "@/lib/repayment-plan";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const start = new Date("2026-01-15T00:00:00Z");

describe("generateInstallmentSchedule — amounts", () => {
  it("splits evenly when the principal divides", () => {
    const rows = generateInstallmentSchedule({ principal: 900, kind: "MONTHLY", periods: 3, startDate: start });
    expect(rows.map((r) => r.amount)).toEqual([300, 300, 300]);
  });

  it("absorbs the rounding remainder into the last installment", () => {
    // 1000 / 3 must sum back to exactly 1000, not 999.99.
    const rows = generateInstallmentSchedule({ principal: 1000, kind: "MONTHLY", periods: 3, startDate: start });
    expect(rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1000);
  });

  it("keeps summing to the principal across awkward divisions", () => {
    for (const [principal, periods] of [[1000, 7], [4790, 6], [12345.67, 11], [0.03, 2]] as const) {
      const rows = generateInstallmentSchedule({ principal, kind: "WEEKLY", periods, startDate: start });
      const sum = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      expect(sum, `${principal} over ${periods}`).toBe(principal);
    }
  });

  it("numbers installments from 1", () => {
    const rows = generateInstallmentSchedule({ principal: 300, kind: "MONTHLY", periods: 3, startDate: start });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("returns nothing when there is nothing to finance", () => {
    expect(generateInstallmentSchedule({ principal: 0, kind: "MONTHLY", periods: 3, startDate: start })).toEqual([]);
    expect(generateInstallmentSchedule({ principal: -50, kind: "MONTHLY", periods: 3, startDate: start })).toEqual([]);
  });

  it("treats a sub-paisa principal as nothing to finance", () => {
    expect(generateInstallmentSchedule({ principal: 0.004, kind: "MONTHLY", periods: 2, startDate: start })).toEqual([]);
  });

  it("forces a promise-day plan to a single lump", () => {
    const rows = generateInstallmentSchedule({
      principal: 1000, kind: "PROMISE_DAY", periods: 5, startDate: start, promiseDays: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1000);
  });
});

describe("generateInstallmentSchedule — due dates", () => {
  it("puts the first weekly installment a week out, not on the day of sale", () => {
    const rows = generateInstallmentSchedule({ principal: 300, kind: "WEEKLY", periods: 3, startDate: start });
    expect(rows.map((r) => iso(r.dueDate))).toEqual(["2026-01-22", "2026-01-29", "2026-02-05"]);
  });

  it("steps monthly plans a month at a time", () => {
    const rows = generateInstallmentSchedule({ principal: 300, kind: "MONTHLY", periods: 3, startDate: start });
    expect(rows.map((r) => iso(r.dueDate))).toEqual(["2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("clamps month-end dates instead of overflowing", () => {
    // One month on from Jan 31 is Feb 28, not the Mar 3 a naive setMonth gives.
    const rows = generateInstallmentSchedule({
      principal: 300, kind: "MONTHLY", periods: 3, startDate: new Date("2026-01-31T00:00:00Z"),
    });
    expect(rows.map((r) => iso(r.dueDate))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("handles a leap February", () => {
    const rows = generateInstallmentSchedule({
      principal: 100, kind: "MONTHLY", periods: 1, startDate: new Date("2028-01-31T00:00:00Z"),
    });
    expect(iso(rows[0].dueDate)).toBe("2028-02-29");
  });

  it("dates a promise-day plan by its day count", () => {
    const rows = generateInstallmentSchedule({
      principal: 500, kind: "PROMISE_DAY", periods: 1, startDate: start, promiseDays: 20,
    });
    expect(iso(rows[0].dueDate)).toBe("2026-02-04");
  });

  it("does not mutate the start date it was handed", () => {
    const given = new Date("2026-01-15T00:00:00Z");
    generateInstallmentSchedule({ principal: 900, kind: "MONTHLY", periods: 6, startDate: given });
    expect(iso(given)).toBe("2026-01-15");
  });
});

describe("outstandingForPlan", () => {
  it("finances only what is left after credit and counter payments", () => {
    expect(outstandingForPlan({ netBill: 10000, creditApplied: 1000, paidNow: 2000 })).toBe(7000);
  });

  it("finances the whole bill when nothing was paid", () => {
    expect(outstandingForPlan({ netBill: 5000 })).toBe(5000);
  });

  it("finances nothing on a settled bill", () => {
    expect(outstandingForPlan({ netBill: 1000, paidNow: 1000 })).toBe(0);
  });

  it("never goes negative on an overpayment", () => {
    expect(outstandingForPlan({ netBill: 1000, paidNow: 1500 })).toBe(0);
  });

  it("finances nothing on a net-return invoice", () => {
    expect(outstandingForPlan({ netBill: -800 })).toBe(0);
  });
});

describe("applyCollectionToInstallments", () => {
  const rows = (): InstallmentLike[] => [
    { id: "i1", seq: 1, amount: 333.33, paidAmount: 0 },
    { id: "i2", seq: 2, amount: 333.33, paidAmount: 0 },
    { id: "i3", seq: 3, amount: 333.34, paidAmount: 0 },
  ];

  it("settles a single installment exactly", () => {
    const { updates, leftover } = applyCollectionToInstallments(rows(), 333.33);
    expect(updates).toEqual([{ id: "i1", seq: 1, applied: 333.33, paidAmount: 333.33, status: "PAID" }]);
    expect(leftover).toBe(0);
  });

  it("marks a short payment PARTIAL", () => {
    const { updates } = applyCollectionToInstallments(rows(), 100);
    expect(updates).toEqual([{ id: "i1", seq: 1, applied: 100, paidAmount: 100, status: "PARTIAL" }]);
  });

  it("cascades an overpayment onto later installments", () => {
    const { updates, leftover } = applyCollectionToInstallments(rows(), 700);
    expect(updates.map((u) => [u.seq, u.applied, u.status])).toEqual([
      [1, 333.33, "PAID"],
      [2, 333.33, "PAID"],
      [3, 33.34, "PARTIAL"],
    ]);
    expect(leftover).toBe(0);
  });

  it("clears the whole plan and reports nothing left over", () => {
    const { updates, leftover } = applyCollectionToInstallments(rows(), 1000);
    expect(updates.every((u) => u.status === "PAID")).toBe(true);
    expect(leftover).toBe(0);
  });

  it("reports money beyond the last installment as leftover", () => {
    const { updates, leftover } = applyCollectionToInstallments(rows(), 1200);
    expect(updates).toHaveLength(3);
    expect(leftover).toBe(200);
  });

  it("tops up a part-paid installment before moving on", () => {
    const partial = rows();
    partial[0].paidAmount = 100;
    const { updates } = applyCollectionToInstallments(partial, 300);
    expect(updates.map((u) => [u.seq, u.applied, u.paidAmount, u.status])).toEqual([
      [1, 233.33, 333.33, "PAID"],
      [2, 66.67, 66.67, "PARTIAL"],
    ]);
  });

  it("skips rows that are already settled", () => {
    const done = rows();
    done[0].paidAmount = 333.33;
    const { updates } = applyCollectionToInstallments(done, 333.33);
    expect(updates.map((u) => u.seq)).toEqual([2]);
  });

  it("applies in seq order however the rows arrive", () => {
    const { updates } = applyCollectionToInstallments([...rows()].reverse(), 400);
    expect(updates.map((u) => u.seq)).toEqual([1, 2]);
  });

  it("touches nothing when there is no money", () => {
    expect(applyCollectionToInstallments(rows(), 0)).toEqual({ updates: [], leftover: 0 });
  });

  it("counts a sub-paisa shortfall as PAID rather than leaving a row open forever", () => {
    const { updates } = applyCollectionToInstallments(rows(), 333.327);
    expect(updates[0].status).toBe("PAID");
  });
});

describe("isOverdue", () => {
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; };
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; };

  it("flags a past due date that still owes something", () => {
    expect(isOverdue(yesterday(), "PENDING")).toBe(true);
    expect(isOverdue(yesterday(), "PARTIAL")).toBe(true);
  });

  it("never flags a settled installment", () => {
    expect(isOverdue(yesterday(), "PAID")).toBe(false);
  });

  it("does not flag one due today", () => {
    expect(isOverdue(new Date(), "PENDING")).toBe(false);
  });

  it("does not flag a future one", () => {
    expect(isOverdue(tomorrow(), "PENDING")).toBe(false);
  });
});

describe("validateRepaymentPlan", () => {
  it("accepts no plan", () => {
    expect(validateRepaymentPlan({})).toEqual({ ok: true, repaymentType: "NONE", periods: null });
    expect(validateRepaymentPlan({ repaymentType: "NONE" })).toEqual({ ok: true, repaymentType: "NONE", periods: null });
  });

  it("rejects an unknown type", () => {
    const result = validateRepaymentPlan({ repaymentType: "FORTNIGHTLY" });
    expect(result.ok).toBe(false);
  });

  it("forces a promise-day plan to one period", () => {
    expect(validateRepaymentPlan({ repaymentType: "PROMISE_DAY", promiseDays: 15, installmentPeriods: 9 }))
      .toEqual({ ok: true, repaymentType: "PROMISE_DAY", periods: 1 });
  });

  it("requires a day count for a promise-day plan", () => {
    expect(validateRepaymentPlan({ repaymentType: "PROMISE_DAY" }).ok).toBe(false);
    expect(validateRepaymentPlan({ repaymentType: "PROMISE_DAY", promiseDays: 0 }).ok).toBe(false);
  });

  it("accepts a period count and floors a fractional one", () => {
    expect(validateRepaymentPlan({ repaymentType: "WEEKLY", installmentPeriods: 6 }))
      .toEqual({ ok: true, repaymentType: "WEEKLY", periods: 6 });
    expect(validateRepaymentPlan({ repaymentType: "MONTHLY", installmentPeriods: 3.7 }))
      .toEqual({ ok: true, repaymentType: "MONTHLY", periods: 3 });
  });

  it("rejects nonsense period counts", () => {
    expect(validateRepaymentPlan({ repaymentType: "WEEKLY", installmentPeriods: 0 }).ok).toBe(false);
    expect(validateRepaymentPlan({ repaymentType: "WEEKLY", installmentPeriods: -3 }).ok).toBe(false);
    expect(validateRepaymentPlan({ repaymentType: "WEEKLY", installmentPeriods: "abc" }).ok).toBe(false);
  });

  it("caps the schedule length so a typo can't write thousands of rows", () => {
    expect(validateRepaymentPlan({ repaymentType: "MONTHLY", installmentPeriods: 120 }).ok).toBe(true);
    expect(validateRepaymentPlan({ repaymentType: "MONTHLY", installmentPeriods: 9999 }).ok).toBe(false);
  });
});

describe("summarizePlan", () => {
  const row = (seq: number, over: Partial<{ amount: number; paidAmount: number; status: string; dueDate: string }> = {}) => ({
    seq,
    dueDate: over.dueDate ?? "2099-01-0" + seq,
    amount: over.amount ?? 1000,
    paidAmount: over.paidAmount ?? 0,
    status: over.status ?? "PENDING",
  });

  it("reports the next unsettled installment", () => {
    const s = summarizePlan({ kind: "MONTHLY", periods: 3, installments: [row(1), row(2), row(3)] });
    expect(s.nextDueDate).toBe("2099-01-01");
    expect(s.nextDueAmount).toBe(1000);
    expect(s.paidCount).toBe(0);
    expect(s.remaining).toBe(3000);
  });

  it("skips settled installments and counts them", () => {
    const s = summarizePlan({
      kind: "MONTHLY", periods: 3,
      installments: [row(1, { paidAmount: 1000, status: "PAID" }), row(2), row(3)],
    });
    expect(s.paidCount).toBe(1);
    expect(s.nextDueDate).toBe("2099-01-02");
    expect(s.remaining).toBe(2000);
  });

  it("nets a partial payment off the next amount and the remaining total", () => {
    const s = summarizePlan({
      kind: "WEEKLY", periods: 2,
      installments: [row(1, { paidAmount: 400, status: "PARTIAL" }), row(2)],
    });
    expect(s.nextDueAmount).toBe(600);
    expect(s.remaining).toBe(1600);
  });

  it("goes flat once the plan is cleared", () => {
    const s = summarizePlan({
      kind: "PROMISE_DAY", periods: 1,
      installments: [row(1, { paidAmount: 1000, status: "PAID" })],
    });
    expect(s.nextDueDate).toBeNull();
    expect(s.nextDueAmount).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.nextOverdue).toBe(false);
    expect(s.overdueCount).toBe(0);
  });

  it("flags an overdue plan and counts every late installment", () => {
    const s = summarizePlan({
      kind: "WEEKLY", periods: 2,
      installments: [
        row(1, { dueDate: "2020-01-01" }),
        row(2, { dueDate: "2020-01-08" }),
      ],
    });
    expect(s.nextOverdue).toBe(true);
    expect(s.overdueCount).toBe(2);
  });

  it("sorts by seq itself, so query order can't change the answer", () => {
    const s = summarizePlan({ kind: "MONTHLY", periods: 3, installments: [row(3), row(1), row(2)] });
    expect(s.nextDueDate).toBe("2099-01-01");
  });
});
