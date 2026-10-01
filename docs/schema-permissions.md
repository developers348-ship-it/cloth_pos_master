# Schema & Permissions

Full schema: `prisma/schema.prisma`.

## Key models

- **`SaleInvoice`**: `partyOption` (`CASH|CC`), `paymentMethod` (`CASH|BANK|CASH_AND_BANK`), `bankAccountId`/`bankAmount`, `creditApplied`, `repaymentType`/`installmentPeriods`, `cardAmount`, `cashReceived`, `netBill`, `returnAmount`. `chooseBank` is dead (superseded by `bankAccountId`). `refundOfInvoiceId` is a **self-relation** (`refundOf` / `refunds`, `ON DELETE SET NULL`, migration `20260909000000_invoice_refund_link`) set on the net-return invoice a full-order refund creates — see [orders.md](orders.md#refund-a-whole-order).
- **`Party`**: `type PartyType` (`CASH|CREDIT|VENDOR`), `previousBalance` (opening only), `creditLimit`, `isDefault` (walking customer). Live balance is ledger-derived — see `lib/party-balance.ts`.
- **`Payment`** / **`Recovery`**: `paymentMethod` + `accountId` (the `bankName` columns are kept for historical reads only). `Recovery.invoiceId` links money collected against one invoice — see `orders.md`.
- **`LedgerEntry`**: double-entry-style row (`debit`, `credit`, `type: LedgerEntryType`), plus `recoveryId`/`paymentId` so a settlement's party-ledger row can be reversed exactly.
- **`Account`** / **`AccountEntry`**: cash and bank accounts with live-computed balances — see `settings-accounts.md`.
- **`Expense`** / **`ExpenseCategory`**: operating costs, salaries and owner drawings. One table with a `kind` flag (`EXPENSE|PROFIT_WITHDRAWAL|CAPITAL_INJECTION`) and a `status` (`PAID|UNPAID`); a paid row carries one `AccountEntry` via `AccountEntry.expenseId`. Categories are user-managed rows, lazily seeded per branch — see `expenses.md`.
- **`InstallmentPlan`** / **`Installment`**: see `installments.md`.
- **`Branch`**: `pwaOfflineEnabled`, `languageSwitcherEnabled`.
- **`Setting`**: generic `key/value` KV store; holds the permissions-matrix override under `"role_permissions"`.

## Enums

- `Role`: `SUPER_ADMIN, ADMIN, MANAGER, CASHIER, ACCOUNTANT`
- `PartyType`, `InvoiceStatus` (`SAVED, HELD, VOIDED`), `SyncStatus`
- `LedgerEntryType`: `SALE, SALE_RETURN, PURCHASE, PURCHASE_RETURN, PAYMENT, RECEIPT, ADJUSTMENT, OPENING_BALANCE`
- `AccountEntryType` (gained `EXPENSE`, `PROFIT_WITHDRAWAL`, `CAPITAL_INJECTION` with cost management), `ExpenseKind`, `ExpenseStatus`, `InstallmentPlanKind`, `InstallmentStatus`

## Permission system — enforced since Phase 8

Before Phase 8 the app *defined* permissions in two places and enforced them in neither: any logged-in user could void or delete any invoice, edit a GRN, adjust stock, or rewrite the role matrix itself. That is fixed.

### The three pieces

1. **`lib/permissions.ts`** — the matrix of defaults (`PERMISSIONS`), now the single source. `DEFAULT_PERMISSIONS` is the plain-string form, and `isAllowed(matrix, role, key)` is the one resolver both halves call. SUPER_ADMIN is allowed unconditionally; an unknown key is denied (a typo in a guard fails closed).
2. **`lib/authz.ts`** — server side. `requirePermission(key)` returns the session or the 401/403 response to return:

   ```ts
   const gate = await requirePermission("DELETE_INVOICE");
   if (!gate.ok) return gate.response;
   ```

   `getEffectivePermissions()` layers the DB override **per key** over the defaults (a matrix saved before a key existed must not deny it to everyone) and caches it for 15 s, busted on save by `invalidatePermissionsCache()`. It now *lives* in **`lib/permissions-server.ts`** and is re-exported here, so `auth.ts` can check a permission from the JWT callback (impersonation, below) without importing the module that imports `auth`.
3. **`lib/permissions-client.tsx`** — `PermissionsProvider` (mounted in `app/dashboard/layout.tsx`) fetches the same matrix once and exposes `usePermissions().can(key)`. UI convenience only; the server is the boundary.

### What is gated

Every route that **moves money or destroys a record**, and its UI affordance:

| Area | Routes | Keys |
| --- | --- | --- |
| Sales | POST `/api/sales`; PATCH/DELETE `/api/sales/[id]`; POST+DELETE `/api/sales/[id]/payment`; PATCH `/api/sales/[id]/party` | `CREATE_INVOICE`, `APPLY_STORE_CREDIT` (only when `creditApplied > 0`), `VOID_INVOICE`, `DELETE_INVOICE`, `MARK_INVOICE_PAID`, `MARK_INVOICE_UNPAID`, `CHANGE_INVOICE_CUSTOMER` |
| Purchases | POST `/api/purchases`; PUT/DELETE `/api/purchases/[id]` | `CREATE_GRN`, `EDIT_GRN`, `DELETE_GRN` |
| Ledger | POST recovery / payment / installments-collect | `RECORD_RECOVERY`, `RECORD_PAYMENT`, `COLLECT_INSTALLMENT` |
| Inventory | POST `/api/inventory/adjust` | `ADJUST_STOCK` |
| Accounts | POST `/api/accounts`, PATCH/DELETE `/api/accounts/[id]`, GET `/api/accounts/[id]/ledger`, POST `/api/accounts/transfer` | `CREATE_ACCOUNT`, `EDIT_ACCOUNT`, `DELETE_ACCOUNT`, `VIEW_ACCOUNT_LEDGER`, `TRANSFER_FUNDS` — see `accounts.md` |
| Costs | GET/POST `/api/expenses`, PATCH/DELETE `/api/expenses/[id]`, POST `/api/expenses/[id]/pay`, the categories + payees routes | `VIEW_EXPENSES`, `CREATE_EXPENSE`, `EDIT_EXPENSE`, `DELETE_EXPENSE`, `WITHDRAW_PROFIT`, `MANAGE_EXPENSE_CATEGORIES` — see `expenses.md` |
| Users | GET/POST `/api/settings/users`, PATCH/DELETE `/api/settings/users/[id]`, POST/DELETE `/api/impersonate` | `VIEW_USERS`, `CREATE_USER`, `EDIT_USER`, `DELETE_USER`, `IMPERSONATE_USER` |
| Settings | PUT `/api/settings/store`, POST `/api/settings/icon`, GET `/api/settings/backup`, POST `/api/settings/backup/restore`, PUT/DELETE `/api/settings/permissions`, GET/POST `/api/settings/clear-test-data`, GET/DELETE `/api/settings/clear-test-data/backups/[file]`, POST `/api/settings/clear-test-data/restore` | `EDIT_STORE_SETTINGS`, `DATABASE_BACKUP`, `DATABASE_RESTORE`, `SYSTEM_CONFIG`, `CLEAR_TEST_DATA` (also gated by `ENABLE_TEST_DATA_TOOLS` — see `settings-accounts.md`) |
| Catalog | items, parties, brands/categories/groups create-update-delete | `ADD_ITEM`/`EDIT_ITEM`/`DELETE_ITEM`, `ADD_PARTY`/`EDIT_PARTY`/`DELETE_PARTY` |

**Read-only list and report endpoints are deliberately left open** (`/api/reports/*`, `/api/items`, `/api/parties`, `/api/ledger` reads, `GET /api/accounts`, `GET /api/settings/permissions`). The shop runs on one shared terminal; hiding figures from the staff standing at it was not the goal, and the bank-account list is needed by anyone who can record money. Gating those on the `VIEW_*` keys is a deliberate later decision, not an oversight — it would change what a CASHIER can see today.

There are two exceptions. `GET /api/accounts/[id]/ledger` is gated on `VIEW_ACCOUNT_LEDGER`: a full bank statement is worth keeping off the shared counter terminal in a way a sales figure is not. The *list* endpoint next to it stays open, because the checkout bank dropdown reads it.

The second is every read under `/api/expenses`, gated on `VIEW_EXPENSES` — staff salaries and owner drawings are the clearest case of a figure a shop wants off the counter terminal, and unlike the bank list nothing at checkout needs them.

### Keys added in Phase 8

`VOID_INVOICE`, `APPLY_STORE_CREDIT`, `MARK_INVOICE_PAID`, `MARK_INVOICE_UNPAID`, `CHANGE_INVOICE_CUSTOMER`, `COLLECT_INSTALLMENT`, `MANAGE_ACCOUNTS` (since split, below) — all present in the Settings → Roles matrix with labels in `lib/translations/roles.ts` (en + ur). Defaults: voiding sits one notch below deleting (MANAGER may void, not delete); recording money follows `RECORD_RECOVERY`; undoing it is tighter than taking it; applying store credit follows the counter (CASHIER may).

### Keys added when accounts moved out of Settings

`MANAGE_ACCOUNTS` was one key covering create, edit, deactivate and transfer. It is **gone**, replaced by six: `VIEW_ACCOUNTS`, `VIEW_ACCOUNT_LEDGER`, `CREATE_ACCOUNT`, `EDIT_ACCOUNT`, `DELETE_ACCOUNT`, `TRANSFER_FUNDS`, in their own "Bank & Cash Accounts" matrix group. A stored override still naming `MANAGE_ACCOUNTS` is simply ignored — the per-key layering in `getEffectivePermissions()` means the new keys resolve from the defaults. See `accounts.md`.

### `IMPERSONATE_USER` — signing in as another user

Settings → Users can hand an admin a working session as any member of staff below their own rank, so they see the app as that user and can work under their name. The key defaults to SUPER_ADMIN + ADMIN and is enforced in two places, because the token is what actually grants the access:

- `POST /api/impersonate` — validates, writes the `AuditLog` row, returns a reason on refusal.
- the `jwt` callback in `auth.ts` — re-runs the identical check (`checkImpersonation()` in `lib/impersonation-server.ts`) before rewriting the token, so calling next-auth's `update()` directly is no shortcut.

While impersonating, the token's identity fields **are** the target's — role, id, branch — which is why nothing else in the app needed a special case: `requirePermission()`, the sidebar and `SaleInvoice.userId` all see the user being impersonated. `token.actor` holds the real admin, surfaces as `session.user.actor`, and is what the banner and the "back to admin" swap key off.

The escalation guard is `ROLE_RANK` in `lib/impersonation.ts`: strictly-lower only, so an ADMIN cannot step into another ADMIN or a SUPER_ADMIN and pick up grants their own role never had. Pinned in `tests/impersonation.test.ts`, including that the settings button and the server rule agree on every pair of roles. Full flow in `settings-accounts.md`.

### Sidebar nav visibility — every entry, not just two

Every `NAV_ITEMS` row in `components/layout/Sidebar.tsx` now carries a `permission` field (Dashboard and Settings excepted — Settings has no single matching key and gates its own sub-sections instead), each picked to match that row's `roles` list exactly under the default matrix, so wiring this changed nothing until an admin actually edits Settings → Roles. This closed the original bug report: disabling a permission used to leave its menu item showing regardless, because only Accounts/Expenses checked one.

- **`app/dashboard/settings/roles/page.tsx`** gates its own view/edit on `SUPER_ADMIN`/`ADMIN` inline; the API behind it now enforces `SYSTEM_CONFIG`, so the effective rule is correct either way.

### Every key the Roles UI shows is now checked somewhere

Settings → Roles renders every key in `lib/permissions.ts` as a toggle, so a key nothing ever reads was a switch that looked like it did something. A pass wired every remaining feature that had one: `VIEW_ITEMS`/`VIEW_PARTIES` (page + nav guard, list APIs stay open per the read-open stance below), `VIEW_PURCHASE_PRICE`/`EDIT_SALE_PRICE` (item form fields), `PRINT_BARCODE`/`PRINT_GRN` (purchases toolbar + row buttons), `SET_CREDIT_LIMIT` (party form field, plus a server check on `POST/PUT /api/parties[/id]` when the limit is actually rising), `VIEW_PARTY_LEDGER` (party detail's Ledger tab), `APPLY_ITEM_DISCOUNT`/`APPLY_PACKAGE_DISCOUNT` (checkout discount fields, plus a server check on `POST /api/sales` when a line or the bill actually carries one), `OVERRIDE_SALE_PRICE` (checkout rate field — client-only; the server would need a per-line catalog-price lookup to verify, not added), `HOLD_INVOICE`/`PRINT_RECEIPT` (checkout, client-only — neither persists to the DB), `VIEW_DAYBOOK`/`VIEW_OUTSTANDING` (Ledger page tabs), `VIEW_SALES_REPORT`/`VIEW_CASH_REPORT`/`VIEW_PURCHASE_REPORT`/`VIEW_STOCK`/`EXPORT_REPORT` (Reports page tabs + CSV buttons), and `ASSIGN_ROLES` (the role `<select>` in the user form, plus a server check on `POST /api/settings/users` and on `PATCH .../[id]` when the role actually changes).

Twelve keys were removed outright rather than left as decoration, because no feature existed anywhere to gate: `VIEW_AUDIT_LOG` (no page reads `AuditLog`), `CREATE_BRANCH`/`EDIT_BRANCH`/`SWITCH_BRANCH`/`VIEW_ALL_BRANCHES` (this is a single-branch-per-store app — no multi-branch UI exists at all), `IMPORT_EXPORT_ITEMS` (no import/export UI), `EDIT_INVOICE` (a saved invoice can only be voided, not line-edited), `TRANSFER_STOCK` (no stock-transfer-between-branches feature), `EDIT_LEDGER`/`DELETE_LEDGER` (no edit/delete action on a `LedgerEntry` row anywhere), `VIEW_ALL_BRANCH_REPORT` (same single-branch reason), `VIEW_RECEIVABLES` (no dedicated tab — overlapped ambiguously with `VIEW_OUTSTANDING`). See the comment above `PERMISSIONS` in `lib/permissions.ts`.

`VIEW_ITEMS`, `VIEW_PARTIES`, `VIEW_STOCK`, and the four `VIEW_*_REPORT`/`VIEW_DAYBOOK`/`VIEW_OUTSTANDING` keys stay off their list/report GET endpoints deliberately — those are the endpoints called out below as read-open, and gating the client nav/tab/page without touching the API follows the same template `VIEW_ACCOUNTS` already established.

### Verified

43 assertions through the real routes on a local DB copy: every gated route 401s with no session; a CASHIER is refused void/delete/mark-paid/change-customer/recovery/accounts/stock/users/matrix but may still ring up a sale and add a party; a MANAGER may void, restore and mark paid but not delete or mark unpaid; SUPER_ADMIN is never blocked; and a saved override actually changes enforcement (granting MANAGER `DELETE_INVOICE` lets them delete, resetting takes it away) while keys added after that override was saved still resolve from the defaults.

Related translation file: `lib/translations/roles.ts`.

## Schema changes since this map was written

- **`Payment.grnId`** (nullable, indexed, FK to `GRN` with `ON DELETE SET
  NULL`) — migration `20260911000000_payment_grn_link`, applied to both the
  local Postgres and the live Supabase database. The vendor-side mirror of
  `Recovery.invoiceId`; without it a vendor payment attached to no purchase
  bill. `GRN.payments` is the back-relation. See [ledger.md](ledger.md).
