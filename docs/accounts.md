# Bank & Cash Accounts

Own top-level page since the accounts feature was lifted out of Settings. Sidebar entry sits between Ledger and Settings.

Main file: `app/dashboard/accounts/page.tsx` — two views in one route, not a nested `[id]` page: `AccountsPage` (the list) swaps to `AccountStatement` when `statementFor` is set, so closing a statement doesn't refetch every balance.

## Model

`Account` / `AccountEntry` in `prisma/schema.prisma:602-660`. Three `AccountType`s:

| Type | Created by | User-manageable |
|---|---|---|
| `CASH` | `getOrCreateCashAccount()` lazily, once per branch (`isDefaultCash`) | Opening balance only — never deactivated (would orphan every cash posting) or deleted |
| `CARD` | `getOrCreateCardAccount()` lazily — money on the card machine not yet deposited | No; settled into a bank by a `TRANSFER` pair |
| `BANK` | The user, on this page | Full add / edit / deactivate / delete |

Balances are always **live-computed** (`openingBalance + Σdebit − Σcredit`), never a stored running total — see the rationale on `getAccountBalance` in `lib/accounts.ts`.

## API — `app/api/accounts/`

Moved here from `app/api/settings/accounts/` when the page moved; the four read-only callers (sales, purchases, ledger, reports — they fill the bank dropdown) were updated with it.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/accounts?branchId=&includeInactive=` | *(open)* | Ungated on purpose: every till needs it for the checkout bank dropdown. `includeInactive=1` is passed only by this page, so a deactivated account can be reactivated but never appears in a payment dropdown. Lazily provisions the Cash + Card accounts. |
| `POST /api/accounts` | `CREATE_ACCOUNT` | `BANK` only — Cash/Card are never user-creatable. |
| `PATCH /api/accounts/[id]` | `EDIT_ACCOUNT` | name / bankName / accountNumber / openingBalance / isActive. Refuses to deactivate the default Cash account. |
| `DELETE /api/accounts/[id]` | `DELETE_ACCOUNT` | `BANK` only, and **only when nothing references it** — counts `AccountEntry` + `SaleInvoice.bankAccountId` + `GRN.bankAccountId` + `Recovery.accountId` + `Payment.accountId`, and returns 409 telling the user to deactivate instead. |
| `GET /api/accounts/[id]/ledger?from=&to=&type=` | `VIEW_ACCOUNT_LEDGER` | The statement. |
| `POST /api/accounts/transfer` | `TRANSFER_FUNDS` | Settle card/cash into a bank; writes the mirrored `TRANSFER` entry pair via `buildTransferOps`. |

## The statement endpoint

`app/api/accounts/[id]/ledger/route.ts` — bank-side mirror of `GET /api/ledger` (party statement).

Two things worth knowing:

1. **Opening balance is the real balance the day before `from`** — stored `openingBalance` plus one aggregate over every entry with `date < from`. Not zero, and not the stored opening balance. Without this, filtering to "today" would close on a figure that disagrees with the account card.
2. **The `type` filter suppresses the running balance.** A running total across a filtered subset climbs to a closing figure matching no real balance, so `balance`, `openingBalance` and `totals.closingBalance` all come back `null` and the response sets `typeFiltered: true`. The UI drops the Balance column and shows an amber note instead.

## Filters

Same shape as Reports (`app/dashboard/reports/page.tsx`): a `DateRangePreset` dropdown (`today | yesterday | last7days | thisMonth | lastMonth | last30days | thisYear | lastYear | all | custom`) driving two date inputs that stay editable only on `custom`/`all`, plus an entry-type dropdown. No Load button — a 300ms-debounced effect refetches on any change. Preset labels reuse the existing `reports_date*` keys; `getDateRangeForPreset` lives in `lib/utils.ts:49`.

CSV export goes through the shared `exportCSV` in `lib/csv-export.ts`.

## Permissions

Six keys, replacing the single `MANAGE_ACCOUNTS` (`lib/permissions.ts`), grouped as "Bank & Cash Accounts" in the Settings → Roles matrix:

| Key | Default roles |
|---|---|
| `VIEW_ACCOUNTS` | SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT |
| `VIEW_ACCOUNT_LEDGER` | SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT |
| `CREATE_ACCOUNT` | SUPER_ADMIN, ADMIN |
| `EDIT_ACCOUNT` | SUPER_ADMIN, ADMIN |
| `DELETE_ACCOUNT` | SUPER_ADMIN |
| `TRANSFER_FUNDS` | SUPER_ADMIN, ADMIN, ACCOUNTANT |

The split exists so an accountant can read a statement and record a deposit without being able to rename or delete the account the whole ledger hangs off.

`VIEW_ACCOUNTS` gates the sidebar entry and the page body client-side only — it is *not* enforced on `GET /api/accounts`, per this repo's read-open stance (`lib/permissions.ts` header comment). `VIEW_ACCOUNT_LEDGER` **is** server-enforced, because a full bank statement is the one figure here worth keeping off the shared counter terminal.

The Accounts sidebar entry was the first nav item gated on the permission matrix rather than a hardcoded `roles` array (`components/layout/Sidebar.tsx` — optional `permission` field on `NAV_ITEMS`); Costs (`VIEW_EXPENSES`) now uses the same field. The rest still use `roles` and can be moved over the same way.

## Translations

`lib/translations/accounts.ts` (`accounts_*`), merged in `lib/translations.ts`. These were `settings_*` keys while the feature was a tab; only `settings_activate` / `settings_deactivate` / `settings_saving` stayed behind, still used by other Settings tabs.

## Not covered

- No edit/delete for `AccountEntry` rows themselves — the statement is read-only, and entries are only ever written by the sale/GRN/settlement paths in `lib/accounts.ts` and the cost-management paths in `lib/expenses.ts` (`EXPENSE` / `PROFIT_WITHDRAWAL` / `CAPITAL_INJECTION` entry types — see [expenses.md](expenses.md)).
- No pagination on the statement; a wide date range fetches every row.
- No unit tests for the ledger route's opening-balance arithmetic (see `docs/testing.md` for what is and isn't covered).
