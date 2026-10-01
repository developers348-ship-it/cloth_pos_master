# Units — gaz/metre and bundle/piece

Cloth arrives from the vendor billed in one unit and goes over the counter in
another: 24 gaz in, sold by the metre. Countables arrive in bundles and are sold
by the piece. This is how that is handled.

Core module: `lib/units.ts` (pure, Prisma-free). Settings reader:
`lib/unit-settings.ts`. Client hook: `lib/use-unit-config.ts`.

## The one rule

**Stock is always held in the unit the item is sold in.** The conversion happens
exactly once, at the GRN, when goods are received.

That is the whole design, and everything else follows from it. `Item.unit` is
the sell unit *and* the unit `ItemStock.qty` is measured in; `Item.salePrice`
and `Item.purchasePrice` are both quoted per that same unit. Because quantity
and price are in step by construction, **every downstream reader needed no
change at all** — sales, the party ledger, stock valuation, the dashboard's
profit figure, the reports. None of them knows this file exists.

The alternative that was considered and rejected was carrying a buy unit and a
sell unit through every table and every report. It spreads a purchase-time
concern across the whole application, and it is the version where the two
calculations below go wrong.

## The worked example

GRN line: buy **24 GAZ @ Rs 100/gaz**, sell unit **MTR @ Rs 130/mtr**.

```
stock            += 24 × 0.9   = 21.60 MTR      → ItemStock.qty
Item.unit                       = MTR            (the sell unit wins)
Item.purchaseUnit               = GAZ            (informational only)
Item.purchasePrice              = 100 ÷ 0.9      = Rs 111.11 /mtr
Item.salePrice                  = 130            (already per mtr, untouched)
GRN amount                      = 24 × 100       = Rs 2,400  (the vendor's bill)
```

`21.60 × 111.11 = Rs 2,400` — the converted cost reconciles back to the bill
exactly. That identity is the property the design rests on, and
`tests/units.test.ts` asserts it directly (*"conserves what a line is worth"*).

Bundles ride the same rail: 5 bundles of 12 @ Rs 1,200 → 60 PCS in stock at
Rs 100/pcs, and `60 × 100 = 5 × 1200`.

## The two calculations that this had to get right

Both are silent, and both only appear once buy-unit ≠ sell-unit.

1. **Cost of goods.** `Item.purchasePrice` *must* be the converted rate.
   Writing the raw Rs 100/gaz against per-metre stock understates cost by 10%
   on every subsequent sale, straight into the dashboard's net profit
   (`app/api/reports/dashboard/route.ts` computes `qty × purchasePrice`).
   Converted at `app/api/purchases/route.ts`, in the item price writeback.

2. **Stock valuation.** `app/api/reports/stock/route.ts` computes
   `currentStock × salePrice`. That is correct **only because** both sides are
   in the sell unit. Nothing there converts, and nothing there should start to
   — if stock ever stops being held in the sell unit, this line breaks first.

## Why inches, not a pair of factors

Settings store **inches per gaz (36)** and **inches per metre (40)**; the
0.9 / 1.111 factors are derived. Two free-standing factors could be edited into
disagreeing with each other — 0.9 and 1.2, say — and then a quantity converted
out and back would not come home. One pair of lengths makes that
unrepresentable. The Settings → Units tab shows the derived factors read-only
beneath the two inputs.

A true metre is 39.37 inches; **40 is a shop convention**, and it is the default
rather than a hard-coded constant precisely so a shop that reconciles against
metric invoices can change it. `tests/units.test.ts` covers the 39.37 case.

Keys: `units.inchesPerGaz`, `units.inchesPerMtr` in the generic `Setting`
key/value table — the same table branding and role permissions use, so this
needed no model of its own and is already inside backup/restore.

## Unit families

| Family | Stock unit | Also transactable in | Conversion |
|---|---|---|---|
| LENGTH | `GAZ` or `MTR` | the other one | via inches |
| COUNT | `PCS` | `BUNDLE` | `Item.piecesPerBundle` |

`BUNDLE` is in the `Unit` enum but **stock is never held in it** and
`Item.unit` is never set to it — `lib/items.ts` refuses it in the write
whitelist, and `sellUnitOptions` never offers it. It exists so a GRN line can
say "five bundles arrived".

A bundle is a **counting convenience, not a sealed pack**: stock is in pieces,
and part-selling is normal. `convertQty(66, "PCS", "BUNDLE", …)` answers 5.5
without complaint.

Cross-family conversion throws `UnitConversionError` rather than guessing —
cloth cannot become pieces. `POST /api/purchases` catches it and answers 400
for the whole receipt rather than writing half of one.

## Precision

`ItemStock.qty` is `Decimal(14,4)`, widened from `(12,3)`. One metre of a
gaz-stocked item is 1.1111 gaz; at three decimals nine metres leave a phantom
0.001 gaz on hand and the sales screen offers a metre of cloth that is not on
the shelf. The fourth digit keeps every 2dp display exact.

Money stays `Decimal(12,2)`, so a converted rate rounds to paisa — the 24-gaz
example above reconciles to within 2.4 paisa of the bill, not to zero. That is
inherent in storing a price at 2dp and is not worth chasing.

## Re-denominating stock already on hand

This is the one place the design could silently corrupt a figure, so it is
handled explicitly.

A GRN line whose sell unit differs from the item's current one changes what
`ItemStock.qty` *means*. The quantity already on the shelf has to move with it:
an item sitting on 21.6 MTR that starts being sold by the gaz holds **24 GAZ**,
not 24 MTR. `restatedStock()` computes the factor and
`app/api/purchases/route.ts` applies it:

- with Prisma's `multiply`, not read-modify-write, so it stays atomic;
- with `updateMany` across **every branch**, because `Item.unit` is global and
  leaving another branch's rows in the old unit is the same bug one step away;
- **once per item** (a GRN may carry several lines for one item) and **before**
  the increments, which are already in the new unit.

The item edit form can change the sell unit too. Doing so on an item that holds
stock has the same consequence and is not currently re-stated there — change the
unit through a GRN line, or adjust stock afterwards.

## Where each piece lives

| Concern | File |
|---|---|
| Conversion, formatting, GRN line resolution | `lib/units.ts` |
| Reading/writing the inch settings (cached 60s) | `lib/unit-settings.ts` |
| Client-side config, one fetch per page load | `lib/use-unit-config.ts` |
| Settings → Units tab | `app/dashboard/settings/page.tsx` |
| `GET`/`PUT` the lengths | `app/api/settings/units/route.ts` |
| Buy/Sell unit columns, live preview | `app/dashboard/purchases/page.tsx` |
| **The conversion itself** | `app/api/purchases/route.ts` |
| Sell Unit / Buy Unit / Pieces per Bundle | `components/items/ItemFormModal.tsx` |
| Tests | `tests/units.test.ts`, `tests/payload-guards.test.ts` |

## Schema

```prisma
enum Unit { PCS  GAZ  MTR  BUNDLE }

model Item {
  unit            Unit    // sell unit; stock is measured in it
  purchaseUnit    Unit?   // informational — see below
  piecesPerBundle Int?    // PCS items only; null = not sold in bundles
}
model ItemStock { qty Decimal @db.Decimal(14, 4) }   // in Item.unit
model GRNItem {
  qty      Decimal   // as billed, in buyUnit
  buyUnit  Unit?
  stockQty Decimal?  // converted — what actually moved stock
  costRate Decimal   // as billed, per buyUnit
}
```

`Item.purchaseUnit` is **informational**. It pre-selects the GRN's buy-unit
dropdown and drives the "GAZ: 24" line under a stock figure. Nothing calculates
from it; the conversion is driven by the GRN line's own `buyUnit`.

`GRNItem.stockQty` is stored rather than recomputed on read, so editing the
gaz/metre settings later can never rewrite what a past receipt did. Reopening a
GRN reads `buyUnit` off the row for the same reason — an item resold in a
different unit since would otherwise make the reopened receipt describe a
conversion that never happened.

Migration: `prisma/migrations/20260915000000_unit_conversion`. Every backfill is
a behavioural no-op — existing items are bought and sold in the same unit, so
`purchaseUnit = unit` and `stockQty = qty`.

> ⚠️ `prisma migrate` writes to the **local Postgres**; the app runs against
> **Supabase**. The SQL and the backfill both have to be applied there
> deliberately.

## The sales screen

The unit cell is **fixed, not chosen** — it renders `item.unit` as read-only
text.

It used to be a free PCS/GAZ/MTR dropdown that changed nothing: the rate stayed
the catalog rate and stock moved by the raw quantity, so picking MTR on a GAZ
item charged the gaz price and took a gaz off the shelf. The unit is settled
once, at the GRN; by the time an item reaches the till there is nothing left to
decide.

Beneath each quantity box is an **Available** line, and `NumberInput`'s
`transform` caps what can be typed at that figure — the box snaps, and the line
turns red at the cap, which is why no toast is needed. `availableFor()`
subtracts what the same item is already committed to on *other* rows, so an
item on two lines cannot sell the shelf twice. Return rows are goods coming back
in and are not capped.

`POST /api/sales` re-checks it, for the same reason `validateSalePayment` runs
in both places: a cap that lives only in the browser is not a cap. It enforces
only rows that **exist** — an item with no `ItemStock` row for the branch is
"never tracked here", not "zero", and blocking on it would stop every sale in a
second branch. That is the known `updateMany` gap written up at the end of
`items.md`; closing it is not this guard's job.
