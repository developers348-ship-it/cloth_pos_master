# Parties page

Main file: `app/dashboard/parties/page.tsx`. List/add/edit/delete of customers
and vendors (`PartyFormModal`), filtered by type and searched server-side.

## Two different balances, and why the column was wrong

`Party.previousBalance` is the **opening** balance — the figure a party was
created with. It is never mutated by trading: a sale writes a `LedgerEntry`,
and the current balance is computed on read as
`previousBalance + Σdebit − Σcredit` (the same formula the ledger's running
balance, `GET /api/parties/[id]/balance` and the checkout's credit guard all
use).

The list's money column showed `previousBalance`, so it sat frozen while the
customer bought and paid. It now shows both: **Opening Bal** (unchanged) and a
live **Balance**.

## Sign convention

One convention across the app, defined in `lib/party-balance.ts`:

- **`balance > 0`** — the party owes the store. Shown red, tagged `Dr`.
- **`balance < 0`** — the store owes the party. Shown green, tagged `Cr`. Either
  a vendor payable, or a customer holding store credit from a return that was
  never refunded in cash.
- `|balance| <= 0.005` renders as `—`; sub-paisa Decimal noise is not a debt.

Note `GET /api/ledger/outstanding` does **not** follow this — it returns
`Math.abs(balance)`, discarding direction. See [ledger.md](ledger.md).

## Where the live figure comes from

`GET /api/parties?withBalance=true&branchId=` adds a `balance` field.
Opt-in on purpose: the Parties page wants it, but the checkout screen's party
search does not, and skipping the aggregate keeps that lookup cheap.

It resolves through **`getPartyBalances(parties, branchId)`** in
`lib/party-balance.ts` — one `groupBy` for the whole list rather than a
`getPartyBalance` call per row. Parties with no ledger rows still get an entry
(their opening balance), so callers can index the map without a fallback.

## Footer totals

Two figures, not one net total: **Total Receivable** (sum of the positive
balances) and **Total Payable** (sum of the negative ones, as a positive
amount). Netting a customer's debt against a vendor's payable would hide both.
Computed over the *visible* rows, so the type filter narrows them too.
