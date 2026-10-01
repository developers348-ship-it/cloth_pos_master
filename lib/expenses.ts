import { prisma } from "@/lib/prisma";
import { getOrCreateCashAccount } from "@/lib/accounts";

/**
 * Cost management: operating expenses, owner drawings and capital injections.
 *
 * Everything here posts through the same `Account` / `AccountEntry` pair the
 * sale, purchase and settlement paths use (`lib/accounts.ts`), so a salary paid
 * out of the till moves the cash balance exactly like a vendor payment does and
 * shows up on the same account statement.
 *
 * The one thing that is *not* shared with those paths is the profit maths: an
 * `EXPENSE` reduces reported profit, a `PROFIT_WITHDRAWAL` does not. Taking
 * earnings out of the business moves money without costing the business
 * anything, and treating a drawing as a cost would understate profit by exactly
 * the amount the owner took — see `netProfit` below.
 */

/**
 * Headings a cloth shop almost always needs, used to seed a branch that has
 * none. Not an enum: the point of `ExpenseCategory` being a table is that the
 * shop can add "Chowkidar", "Generator Diesel" or anything else without a
 * migration.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Salary", note: "Staff wages" },
  { name: "Rent", note: "Shop rent" },
  { name: "Utilities", note: "Electricity, gas, water" },
  { name: "Transport", note: "Delivery and freight" },
  { name: "Repairs & Maintenance", note: null },
  { name: "Marketing", note: null },
  { name: "Miscellaneous", note: null },
] as const;

/**
 * Seeds the default category list the first time a branch needs one — the same
 * lazy find-or-create idiom as `getOrCreateCashAccount()`.
 *
 * Seeds **only when the branch has none at all**. Topping up individually
 * missing names would resurrect a category the shop deliberately deleted every
 * time the page was opened.
 */
export async function ensureExpenseCategories(branchId: string) {
  const existing = await prisma.expenseCategory.count({ where: { branchId } });
  if (existing > 0) return;

  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      branchId,
      name: c.name,
      note: c.note,
    })),
    // Two tabs opening the page at once would otherwise collide on the
    // [branchId, name] unique index.
    skipDuplicates: true,
  });
}

/** Money leaves the account for a cost or a drawing; an injection brings it in. */
export function isMoneyIn(kind: string): boolean {
  return kind === "CAPITAL_INJECTION";
}

/**
 * The `AccountEntryType` a given expense kind posts as. Deliberately one type
 * per kind rather than a single `EXPENSE` type for all three, so the account
 * statement's type filter can separate "what the shop spent" from "what the
 * owner took out" without joining back to the Expense row.
 */
export function accountEntryTypeFor(kind: string): "EXPENSE" | "PROFIT_WITHDRAWAL" | "CAPITAL_INJECTION" {
  if (kind === "PROFIT_WITHDRAWAL") return "PROFIT_WITHDRAWAL";
  if (kind === "CAPITAL_INJECTION") return "CAPITAL_INJECTION";
  return "EXPENSE";
}

/**
 * Validates and normalises the payment half of an expense form.
 *
 * `UNPAID` forces the account fields to null rather than trusting the payload:
 * a stale accountId left in a hidden field must not make an unsettled salary
 * look like money that has already left the till. `PAID` requires the mirror —
 * a method, and for BANK a real account — because a paid cost with no account
 * behind it would reduce profit without reducing any balance.
 *
 * Returns the resolved `accountId` (CASH resolves to the branch's own cash
 * account via `resolveSettlementAccount`, which is what every other money path
 * in this app uses).
 */
export async function resolveExpensePayment(params: {
  branchId: string;
  status?: string | null;
  paymentMethod?: string | null;
  accountId?: string | null;
}): Promise<
  | { ok: true; status: "PAID"; paymentMethod: string; accountId: string }
  | { ok: true; status: "UNPAID"; paymentMethod: null; accountId: null }
  | { ok: false; error: string }
> {
  const status = params.status === "UNPAID" ? "UNPAID" : "PAID";
  if (status === "UNPAID") {
    return { ok: true, status, paymentMethod: null, accountId: null };
  }

  const method = params.paymentMethod || "CASH";
  if (method !== "CASH" && method !== "BANK") {
    return { ok: false, error: `Unknown paymentMethod "${method}" — expected CASH or BANK` };
  }

  if (method === "BANK") {
    if (!params.accountId) {
      return { ok: false, error: "Select a bank account" };
    }
    const account = await prisma.account.findUnique({ where: { id: params.accountId } });
    if (!account || account.branchId !== params.branchId) {
      return { ok: false, error: "Bank account not found in this branch" };
    }
    if (account.type !== "BANK") return { ok: false, error: "Selected account is not a bank account" };
    if (!account.isActive) return { ok: false, error: "Selected bank account is inactive" };
    return { ok: true, status, paymentMethod: method, accountId: account.id };
  }

  const cash = await getOrCreateCashAccount(params.branchId);
  return { ok: true, status, paymentMethod: method, accountId: cash.id };
}

/**
 * The single `AccountEntry.create()` op behind a paid expense, drawing or
 * injection. Meant to be pushed into the caller's `ops` array and run in the
 * same `prisma.$transaction([...])` as the Expense write — the same shape as
 * `buildSaleAccountEntryOps` / `buildSettlementOps` in `lib/accounts.ts`.
 *
 * Unlike `POST /api/accounts/transfer`, this does **not** refuse to take an
 * account below zero. A transfer that overdraws invents money in the
 * destination account; paying a real salary out of a till whose opening balance
 * was never entered does not — it exposes that the balance is behind, and
 * blocking it would make the feature unusable for a shop that has not set its
 * opening balances yet.
 */
export function buildExpenseAccountEntryOps(params: {
  branchId: string;
  expenseId: string;
  accountId: string;
  kind: string;
  amount: number;
  date: Date;
  reference?: string | null;
  notes?: string | null;
}) {
  const { branchId, expenseId, accountId, kind, amount, date, reference, notes } = params;
  const moneyIn = isMoneyIn(kind);

  return [
    prisma.accountEntry.create({
      data: {
        branchId,
        accountId,
        date,
        type: accountEntryTypeFor(kind),
        debit: moneyIn ? amount : 0,
        credit: moneyIn ? 0 : amount,
        reference: reference || `EXP-${expenseId.slice(-6).toUpperCase()}`,
        expenseId,
        notes: notes || null,
      },
    }),
  ];
}

export type ExpenseTotals = {
  /** Operating cost recognised in the range — PAID *and* UNPAID. */
  expenses: number;
  /** The unpaid slice of `expenses`, i.e. what is still owed. */
  unpaidExpenses: number;
  /** Owner drawings. Money out, but never a cost. */
  withdrawals: number;
  /** Owner money in. */
  injections: number;
  /** Rows counted, across all three kinds. */
  count: number;
};

const EMPTY_TOTALS: ExpenseTotals = {
  expenses: 0,
  unpaidExpenses: 0,
  withdrawals: 0,
  injections: 0,
  count: 0,
};

/**
 * Expense totals for a branch and date range, by kind.
 *
 * **Accrual, not cash.** `expenses` counts a cost dated inside the range
 * whether or not it has been paid, because that is the whole reason an UNPAID
 * status exists: a salary earned in September is a September cost even if it is
 * settled in October. Filtering to paid-only would let the shop flatter a
 * month's profit simply by paying late. Rows are bucketed by `date` (when the
 * cost was incurred), never by `paidAt`.
 *
 * Cash-flow figures must use the `AccountEntry` rows instead — those exist only
 * for the paid ones.
 */
export async function getExpenseTotals(
  branchId: string,
  from?: Date | null,
  to?: Date | null
): Promise<ExpenseTotals> {
  const where: Record<string, unknown> = { branchId };
  if (from || to) {
    const date: Record<string, Date> = {};
    if (from) date.gte = from;
    if (to) date.lte = to;
    where.date = date;
  }

  const grouped = await prisma.expense.groupBy({
    by: ["kind", "status"],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  return grouped.reduce<ExpenseTotals>((acc, row) => {
    const amount = Number(row._sum.amount ?? 0);
    acc.count += row._count._all;
    if (row.kind === "PROFIT_WITHDRAWAL") acc.withdrawals += amount;
    else if (row.kind === "CAPITAL_INJECTION") acc.injections += amount;
    else {
      acc.expenses += amount;
      if (row.status === "UNPAID") acc.unpaidExpenses += amount;
    }
    return acc;
  }, { ...EMPTY_TOTALS });
}

/**
 * Net profit = gross profit (sale − cost of goods) − operating expenses.
 *
 * Withdrawals are pointedly absent. The owner taking Rs. 50,000 out of a shop
 * that earned Rs. 200,000 leaves a shop that still earned Rs. 200,000; the
 * money moved, nothing was consumed. Netting drawings off profit here would
 * double-count them, since they have already reduced the cash balance.
 */
export function netProfit(grossProfit: number, expenses: number): number {
  return grossProfit - expenses;
}
