/**
 * Shared engine behind "clear test data": which tables make up each
 * selectable group, what each group requires to be cleared first (so a
 * partial selection never trips a foreign-key constraint), and the actual
 * delete.
 *
 * This is the single source of truth for `prisma/reset-data.ts` (the CLI,
 * which clears every group) and `POST /api/settings/clear-test-data` (the
 * Settings UI, which clears whichever groups were picked) — so the two can
 * never drift out of step the way a second hand-written table list would.
 *
 * The `requires` edges were read off prisma/schema.prisma's foreign keys, not
 * guessed: a group requires another when some column in it points at a table
 * that other group owns. E.g. `sales` requires `ledgerMoney` because
 * LedgerEntry.invoiceId, Recovery.invoiceId, AccountEntry.invoiceId and
 * InstallmentPlan.invoiceId all reference SaleInvoice. If this map is ever
 * wrong or a schema change adds a new reference, Postgres rejects the
 * out-of-order delete and the whole transaction rolls back untouched — the
 * failure mode is a clear error, never a partial or corrupted clear.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type ClearGroupId =
  | "auditLog"
  | "dayBook"
  | "stockAdjustments"
  | "ledgerMoney"
  | "sales"
  | "purchases"
  | "expenses"
  | "catalog"
  | "accounts"
  | "parties";

type TableSpec = {
  table: string;
  count: (tx: Tx) => Promise<number>;
  run: (tx: Tx) => Promise<{ count: number }>;
};

type ClearGroup = {
  id: ClearGroupId;
  /** Translation key for the group's label in the Settings tab. */
  labelKey: string;
  /** Other groups whose tables must be cleared first. */
  requires: ClearGroupId[];
  tables: TableSpec[];
};

/**
 * Declared in the order that is always safe to delete in — every table here
 * is referenced only by a table above it, or by one of the tables the tool
 * never touches (User, UserBranch, Organization, Branch, Setting, Session,
 * the default Party). `clearData` and `reset-data.ts` both delete strictly in
 * this order.
 */
export const CLEAR_GROUPS: ClearGroup[] = [
  {
    id: "auditLog",
    labelKey: "settings_clearGroupAuditLog",
    requires: [],
    tables: [
      { table: "AuditLog", count: (tx) => tx.auditLog.count(), run: (tx) => tx.auditLog.deleteMany() },
    ],
  },
  {
    id: "ledgerMoney",
    labelKey: "settings_clearGroupLedgerMoney",
    requires: [],
    tables: [
      { table: "AccountEntry", count: (tx) => tx.accountEntry.count(), run: (tx) => tx.accountEntry.deleteMany() },
      { table: "Installment", count: (tx) => tx.installment.count(), run: (tx) => tx.installment.deleteMany() },
      { table: "InstallmentPlan", count: (tx) => tx.installmentPlan.count(), run: (tx) => tx.installmentPlan.deleteMany() },
      { table: "LedgerEntry", count: (tx) => tx.ledgerEntry.count(), run: (tx) => tx.ledgerEntry.deleteMany() },
      { table: "Recovery", count: (tx) => tx.recovery.count(), run: (tx) => tx.recovery.deleteMany() },
      { table: "Payment", count: (tx) => tx.payment.count(), run: (tx) => tx.payment.deleteMany() },
    ],
  },
  {
    id: "sales",
    labelKey: "settings_clearGroupSales",
    requires: ["ledgerMoney"],
    tables: [
      { table: "SaleInvoiceItem", count: (tx) => tx.saleInvoiceItem.count(), run: (tx) => tx.saleInvoiceItem.deleteMany() },
      { table: "SaleInvoice", count: (tx) => tx.saleInvoice.count(), run: (tx) => tx.saleInvoice.deleteMany() },
    ],
  },
  {
    id: "purchases",
    labelKey: "settings_clearGroupPurchases",
    requires: ["ledgerMoney"],
    tables: [
      { table: "GRNItem", count: (tx) => tx.gRNItem.count(), run: (tx) => tx.gRNItem.deleteMany() },
      { table: "GRN", count: (tx) => tx.gRN.count(), run: (tx) => tx.gRN.deleteMany() },
    ],
  },
  {
    id: "expenses",
    labelKey: "settings_clearGroupExpenses",
    requires: ["ledgerMoney"],
    tables: [
      { table: "Expense", count: (tx) => tx.expense.count(), run: (tx) => tx.expense.deleteMany() },
      { table: "ExpenseCategory", count: (tx) => tx.expenseCategory.count(), run: (tx) => tx.expenseCategory.deleteMany() },
    ],
  },
  {
    id: "stockAdjustments",
    labelKey: "settings_clearGroupStockAdjustments",
    requires: [],
    tables: [
      { table: "StockAdjustment", count: (tx) => tx.stockAdjustment.count(), run: (tx) => tx.stockAdjustment.deleteMany() },
    ],
  },
  {
    id: "dayBook",
    labelKey: "settings_clearGroupDayBook",
    requires: [],
    tables: [
      { table: "DayBook", count: (tx) => tx.dayBook.count(), run: (tx) => tx.dayBook.deleteMany() },
    ],
  },
  {
    id: "catalog",
    labelKey: "settings_clearGroupCatalog",
    // ItemStock cascades off Item at the DB level, but it's deleted explicitly
    // anyway so its count shows up honestly in the preview.
    requires: ["stockAdjustments", "sales", "purchases"],
    tables: [
      { table: "ItemStock", count: (tx) => tx.itemStock.count(), run: (tx) => tx.itemStock.deleteMany() },
      { table: "Item", count: (tx) => tx.item.count(), run: (tx) => tx.item.deleteMany() },
      { table: "ItemCategory", count: (tx) => tx.itemCategory.count(), run: (tx) => tx.itemCategory.deleteMany() },
      { table: "ItemBrand", count: (tx) => tx.itemBrand.count(), run: (tx) => tx.itemBrand.deleteMany() },
      { table: "ItemGroup", count: (tx) => tx.itemGroup.count(), run: (tx) => tx.itemGroup.deleteMany() },
    ],
  },
  {
    id: "accounts",
    labelKey: "settings_clearGroupAccounts",
    requires: ["ledgerMoney", "sales", "purchases", "expenses"],
    tables: [
      { table: "Account", count: (tx) => tx.account.count(), run: (tx) => tx.account.deleteMany() },
    ],
  },
  {
    id: "parties",
    labelKey: "settings_clearGroupParties",
    requires: ["ledgerMoney", "sales", "purchases"],
    tables: [
      {
        table: "Party (except Walking Customer)",
        count: (tx) => tx.party.count({ where: { isDefault: false } }),
        run: (tx) => tx.party.deleteMany({ where: { isDefault: false } }),
      },
    ],
  },
];

const GROUP_BY_ID = new Map(CLEAR_GROUPS.map((g) => [g.id, g]));

export const ALL_GROUP_IDS: ClearGroupId[] = CLEAR_GROUPS.map((g) => g.id);

/**
 * Expands a selection to include every group it `requires`, transitively.
 * Unknown ids are dropped rather than throwing — a stale id from an older
 * client build should shrink the selection, not fail the whole request.
 */
export function resolveGroupSelection(selected: readonly string[]): ClearGroupId[] {
  const closure = new Set<ClearGroupId>();
  const visit = (id: string) => {
    const group = GROUP_BY_ID.get(id as ClearGroupId);
    if (!group || closure.has(group.id)) return;
    closure.add(group.id);
    for (const req of group.requires) visit(req);
  };
  for (const id of selected) visit(id);
  // Return in the fixed safe delete order, not selection order.
  return CLEAR_GROUPS.map((g) => g.id).filter((id) => closure.has(id));
}

/** True only for the exact confirm phrase, case-sensitive like Restore's. */
export function isClearConfirmed(phrase: unknown): boolean {
  return phrase === "CLEAR";
}

export type ClearPreviewRow = { id: ClearGroupId; labelKey: string; table: string; rows: number };

export async function previewClearGroups(tx: Tx, groupIds: readonly ClearGroupId[]): Promise<ClearPreviewRow[]> {
  const rows: ClearPreviewRow[] = [];
  for (const id of groupIds) {
    const group = GROUP_BY_ID.get(id);
    if (!group) continue;
    for (const spec of group.tables) {
      rows.push({ id: group.id, labelKey: group.labelKey, table: spec.table, rows: await spec.count(tx) });
    }
  }
  return rows;
}

export type ClearResult = {
  groupsCleared: ClearGroupId[];
  tables: { table: string; rows: number }[];
  rowsDeleted: number;
  /** Set when the `parties` group ran and a Walking Customer exists. */
  walkingCustomerAccountId: number | null;
};

/**
 * Deletes every table in the resolved group set, inside one transaction —
 * either the whole selection goes or none of it does. Mirrors
 * prisma/reset-data.ts's Party.accountId sequence fix-up and balance reset
 * when the `parties` group is included.
 */
export async function clearData(prisma: PrismaClient, groupIds: readonly ClearGroupId[]): Promise<ClearResult> {
  return prisma.$transaction(
    async (tx) => {
      const tables: { table: string; rows: number }[] = [];
      let rowsDeleted = 0;

      for (const id of groupIds) {
        const group = GROUP_BY_ID.get(id);
        if (!group) continue;
        for (const spec of group.tables) {
          const { count } = await spec.run(tx);
          tables.push({ table: spec.table, rows: count });
          rowsDeleted += count;
        }
      }

      let walkingCustomerAccountId: number | null = null;
      if (groupIds.includes("parties")) {
        const walking = await tx.party.findFirst({ where: { isDefault: true }, select: { id: true, accountId: true } });
        if (walking) {
          await tx.party.update({ where: { id: walking.id }, data: { previousBalance: 0 } });
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"Party"', 'accountId'), $1, true)`,
            walking.accountId
          );
          walkingCustomerAccountId = walking.accountId;
        }
      }

      return { groupsCleared: [...groupIds], tables, rowsDeleted, walkingCustomerAccountId };
    },
    { timeout: 120_000 }
  );
}
