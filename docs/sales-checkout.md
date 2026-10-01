# Sales / Checkout Page

Main file: `app/dashboard/sales/page.tsx` (single client component — the entire checkout form). No dedicated `/orders` route; the sales list lives in Reports (see `orders.md`).

> **Updated through Phase 5 of the payment/accounts overhaul** (see `settings-accounts.md` for the Account model this now posts to). The section below reflects the current state; the original CASH/CR/1INCH/5INCH design and the free-text bank field are gone.

## "Payment Option" block (now in the right panel, not a top bar)

A **pricing-tier / credit-type selector**, not a payment method — controls which catalog price applies, nothing else:

- Options: `CASH | CC` (CC = "Credit Customer" — this is the renamed/collapsed old `CR` tier; `1INCH`/`5INCH` were dropped entirely). State type `"CASH" | "CC"`.
- Effect: switches `salePrice` (CASH) vs `altSalePrice` (CC) — see `priceForPartyOption()` and the re-pricing effect that fires on `partyOption` change.
- Receipt/WhatsApp text ("Previous Balance" / "CREDIT SALE") now triggers on `partyOption !== "CASH"` (widened from the old `=== "CR"` check, so legacy `CR`/`1INCH`/`5INCH` rows on old invoices still render correctly).
- `SaleInvoice.partyOption` stays a plain string column (not a hard DB enum) — new writes are restricted to `CASH|CC` at the application layer only, to avoid a destructive rewrite of historical `CR`/`1INCH`/`5INCH` rows.

## Payment Method + money-in fields (right panel, below Net Bill)

A real **Payment Method** selector now exists, separate from Payment Option: `CASH | BANK | CASH_AND_BANK`. Changing it clears whichever field(s) just went out of scope (e.g. switching to `BANK` zeroes `cashReceived`) so a stale amount can't silently ride along.

- `cardAmount` — always visible regardless of Payment Method; intentionally **not** wired into the Account/cash-bank ledger (card settlement isn't tracked as a bank balance in this phase — see `schema-permissions.md`'s Account model notes if that changes later).
- `cashReceived` ("Amt Received") — shown when Payment Method is `CASH` or `CASH_AND_BANK`; posts to the branch's Cash `Account`.
- `bankAmount` + a **bank dropdown** (`bankAccountId`, sourced from `GET /api/accounts`) — shown when Payment Method is `BANK` or `CASH_AND_BANK`; posts to the selected Bank `Account`.

### The old `chooseBank` free-text bug is fixed
The free-text "Bank name..." field (and the dead `chooseBank` column) is gone entirely, replaced by `bankAccountId` (a real FK to `Account`) + `bankAmount`. `SaleInvoice.chooseBank` is kept in the schema for historical reads but nothing writes to it anymore.

## Right panel layout, top → bottom

1. Unit-sold grid (PCS/GAZ/MTR) + Returns row
2. **Payment Option: Cash / CC** (moved here from the old top bar)
3. Gross Sale (read-only) → Package Discount → Sale → Return → Adjustment (add/sub + input) → **Slip Amount** → Courier Charges
4. **Net Bill** — big teal callout
5. Card Amt (always visible) → **Payment Method: Cash / Bank / Cash & Bank** → conditionally Amt Received and/or Bank select + Bank Amt → Change (computed)
6. Scanned count / Balance Qty

Left side of the screen: party bar + line-items table + New/Save/Print/Resume/Add Item/Add Party buttons.

## Totals math — `lib/utils.ts` (`calculateInvoiceTotals`)

```
saleAmount    = grossSale - packageDiscount
slipAmount    = saleAmount - returnAmount
adjustedSlip  = adjustType === "add" ? slipAmount + adjustment : slipAmount - adjustment
netBill       = adjustedSlip + courierCharges
isRefund      = netBill < 0
creditApplied = isRefund ? 0 : min(max(0, requestedCredit), netBill)   // clamped here
amountDue     = max(0, netBill - creditApplied)
totalReceived = cardAmount + cashReceived + bankAmount + creditApplied
change        = max(0, totalReceived - abs(netBill))
```

`creditApplied` is clamped inside this function rather than at the call site, so every caller — and the value the Sales page posts to the server, which it reads back off this returned object — gets the same bounded number. `amountDue` is what still has to be collected at the till after credit.

## Account (cash/bank ledger) posting

`POST /api/sales`, and the void/restore/delete handlers in `app/api/sales/[id]/route.ts`, all call `buildSaleAccountEntryOps()` (`lib/accounts.ts`) to keep `AccountEntry` rows in sync with the invoice's `cashReceived`/`bankAmount`/`bankAccountId`:

- A normal sale (`netBill >= 0`) posts `SALE_RECEIPT` entries (debit = money in) to the Cash account (lazily provisioned via `getOrCreateCashAccount`) and/or the selected Bank account.
- A net-return invoice (`netBill < 0`) posts `SALE_REFUND` entries (credit = money out) instead — same fields, sign-flipped by the server.
- Voiding an invoice deletes its `AccountEntry` rows (mirrors the existing `LedgerEntry` deletion); restoring recreates them; deleting an invoice removes them unconditionally. Verified end-to-end (create → balances update → void → balances reverse to 0 → restore → balances reapply → delete → balances zero out again).
- The party `LedgerEntry`'s credit side now includes `bankAmount` too: `credit: cashReceived + cardAmount + bankAmount`.

## Cash tendered vs money kept

> **Business rule: "Cash Received" is always the cash the shop kept, never
> what the customer handed over.** A 4000 bill paid with a 5000 note and
> 1000 change is **4000** of cash received on every screen: the Dashboard
> tile, the Sales & Profit panel, the Sales and Cash reports, the invoice
> page, the receipt, the party ledger and the Cash account. The 5000 exists
> only while the cashier is typing it in.
>
> Two rules keep it that way:
>
> 1. **Net once, at save.** `POST /api/sales` is the only place a tender is
>    turned into a kept amount (`moneyKeptFromTender`). The client sends the
>    tender plus `change`, not pre-netted figures, or the change would come off
>    twice. Every other writer (refund, Mark Unpaid, restore) writes kept
>    figures or zeros, never a tender.
> 2. **Sign it when summing.** On a net-return invoice (`netBill < 0`) the same
>    columns are cash paid **out**, so any total across invoices goes through
>    `moneyInFromInvoice(netBill, amount)` in `lib/utils.ts`. Summing the raw
>    column counted a 500 cash refund as 500 cash received. The Dashboard
>    tile, `/api/reports/dashboard`, `/api/reports/sales` and
>    `/api/reports/cash` all do this. A new report must too.

### The Cash report's columns — `app/api/reports/cash/route.ts`

One row per **shop** day (`shopDateKey`). All sale amounts are kept figures,
signed as above.

| Column | What it is |
|---|---|
| Cash / Card / Bank Sales | `cashReceived` / `cardAmount` / `bankAmount` |
| Credit Sales | `netBill − creditApplied − cash − card − bank`, when positive: billed but not paid at the counter. It used to leave bank and store credit in, so a bank-paid sale read as a credit sale. |
| Recoveries | every `Recovery` that day, cash and bank; the cash part is shown underneath when they differ |
| Total Cash In | cash sales + **cash** recoveries only: what should be in the drawer. It used to add bank recoveries too. |

The "Amt Received" box is what the customer **handed over**; `Change` below it
is what went back. Only the difference is the store's money, so `POST
/api/sales` nets it once — `moneyKeptFromTender()` in `lib/utils.ts` — and
stores *those* figures in `SaleInvoice.cashReceived` / `bankAmount` /
`cardAmount`. Those columns therefore never hold a tender, and every reader of
them (the party `LedgerEntry` credit, the Cash/Bank `AccountEntry` rows, the
installment plan's `paidNow`, the void/restore path, and the
Cash/Sales/Dashboard reports) is right without knowing the rule exists.

Before this, all of them were handed the tendered figure: a 1000 bill paid with
a 1500 note gave the customer **500 of store credit they never earned** and
overstated cash in hand by 500.

### Why the netting spans all three channels

The original `cashKeptFromTender()` took the change off **cash alone**, but
`change` is derived from card + cash + bank + credit. When the overpayment
arrived by card or bank, the cash figure clamped at 0 and the full tender still
reached the ledger — a 1000 bill settled with a **1200 bank transfer** left the
party balance at **−200**, i.e. store credit worth exactly the change handed
back. Same for a 1200 card.

`moneyKeptFromTender()` absorbs the change **cash first, then bank, then card**
(the change physically leaves the till). Every returned figure stays `>= 0`, so
no column or reader needs to cope with a negative amount, and they always sum
to `totalKept` — which is what the ledger credits and what an installment plan
treats as already paid. `cashKeptFromTender()` is still exported and still
correct as the cash component of that allocation.

> Nuance worth knowing: on a bank overpayment the Bank `AccountEntry` records
> the **kept** amount (1000), not the 1200 that actually hit the bank, with the
> 200 difference implicitly treated as cash out of the drawer. The alternative
> — posting 1200 to bank and −200 to cash — is more literally accurate but
> needs a negative cash entry. Revisit if bank statements are ever reconciled
> line by line.

One case must *not* net, and the helper handles it: on a net-return invoice the
amounts are money paid **out** and `change` means "over-refunded"; that cash
genuinely left the drawer too.

`calculateInvoiceTotals` also returns `cashKept`/`bankKept`/`cardKept`/
`totalKept`, so the screen can show a **Net Cash** line under Change (only when
change > 0) and the receipt prints the netted figures rather than the tender.

Covered by `tests/invoice-totals.test.ts` → *"moneyKeptFromTender — change never
becomes customer balance"*.

**No invoice holds a tender any more.** The one saved before this fix
(invoice #1: 4490 bill, 5000 handed over) was corrected on 2026-09-29, the
invoice and its SALE ledger credit together. A saved invoice still holds a
tender if it has `change > 0`, `netBill >= 0` and
`cashReceived + cardAmount + bankAmount + creditApplied > netBill`.

## Save validation — `lib/sale-validation.ts`

`validateSalePayment()` is pure and Prisma-free, and runs in **both** places:
the screen blocks Save with a translated toast, and `POST /api/sales` re-checks
it and returns a 400, so a stale tab or a hand-rolled request can't write an
invoice the UI would have refused. One issue is returned at a time — the cashier
fixes the field named and re-saves.

| Code | Rule |
| --- | --- |
| `BANK_ACCOUNT_REQUIRED` | Bank / Cash & Bank needs a selected account (a bank amount with no account posts to no balance) |
| `BANK_AMOUNT_REQUIRED` | ...and a non-zero amount |
| `CASH_AMOUNT_REQUIRED` | Cash & Bank needs a cash amount too. **Not** enforced on the plain Cash method — that's the default and a pure credit sale legitimately leaves it at zero |
| `CASH_SALE_NOT_SETTLED` | Payment Option `CASH` must be fully settled to save; the toast names what is still due |
| `CREDIT_NEEDS_NAMED_PARTY` | `CC` refuses the shared Walking Customer — a debt parked there belongs to nobody and could never be recovered |
| `CREDIT_SALE_FULLY_PAID` | A `CC` invoice that has been paid in full |

Two directions are exempt from the last three: a **net-return** invoice (money
flows outward, so "settled" and "fully paid" both invert) and a zero-value bill.
Method completeness still applies to a refund.

### Why the price tier takes part, and the re-price dialog

`partyOption` is a price tier, not a payment method — so "switch to Cash"
**re-prices every line** from `altSalePrice` to `salePrice`. That is why
`CREDIT_SALE_FULLY_PAID` is the one code with no toast: it opens a confirm
dialog, and confirming sets the tier and hands the invoice **back unsaved** so
the cashier checks the new Net Bill before committing. Silently flipping the
tier during save would change what the customer is charged.

## Keyboard shortcuts

`Ctrl+S` save, `Ctrl+P` print, `F7` hold, `F8` resume, `F11` add item, `F12` add
party — and **`Ctrl+I` for New**.

New was `Ctrl+N`, which could never have worked: Chrome and Edge reserve it for
a new browser window at a level a page cannot `preventDefault`. `Ctrl+S` and
`Ctrl+P` *are* cancellable, so those are genuine.

## Two Save buttons

The bottom toolbar keeps its Save, and there is a second one **directly under
the payment fields** in the right panel — where the cashier's eyes and cursor
already are after typing the cash. Both call the same `saveInvoice()`. The GRN
screen has the same pair.

## Returns

Each line item has an `isReturn` toggle (S/R radio). In `calculateInvoiceTotals`, return rows are excluded from `grossSale`/sold quantities and instead accumulate into `returnAmount`/returned quantities, which subtracts from `slipAmount`. On save, stock deltas are reversed for return lines (`delta = line.isReturn ? line.qty : -line.qty`). Void/delete correctly reverses this too.

### Refund correctness (Phase 3) — the money math when returns outweigh sales

When returned lines outweigh sold lines, `netBill` goes negative — this is a **net-return invoice**, not a special document type (there's still no separate return document, per `orders.md`). Two formulas needed fixing for this to behave sensibly, both in `lib/utils.ts`:

- **`change` in `calculateInvoiceTotals`** — the original formula (`totalReceived - netBill`) only made sense for `netBill >= 0`; for a refund it produced nonsense (e.g. refunding exactly what's owed showed a huge fake "change"). Fixed to compare against `Math.abs(netBill)`, so the same field now correctly means "over-refunded" when `netBill < 0`. The totals object also now exposes `isRefund: boolean` (`netBill < 0`) for the UI to key off.
- **`computeSaleLedgerSplit(netBill, totalPaid)` (new)** — the party `LedgerEntry`'s debit/credit split for a refund. A normal sale bills `netBill` (debit) and offsets it by `totalPaid` (credit). For a refund, folding the payout into `credit` would *double-subtract* (money paid TO the customer doesn't reduce what they owe the same way money received FROM them does) — instead the payout is folded straight into `debit` (`netBill + totalPaid`), which correctly nets to 0 when a return is refunded in full immediately, and to the correct remaining store-credit amount on a partial refund. Verified: a $750 return refunded $300 in cash leaves a ledger debit of exactly `-450` (store owes the customer $450).

Both `app/api/sales/route.ts` (create) and `app/api/sales/[id]/route.ts` (restore) call `computeSaleLedgerSplit` so the two paths can't drift.

### UI relabeling for refunds

The Sales page UI (right panel and the printed receipt) checks `totals.isRefund` / `detail.totals.netBill < 0` (in `InvoiceReceipt`) to swap labels and color: **"Net Bill" → "Refund Due"** (red callout instead of teal), **"Amt Received" → "Refund (Cash)"**, **"Bank Amt" → "Refund (Bank)"**, **"Change" → "Over-Refunded"**. No new fields — same inputs, relabeled and sign-interpreted by the server, matching the original plan's decision not to auto-suggest a refund split from a return rung up at the counter.

A **full-order refund** taken from the sales list is a different path: it builds one of these net-return invoices server-side from the sale being refunded, linked by `SaleInvoice.refundOfInvoiceId`, so that case *is* now tied back to its original — see [orders.md](orders.md#refund-a-whole-order). A return typed in at the counter still has no such link.

## Customer balance / credit

`Party.previousBalance` is **never mutated directly** by a sale. Instead:

- Every sale creates a `LedgerEntry` (`type: "SALE"`, `debit: netBill, credit: cashReceived + cardAmount + bankAmount`) — `app/api/sales/route.ts`.
- Running balance = `party.previousBalance` (opening balance) + sum of ledger debits/credits, computed on read (`app/api/ledger/route.ts:48`, `app/api/ledger/outstanding/route.ts:63-64`).
- A `CC` sale (or any partially-paid sale) just leaves a net debit in the ledger — **no `creditLimit` check exists anywhere in the sales flow**, despite `Party.creditLimit` existing in the schema.
- Voiding an invoice deletes its ledger entries (restoring balance); restoring re-creates them (`app/api/sales/[id]/route.ts`).

## Store credit at checkout (Phase 4)

A customer holding store credit (typically from a return that wasn't refunded in cash — see the refund section above) can spend it against a new bill.

### `GET /api/parties/[id]/balance?branchId=` — the live single-party balance

New endpoint (`app/api/parties/[id]/balance/route.ts`), the single-party counterpart to `GET /api/ledger/outstanding`. Both it and the server-side guard call `getPartyBalance()` in **`lib/party-balance.ts`**, so the number the cashier sees and the number the server enforces can't drift apart. Same live-computed `opening + Σdebit − Σcredit` formula as everywhere else in this app — no new stored counter.

Returned fields: `balance` is **signed** (`> 0` the party owes the store, `< 0` the store owes the party), `availableCredit` is that negative side as a positive spendable amount (0 for anyone not credit-eligible), `creditEligible` says whether credit may be applied at checkout at all.

**Who is credit-eligible** (`creditIneligibleReason()` in the same file): every party except the `isDefault` Walking Customer (shared by every anonymous sale, so credit parked on it isn't attributable to one person — spending it would leak one customer's credit into an unrelated later sale) and `VENDOR` parties (settled through purchases, not the sales counter). Note this is *not* restricted to `type=CREDIT` parties: a `CASH`-type walk-in with a name who returned goods legitimately holds credit too.

### Server-side guard — `validateCreditApplied()`

Store credit is the only payment channel that moves value with **no matching cash movement**, so unlike `cashReceived`/`bankAmount` it is re-derived from the database in `POST /api/sales` instead of being trusted from the client. It **rejects with a 400** rather than silently clamping — the saved invoice has to match the amount the cashier agreed to, and a quietly reduced credit would leave the customer short at the till. Four rejections: credit on a net-return invoice, credit above the invoice total, credit above the party's live `availableCredit`, and credit for an ineligible party. The guard runs *before* the invoice-number lookup and the `$transaction`, so a rejected request writes nothing.

### What credit does and does not touch

- **`SaleInvoice.creditApplied`** stores the honoured amount (column already existed from the Phase 1 migration — Phase 4 needed no migration).
- **No `AccountEntry`** — no cash or bank money moved. `buildSaleAccountEntryOps()` is only ever passed `cashReceived`/`bankAmount`, so this holds by construction.
- **The party `LedgerEntry` is unchanged**: `debit = netBill`, `credit = cashReceived + cardAmount + bankAmount`. `creditApplied` is **deliberately excluded from the credit side**, which is a correction to the original plan's wording ("`creditApplied` widens the SALE row's credit"). The customer's credit already exists in this ledger as a negative balance, so billing the full `netBill` as debit is itself what consumes it — 450 credit, a 1000 bill, 550 cash pays out to exactly 0. Adding the 450 to the credit side too would leave the balance at −450 and hand the credit back a second time. Verified end-to-end: 750 credit + 1000 bill + 250 cash → ledger `debit 1000 / credit 250`, running balance 0.
- **Void/delete need no changes**: voiding drops the invoice's `LedgerEntry`, which releases the consumed credit back to the customer; restore recalculates from the same `computeSaleLedgerSplit` inputs.

### Checkout UI

A purple **Store Credit** panel sits between the Net Bill callout and Card Amt, rendered only when `canApplyCredit` (customer is eligible, holds credit, and `netBill > 0`). It shows available credit, a **Use Max** button (`min(availableCredit, netBill)`), a Credit Used input, an amber note when the typed amount is above the cap, and an **Amount Due** row.

`creditApplied` participates in draft persistence, hold/resume and `clearForm`. A `lastPartyIdRef` guard zeroes it when the customer changes (so one customer's credit can't ride onto the next bill) but skips the very first run, so a restored draft's credit survives hydration. The balance is re-fetched after each save, since the sale just moved it.

### Party bar and receipt now show the *live* balance

The party bar's "Bal:" badge and the receipt's "Prev Balance" line previously read `Party.previousBalance` — the **opening** balance, not the current one. With credit now spendable at checkout, showing a stale figure beside an "available credit" panel would be actively misleading, so both now read `partyBalance.balance` (falling back to `previousBalance` only while the fetch is in flight). The badge turns green and tags `CR` when the store owes the customer. The receipt and WhatsApp message also gained a "Store Credit Used" line (plus "Amount Due" in the WhatsApp text).

## Repayment plan on a credit sale (Phase 5)

An amber **Repayment** panel sits below Change, shown only while `outstandingAfterPayment > 0` (`netBill − creditApplied − card − cash − bank`). Choosing anything but None makes `POST /api/sales` generate a due-dated `InstallmentPlan` for exactly that outstanding amount, inside the same transaction as the invoice.

`effectiveRepaymentType` pins the posted value to `NONE` when nothing is owed, so a selection made before the customer paid in full can't be posted with no schedule to build. Full detail — schedule maths, the collect endpoint, void/restore behaviour, the Ledger tab — is in [installments.md](installments.md).

## Barcode scanning

A scan box sits in the Add-Row bar under the line-items table. It is
`components/items/BarcodeScanner.tsx`, the same component the GRN screen uses -
see [purchases-grn.md](purchases-grn.md) for the lookup rules, the
unknown-code chooser (attach to an existing item / create a new one) and the
`globalCapture` keystroke buffer that catches a scan typed while focus is
somewhere else on the page.

### Two places to scan

The dedicated box is the deliberate target, but the cursor normally sits in a
row's **item box** while ringing up a sale, so that box takes scans too. Enter
(or Tab) there resolves in this order:

1. An **exact barcode** among the already-loaded search results - it always
   beats a partial name match, per the rule above.
2. A **detected scan** -> the code goes to the scanner via its imperative
   `scan(code, token)` handle, so the match / attach / create rules exist once,
   not twice. The row's box is cleared first, since the raw code is not a name.
3. Otherwise the **highlighted search result**, which is the old behaviour.

Step 2 needs to tell a scanned code from a name typed faster than the 250ms
search debounce can answer. `wasRowScan` requires the box's *entire* contents
to have arrived as one burst with no gap longer than `SCAN_KEY_GAP_MS`, and to
be at least `MIN_SCAN_LENGTH` characters - a fast typist finishing a word does
not qualify, because their earlier keystrokes broke the burst. Tab is only
intercepted when it *is* a scan; otherwise it keeps moving focus normally.

### Where the cursor goes next

`focusRowAfter(rowId)` moves it to the item box on the following row, appending
one when the invoice has run out (via `pendingFocusRef` + an effect, since the
input doesn't exist until React commits the new row). It lives in
`lib/use-row-scan-flow.ts` along with the burst detection above, shared
verbatim with the GRN screen - see [purchases-grn.md](purchases-grn.md). It fires after
`pickItemForRow` and after a scan that came from a row box, so a run of scans
walks straight down the invoice with no mouse.

A scan made in the **dedicated box** deliberately does *not* move the cursor -
it stays put so the next scan can follow immediately. The scanner tells the two
cases apart with the `token` it echoes back to `onItem`: a row box passes its
row id, the dedicated box passes nothing. The token also survives a detour
through the "not recognised" chooser, and a cancelled chooser leaves no stale
origin behind.

The sales page supplies `onItem` -> `addScannedItem`, which bumps the
quantity when the item is already a non-return line on the invoice and
otherwise fills the first empty row. The row it builds is priced through
`priceForPartyOption` and carries `salePrice`/`altSalePrice`, exactly like
`pickItemForRow`, so a scanned line re-prices on a Party Option switch just
like a typed one. Its `amount` uses the same disRS-wins-over-disPct rule as
`updateRow`.

Note that a scanned item is added at the *current* Party Option; nothing about
scanning bypasses the pricing tier.

## Numeric inputs

Every money/quantity box on this page (line qty, rate, Dis Rs, Dis %, package discount, adjustment, courier, card, cash received, bank amount, store credit) uses `components/ui/NumberInput.tsx` rather than a raw `<input type="number">` — the raw pattern made the leading 0 unclearable and sub-one decimals untypable. See [items.md](items.md) for how it works. The Purchases page has not been converted yet.

## Related translations

`lib/translations/sales.ts`: `sales_partyOptionLabel` (now displays "Payment Option:"), `sales_paymentOptionCash`/`sales_paymentOptionCC`, `sales_paymentMethodLabel` + `sales_paymentMethodCash`/`Bank`/`Both`, `sales_cardAmt`, `sales_amtReceived`, `sales_bankAmt`, `sales_selectBankPlaceholder`, `sales_noBankAccounts` (+ Urdu for all). `sales_bank`/`sales_bankNamePlaceholder` are legacy keys — `sales_bank` is reused as the bank-dropdown's inline label, `sales_bankNamePlaceholder` is now unused.

The scan box's strings are shared, not `sales_*`-prefixed: they live in `lib/translations/items.ts` under `scan_*`.

Phase 4 added `sales_creditAvailable`, `sales_creditApplied`, `sales_creditUseMax`, `sales_creditCappedAt` and `sales_amountDue` (+ Urdu). The receipt/WhatsApp strings stay hardcoded English, matching the rest of the print block.

## The unit cell is fixed, and quantity is capped at stock

**Unit is no longer chosen on this screen.** The cell renders `item.unit` as
read-only text.

It used to be a free PCS/GAZ/MTR dropdown that changed nothing: the rate stayed
the catalog rate and stock moved by the raw quantity, so picking MTR on a GAZ
item charged the gaz price and took a gaz off the shelf. An item's unit is now
settled once, at the GRN, where goods bought in one unit are converted into the
one they will be sold in (`units.md`) — by the time an item reaches the till
there is nothing left to decide.

Under each quantity box is an **Available** line, and `NumberInput`'s
`transform` caps what can be typed at that figure. The box snaps to the cap and
the line turns red when it is reached, which is why no toast fires — the reason
is sitting under the field. `availableFor()` subtracts what the same item is
already committed to on *other* rows, so an item split across two lines cannot
sell the shelf twice. Repeated scans of the same code stop at the cap too.
Return rows are goods coming back **in** and are not capped.

`POST /api/sales` re-checks it and answers 400, for the same reason
`validateSalePayment` runs in both places: a stale tab, a resumed held invoice
priced against older stock, or a hand-rolled request all get past a cap that
lives only in the browser.

The guard enforces only `ItemStock` rows that **exist**. An item with no row for
this branch is "stock never tracked here", not "zero in stock" — blocking on it
would stop every sale in a second branch. That is the known `updateMany` gap
recorded at the end of `items.md`, and closing it is not this guard's job.

The item-search dropdown shows stock in the sell unit, with the bought-as
quantity beside it when the item is bought in a different one.
