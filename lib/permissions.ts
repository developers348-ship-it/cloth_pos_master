import { Role } from "@prisma/client";

/**
 * The permission matrix: which roles may do what, by default.
 *
 * This map is the single source of the defaults. The DB-backed override that
 * SUPER_ADMIN edits in Settings -> Roles (stored in `Setting["role_permissions"]`)
 * is layered on top of it per key by `lib/authz.ts` -- so a key added here is
 * live immediately, even for a store that saved an override before it existed.
 *
 * Enforcement (Phase 8): server-side via `requirePermission()` on every route
 * that moves money or destroys a record, and client-side via `usePermissions()`
 * so the button isn't offered in the first place. Read-only list/report
 * endpoints are deliberately left open -- the shop runs on a shared terminal and
 * hiding figures from the staff using it was not the goal.
 *
 * Every key here must be checked *somewhere* (a `can()` in the UI it gates, or
 * a `requirePermission()` on the route behind it) -- Settings -> Roles renders
 * every key in this object as a toggle, so an unchecked one is a switch that
 * looks like it does something and does not. A dozen such keys (ASSIGN_ROLES's
 * neighbours VIEW_AUDIT_LOG, CREATE_BRANCH/EDIT_BRANCH/SWITCH_BRANCH/
 * VIEW_ALL_BRANCHES, IMPORT_EXPORT_ITEMS, EDIT_INVOICE, TRANSFER_STOCK,
 * EDIT_LEDGER/DELETE_LEDGER, VIEW_ALL_BRANCH_REPORT, VIEW_RECEIVABLES) were
 * removed for exactly this reason -- none of them gated a feature that exists.
 * Add a key back only alongside the feature it controls.
 */
export const PERMISSIONS = {
  // User Management
  VIEW_USERS: [Role.SUPER_ADMIN, Role.ADMIN],
  CREATE_USER: [Role.SUPER_ADMIN, Role.ADMIN],
  EDIT_USER: [Role.SUPER_ADMIN, Role.ADMIN],
  DELETE_USER: [Role.SUPER_ADMIN],
  ASSIGN_ROLES: [Role.SUPER_ADMIN, Role.ADMIN],
  // Signing in as another member of staff to see the app exactly as they do,
  // and to ring up a sale under their name. Everything done while impersonating
  // is recorded against the *target* user, so this is effectively "act as them"
  // and is kept to the two roles that can already create and edit those
  // accounts. The rank rule in lib/impersonation.ts stops it being an
  // escalation: you may only step down into a role below your own.
  IMPERSONATE_USER: [Role.SUPER_ADMIN, Role.ADMIN],

  // Items
  VIEW_ITEMS: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT],
  ADD_ITEM: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  EDIT_ITEM: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  DELETE_ITEM: [Role.SUPER_ADMIN, Role.ADMIN],
  VIEW_PURCHASE_PRICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  EDIT_SALE_PRICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  PRINT_BARCODE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],

  // Parties
  VIEW_PARTIES: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT],
  ADD_PARTY: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT],
  EDIT_PARTY: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  DELETE_PARTY: [Role.SUPER_ADMIN, Role.ADMIN],
  SET_CREDIT_LIMIT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  VIEW_PARTY_LEDGER: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],

  // Sales
  CREATE_INVOICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  DELETE_INVOICE: [Role.SUPER_ADMIN, Role.ADMIN],
  APPLY_ITEM_DISCOUNT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  APPLY_PACKAGE_DISCOUNT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  OVERRIDE_SALE_PRICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  PROCESS_SALE_RETURN: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  HOLD_INVOICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  PRINT_RECEIPT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  // Voiding is reversible (Restore puts the stock and ledger back), so it sits
  // one notch below DELETE_INVOICE rather than alongside it.
  VOID_INVOICE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  // Spending a customer's store credit at the counter is part of ringing up a
  // sale, so it follows CREATE_INVOICE rather than the ledger permissions.
  APPLY_STORE_CREDIT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],

  // Sales list row actions (Phase 7)
  // Marking an invoice paid books a real recovery, so it matches
  // RECORD_RECOVERY rather than the counter permissions.
  MARK_INVOICE_PAID: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  // Undoing one deletes money out of the books; kept tighter than taking it.
  MARK_INVOICE_UNPAID: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  // Moves a whole invoice, its ledger rows and any collections onto another
  // party -- a correction, not everyday counter work.
  CHANGE_INVOICE_CUSTOMER: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],

  // GRN / Purchases
  CREATE_GRN: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  EDIT_GRN: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],
  DELETE_GRN: [Role.SUPER_ADMIN, Role.ADMIN],
  PRINT_GRN: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],

  // Inventory
  VIEW_STOCK: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER],
  ADJUST_STOCK: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER],

  // Ledger
  VIEW_DAYBOOK: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  RECORD_PAYMENT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  RECORD_RECOVERY: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  VIEW_OUTSTANDING: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  // Collecting a scheduled installment books the same Recovery/Payment a manual
  // one does (Phase 5), so it carries the same roles.
  COLLECT_INSTALLMENT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],

  // Cash / bank accounts
  // Split out of the single MANAGE_ACCOUNTS key when accounts moved from a
  // Settings tab to their own page: the shop wanted an accountant who can read
  // a bank statement and record a deposit without also being able to rename or
  // delete the account the whole ledger hangs off.
  //
  // VIEW_ACCOUNTS gates the sidebar entry and the page itself. It is *not*
  // enforced on `GET /api/accounts`, which every till needs in order to fill
  // the bank-account dropdown at checkout -- same read-open stance as the rest
  // of this file. VIEW_ACCOUNT_LEDGER *is* enforced server-side, because a
  // full bank statement is the one figure here worth hiding from the counter
  // (it mirrors VIEW_PARTY_LEDGER).
  VIEW_ACCOUNTS: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  VIEW_ACCOUNT_LEDGER: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  CREATE_ACCOUNT: [Role.SUPER_ADMIN, Role.ADMIN],
  // Renaming an account is cosmetic, but editing its opening balance moves
  // every balance derived from it -- so both sit at the same level.
  EDIT_ACCOUNT: [Role.SUPER_ADMIN, Role.ADMIN],
  // Only ever allowed on an account with no entries against it (the route
  // refuses otherwise), but it is still the one irreversible action here.
  DELETE_ACCOUNT: [Role.SUPER_ADMIN],
  // Settling the card machine into the bank, or a cash deposit run. Moves real
  // money between the store's own accounts, so it follows RECORD_RECOVERY.
  TRANSFER_FUNDS: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],

  // Cost management (expenses, salaries, owner drawings)
  // Costs are the one figure a shop usually does want off the counter
  // terminal: what the staff are paid, and what the owner takes out. So unlike
  // the read-open stance elsewhere in this file, VIEW_EXPENSES is enforced on
  // the list endpoint too, not just the sidebar -- same reasoning as
  // VIEW_ACCOUNT_LEDGER, one step further.
  VIEW_EXPENSES: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  // Recording a cost moves money out of a real account, so it follows
  // RECORD_PAYMENT rather than the counter permissions.
  CREATE_EXPENSE: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  EDIT_EXPENSE: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  DELETE_EXPENSE: [Role.SUPER_ADMIN, Role.ADMIN],
  // Deliberately the narrowest key in this group and separate from
  // CREATE_EXPENSE: a manager who may pay the electricity bill has no business
  // taking the owner's earnings out of the till. Capital injections ride the
  // same key -- they are the same drawer.
  WITHDRAW_PROFIT: [Role.SUPER_ADMIN, Role.ADMIN],
  // Renaming or removing a heading rewrites how every past cost reads in the
  // reports, so it sits above recording one.
  MANAGE_EXPENSE_CATEGORIES: [Role.SUPER_ADMIN, Role.ADMIN],

  // Reports
  VIEW_SALES_REPORT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT],
  VIEW_CASH_REPORT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT],
  VIEW_PURCHASE_REPORT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  EXPORT_REPORT: [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],

  // Settings
  EDIT_STORE_SETTINGS: [Role.SUPER_ADMIN, Role.ADMIN],
  DATABASE_BACKUP: [Role.SUPER_ADMIN, Role.ADMIN],
  DATABASE_RESTORE: [Role.SUPER_ADMIN],
  SYSTEM_CONFIG: [Role.SUPER_ADMIN],
  // Gates the Settings -> Clear Data tab: wiping transactional data for a
  // fresh round of local testing. Also behind the ENABLE_TEST_DATA_TOOLS env
  // var (lib/test-data-tools.ts), which an installer turns off for a client
  // deployment independently of this matrix. Restoring one of its automatic
  // backups reuses DATABASE_RESTORE, since it is the same "replace all data"
  // operation as the Backup tab's restore, just sourced from disk.
  CLEAR_TEST_DATA: [Role.SUPER_ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** The defaults as plain strings -- the shape the DB override and the client use. */
export const DEFAULT_PERMISSIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(PERMISSIONS).map(([key, roles]) => [key, [...(roles as readonly Role[])]])
);

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function checkPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return hasPermission(role, permission);
}

/**
 * The one place that answers "may this role do this?", given an already-resolved
 * matrix (defaults with any DB override layered on). Both the server guard and
 * the client hook go through it, so a button can never disagree with the route
 * behind it.
 *
 * SUPER_ADMIN is allowed unconditionally: the override editor already forces
 * them into every key, and a matrix saved with a mistake in it must not be able
 * to lock the owner out of their own system.
 */
export function isAllowed(
  matrix: Record<string, string[]>,
  role: string | undefined | null,
  permission: string
): boolean {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  const roles = matrix[permission] ?? DEFAULT_PERMISSIONS[permission];
  // An unknown key is treated as denied rather than open -- a typo in a guard
  // should fail closed.
  return Array.isArray(roles) ? roles.includes(role) : false;
}
