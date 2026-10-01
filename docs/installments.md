# Installments (customer credit repayment plans)

> Added in **Phase 5** (customer side) and extended in **Phase 6** (vendor side). Both are live: a plan hangs off either a `SaleInvoice` or a `GRN` and shares one generator, one ops layer and one collect endpoint.

## The money logic — `lib/installments.ts`

Pure, no Prisma import, so it can be unit-tested directly in Phase 9 (and so the checkout screen can preview the exact schedule the server will write, from the same function).

- **`generateInstallmentSchedule({ principal, kind, periods, startDate, promiseDays })`**
  - `PROMISE_DAY` → always a single row due `startDate + promiseDays` (period count forced to 1).
  - `WEEKLY` → `periods` rows at `startDate + 7×seq`; `MONTHLY` → `startDate + seq` months. `seq` is 1-based, so the first installment falls a whole period *after* the sale, not on the day of it.
  - Month arithmetic **clamps** rather than overflowing: one month on from Jan 31 is Feb 28/29, not the Mar 3 a naive `setMonth` gives.
  - Per-installment amount is `floor(principal/periods)` to the paisa and **the last row absorbs the remainder**, so the schedule always sums to exactly the principal — 1000 over 3 is `333.33 + 333.33 + 333.34`, never `999.99`. Verified end-to-end.
- **`outstandingForPlan({ netBill, creditApplied, paidNow })`** → `max(0, netBill − creditApplied − paidNow)`. Only the shortfall is financed; credit and counter payments are already settled.
- **`applyCollectionToInstallments(rows, amount)`** → the cascade. Fills rows in `seq` order, marking each `PAID` or `PARTIAL`, and returns `leftover` for anything past the last row. Overpayment cascades **by design** (a customer clearing two installments, or the whole plan, at once is an everyday case) rather than being rejected.
- **`isOverdue(dueDate, status)`** → compared against the start of today, so something due *today* is not yet late.

## Prisma glue — `lib/repayment-plan.ts`

> Renamed from `lib/sale-plan.ts` in Phase 6, when it stopped being sales-only. `buildInvoicePlanOps` became `buildPlanOps`, and both it and `buildPlanTeardownOps` take a `PlanOwner` — `{ invoiceId }` or `{ grnId }`.

- **`validateRepaymentPlan({ repaymentType, installmentPeriods, promiseDays })`** — normalises the checkout selector into what gets stored, or an error for a 400. `PROMISE_DAY` requires `promiseDays > 0`; `WEEKLY`/`MONTHLY` require `periods` in 1…120 (the cap stops a typo like 9999 from writing 9999 rows).
- **`buildPlanOps(...)`** — the `InstallmentPlan.create` op with its schedule nested, or `[]` when there is nothing to finance (no repayment type, or the document already fully settled). Returned as an array so callers just spread it.
- **`buildPlanTeardownOps({ invoiceId } | { grnId })`** — used by invoice void/delete and GRN edit/delete. Any money already collected **stays put**: the `Recovery` rows, their party `LedgerEntry` and their `AccountEntry` are real movements of real cash and are not reversed. Only the `AccountEntry.installmentId` / `Installment.recoveryId` links are cleared, because the FK would otherwise block the delete. Installment rows go via the schema's `onDelete: Cascade` on `planId`.

## Where plans get created

`POST /api/sales` calls `validateRepaymentPlan` alongside the credit guard, stores `repaymentType`/`installmentPeriods` on the invoice, and pushes `buildPlanOps(...)` into the same `$transaction([...])` as the invoice, ledger and account entries.

**Void / restore / delete** (`app/api/sales/[id]/route.ts`):
- Void → `buildPlanTeardownOps` (the debt was just reversed, so the schedule goes with it).
- Restore → the plan is regenerated from the invoice's own stored settings, the same way the ledger and account entries are rebuilt. **Known limitation**: collections taken before the void are not re-applied to the fresh schedule — that money stays on the party's ledger as a recovery, so their *balance* is still correct, but the new schedule starts from zero paid. Verified.
- Delete → teardown must precede the invoice delete (`InstallmentPlan.invoiceId` is an FK).

## Settlement ops are now shared — `lib/accounts.ts`

Before Phase 5, `POST /api/ledger/recovery` and `POST /api/ledger/payment` moved the party ledger but **never touched a cash/bank balance**, and wrote a dead free-text `bankName` (the same bug pattern Phase 2 fixed on the sales screen). Both now go through:

- **`resolveSettlementAccount(branchId, paymentMethod, accountId)`** — `CASH` resolves to the branch's lazily-provisioned cash account (any `accountId` sent with it is ignored); `BANK` requires a real, active bank account in that branch.
- **`buildSettlementOps({ kind, id, ... , installmentId?, invoiceId? })`** — the `Recovery`|`Payment` row + the party `LedgerEntry` (`RECEIPT` credit for money in, `PAYMENT` debit for money out) + the `AccountEntry` (debit into the account for a recovery, credit out for a payment). Passing `installmentId` only re-types the account entry to `INSTALLMENT_COLLECTION` and links it back.

  Phase 7 added two things here. The ledger row now carries `recoveryId`/`paymentId`, so a settlement can be reversed exactly instead of by matching its reference string. And `invoiceId` lands on the `Recovery` row only — **never** on the ledger or account entry, because invoice void/restore/delete clear those two tables by `invoiceId` and would erase the effects of money that really changed hands. The collect endpoint passes `plan.invoiceId`, which is what lets the sales list show an invoice as PAID once its installments are collected.

All three routes (recovery, payment, installment collect) use it, so a manual recovery and an installment collection can't drift apart in what they post.

**API contract change**: recovery/payment POST now take `accountId` instead of `bankName`. `Recovery.bankName`/`Payment.bankName` stay in the schema for historical reads; nothing writes them.

## `GET /api/ledger/installments`

`?branchId=&status=open|overdue|all&partyId=&side=sales|purchase|all`

Flat list across every plan in a branch, due-date ascending, with `remaining`, an `isOverdue` flag, and a `summary` (`count`, `totalRemaining`, `overdueCount`, `overdueRemaining`). `status=open` (default) means PENDING or PARTIAL. `plan.side` is `"sales"` (attached to a `SaleInvoice`, collected as a Recovery) or `"purchase"` (attached to a `GRN`, settled as a Payment).

## `POST /api/ledger/installments/collect`

Body: `{ installmentId, amount, paymentMethod: "CASH"|"BANK", accountId?, notes?, date? }`

One `$transaction` covering the installment row updates, the Recovery/Payment, the party ledger entry and the account entry. The cascade set is **the clicked installment plus every later unpaid one** — earlier unpaid installments are deliberately left alone, since the cashier picked this row. Rejects a zero/negative amount, an already-`PAID` installment, and `BANK` without a valid bank account; 404s an unknown installment.

Response carries `applied[]` (which rows absorbed how much, and their new status) and `leftover`.

## Interaction with the sales list's Mark Paid (Phase 7)

`POST /api/sales/[id]/payment` settles an invoice as a whole and so cascades from **seq 1**, not from a clicked row, and its `Recovery` has no `installmentId` on its account entry. That absence is exactly what distinguishes a Mark Paid settlement from a collection taken here — Mark Unpaid reverses only the former, and refuses when an invoice was settled from this tab instead.

Because the schedule doesn't record which settlement contributed what, Mark Unpaid rebuilds it by **replay**: `buildPlanReplayOps` in `lib/repayment-plan.ts` resets every row and re-applies each surviving `INSTALLMENT_COLLECTION` account entry (which carries both the amount and the row it was booked against) through the same cascade, in date order. A row part-paid here and then finished off by Mark Paid therefore returns to its part-paid state rather than being zeroed. There is still no undo for a collection taken in this tab. See [orders.md](orders.md).

## UI

### Checkout (`app/dashboard/sales/page.tsx`)

An amber **Repayment** panel appears below Change, but only while `outstandingAfterPayment > 0` (net bill minus credit applied minus card/cash/bank). It shows the balance owed, a `None / Promise Day / Weekly / Monthly` selector, a period count (defaulted to 3 on first pick of Weekly/Monthly so the field is never a dead end), a Promise Days input for `PROMISE_DAY`, and a live schedule preview (`3 × Rs. 333.33 — first due …, last …`) computed from `generateInstallmentSchedule` itself.

`effectiveRepaymentType` pins the posted value to `NONE` whenever nothing is left owing, so a selection made before the customer decided to pay in full can't be posted and rejected with no schedule to build. `repaymentType`/`installmentPeriods` participate in draft persistence, hold/resume and `clearForm`.

### Ledger → Installments tab (`app/dashboard/ledger/page.tsx`)

New tab between Payment and Day Book. `Open / Overdue / All` sub-filters, a summary header (total remaining + an overdue callout), and a table of due date, party, `INV-#`/`GRN-#`, plan kind with `seq/periods`, amount, paid, remaining and a status badge (overdue rows tint red and badge as Overdue). Each unpaid row has a **Collect** button (**Pay** for vendor-side plans) opening `CollectInstallmentModal`, which defaults the amount to that row's remaining, takes Cash/Bank + a bank dropdown, date and notes, warns inline when the amount exceeds the row (explaining it will cascade), and reports how many installments were settled plus any leftover. CSV export included.

`RecordForm` (the Recovery/Payment tab form) swapped its free-text bank field for the same real bank-account dropdown, matching the new API contract.

## Translations

`lib/translations/sales.ts`: `sales_balanceOwed`, `sales_repaymentLabel`, `sales_repaymentNone`/`PromiseDay`/`Weekly`/`Monthly`, `sales_installmentCount`, `sales_promiseDaysRequired`, `sales_firstDue`, `sales_lastDue`.

`lib/translations/ledger.ts`: `ledger_tabInstallments`, `ledger_instFilterOpen`/`Overdue`/`All`, `ledger_installmentsHeading`, `ledger_installmentsCounted`, `ledger_overdue`, `ledger_totalRemaining`, `ledger_dueDate`, `ledger_planColumn`, `ledger_paidColumn`, `ledger_remainingColumn`, `ledger_noInstallments`, `ledger_planPromiseDay`/`Weekly`/`Monthly`, `ledger_status`, `ledger_statusPaid`/`Partial`/`Pending`, `ledger_collect`, `ledger_pay`, `ledger_collectInstallment`, `ledger_payInstallment`, `ledger_installmentSeq`, `ledger_dueOn`, `ledger_recordCollection`, `ledger_recordPayment`, `ledger_collectionRecorded`, `ledger_installmentsSettled`, `ledger_leftoverOnAccount`, `ledger_overpaymentCascades`, `ledger_bankAccount`, `ledger_selectBankAccount`, `ledger_noBankAccounts` (all with Urdu). `ledger_bankName`/`ledger_bankNamePlaceholder` are now unused.

## Vendor side (Phase 6)

`POST`/`PUT /api/purchases` do what the sales route does: `validateRepaymentPlan`, store `repaymentType`/`installmentPeriods`/`promiseDays` on the GRN, then push `buildPlanOps({ grnId, ... })` into the same transaction. The principal financed is `netBill − paidNow`, so paying part of the bill at receipt shrinks the schedule.

Collecting on a vendor plan goes through the *same* `POST /api/ledger/installments/collect`: the endpoint sees `plan.grnId` and books a `Payment` (money out of cash/bank, debit on the vendor ledger) instead of a `Recovery`. The Installments tab labels the button **Pay** rather than **Collect** for those rows. Verified end-to-end. See [purchases-grn.md](purchases-grn.md).

## `summarizePlan` — a plan as one line

`summarizePlan({ kind, periods, installments })` in `lib/installments.ts`
(pure) reduces a plan to `{ kind, periods, remaining, paidCount, nextDueDate,
nextDueAmount, nextOverdue, overdueCount }`. It sorts by `seq` itself, so query
order can't change the answer.

It exists for the screens that list a **bill** rather than a schedule, and is
shared by `GET /api/reports/sales` and `GET /api/reports/purchases` so an
invoice's badge and a GRN's badge can't come to mean different things. Rendered
by `PlanChip` in `components/reports/list-ui.tsx` — kind, `paidCount/periods`,
and the next due date, turning red once that date has passed. It replaced a
plain "Installments" chip that only said a plan existed.

## Where a plan is visible

- **Ledger → Installments** — the full schedule, the collect action, and
  (new) a **Both / Customer / Vendor** side filter plus a per-row side badge.
- **Ledger → Ledger** — a repayment strip above the selected party's statement.
- **Reports → Sales** and **Purchases → GRN Records** — a `PlanChip` per row.
- **Checkout / GRN form** — the amber Repayment panel, while the bill is still
  unsettled, with a live schedule preview.

The plan-kind labels are the `ledger_plan*` translation keys everywhere, so all
of these name the arrangement identically.
