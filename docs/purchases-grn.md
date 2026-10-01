# Purchases / GRN (Goods Receipt Note)

> **Updated in Phase 6 of the payment/accounts overhaul.** Payment capture, the two ledger bugs and vendor installments below are all now built; the "big gap" and "dead type" sections have been rewritten to say what actually happens.

Main file: `app/dashboard/purchases/page.tsx` (tabs: `grn`, `records` and `inventory`). Vendors are `Party` records with `type = VENDOR` — there is no separate Vendor model (`prisma/schema.prisma:24-28`, `PartyType = CASH|CREDIT|VENDOR`).

## The GRN picker (left panel)

The 224px column down the left of the `grn` tab: a search box, a **date-range
dropdown**, and one row per GRN that loads it into the form on click.

The dropdown is the shared `DateRangePreset` set (today / yesterday / last 7
days / this month / last month / last 30 days / this year / last year / all /
custom), backed by `getDateRangeForPreset` in `lib/utils.ts` — the same presets
the reports, accounts and expenses screens offer. It is **one `<select>` rather
than a row of buttons** because the column is 224px wide and already carries a
search box, and the two date inputs render only under `custom`, so the common
ranges cost no vertical space at all.

`from`/`to` go to `GET /api/purchases`, which gained inclusive whole-day date
filtering for it (`to` is pushed to 23:59:59.999, matching the report routes).
The default is **`all`** — that is what the list did before it had a filter, and
defaulting to a narrow range would hide the older GRN somebody came here to
open. The list still takes 80 rows and still orders by `createdAt`, while
filtering on `date`.

## Current GRN form

Header: date, GRN No (auto), Bill No (vendor's own ref), Vendor picker, Remarks. Each line carries a **PUR/RET toggle** (`isReturn`) — a purchase GRN can still mix RET rows in, as a negative line inside the same GRN. Summary: discount %, adjustment, purchase amount, return amount, `netBill = billAmount - returnAmount` (not clamped — see the ledger fix below).

### Purchase Return GRN

**New Return** in the toolbar opens a return document: `GRN.isReturn = true` (migration `20260929100000_grn_return_flag`), an
orange banner, and every row is RET (the PUR button is disabled). Totals,
ledger and payment are the existing net-return path — `netBill < 0` books a
`PURCHASE_RETURN` and the payment fields relabel to Refund. What `isReturn` adds
is that the document *is* a return: the form reopens in return mode, the picker
list badges it, and the ledger note says "Purchase Return GRN". The migration
marks an existing GRN made only of return lines as one. Save stays in the same
mode, so returns can be entered one after another.

### Vendor picker

- **Searched on the server** (`/api/parties?type=VENDOR&q=`, 250 ms debounce). It
  used to load the first 200 vendors once and filter them in the browser, so
  vendor 201 onward could never be found. `q` now also matches the account no.
  exactly when it is numeric.
- **Add a vendor from the GRN** — the person icon beside the field, or the "Add
  as a new vendor: <typed>" row at the bottom of the search, both gated on
  `ADD_PARTY`. `PartyFormModal` gained `defaultType` / `defaultName` for it; the
  saved vendor is selected straight away.
- **Edit the selected vendor** — the pencil beside the field (`EDIT_PARTY`), the
  same `PartyFormModal` edit mode the sales screen uses for customers.
  `loadGrn()` now keeps the full `party` row from `GET /api/purchases/:id` so a
  reopened GRN's vendor can be edited too.

## Payment capture at receipt time (Phase 6)

The GRN summary now carries a **Payment** block — the purchase-side mirror of the sales screen's:

- `paymentMethod`: `LEND | CASH | BANK | CASH_AND_BANK`. `LEND` is the default and means the whole bill goes on vendor credit (the old, only, implicit behaviour). Switching method clears whichever amount fell out of scope.
- `cashAmount` / `bankAmount` + a real bank-account dropdown (`bankAccountId`), posting to the branch's Cash/Bank `Account` via `buildGrnAccountEntryOps` (`lib/accounts.ts`).
- On a net-return GRN the same two fields relabel to **Refund (Cash)** / **Refund (Bank)** — money coming back *from* the vendor.

Server-side `validateGrnPayment` (`lib/accounts.ts`) normalises and rejects: `LEND` forces both amounts to zero rather than trusting a stale hidden field; a bank amount with no account selected is a 400 (it would otherwise be recorded as paid but appear in no account balance); paying more than the bill is a 400.

### Vendor installment plans

Below the payment block, when anything is still owed, a **Repayment** selector (`None | Promise Day | Weekly | Monthly` + period count / promise days) with a live schedule preview. It generates an `InstallmentPlan` hanging off `grnId`, using the *same* `lib/installments.ts` generator, the same `lib/repayment-plan.ts` ops and the same `POST /api/ledger/installments/collect` endpoint as the customer side — a vendor-side collection just books a `Payment` (money out) instead of a `Recovery`. See [installments.md](installments.md).

The plan finances only `netBill − paidNow`, so paying part of the bill at receipt shrinks the schedule accordingly.

### Edit / delete

`PUT` re-derives the whole money side from the new amounts: it now deletes the GRN's `AccountEntry` rows and tears down its installment plan alongside the existing ledger-entry delete, then rebuilds all three. `DELETE` does the same teardown before removing the GRN (`InstallmentPlan.grnId` is an FK). Installment payments already made are never reversed — see `buildPlanTeardownOps`.

### Barcode scanning (shared with the sales screen)

The scan field, the lookup and the unknown-code chooser all live in
`components/items/BarcodeScanner.tsx`, mounted by **both** the GRN line-items
footer and the sales screen's Add-Row bar. The GRN page only supplies
`onItem`, which decides where a resolved scan lands. A USB scanner types the
code and sends Enter (some models send Tab), so it is a plain input with a
key handler - no driver or library.

On scan:

- **Exact barcode match** -> `onItem`. On the GRN that bumps the quantity if
  the item is already a purchase line, else fills the first blank row. Only an
  *exact* `barcode` equality counts: `/api/items?search=` also does partial
  name/brand matching, which must never silently pick a different item than
  the one in the operator's hand. An empty-string barcode (three items in this
  database carry `""`) is falsy and so never matches.
- **No match** -> a chooser opens, because most of this catalogue has no
  barcode yet:
  - *Attach it to an existing item* - searches by name, `PUT /api/items/[id]`
    writes the code, then the item is handed to `onItem`. This is the common
    case and it's the default-looking path on purpose; creating a second copy
    of an item that already exists would be the wrong default. An item that
    already carries a different code is flagged as "replaces its code" rather
    than being silently re-tagged.
  - *Create a new item with this barcode* - opens `ItemFormModal` with
    `defaultBarcode` pre-filling the code; the saved item goes straight to
    `onItem`.

`Item.barcode` is indexed but **not unique**, so duplicate codes are possible
in principle; the lookup takes the first exact match in name order.

**`globalCapture`** (on for both pages) also picks up a scan typed while focus
is outside any field, by buffering keystrokes that arrive faster than
`SCAN_KEY_GAP_MS` (120ms) apart and treating the Enter that follows >= 4 of
them as a scan. Without it a scan is simply lost unless the operator first
clicks the box - which on the sales screen, where six rows of inputs compete
for focus, is most of the time. Keystrokes are ignored outright whenever an
`INPUT`/`TEXTAREA`/`SELECT`/contenteditable holds focus, so it can never eat
ordinary typing.

Registering a barcode in the first place is done in `ItemFormModal`: its
barcode field is a font-mono input with a scan hint, and it swallows the
Enter/Tab a scanner sends afterwards so the code can't move focus or submit
the form mid-entry.

### Two places to scan, and where the cursor goes

The dedicated box is the deliberate target, but the cursor normally sits in a
row's **item box**, so that box takes scans too. Enter (or Tab) there resolves
in this order:

1. An **exact barcode** among the already-loaded search results - it always
   beats a partial name match, per the rule above.
2. A **detected scan** -> the code goes to the scanner via its imperative
   `scan(code, token)` handle, so the match / attach / create rules exist once,
   not twice.
3. Otherwise the **first search result** (Enter previously did nothing here).

Step 2 has to tell a scanned code from a name typed faster than the 200ms
search debounce can answer. `wasRowScan` requires the box's *entire* contents
to have arrived as one burst with no gap longer than `SCAN_KEY_GAP_MS`, and to
be at least `MIN_SCAN_LENGTH` characters - a fast typist finishing a word does
not qualify, because their earlier keystrokes broke the burst. Tab is only
intercepted when it *is* a scan; otherwise it keeps moving focus normally.

`focusRowAfter(rowId)` then moves the cursor to the item box on the following
row, appending one when the GRN has run out, so a run of scans walks straight
down the document with no mouse. It fires after `selectItemForLine` and after a
scan that came from a row box - but **not** after one made in the dedicated
box, which keeps the cursor so the next scan can follow immediately. The
scanner tells the two apart with the `token` it echoes back to `onItem`: a row
box passes its row id, the dedicated box passes nothing. The token survives a
detour through the "not recognised" chooser, so a cancelled chooser leaves no
stale origin behind.

All of this - the burst detection, the input refs and the cursor walk - is
`lib/use-row-scan-flow.ts`, shared verbatim with the sales screen. The two
pages differ only in what they do with the resolved item.

### Adding an item without leaving the GRN

Two entry points, both gated on `ADD_ITEM` and both routed through
`openAddItem(name?)` -> `ItemFormModal` -> `handleItemCreated`, which drops the
saved item straight onto the GRN:

- An **Add New Item** button in the line-items footer.
- An **"Add as a new item: <typed text>"** row at the bottom of the item-search
  results, which pre-fills the form's name via the modal's `defaultName` prop.
  This is the case the screen previously had no answer for - receiving stock
  for something not yet catalogued meant leaving the half-built GRN.

### The item-search dropdown was clipped

The per-row results list used to be `absolute` inside the row's `<td>`, which
put it inside the items table wrapper's `overflow-hidden` - so it was clipped
to roughly one row's height and everything below the first result was
invisible. It is now rendered outside the table as a `fixed z-[100]` popup
positioned from the input's `getBoundingClientRect()`, the same approach the
sales screen already used. It closes on outside click, and on scroll/resize
rather than floating over the wrong row.

## GRN Records tab

`components/purchases/GrnRecordsTab.tsx` — every received bill as a record you
can filter, read and open. The purchase-side counterpart of the sales list in
Reports → Sales, built from the same pieces so a GRN and an invoice read the
same way when both are open.

The picker above answers "which GRN do I want to edit". This answers a different
question — what did we buy in this period, from whom, and what do we still owe
on it — and needs a full table for it.

**Mounted in two places, deliberately the same component:** the Purchases
screen's `records` tab, and **Reports → Purchases** (`app/dashboard/reports/page.tsx`),
which used to be a seven-column table with no payment side and no way to open a
GRN. Keeping a second, thinner GRN list in step with the first was never going
to happen, so there is now only one. The Reports mount passes no `onEditGrn`, so
**Open in GRN Form** is simply absent there — there is no form on that page to
open one into. Reports' `loadForTab` map is `Partial` as a result: the purchases
tab now does its own fetching.

- **Filters** — date-range preset + from/to, payment status (PAID/PARTIAL/UNPAID,
  applied server-side on the *computed* status), and a free-text box matching
  vendor / GRN no / bill no / account id. The text box stays client-side and
  fires no request, exactly as the sales list's does. No Load button: the loader
  is a `useCallback` keyed on its own filter state, refetched on change with a
  250 ms debounce.
- **Totals** — GRN count, sale amount, returns, net bill, paid, outstanding.
- **Rows** — a table from `md` up (columns drop out in a fixed order: items at
  `lg`, bill no at `xl`) and one card per GRN below it. Everything a hidden
  column carried reappears in the expander. Actions are pinned `sticky right-0`
  inside the `overflow-x-auto` wrapper.
- **Expander** — the line items (marked **P**/**R**, the GRN form's own two
  marks) with the money breakdown under them, capped and right-aligned. The
  breakdown derives the discount amount from `saleAmount × discountPct` because
  the GRN stores only the percentage and `billAmount` already has it folded in.
- **Actions** — **GRN Detail** (always first, never withdrawn: reading isn't
  gated), **Open in GRN Form** (`EDIT_GRN`, Purchases screen only — switches tab
  and loads the GRN in one step), **Delete** (`DELETE_GRN`).
- **CSV export** carries the whole money side, including Cash Paid / Bank Paid /
  Paid Since / Total Paid / Outstanding.

### What "paid" means on a GRN — and the one gap

`lib/grn-settlement.ts` is the purchase-side mirror of `lib/invoice-settlement.ts`:
pure, no Prisma import, unit-tested in `tests/grn-settlement.test.ts`, and shared
by `GET /api/reports/purchases` and `GET /api/purchases/:id` so the badge in the
list and the figure on the printed GRN can't drift.

```
settled     = cashPaid + bankPaid + collected
outstanding = max(0, netBill − settled)     // 0 for a net-return GRN
status      = netBill <= 0 || outstanding ≈ 0 ? PAID : settled > 0 ? PARTIAL : UNPAID
```

`collected` is the sum of `Installment.paidAmount` on the plan hanging off this
GRN's `grnId`.

**The gap, and it is deliberate:** a vendor `Payment` carries no `grnId` — there
is no purchase-side equivalent of `Recovery.invoiceId` (see docs/orders.md's
schema note). So a payment made from the Ledger page against the vendor's
balance *as a whole* is not attributable to one bill and is not counted. A LEND
GRN with no repayment plan therefore stays **UNPAID** until it is paid through
one. The vendor's *balance* is right either way; it is only the per-bill
attribution that is missing. Closing it properly means a `Payment.grnId` column
and a Mark Paid action on the purchase side, mirroring Phase 7 — not done.

### `GET /api/reports/purchases`

Rewritten for this list. It now carries `id` (there was no way to link to a GRN
before), the vendor's id, `receivedBy`, the line items, the whole payment side
(`paymentMethod`, `cashPaid`, `bankPaid`, `bankAccountName`, `collected`,
`settled`, `outstanding`, `paymentStatus`, `hasPlan`) and a `paymentStatus`
query filter. `billNo` is now `""` rather than `"—"` when absent — the dash is
the UI's business.

`totals.paid` is **signed by `netBill`**, for the same reason the sales report
signs its cash total: on a net-return GRN `cashAmount`/`bankAmount` are money
coming back *from* the vendor, so summing them raw reported a refund as a
payment made. Filters are applied before totals, matching the sales route.

## GRN detail page

`app/dashboard/purchases/[id]/page.tsx`, reached from a row's **GRN Detail**
action or by clicking its GRN number — both built by `grnHref()` so the two
can't diverge, the same rule as `invoiceHref()` on the sales side. Both live in
`lib/document-links.ts`, because the Ledger page links to the same two pages.

A page rather than a modal, for the reasons set out in docs/orders.md: a
received bill deserves a URL that can be linked, bookmarked, opened in a second
tab and walked back through with Back, and a document this tall shouldn't scroll
inside a box that is itself scrolling the list behind it.

| File | Holds |
| --- | --- |
| `components/purchases/grn-detail.ts` | the `GRNDetail` type and the `useGrnDetail()` fetch hook |
| `components/purchases/GRNDocument.tsx` | the A5/A4 paper — the same markup on screen as on paper |

**Two prints, not three.** There is no counter slip for a purchase, so A5 and A4
of the document is the whole of it. Still one `useReactToPrint` handler per paper
size, because the hook closes over the `pageStyle` it was given.

**Not to be confused with `GRNPrintModal`**, which prints the GRN *being
entered* from the form's own state — that one has no saved id, no vendor balance
and no payment history to show, so it stays as it is.

What the document holds, in order: store header and a **GOODS RECEIPT NOTE** /
**PURCHASE RETURN NOTE** title chosen by `netBill < 0` (the same test the ledger
split uses to write `PURCHASE_RETURN`); GRN meta (no, date + time, bill no,
received by, payment method + bank account) with the status chips the list row
carries; the vendor block with **previous and closing balance as at this GRN**;
received and returned lines in separate tables with unit, qty, cost rate, sale
rate, Dis % and amount; the quantity totals; the bill (sale amount → discount →
adjustment → returns → **net bill**) beside the payment (cash, bank, paid since,
total paid, outstanding); the payments made against the bill since; the
repayment schedule; remarks; and the store's footer terms.

**The balance is replayed, not aggregated** — the same mechanism, and the same
caveats, as `GET /api/sales/:id` (see docs/orders.md). `GET /api/purchases/:id`
reads the vendor's `LedgerEntry` rows, orders them by `(date, createdAt)` and
splits at this GRN's own first row. Two differences from the sales side are worth
knowing:

- It anchors on `LedgerEntry.grnId`. A GRN with no ledger row of its own — a
  zero-value bill with nothing paid writes none — falls back to its date.
- The delta is **`credit − debit`**, the opposite way round, because a vendor
  balance is a payable: a purchase writes `credit: netBill`, so this way a
  positive figure means "we owe the vendor this much" and the document prints it
  under that label with no sign flip. It is the same figure the rest of the app
  shows for a vendor, just without the `Math.abs()` that
  `GET /api/ledger/outstanding` applies to its `opening + debit − credit`.
  `Party.previousBalance` is already CR for a vendor, so it adds in directly.

`GET /api/purchases/:id` **also still spreads every raw GRN column at the top
level**, because the GRN form's own `loadGrn()` reads them — the detail blocks
(`vendor`, `lines`, `totals`, `payment`, `payments`, `plan`) are additive. One
fetch serves both, so the form and the document can't drift on what a field
means. Only the blocks are typed in `grn-detail.ts`: the raw columns arrive as
Prisma `Decimal` strings, and the blocks are the `Number()`-converted ones a
document should read.

Also on the document: `payments` is **one row per `Payment`, not per
installment** — a single payment can settle several installments at once
(`applyCollectionToInstallments` walks the schedule from seq 1), and what the
paper lists is the money that moved.

## Shared list primitives

`components/reports/list-ui.tsx` — `DateFilter`, `TotalCard`, `Money`, `Chip`,
`MoneyGroup`, `shownParts`, `DATE_PRESETS`, `applyDatePreset`,
`usePresetLabels`, `today`, `monthStart`.

These were private helpers inside `app/dashboard/reports/page.tsx`. They moved
out when the GRN Records list needed the same ones. The reasoning is the same as
for reusing the tab itself: two lists of documents rendering money and status
differently is exactly the drift the sales table already had to be rescued from
(`Rs.` wrapping onto two lines, two adjacent status columns saying the same
thing — see docs/orders.md), and copying them would have re-introduced it on the
purchase side. `app/dashboard/reports/page.tsx` now imports them; the accounts
and expenses pages still carry their own `DATE_PRESETS` copies and were left
alone.

## Vendor balance mechanism

Identical to customer balance (see `sales-checkout.md`) — `Party.previousBalance` (opening) + Σ `LedgerEntry` — just opposite sign interpretation (`credit` increases payable instead of receivable). Confirmed in `app/api/ledger/outstanding/route.ts:11,22,61-79` (`type=payable` for VENDOR parties).

### Ledger-entry bug on purchases — FIXED in Phase 6
Both routes used to write the vendor `LedgerEntry` only `if (netBill > 0)`, and the page clamped `netBill` with `Math.max(0, ...)`. Together that meant a GRN returning more than it received wrote **no ledger entry at all** and the payable silently never moved. Fixed on all three fronts: the clamp is gone (a net-return GRN now really does carry a negative `netBill`), and both `POST` and `PUT` branch on `netBill !== 0 || paidNow > 0`.

### `PURCHASE_RETURN` is now actually written
`computePurchaseLedgerSplit(netBill, paidNow)` in `lib/utils.ts` decides the row:

- `netBill >= 0` → `type: PURCHASE`, `credit: netBill` (we now owe it), `debit: paidNow` (handed over at receipt).
- `netBill < 0` → `type: PURCHASE_RETURN`, `debit: -netBill` (the vendor owes us the returned value), `credit: paidNow` (any refund they handed back, settling that claim toward zero).

Both columns stay positive — the direction is carried by the type, not by a negative amount. `PURCHASE_RETURN` was a defined-but-never-written enum value before this; the Ledger page already had a label for it. Verified end-to-end: a 500 net-return with no refund moves the vendor balance +500; with a 200 cash refund it moves +300 and cash rises 200.

The matching `AccountEntry` types are `PURCHASE_PAYMENT` (credit, money out) and `PURCHASE_REFUND` (debit, money in), chosen off the same signed `netBill`.

## `promiseDays`

- `Party.promiseDays Int?` — still **dead**: never read or written anywhere. Not repurposed; per-document promise days won out, matching `SaleInvoice.promiseDays`'s existing pattern.
- `SaleInvoice.promiseDays` / `GRN.promiseDays` — both now feed a real `PROMISE_DAY` installment plan (a single row due that many days out) instead of being decorative.

## Stock + pricing side effects on save

`app/api/purchases/route.ts:90-111` — `itemStock.upsert` with signed `delta` (+qty purchase, -qty return); the item's `purchasePrice`/`salePrice` are overwritten to the latest GRN's rate with no price history kept. DELETE (`app/api/purchases/[id]/route.ts:145`) reverses stock and removes that GRN's ledger entries.

## Translations

`lib/translations/purchases.ts` — the pre-existing `purchases_vendor`, `purchases_netBill`, `purchases_saleAmount`, `purchases_returnAmount`, `purchases_pur`/`purchases_ret`, plus Phase 6's payment/repayment/scan vocabulary: `purchases_paymentMethod`, `purchases_payLend`/`payCash`/`payBank`/`payBoth`, `purchases_cashPaid`/`bankPaid`, `purchases_bank`, `purchases_selectBankAccount`, `purchases_bankAccountRequired`, `purchases_noBankAccounts`, `purchases_refundDue`/`refundCash`/`refundBank`, `purchases_overpaidError`, `purchases_balanceOwed`, `purchases_repayment`, `purchases_repaymentNone`/`PromiseDay`/`Weekly`/`Monthly`, `purchases_installmentCount`, `purchases_promiseDays`, `purchases_promiseDaysRequired`, `purchases_firstDue` (all with Urdu).

The scan vocabulary moved out of this file when the scanner became shared: it now lives in `lib/translations/items.ts` under a `scan_*` prefix (`scan_placeholder`, `scan_failed`, `scan_unknownBarcode`, `scan_attachToExisting`, `scan_searchItemPlaceholder`, `scan_noItemsFound`, `scan_willReplaceBarcode`, `scan_attached`, `scan_attachFailed`, `scan_createNewItem`, `scan_addAsNewItem`), alongside `items_barcodeScanHint`. The old `purchases_scan*` / `purchases_*Barcode*` keys were deleted rather than left as dead duplicates.

## Still open

- The item's `purchasePrice`/`salePrice` are still overwritten to the latest GRN's rate with **no price history** (`app/api/purchases/route.ts`). Untouched by Phase 6.
- A GRN has no void/restore, only edit and delete — unlike a `SaleInvoice`, which has `InvoiceStatus`. So the Records list has no record-status filter, only a payment-status one.
- **A vendor payment can't be attributed to one GRN** (`Payment` has no `grnId`), so a LEND GRN with no repayment plan reads UNPAID for ever even after the vendor has been paid off the ledger. See "What 'paid' means on a GRN" above; the fix is a `Payment.grnId` column plus a purchase-side Mark Paid.
- **No Mark Paid / Mark Unpaid on a GRN**, and so no purchase-side mirror of `POST /api/sales/:id/payment`. Money is paid to a vendor from the Ledger page or through an installment collection.

## Recent fixes

### "Sale Amount" was the purchase subtotal

The GRN summary, the printed GRN document and the GRN Records breakdown all
labelled the value of goods received with `purchases_saleAmount` ("Sale
Amount"). Renamed to `purchases_purchaseAmount` ("Purchase Amount") in all
three. The `saleRate` **column** in the line grid is untouched — that one
genuinely is the retail price being set on the item.

### A second Save button

Below the payment fields in the right-hand summary, alongside the existing
toolbar Save — where the cursor already is after typing the amounts. Same
`handleSave()`, same `EDIT_GRN`/`CREATE_GRN` permission gate.

### `promiseDays` is not dead

Earlier notes in this file call it dead. It is wired: the GRN form posts it, and
`validateRepaymentPlan` / `buildPlanOps` use it to date a `PROMISE_DAY`
schedule. Same on the sales side.

### Vendor payments now attach to a GRN

`Payment.grnId` (migration `20260911000000_payment_grn_link`) closed the gap
this file and `lib/grn-settlement.ts` used to describe: an ad-hoc vendor payment
moved the vendor's balance but belonged to no bill, so a GRN with no repayment
plan read UNPAID however much had been paid out. The Ledger page's Payment tab
now allocates across a vendor's open GRNs, and `GrnSettlement.paid` counts it.
See [ledger.md](ledger.md).

## Buy Unit / Sell Unit — the conversion lives here

Each GRN line now carries **two** unit dropdowns instead of the old read-only
Unit cell:

- **Buy Unit** — what the vendor billed in. `qty`, `costRate` and `amount` stay
  in it, untouched, because the GRN has to reconcile against the bill in the
  vendor's own terms.
- **Sell Unit** — what the goods will be sold in, and therefore the unit their
  stock will be held in from this receipt on. Shown amber when it differs from
  the item's current unit, because that receipt re-labels stock already on hand.

Both default from the item and are limited to its family, so a shop buying and
selling the same way never touches them. When they differ, a sub-row under the
line spells the conversion out — `24 GAZ → 21.60 MTR · cost Rs 111.11/MTR` —
computed by the same `convertGrnLine` the server runs, so the preview cannot
drift from what gets written.

**`POST /api/purchases` is the one place in the application that converts.** It
re-derives `stockQty` and the per-sell-unit cost itself rather than trusting the
client's figures (the same discipline as the sale-totals recheck), writes
`Item.unit = sellUnit`, `Item.purchaseUnit = buyUnit`, and — the calculation
that matters most — `Item.purchasePrice = costPerSellUnit`. Writing the raw
per-gaz cost against per-metre stock would understate cost of goods by 10% on
every later sale, straight into the dashboard's profit figure.

A line that cannot be converted (cloth into pieces, a bundle with no size)
answers **400 for the whole receipt** rather than writing half of one.

Barcode labels print the **sell** unit, its sale rate, and the converted count
— one label per piece, not one per bundle. A label is read at the till.

Full mechanism, schema and the re-denomination rule: **`units.md`**.
