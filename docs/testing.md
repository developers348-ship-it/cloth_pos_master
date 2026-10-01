# Tests

```
npm test         # one run
npm run test:watch
```

Vitest 3, node environment, config in `vitest.config.ts`. Tests live in `tests/*.test.ts` and import through the `@/` alias, which the config maps by hand (no tsconfig-paths dependency). Pinned to v3 because v5 wants `@types/node` ≥22 and this project is on ^20.

## What is covered, and why only this

**The pure money logic** — the calculations that decide what a customer owes, what a repayment schedule looks like, what a payload may write, and who is allowed to change any of it. Those modules were deliberately written without a Prisma import so they could be tested exactly this way; the two that do import it (`lib/repayment-plan.ts`, `lib/accounts.ts`) are used through their pure validators with `vi.mock("@/lib/prisma", () => ({ prisma: {} }))`, so no test opens a database connection.

| File | Covers |
| --- | --- |
| `tests/invoice-totals.test.ts` | `calculateInvoiceTotals` (lines, discounts, bill assembly, refunds, store credit), `cashKeptFromTender`, `computeSaleLedgerSplit`, `computePurchaseLedgerSplit` |
| `tests/installments.test.ts` | schedule generation (amounts, rounding remainder, month-end clamping, leap years), `outstandingForPlan`, the collection cascade, `isOverdue`, `validateRepaymentPlan`, `summarizePlan` |
| `tests/invoice-settlement.test.ts` | settled/outstanding/payment-status, including the Mark Paid → Mark Unpaid round trip, plus `invoiceRefundable` (the ceiling on a full-order refund's payout) |
| `tests/permissions.test.ts` | `isAllowed` (unknown key fails closed, SUPER_ADMIN override, per-key layering of a stale saved matrix) and invariants of the default matrix |
| `tests/payload-guards.test.ts` | `validateGrnPayment` and `pickItemFields` |
| `tests/impersonation.test.ts` | the "sign in as user" rules — the strictly-lower `ROLE_RANK` guard that keeps it from being a privilege escalation, self/deactivated targets, and that the settings button agrees with the server rule on every pair of roles |
| `tests/grn-settlement.test.ts` | the purchase-side mirror: what a GRN has been paid (receipt-time, plan collections, and Ledger-page payments carrying its `grnId`), what is still owed on it, its PAID/PARTIAL/UNPAID badge, and that a net-return GRN owes nothing |
| `tests/sale-validation.test.ts` | `validateSalePayment` — payment-method completeness, "a Cash sale must be settled", "a CC sale must not be fully paid", and the walking-customer credit ban |
| `tests/settlement-allocation.test.ts` | `allocateFifo` (oldest-first split, cascade, its own sorting) and `validateAllocations` (the cap at what a party actually owes, per-bill caps, duplicate/unknown bills) |
| `tests/branding.test.ts` | `brandingInitial` (the letter in the fallback icon, including the Latin-first rule and multi-byte names), `brandingShortName`, `parseDataUrl` round-trips, `validateBrandingUpload` and the `isBrandingAsset` path guard |

**Not covered, deliberately:** route handlers, Prisma transaction ops and React components. Those need a database or a DOM, and the phased rollout verified them end-to-end through the real routes against a local Postgres copy instead (see the plan file). `components/ui/NumberInput.tsx` is the one piece of UI logic worth testing eventually — it would need jsdom and `@testing-library/react`.

## The suite has been checked for teeth

Reintroducing each of these real bugs makes it fail; every one was caught:

- `change` measured against `netBill` instead of its magnitude (the Phase 3 refund bug)
- payment status counting only cash + card (the pre-Phase-7 formula)
- the installment schedule dropping its rounding remainder
- `isAllowed` failing *open* on an unknown permission key
- `pickItemFields` letting `isActive` through

## The change-handed-back defect is fixed

`SaleInvoice.cashReceived` used to store the amount **tendered**, and the party
ledger, the Cash account and the installment plan were all posted that figure —
so a 1000 bill paid with a 1500 note gave the customer 500 of store credit they
never earned and overstated cash in hand by 500. `cashKeptFromTender` in
`lib/utils.ts` now nets the change off, once, in `POST /api/sales`, so the
column never holds a tender and every downstream reader is correct without
knowing the rule exists. Covered by
`describe("cashKeptFromTender — change handed back is not the store's money")`
in `tests/invoice-totals.test.ts`, including the case that must *not* net: on a
net-return invoice `change` means "over-refunded" and that cash really did
leave the drawer.

The one invoice saved before this change (#1) was corrected on 2026-09-29, so
no stored invoice holds a tender any more.

## `tests/units.test.ts`

Covers `lib/units.ts` end to end: gaz/metre and bundle/piece conversion, the
cross-family refusals, `resolveGrnLine`'s handling of a GRN payload, and
`formatStock`'s bought-as line.

Two cases are worth knowing about specifically, because they are the properties
the whole unit design rests on rather than ordinary examples:

- ***"conserves what a line is worth"*** — asserts `qty_from x rate_from ===
  qty_to x rate_to` across several figures. If this fails, a GRN's converted
  cost stops reconciling with the vendor's bill and the dashboard's profit
  figure drifts.
- ***"nine metres out of ten gaz leaves an empty shelf, not 0.001"*** — the
  reason `ItemStock.qty` carries four decimals rather than three.

Deliberately not covered, for the same reason as the rest of the suite: nothing
here touches Prisma, so the GRN write path itself (the stock upsert, the
re-denomination `multiply`, the `Item.purchasePrice` writeback) is unverified by
tests. `resolveGrnLine` is extracted precisely so the arithmetic those ops
depend on can be tested without a database.

## `tests/shop-dates.test.ts`

The shop-timezone date helpers in `lib/utils.ts`. Clock-dependent, so it uses
`vi.setSystemTime` to pin an instant rather than trusting the machine it runs
on — which is the whole point, since the bug it guards against only appears
when the machine's clock and the shop's disagree.

The cases that matter are the boundaries, not the middle of the day: 02:00 shop
time (still the previous day in UTC), 23:59 shop time, the exact rollover at
19:00 UTC, and the month and year crossings that happen while UTC is still on
the day before. There is also a pair asserting consecutive days leave **no gap
and no overlap** — the gap is what swallowed a real invoice.
