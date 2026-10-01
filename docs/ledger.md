# Ledger page

Main file: `app/dashboard/ledger/page.tsx`. Six tabs: **Ledger** (one party's
statement), **Recovery** (money in from customers), **Payment** (money out to
vendors), **Installments**, **Day Book**, **Outstanding**.

## Recovery / Payment — collecting against specific bills

Both tabs share one component, `RecordForm`, parameterised by
`type: "recovery" | "payment"`. It is a two-column layout: the form on the
left, and on the right **the party's open bills** — the question the tab could
not previously answer.

### The bill list — `GET /api/ledger/open-documents`

`?branchId=&partyId=&side=sales|purchase`. Returns each unsettled bill as
`{ id, no, date, netBill, settled, outstanding }` plus a summary
(`count`, `totalOutstanding`, `totalBilled`, `oldestDate`).

The queries live in **`lib/open-documents.ts`** (`getOpenInvoices` /
`getOpenGrns`), shared with the POST handlers that validate an allocation — the
cap on how much may be collected has to be re-read from the database, and it
has to be the *same* figure the cashier was shown. `outstanding` comes from the
pure `invoiceOutstanding` / `grnOutstanding`, so this list and the
payment-status badges in Reports cannot disagree.

Only `SAVED` invoices count: `VOIDED` ones owe nothing and `HELD` ones are
parked drafts that were never rung up (matches `recordStatus=ACTIVE` in
`GET /api/reports/sales`).

### The split — `lib/settlement-allocation.ts`

Pure and Prisma-free, so the screen pre-fills exactly what the server would
otherwise do.

- **`allocateFifo(documents, amount)`** — fills bills oldest-first to their
  outstanding, then cascades. It **sorts the list itself** (date, then document
  number), so a caller can't change the split by reordering. Returns
  `unallocated` for anything left once every bill is covered.
- **`validateAllocations({ documents, allocations, amount })`** — rejects
  rather than clamping, for the same reason `validateCreditApplied` does: the
  rows written have to be what the cashier agreed with the party. Errors:
  `UNKNOWN_DOCUMENT`, `DUPLICATE_DOCUMENT`, `NOT_POSITIVE`, `OVER_DOCUMENT`,
  `OVER_TOTAL`, and **`OVER_OUTSTANDING`** — the shop's rule that a collection
  may never exceed what the party actually owes, checked against the live
  figures rather than the typed total.

Under-allocating is deliberately allowed: part of the money can sit on account.

### How a split collection is stored

**One `Recovery` (or `Payment`) row per bill settled**, each carrying that
bill's id. `Recovery.invoiceId` and `Payment.grnId` are single FKs, and every
reader of them sums the rows pointing at a document — so a split is naturally
several rows, and the per-bill attribution comes for free rather than needing a
join table. A 5000 recovery across INV-3 (2000) and INV-7 (3000) writes two
rows; the Recovery history lists both.

Each row still goes through `buildSettlementOps()` (`lib/accounts.ts`), so the
party `LedgerEntry` and the cash/bank `AccountEntry` stay in step with the
installment-collect endpoint.

Omitting `allocations` from the POST body is legitimate — the server falls back
to `allocateFifo`, so a quick collection with no interest in the breakdown
still lands on real bills instead of floating free.

### `Payment.grnId` (migration `20260911000000_payment_grn_link`)

Added because there was no purchase equivalent of `Recovery.invoiceId`: a
vendor payment moved the vendor's *balance* correctly but attached to no bill,
so a GRN with no repayment plan read **UNPAID however much had been paid out**.
Nullable — existing rows, and payments made against the vendor's balance as a
whole, still leave it null and are still excluded from per-bill settlement.

`GrnSettlement` gained a matching `paid` channel (`lib/grn-settlement.ts`),
counted by `GET /api/reports/purchases`, `GET /api/purchases/[id]` and
`getOpenGrns`. Applied to **both** databases — see the two-databases note in
`AGENTS.md`/memory: the Prisma CLI migrates local Postgres, the app reads
Supabase.

### Party filter on the picker

Recovery is **`NOT_VENDOR`**, not `CREDIT`. It used to be `CREDIT`-only, which
hid every walk-in who had been sold to on credit under their own name — they
simply could not be selected, so their debt could never be collected here.
Payment stays `VENDOR`.

## The wrong totals in both tabs

`GET /api/ledger/recovery` and `/payment` returned raw Prisma rows, and
`amount` is a `Decimal` — which serializes to JSON as a **string**. The tab
footers sum with `reduce`, so 500 + 300 rendered as **500,300.00**. Both routes
now map `amount` to `Number` on the way out (and resolve `bankName` from the
linked `Account`), matching every other endpoint in this app.

## Installments tab

Lists customer plans (hanging off a `SaleInvoice`, collected as a `Recovery`)
and vendor plans (off a `GRN`, settled as a `Payment`) together. Two filter
rows: **open / overdue / all** (status) and **Both / Customer / Vendor** (side).

The side filter is new; `GET /api/ledger/installments` had always supported
`side=sales|purchase`, but with no control for it the two were interleaved with
nothing but the `INV-`/`GRN-` reference to tell them apart — which is why
customer installments looked like they didn't exist. Each row now also carries
a Customer/Vendor badge beside its reference.

Full schedule maths and the collect endpoint: [installments.md](installments.md).

## Ledger tab: reading the statement

- **Opening balance is as of the From date**: `party.previousBalance` plus every entry dated before the window (`GET /api/ledger`). It used to be `previousBalance` alone, so a one-month statement ignored everything before that month.
- Each balance shows Dr/Cr plus a one-line hint that depends on the party type, and the key under the cards changes with it. Positive balance = Dr = party owes the shop, for customers and vendors alike, but the *normal* side flips: a customer is usually Dr (collect in Recovery), a vendor usually Cr (pay in Payment).
- A sale paid at the counter is **one** `SALE` row carrying both debit (the bill) and credit (the payment), from `computeSaleLedgerSplit`. The Notes cell now says *Paid in full on the spot* or *Rs X paid on the spot, Rs Y left owing*, so the row doesn't read as a contradiction.
- Page 1 starts with a *Balance brought forward* row, and a footer gives the period totals.

## Ledger tab — repayment strip

When the selected party has open installments, a strip above their statement
shows one chip per installment (soonest first): reference, plan kind, `seq/periods`,
next due date, remaining — red once overdue. Fed by
`GET /api/ledger/installments?partyId=&status=open`. The Installments tab still
owns the full schedule and the collect action; this only answers "what did we
agree, and when next".

## Outstanding tab

`GET /api/ledger/outstanding?branchId=&type=receivable|payable`. Note it
returns `balance: Math.abs(balance)` and filters on that, so **direction is
discarded** — a customer holding store credit shows as owing money. Not
addressed here; the Parties page uses the signed convention instead (see
[accounts.md](accounts.md) and `lib/party-balance.ts`).

## Every bill number is a link

A statement line, a recovery, a payment, an installment, a day-book entry and
the open-bill picker all print an `INV-3` / `GRN-12`, and each raised the same
question: *what was on that bill?* The detail pages
(`/dashboard/invoices/[id]`, `/dashboard/purchases/[id]`) already existed — only
the link was missing.

`DocRef` in `app/dashboard/ledger/page.tsx` renders the reference as a `<Link>`
when the row carries the document's **id**, and as plain text otherwise. The
URLs come from **`lib/document-links.ts`** (`invoiceHref` / `grnHref`), which is
where the sales report's and the GRN tab's private copies of those two helpers
moved rather than being written a third time.

Where the id comes from, per tab:

| Tab | Source of the id |
| --- | --- |
| Party Ledger, Day Book | `LedgerEntry.invoiceId` / `.grnId`, newly returned by `GET /api/ledger` and `/daybook` |
| Recovery | `Recovery.invoiceId` (already on the row) + `invoiceNo`, newly joined |
| Payment | `Payment.grnId` + `grnNo`, newly joined |
| Installments, repayment strip, collect modal | `InstallmentPlan.invoiceId` / `.grnId`, newly returned by `GET /api/ledger/installments` |
| Recovery/Payment open-bill picker | `OpenDocument.id` — already the document id, since it is what an allocation posts under |

**The settlement rows deliberately have nothing to link to.** A `RECEIPT` /
`PAYMENT` ledger entry is not tied to a document by FK — see the note on
`buildSettlementOps` in `lib/accounts.ts`, which explains why — and its
reference is a `REC-XXXXXX` / `PAY-XXXXXX` number rather than a bill. Those
cells stay plain text.

The Outstanding tab is party-level and names no document, so nothing there
changed; its **View** action still jumps to that party's statement.

Recovery and Payment gained a **Reference** column (and a `Reference` field in
their CSV exports) — previously the invoice a collection landed on was visible
only in the free-text note.
