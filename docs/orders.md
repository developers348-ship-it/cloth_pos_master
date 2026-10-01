# Order / Sales List

No dedicated `/orders` route. The sales list is the **Reports page's "Sales" tab**: `app/dashboard/reports/page.tsx` (`activeTab === "sales"` is the default).

- Data: `GET /api/reports/sales` → `{ invoices, totals }`.
- Row type `SaleRow` (~30): `id, invoiceNo, date, partyId, partyName, accountId, cashier, partyOption, itemCount, items[], grossSale, packageDiscount, returnAmount, netBill, cashReceived, cardAmount, bankAmount, creditApplied, recovered, recoveredMarkPaid, outstanding, hasPlan, refundOfInvoiceNo, refundedByInvoiceNo, paymentStatus (PAID/PARTIAL/UNPAID), recordStatus (SAVED/HELD/VOIDED)`.
- Customer shown as `partyName` + `#{accountId}` + `cashier`, joined server-side via `party: { select: { name, accountId } }`.

## Payment status is derived, not stored

`lib/invoice-settlement.ts` (pure, no Prisma — unit-testable) is the single source of that maths, shared by the report route and the Mark Paid / Mark Unpaid endpoints:

```
settled     = creditApplied + cashReceived + cardAmount + bankAmount + recovered
outstanding = max(0, netBill − settled)     // 0 for a net-return invoice
status      = netBill <= 0 || outstanding ≈ 0 ? PAID : settled > 0 ? PARTIAL : UNPAID
```

`recovered` is the sum of `Recovery` rows carrying this invoice's `invoiceId` — money collected *after* the sale. Before Phase 7 the status came from `cashReceived + cardAmount` alone, so a bank-paid invoice, one settled with store credit, and one whose installments had all been collected each still read UNPAID.

`recoveredMarkPaid` is the part of `recovered` that Mark Unpaid may reverse: a Mark Paid recovery settles the invoice as a whole and so has no `installmentId` on its `AccountEntry`, while a collection taken in Ledger → Installments does. That single flag is what separates the two everywhere.

## Row actions

All of them live behind one **Actions ▾** dropdown per row (`components/ui/ActionMenu.tsx`, built by `salesRowActions(r)` in the page). The menu is portalled to `document.body` and positioned `fixed` off the trigger's rect — the table sits in an `overflow-x-auto` wrapper that would clip an absolutely-positioned menu — and so closes on scroll, resize, outside click and Escape. Items the role lacks the permission for are omitted, not disabled.

- **Order Detail** — always the first item, and never withdrawn: navigates to the invoice's own page, `/dashboard/invoices/<id>`. The row's **invoice number** is a `<Link>` to the same place, both built by `invoiceHref()` (`lib/document-links.ts`) so the two can't diverge. See [Order detail page](#order-detail-page).
- **Receipt** — second, also never withdrawn: prints the 80mm counter slip straight from the row, without opening the page (`components/sales/ReceiptPrintTrigger.tsx`). A customer coming back for their receipt is the everyday case, so it is one click rather than three.
- **Mark Paid** (`r.outstanding > 0`) — modal (`MarkPaidModal`) with date / amount / Cash-or-Bank / bank dropdown / notes → `POST /api/sales/:id/payment`.
- **Mark Unpaid** (`recoveredMarkPaid + cashReceived + cardAmount + bankAmount > 0`) — confirm → `DELETE /api/sales/:id/payment`. Available on a fully paid invoice, including one paid entirely at the counter.
- **Customer** — `ChangeCustomerModal`, party search → `PATCH /api/sales/:id/party`.
- **Void** — PATCH `/api/sales/:id` `{ status: "VOIDED" }`, reverses stock + deletes ledger/account entries + tears down the plan.
- **Restore** — PATCH `{ status: "SAVED" }`, reapplies them (the rebuilt schedule starts from zero paid).
- **Delete** — DELETE `/api/sales/:id`, permanent, reverses stock.
- **Refund** (`PROCESS_SALE_RETURN`, an active sale with `netBill > 0` that isn't already refunded and isn't itself a refund) — modal (`RefundModal`) with date / amount / Cash-or-Bank / bank dropdown / notes → `POST /api/sales/:id/refund`. See [Refund a whole order](#refund-a-whole-order).
- **No Edit action** — invoices still can't be edited from this list.
- **A refunded sale has no actions but Order Detail and Receipt.** Its goods are back in stock and its money handed over, both recorded on the refund invoice, so Mark Paid / Mark Unpaid / Change Customer / Void / Delete would all act on figures the refund already reversed. The row's `Refunded · #N` chip points at the document to act on instead; the way to undo a refund is to delete the refund invoice. Void and Delete refuse this server-side too, so the hidden items aren't the only guard.
- Expandable row shows line items on click (`toggleExpandSale`).
- CSV export carries Bank Amount / Store Credit / Recovered / Outstanding / Refund Of / Refunded By.

## API handlers

`app/api/sales/[id]/route.ts`:
- `GET` — one invoice in full, for the Order Detail view. Ungated (read-only, per the note in `lib/authz.ts`).
- `PATCH` — void/restore.
- `DELETE` — permanent removal.

`app/api/sales/[id]/payment/route.ts` — **Mark Paid / Mark Unpaid**:
- `POST { amount?, paymentMethod: "CASH"|"BANK", accountId?, date?, notes? }` — records a `Recovery` dated when the money actually arrived, through the same `buildSettlementOps` the Ledger page's Record Recovery and the installment collect endpoint use, so all three post identically. `amount` defaults to the whole outstanding; overpayment is a 400 (money beyond the invoice belongs on the party's ledger). Any installment schedule absorbs the money from seq 1 via `applyCollectionToInstallments`.
- `DELETE` — deletes the Mark Paid recoveries, their `LedgerEntry` (found by `recoveryId`) and their `AccountEntry`, then replays the schedule with `buildPlanReplayOps`.

  **The invoice's own `cashReceived`/`bankAmount` are deliberately never touched *by POST*.** They record what was taken at the counter on the day of the sale; adding to them would move today's cash onto the invoice's original date in the cash report and day book (`app/api/reports/cash/route.ts` groups invoice cash by `invoice.date`).

  `DELETE` is not the mirror image of that, because its meaning is "this invoice was never paid" rather than "money went back out today". On top of the recoveries it reverses, it zeroes `cashReceived`/`cardAmount`/`bankAmount`, deletes the `SALE_RECEIPT`/`SALE_REFUND` account entries (safe to key by `invoiceId` — a settlement's entries carry `recoveryId` instead, see below) and rewrites the SALE `LedgerEntry` split via `computeSaleLedgerSplit(netBill, 0)`. That day's cash report therefore changes, which is the intended effect. Either half is enough on its own to make the action available; with neither, it 400s. `creditApplied` is left consumed, so an invoice part-settled by store credit comes back `PARTIAL`, not `UNPAID`. The installment schedule is unaffected by the counter half — a plan's principal never included counter payments.

`app/api/sales/[id]/party/route.ts` — **Change Customer** (`PATCH { partyId }`). Moves the invoice *and* everything booked against it: its SALE `LedgerEntry`, the `AccountEntry` party attribution, the `InstallmentPlan`, and any recoveries with their own ledger/account rows. Refuses vendors, an inactive party, the same party, a walking-customer target when the invoice used store credit or has a plan, and re-runs `validateCreditApplied` against the *new* party when `creditApplied > 0` (the old party gets that credit back, so the new one must genuinely hold it).

## Order detail page

`app/dashboard/invoices/[id]/page.tsx`, reached from the row's **Order Detail** action or by clicking its invoice number.

**It began as a modal and was made a page.** An invoice deserves a URL: one that can be linked, bookmarked, opened in a second tab and walked back through with the browser's Back button, none of which a dialog can do — and a document this tall was scrolling inside a box that was itself scrolling the report behind it.

The page owns the fetch and the print buttons; the paper is two presentational components, so what is on screen is exactly what prints:

| Component | Paper | Holds |
| --- | --- | --- |
| `components/sales/InvoiceDocument.tsx` | A5 / A4 | The full invoice — per-line Dis Rs. / Dis %, every total, the money breakdown, payments since, the installment schedule |
| `components/sales/InvoiceReceipt.tsx` | 80mm, `size: 80mm auto` | The counter slip, mirroring the receipt `app/dashboard/sales/page.tsx` prints at checkout |

`components/sales/invoice-detail.ts` carries the shared `InvoiceDetail` type and the `useInvoiceDetail()` fetch hook, so the page, the document, the slip and the list's receipt action can't drift on what a field means.

**The slip is a different document, not a smaller invoice.** No discount columns, no schedule, no ledger history — what was bought, what it came to, what was paid, in the order a customer reads it. A re-print has to look like the receipt they were first handed, which is also why the receipt action fetches the invoice instead of printing from the `SaleRow` in hand: the row has no `change`, no bank account name and no party balance.

Page height means the slip is mounted off-screen (`left: -9999px`) rather than conditionally rendered — react-to-print needs a real, laid-out node to copy, and `display: none` gives it nothing to measure.

Fed by `GET /api/sales/:id`, not by the `SaleRow` already in hand. The list route deliberately carries only what its columns show; an invoice document also needs the per-line `disRS`/`disPct`, the `adjustment`/`courierCharges`/`slipAmount` figures, which bank account the money went into, the customer's contact block and running balance, every payment taken since the sale, and the installment schedule. Loading all of that for a thousand rows to read one is the reason it is a lookup by id.

What the document holds, in order: store header (name/address/phone from `useStore()`) and a **SALE INVOICE** / **REFUND INVOICE** title chosen by `netBill < 0`; invoice meta (no, date + time, cashier, party option, payment method + bank account) with the same status chips the list row carries; the customer block, with **previous and closing balance as at this invoice**; sold and returned lines in separate tables, each with unit, qty, rate, Dis Rs., Dis % and amount; the pcs/gaz/mtr unit totals; the bill (gross → package discount → returns → adjustment → courier → slip → **net bill**) beside the payment (cash, card, bank, store credit, recovered, change, total received, outstanding); the `Recovery` rows collected since, each tagged Mark Paid or Installment by the same `installmentId` test the list route uses; the installment schedule; notes; and the store's footer terms.

**The balance is replayed, not aggregated.** The Contacts report's `previousBalance + Σdebit − Σcredit` is the right figure for a list of who owes what *now*, but an invoice that prints "previous balance" has to mean the balance before *this* sale — otherwise reprinting an old invoice shows a figure that has moved since, and the document stops adding up. So `GET /api/sales/:id` reads the party's `LedgerEntry` rows, orders them by `(date, createdAt)` and splits at this invoice's own first row: everything before it is `balanceBefore`, its own rows are the invoice's effect, everything after is ignored, and `balanceAfter = balanceBefore + effect`. Ordering on `createdAt` as well as `date` is what keeps same-day invoices in the order they were rung up. A voided invoice has had its ledger rows deleted, so there is nothing to anchor on and the split falls back to the invoice date.

Worth knowing: two ledger rows sharing both `date` and `createdAt` across *different* invoices tie, and the split then picks one arbitrarily. Replaying the whole party's rows also means a party with a very long history is read in full for one invoice view.

**One `useReactToPrint` handler per paper, not a shared `size` state.** The hook closes over the `pageStyle` string it was given, so a button that set state and then printed would print at the *previous* size. The page therefore holds three: Receipt (80mm), A5 and A4.

## Refund a whole order

`app/api/sales/[id]/refund/route.ts` — `POST { amount?, paymentMethod: "CASH"|"BANK", accountId?, date?, notes? }`, gated on `PROCESS_SALE_RETURN` (a key that had existed in `lib/permissions.ts` since Phase 8 with nothing to gate).

**A refund is a second invoice, not an edit of the first.** It creates a net-return invoice — every line of the sale copied with `isReturn` flipped, `netBill` the exact negative — linked back through `SaleInvoice.refundOfInvoiceId`. That is the same shape as a net-return invoice rung up at the counter, so `buildSaleAccountEntryOps` and `computeSaleLedgerSplit` already handle it (see `sales-checkout.md`'s refund-correctness notes) and nothing new had to learn about refunds. Reversing the sale in place would have been one row less to read, but it would date today's payout to the day of the sale — `app/api/reports/cash/route.ts` groups invoice money by `invoice.date` — and erase the fact that the sale happened, which is the same reasoning that shaped Mark Paid in Phase 7.

Where the money goes:

- **Stock** — each mirrored line moves the opposite way, so the pair nets to no stock movement.
- **Cash/bank** — the payout posts `SALE_REFUND` `AccountEntry` rows (credit = money out) on the refund's own date.
- **Party ledger** — one row, and this is the first thing in the app to ever write the long-defined `SALE_RETURN` `LedgerEntryType` (the Ledger page has rendered it as "Sale Return" all along). `debit = −netBill + payout`, straight out of `computeSaleLedgerSplit`, is what makes every case come out right with no special-casing: a sale paid in full and refunded in full nets to 0; an unpaid credit sale refunded with no payout cancels its debt exactly; a sale part-settled with store credit refunds the *money* and hands the credit back as credit.
- **Installments** — any plan on the original is torn down via `buildPlanTeardownOps`; nothing is left to collect. Collections already taken stay on the party's ledger (they carry `recoveryId`, never `invoiceId`) and are counted in `refundable`, so the customer is paid back for them.

`refundable = cashReceived + cardAmount + bankAmount + Σ recoveries` — what the customer actually handed over. `creditApplied` is **excluded**: no money came in for it, and the ledger row above returns it as credit. `amount` defaults to the whole of `refundable` and may be reduced (the remainder stays as store credit); above it the route 400s, for the same reason Mark Paid refuses an overpayment — the store can't hand back money it never took.

Refused with a 400: a non-`SAVED` invoice, one already refunded, a refund invoice itself, a `netBill <= 0` invoice, and `BANK` with no `accountId`.

### Invoice totals on the refund document

`grossSale` is deliberately left at **0** and the whole value goes into `returnAmount`, so a refund never inflates the period's gross sales — the report's Returns total is where it belongs. `slipAmount`/`netBill` are the negatives of the original's; the unit totals swap sold ↔ returned.

`cashReceived`/`bankAmount` on a net-return invoice mean money paid **out** (the Sales page reads them the same way, relabelling "Amt Received" to "Refund (Cash)"). `GET /api/reports/sales` therefore **signs them by `netBill`** when summing `totals.cashReceived`/`cardAmount` — the raw sum reported a cash refund as cash received, which was already wrong for counter-created net-return invoices before refunds existed.

## Schema support (migration `20260908143316_invoice_linked_recoveries`)

Additive only: `Recovery.invoiceId` (ON DELETE SET NULL) plus `LedgerEntry.recoveryId` / `LedgerEntry.paymentId`, all nullable and indexed.

A settlement's ledger and account rows carry `recoveryId`, **never** `invoiceId` — the invoice void/restore/delete paths clear those two tables by `invoiceId`, so linking them that way would wipe the party-ledger and cash effects of a collection that really happened. Consequences, all intentional and verified:

- **Void** leaves collected money standing; the customer ends up holding it as a credit balance.
- **Delete** leaves it too — the FK just nulls the link.
- **Restore** rebuilds the SALE ledger/account rows and a fresh schedule; pre-void collections stay on the party's ledger but are not re-applied to the new schedule.

## Filters (Reports → Sales tab)

Date range preset, payment status, record status (active/voided/all), free-text search by party/invoice (`filteredSales`). CSV export alongside.

## No "Cash Received" tile in the totals row — and why one was tried and pulled

The totals row (Invoices / Gross Sale / Discount / Returns / Net Bill / Outstanding / Profit) deliberately has **no aggregate Cash Received tile**, even though `totals.cashReceived` is still computed and returned by the API (it feeds the per-invoice "Received" sub-line and the CSV export, which are fine — see below).

A summed Cash Received tile was added once and removed after it read, in practice, as "cash we currently have in hand" — which it never was, for two independent reasons:

1. **Per-invoice `cashReceived` is *supposed* to already be netted of change** (`cashKeptFromTender()` / `moneyKeptFromTender()`, `lib/utils.ts`, since 2026-09-11 — see the "Cash tendered vs money kept" section of [sales-checkout.md](sales-checkout.md)). But any invoice dated before that fix still stores the raw tendered figure, change and all, because historical rows were deliberately left as-is. A tile summing across a date range that straddles the fix mixes both kinds with no visual distinction.
2. **Even correctly-netted, a sum of invoice `cashReceived` is not "cash in hand."** It only covers money taken *at the counter on sale rows in this filtered set* — it has no opening float, no cash expenses, no owner withdrawals/injections, no cash-side Mark Paid/recovery collections, and nothing from outside the current filter (date range, payment status, record status, search). The actual cash position lives in the branch's Cash `Account` balance (Bank & Cash Accounts page, [accounts.md](accounts.md)) and the Reports → Cash tab, both of which aggregate every posting, not just this tab's filtered invoices.

**Rule going forward:** don't re-add a summed cash/tender tile to a filtered report unless it is explicitly scoped and labelled as "money taken on these invoices" rather than left to read as the shop's cash-in-hand — that reading is what confused an owner reviewing this tab. The per-invoice "Received" figure and the CSV `Cash Received` column stay, since they're read next to one invoice, not mistaken for a running balance.

### The per-invoice figure also shows Change now, for the same reason

Even at the single-invoice level, a "Received" figure with nothing next to it read as "the store kept all of this" — confusing on any invoice where the customer tendered more than the bill and got change back, and *especially* confusing on a pre-2026-09-11 historical row, where `cashReceived` still holds the raw, un-netted tender (see the rule above).

`SaleInvoice.change` has existed since the very first migration (`20260904170129_init`) — it is not part of the netting fix and was already being computed and saved at checkout before it — but the Sales report never selected or displayed it. `GET /api/reports/sales` now selects it and returns `change` on each `SaleRow`; `app/dashboard/reports/page.tsx` shows it in two places, both only when `change > 0.005` (never a bare zero row):

- The table's Received cell, as a small amber line under the channel breakdown (`sales_change`, next to the `formatCurrency` amount).
- The expanded `SaleMoneyBreakdown` panel, as a line in the paid group — same position (channels, then Change, then the Outstanding total) as `InvoiceDocument`/`InvoiceReceipt` already use, so the three surfaces read the same way rather than each inventing its own layout.

No schema change, no checkout change, no historical data touched — the column was already correctly populated; only the report was missing it. This does **not** retroactively explain every possible legacy mismatch (a row saved before this migration existed, if any, would still have no `change` to show), but every row from 2026-09-04 onward carries it.

## Profit

`GET /api/reports/sales` also returns `totals.profit`/`totals.cogs` and a per-invoice `cogs`/`profit` on each `SaleRow`, computed the same way as the Dashboard's Sales & Profit panel (`profit = netBill − Σ (isReturn ? −1 : +1) × qty × item.purchasePrice`; see the estimate caveat in [dashboard.md](dashboard.md)). The totals-row Profit tile and the per-invoice figure in the expandable `SaleMoneyBreakdown` panel are both hidden from a role without `VIEW_PURCHASE_PRICE` — the same key that withholds purchase price on the Items page — client-side only; the API itself is ungated, matching every other read-only report route.

**There is no Load button on any tab.** Each tab's loader is a `useCallback` keyed on its own filter state, and one effect (`useEffect(..., [activeLoader])`) refetches on tab switch and on every filter change, debounced 250 ms so a date input being typed into doesn't fire per keystroke. `DateFilter` shows only a spinner while a fetch is in flight. The search boxes on Sales/Stock/Contacts stay client-side and trigger no request.

### Stale-while-revalidate on the Sales tab

The reports page is a client component, so navigating away unmounts it and drops its rows; every return visit used to sit on an empty table for the length of the round trip. `lib/report-cache.ts` is a module-scoped, in-memory cache — one entry per namespace, holding the last payload and the filter key that produced it — that outlives the unmount for as long as the tab is open.

The Sales tab (`SALES_CACHE = "reports:sales"`) seeds `salesRows`/`salesTotals` from it in lazy `useState` initialisers, so the last result paints on the first frame, then refetches underneath and swaps in the fresh rows. `salesStale` (`salesLoading && !isReportCacheFresh(...)`) is true only when what's on screen belongs to *different* filters; the totals and the table are dimmed then, not blanked. A `salesReq` sequence ref drops any response that isn't from the newest request, which matters now that a stale list stays visible while the user keeps moving the dates.

The Purchases tab does the same in `GrnRecordsTab` (`GRN_CACHE = "reports:purchases"`) — one slot shared by both of that component's mounts, Reports → Purchases and the Purchases screen, since they list the same GRNs off the same defaults. Stock/Cash/Contacts still reload from empty.


## List layout

The pieces this list is built from — `DateFilter`, `TotalCard`, `Money`, `Chip`, `MoneyGroup`, `shownParts`, `DATE_PRESETS` — no longer live in this page. They moved to `components/reports/list-ui.tsx` when the GRN Records list needed the same ones, so a purchase and an invoice render money and status identically; see docs/purchases-grn.md. `SaleLineItems` / `SaleMoneyBreakdown` / `SaleExpander` / `salesStatusChips` stay here, being about invoices specifically.

**Reports → Purchases is no longer this page's own table** either: it mounts `components/purchases/GrnRecordsTab.tsx`, which owns its filters and its fetching. That is why `loadForTab` is a `Partial<Record<Tab, …>>` with no `purchases` entry and the auto-load effect guards on `activeLoader`.

One set of rows, two renderings, sharing `SaleExpander` (which composes `SaleLineItems` + `SaleMoneyBreakdown`) and `salesStatusChips` so the two can't drift:

- **From `md` up** — a table whose columns drop out in a fixed order as the window narrows: items at `lg`, Type and Gross at `xl`. Everything a hidden column carried reappears in the expander, so no figure is only reachable by widening the window. The Actions column is `sticky right-0` inside the `overflow-x-auto` wrapper, so the menu stays reachable without scrolling back across the table.
- **Below `md`** — one card per invoice. A ten-column table is unreadable on a phone however it is squeezed.

Three things the old table got wrong, worth not re-introducing:

- **`Rs.` and its digits wrapped onto two lines** whenever a column got tight. Every money figure now goes through the `Money` helper: `whitespace-nowrap tabular-nums`, and a negative amount puts the sign *before* `Rs.` rather than between it and the digits (`Rs. -24.00` → `− Rs. 24.00`).
- **Two adjacent status columns** ("Payment Status" and "Status") read as the same thing twice, and the second only ever said "Active". They are now one column: the payment badge always, plus a chip only when there is something to say (Voided / `Refunded · #N` / `Refund of #N` / Installments).
- **The expander held a nested `<table>`** whose columns lined up with nothing above them, so the detail read as floating text. It is now a bordered panel on a fixed grid, with the money breakdown stacked under it. Two indents put it under the row it belongs to rather than against the table's edge: the expander row leaves the chevron column empty and spans the detail across the other nine, and the panel's own leading grid column (`1.5rem`) is empty so the lines sit inside the invoice rather than butting against its border.
- **The money breakdown was a five-across grid.** Ten figures spread over the full table width put the label of one column next to the amount of the previous one, so the eye had to travel sideways to pair them up and the totals lined up with nothing. It is now a vertical panel under the line items, split into what the goods came to and what was paid against it — each half closing on the figure that matters, Net Bill and Outstanding, the same shape as the printed invoice.
- **It is capped (`max-w-sm`) and pushed right (`ml-auto`)**, not stretched. A label pinned to the far left of the table with its amount at the far right is the same problem in a new form; held to a column, each label sits directly opposite its own figure, and the column lands under the Net Bill / Received columns of the row above, where the figures it repeats already sit.
- **One line per pair**, label left and amount right. Stacking the amount under its label was tried and made the panel twice as tall for no gain — it pushed Outstanding below the fold of a short invoice.
- **Zero rows are dropped, not dashed** (`shownParts`). A cash sale with no discount, return or card payment was printing six labels with a dash against each, burying the two figures that mattered. The closing totals are exempt: `Outstanding Rs. 0.00` is a statement, where a missing Outstanding row would read as an omission. In practice this takes a ten-row panel down to three or four.
- **A money column *beside* the items was tried and reverted.** Side by side, the breakdown squeezed the item table into whatever width was left and the two panels competed for the eye, instead of being read in the order the sale happened: what was bought, then what it came to. Right-aligned *under* the items is not that layout — the items still get the full width.

Separate Cash and Card columns are gone, replaced by one **Received** column: the settled total, with the channel breakdown (`Cash 1,000 · Card 950`) as a sub-line.
