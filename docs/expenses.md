# Cost Management

Own top-level page at `/dashboard/expenses`. Sidebar entry sits between Bank & Cash and Settings.

Main file: `app/dashboard/expenses/page.tsx` — two views in one route, not a nested `[id]` page: `ExpensesPage` (the list) swaps to `CategoryManager` when `showCategories` is set, the same shape the Accounts page uses for its statement.

Where it sits relative to the rest: the Accounts page answers *where is the store's money*, this one answers *where did it go*. It is not the vendor-payment path — a `Payment` against a party ledger (`/api/ledger/payment`) is money out to someone the books track a balance for. An expense has no counterparty inside the books, only a category and, once paid, an account.

## Model

`ExpenseCategory` / `Expense` in `prisma/schema.prisma:670-736`, enums `ExpenseKind` / `ExpenseStatus` at `:101-112`. Migration `20260909171908_cost_management`.

### Three kinds, one table

`ExpenseKind` is a flag on one table rather than three tables, because the page, the account posting and the filters are identical across them — only the profit maths differs.

| Kind | Money | Reduces profit? | Permission |
|---|---|---|---|
| `EXPENSE` | Out | **Yes** | `CREATE_EXPENSE` |
| `PROFIT_WITHDRAWAL` | Out | **No** | `WITHDRAW_PROFIT` |
| `CAPITAL_INJECTION` | In | No | `WITHDRAW_PROFIT` |

**A withdrawal is not a cost.** The owner taking Rs. 50,000 out of a shop that earned Rs. 200,000 leaves a shop that still earned Rs. 200,000 — money moved, nothing was consumed. Netting drawings off profit would double-count them, since they have already reduced the cash balance. `netProfit()` in `lib/expenses.ts` subtracts `expenses` only, and the summary tiles keep costs and withdrawals in separate columns rather than showing one "money out" figure.

`CAPITAL_INJECTION` is the mirror of a withdrawal (the owner putting money back in) and rides the same permission — it is the same drawer.

### Paid vs unpaid

`ExpenseStatus` is what makes this more than a wrapper around `AccountEntry`:

- `PAID` — `paymentMethod` (`CASH`/`BANK`) and `accountId` are set, and exactly one `AccountEntry` exists (`expenseId` links it).
- `UNPAID` — both are forced null, and **nothing is posted to any account**. A recognised liability: salary due, rent not yet paid.

**Costs are accrual, balances are cash.** `getExpenseTotals()` counts a cost dated inside the range whether or not it has been paid, and buckets by `date` (when the cost was incurred), never `paidAt`. Otherwise a shop could flatter a month's profit by paying late. The account balances see only the paid ones, because only they have an `AccountEntry`. `POST /api/expenses/[id]/pay` deliberately leaves `date` alone and only stamps `paidAt` — paying September's rent in October keeps it a September cost.

### Payee

Two fields, both optional, and they are not alternatives:

- `payeeUserId` → a staff member with a login, for salaries.
- `payeeName` → free text, for everyone a shop pays who never signs in, and for K-Electric.

Picking a user **snapshots their name into `payeeName`** as well as setting the relation. `ON DELETE SET NULL` means deleting that user would otherwise leave the row with no record of who was actually paid.

`recordedById` is the audit trail — who entered it. Money leaving the till is where that matters most, and the list shows it under the payee.

The staff dropdown reads `GET /api/expenses/payees`, **not** `GET /api/settings/users`: the latter is gated on `VIEW_USERS` (SUPER_ADMIN/ADMIN) and returns emails and roles. An accountant who may record a salary needs to pick the payee without being able to read the user directory.

## Categories

A table, not an enum — the whole point is that a shop can add "Chowkidar" or "Generator Diesel" without a migration.

`ensureExpenseCategories(branchId)` in `lib/expenses.ts` lazily seeds `DEFAULT_EXPENSE_CATEGORIES` (Salary, Rent, Utilities, Transport, Repairs & Maintenance, Marketing, Miscellaneous) on the first call to the categories endpoint — the same find-or-create idiom as `getOrCreateCashAccount()`.

It seeds **only when the branch has none at all**. Topping up individually missing names would resurrect a category the shop deliberately deleted, every time the page was opened.

A category is required for `EXPENSE` (the reports can't group otherwise) and always null for the other two kinds.

## API — `app/api/expenses/`

| Route | Permission | Notes |
|---|---|---|
| `GET /api/expenses?branchId=&from=&to=&kind=&categoryId=&status=&accountId=&q=` | `VIEW_EXPENSES` | List + the range's totals in one response. Totals ignore the kind/status/search filters on purpose — the tiles are the period's summary, and a tile that moved when you typed in the search box would stop being one. |
| `POST /api/expenses` | `CREATE_EXPENSE`, or `WITHDRAW_PROFIT` when `kind !== "EXPENSE"` | Writes the Expense + (when paid) its `AccountEntry` in one transaction. |
| `PATCH /api/expenses/[id]` | `EDIT_EXPENSE` / `WITHDRAW_PROFIT` | `kind` is **not** editable — see below. |
| `DELETE /api/expenses/[id]` | `DELETE_EXPENSE` / `WITHDRAW_PROFIT` | Deletes the account posting with it, so the money goes back into the balance. A real delete, not a deactivate: an expense's `AccountEntry` exists only because of it, so there are no dependents worth protecting. |
| `POST /api/expenses/[id]/pay` | `CREATE_EXPENSE` / `WITHDRAW_PROFIT` | Settles an unpaid cost. |
| `GET /api/expenses/categories?branchId=&includeInactive=` | `VIEW_EXPENSES` | Lazily seeds the defaults. `includeInactive=1` is passed only by the manager view. |
| `POST /api/expenses/categories` | `MANAGE_EXPENSE_CATEGORIES` | 409s on a name clash, and says "reactivate it instead" when the clash is a deactivated one. |
| `PATCH`/`DELETE /api/expenses/categories/[id]` | `MANAGE_EXPENSE_CATEGORIES` | Delete only while nothing is booked under it — otherwise 409, same rule and reasoning as `DELETE /api/accounts/[id]`. |
| `GET /api/expenses/payees?branchId=` | `VIEW_EXPENSES` | id + name of active users in the branch, nothing else. |

### Two decisions in the write paths worth knowing

1. **`kind` is immutable.** Flipping a paid salary into an owner drawing would retroactively move it out of the profit calculation — that is a different record, not an edit of this one. The PATCH 400s and says to delete and re-record.
2. **A money edit rebuilds the posting rather than patching it.** `PATCH` runs `accountEntry.deleteMany({ expenseId })` and then re-derives the entry from the merged fields. There is at most one, it is derived entirely from those fields, and rebuilding is the only way an edit that flips PAID → UNPAID (the entry must vanish) and one that flips back (it must reappear) go through the same code path. The payment half is also resolved from the **merged** old-and-new view, so a PATCH that changes only the amount keeps paying out of the same account instead of silently falling back to cash.

### Deliberate difference from the transfer route

`POST /api/accounts/transfer` refuses to overdraw the source account. `buildExpenseAccountEntryOps` does **not**. A transfer that overdraws invents money in the destination; paying a real salary out of a till whose opening balance was never entered does not — it exposes that the balance is behind. Blocking it would make the feature unusable for a shop that has not set its opening balances yet.

## Account postings

Every paid row writes exactly one `AccountEntry` through the same `Account` machinery as sales, GRNs and settlements (`lib/accounts.ts`), so a salary paid out of the till appears on the cash account's statement next to the sales that put it there. `CASH` resolves through `resolveSettlementAccount`'s cash path — the branch's single lazily-provisioned cash account.

Three new `AccountEntryType` values, one per kind (`EXPENSE`, `PROFIT_WITHDRAWAL`, `CAPITAL_INJECTION`) rather than one shared `EXPENSE` type, so the statement's type filter can separate "what the shop spent" from "what the owner took out" without joining back to the Expense row. All three are in the Accounts statement filter and have `accounts_type_*` labels.

`AccountEntry.expenseId` is the link back; `ON DELETE SET NULL`.

## Dashboard integration

`/api/reports/dashboard` gained, for the same date range:

- `totals.expenses`, `totals.unpaidExpenses`, `totals.withdrawals`, `totals.injections`
- `totals.netProfit` = `totals.profit − totals.expenses`, and `totals.netMarginPct`
- per-bucket `expenses` and `netProfit` on each `series` entry

`totals.profit` and `marginPct` are unchanged and remain **gross** — sale minus cost of goods. The panel now shows six tiles instead of four (Sales, Gross Profit, Costs, Net Profit, Margin, Discount) and the table view gained Costs and Net Profit columns.

**The chart still plots Sales vs Gross Profit only.** A third series would need a third validated colour and would crowd bars already ~2.4px wide at 30 daily buckets; `expenses`/`netProfit` are optional on `SalesProfitPoint` and read by the table instead. Both notes under the chart say which figure is which.

The existing profit caveat still applies on top of this one: COGS is valued at the item's *current* `purchasePrice`, so re-costing an item moves historical gross **and** net profit. See [dashboard.md](dashboard.md#profit-is-an-estimate--and-knowingly-so).

## Permissions

Six keys in their own "Cost Management" matrix group (`lib/permissions.ts`, labels in `lib/translations/roles.ts`):

| Key | Default roles |
|---|---|
| `VIEW_EXPENSES` | SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT |
| `CREATE_EXPENSE` | SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT |
| `EDIT_EXPENSE` | SUPER_ADMIN, ADMIN, ACCOUNTANT |
| `DELETE_EXPENSE` | SUPER_ADMIN, ADMIN |
| `WITHDRAW_PROFIT` | SUPER_ADMIN, ADMIN |
| `MANAGE_EXPENSE_CATEGORIES` | SUPER_ADMIN, ADMIN |

`WITHDRAW_PROFIT` is the narrowest and is deliberately **not** implied by `CREATE_EXPENSE`: a manager who may pay the electricity bill has no business taking the owner's earnings out of the till. The page renders two separate buttons rather than one form with a kind dropdown, so without the key the option isn't visible at all.

`VIEW_EXPENSES` is **server-enforced on the list endpoint**, unlike the read-open stance on `/api/reports/*` and `GET /api/accounts` (see the header comment in `lib/authz.ts`). Staff salaries and owner drawings are exactly the figures a shop wants off the shared counter terminal — the same reasoning as `VIEW_ACCOUNT_LEDGER`, one step further.

The sidebar entry is the second nav item gated on the matrix (`permission` field on `NAV_ITEMS`) rather than a hardcoded `roles` array.

## Translations

`lib/translations/expenses.ts` (`expenses_*`, en + ur), merged in `lib/translations.ts`. The dashboard's new tiles use `dash_grossProfit` / `dash_expenses` / `dash_netProfit` / `dash_afterCosts` / `dash_netProfitNote` in the base dictionary.

## Not covered

- **No recurring costs.** A monthly salary or rent is entered each month by hand. A `recurring` flag plus a generator is the obvious next step and is not here.
- **No per-category report.** The page filters by category and exports CSV, but there is no "spend by category" breakdown or chart. `GET /api/expenses` returns the rows a caller would need to build one.
- **Reports page untouched.** Cost figures reach the Dashboard's Sales & Profit panel only; the Reports page's five tabs have no Expenses tab.
- **Nothing in the Ledger page.** Expenses have no party, so they do not appear in any party statement — only in the account statements.
- **No unit tests.** See [testing.md](testing.md) for what is and isn't covered; the arithmetic worth testing here is `getExpenseTotals`'s accrual split and `netProfit`'s exclusion of withdrawals.
- **No pagination.** A wide date range fetches every row, same as the account statement.
