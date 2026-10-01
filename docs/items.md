# Items — list, add, edit

- Page: `app/dashboard/items/page.tsx`; the add/edit dialog is `components/items/ItemFormModal.tsx`.
  It is also opened from the GRN and sales screens — by a scan that matched nothing (`defaultBarcode`
  pre-fills the code), by their quick Add-Item buttons, and on the GRN by an item search that came
  back empty (`defaultName` pre-fills the typed text). See `purchases-grn.md`.
- Its **barcode field is the place a code gets registered**: a font-mono input with a scan hint that
  swallows the Enter/Tab a scanner sends after the digits, so a scan can't move focus or submit the
  form half-filled. A USB scanner is just a keyboard — pointing it at that field is the whole flow.
- Routes: `app/api/items/route.ts` (GET list, POST create), `app/api/items/[id]/route.ts` (PUT update, DELETE soft-delete via `isActive: false`).
- Gated on `ADD_ITEM` / `EDIT_ITEM` / `DELETE_ITEM`, on both the route and the button — see `schema-permissions.md`.

## Editing used to fail outright, and why

`GET /api/items` returns a **projection**, not raw `Item` rows, and it includes `currentStock` — which lives on `ItemStock` and is not a column on `Item`. The page fed a row from that list straight into the edit dialog, the dialog spread the whole thing into its PUT body, and the route did `prisma.item.update({ where: { id }, data: body })`. Prisma rejected the unknown field, so **every** item edit returned a 500 and the UI showed the generic "failed to save".

Three changes, each independently sufficient, so this can't come back the next time the projection changes:

1. **`lib/items.ts` — `pickItemFields(body, { partial })`.** Both write routes now run the body through a whitelist of real `Item` columns, coercing the numeric ones (an empty text input arriving as `""` becomes 0, not a Prisma type error) and mapping blank optional text to `null`. `isActive` is deliberately not writable through it — deactivating is what DELETE is for, and it carries its own permission.
2. **The list projection was widened** to carry everything the edit form writes back: `description`, `categoryId`, `brandId`, `groupId`, `openingStock`, `minLevel`, `isActive`. Without those, a save would have blanked the item's category, brand and group even once the crash was fixed.
3. **The dialog builds its payload field by field** instead of spreading `form`, and now surfaces the server's actual error message (a 403 from the permission guard, a validation message) rather than a blanket "failed to save".

`partial: true` matters: the GRN's barcode-attach path sends `{ barcode }` on its own, and must not blank the rest of the item. An empty body is a 400.

`openingStock` is only sent on create, where it becomes the `ItemStock` row for the branch. On an edit the column is left alone — it is the figure the item started life with, and the stock report prints it as its own "Opening Stock" column. **Live stock is editable on the same form through a separate field; see below.**

## Barcodes are unique among active items

`Item.barcode` is `String?` with a plain `@@index`, **not** `@@unique` (`prisma/schema.prisma`). Two items could hold the same code, and then a scan on the sales or GRN screen resolves to whichever row the query returned first — the wrong price on the bill and the wrong item's stock moving. Nothing in the database prevents it; three things in the app now do.

- **`lib/items.ts` — `findBarcodeOwner(db, barcode, excludeId?)`.** Returns the active item already holding the code, or null. It takes the Prisma client as an argument rather than importing `lib/prisma`, so the module stays side-effect free for the `pickItemFields` unit tests. Matched **case-insensitively**: the same label re-keyed by hand in a different case is not a second item.
- **Both write routes answer `409`** with `{ error, conflictItemId }`. POST checks the code outright; PUT passes the item's own id as `excludeId`, so re-saving an edit that never touched the barcode doesn't report the item as its own duplicate. PUT is also where the GRN's `{ barcode }`-only attach path lands — the likeliest way a code gets pinned to a second item by accident.
- **`ItemFormModal` checks as you type.** A 350 ms debounce (one request per scan burst, not per digit) hits `GET /api/items?q=`, then narrows the `contains`-across-name/brand/category/barcode results to an exact barcode hit. The field turns red and names the conflicting item; save is blocked. A lookup still in flight does *not* block — the route re-runs the check and returns 409 if it lands late.

**Only active items are considered.** A deleted item is soft-deleted (`isActive: false`) and no longer scannable, so its code is free again. Blocking on it would be a dead end: the item isn't in the list, so the operator can't find it to clear the code.

The application check is not a race-proof guarantee — two simultaneous creates could still both pass. A partial unique index on `barcode WHERE isActive` is the real fix; it isn't in place because existing rows may already hold duplicates and would have to be reconciled first, and because migrations here land on the local Postgres, not the Supabase instance the app actually uses.

## Numeric inputs — `components/ui/NumberInput.tsx`

Used by this dialog and the Sales page (the Purchases page still has the raw pattern).

The plain `<input type="number" value={n} onChange={e => set(Number(e.target.value))} />` this replaces has two faults that show up constantly on a till:

- **The zero can't be cleared.** Backspace gives `""`, `Number("")` is 0, the field re-renders as "0", and the next digit lands beside it — "05", or "50" if the caret was to the left.
- **Decimals below one can't be typed.** Where the value was mapped with `Number(v) || 0` (the sales line-item columns), typing the "0" of "0.5" produced 0, which rendered as an empty box, leaving the decimal point nothing to attach to.

`NumberInput` lets the *text* be the source of truth while the box is being edited and the number take over once it isn't: a `draft` string holds what was typed, dropped on blur. A blank box reports 0 without forcing "0" back into the field. Focus selects the contents, so tapping a field and typing replaces the figure rather than appending to it.

Props beyond the usual input ones:

- `value: number` / `onChange: (n: number) => void` — numbers, not events.
- `blankZero` — render 0 as an empty box (with the placeholder showing); used by the sales line-item columns.
- `transform` — clamp or round before the parent hears about it. When a transform actually changes the figure, the box snaps to the clamped value immediately so it never displays a number that isn't the one in effect. Used by the store-credit field, which is capped at the credit the customer holds.

The stale-draft check runs during render (the documented React "adjust state when props change" pattern) rather than in an effect, so a parent that clamps, resets or recalculates a value still wins, without tripping the repo's `react-hooks/set-state-in-effect` rule.

## The Stock column reads `currentStock`, not `openingStock`

`GET /api/items?branchId=` derives **`currentStock`** from the `ItemStock` row
for that branch. `Item.openingStock` is the quantity the item was created with
and never moves.

The list used to read `item.stockLevels?.[0]?.qty ?? item.openingStock` — a
shape that endpoint has **never returned** — so it always fell through to
`openingStock` and the column sat frozen at the starting quantity no matter how
much was sold or received. The "Low Stock" badge was wrong for the same reason.
Stock itself was decrementing correctly in the database; only the display was
wrong.

### A related gap, not yet fixed

Sales adjust stock with `prisma.itemStock.updateMany(...)`
(`app/api/sales/route.ts` plus the void/restore/delete/refund reversals), and
`updateMany` **silently does nothing when no row matches**. Purchases use
`upsert` (`app/api/purchases/route.ts`) and are safe. An item created in one
branch has no `ItemStock` row for a second branch, so a sale there would not
reduce stock at all. Single-branch installs never hit it; the fix is to make
those five write sites upsert like the purchase side, and it wants its own
verification pass because it touches stock movement.

## Sell Unit, Buy Unit and Pieces per Bundle

An item can be bought in one unit and sold in another — 24 gaz in, sold by the
metre. Three fields on the form carry that, and **`units.md` is where the whole
mechanism is explained**; only what the form does is here.

- **Sell Unit** (the `unit` column, relabelled). What the item is priced and
  sold in, and the unit `ItemStock.qty` is measured in. `PCS | GAZ | MTR` —
  never `BUNDLE`, which `pickItemFields` refuses because stock is not held in
  bundles.
- **Buy Unit** (`purchaseUnit`, nullable). Informational: it pre-selects the
  GRN's buy-unit dropdown and drives the "bought as" line under a stock figure.
  Nothing calculates from it. Blank means "same as the sell unit". Offered only
  within the sell unit's family, so cloth can never be marked as bought by the
  piece. When it differs, the form spells the relationship out underneath —
  `1 GAZ = 0.9000 MTR`.
- **Pieces per Bundle** (`piecesPerBundle`, nullable). Shown only for `PCS`
  items. Whole positive count or null; `pickItemFields` maps 0, blank, a
  fraction and a negative all to null, which is what stops `BUNDLE` being
  offered as a buy unit at all. A bundle is a counting convenience, not a sealed
  pack — stock stays in pieces and part-selling is normal.

**Changing the Sell Unit on an item that already holds stock re-labels that
stock without moving it.** The GRN handles this (it re-states the quantity when
a line's sell unit differs); this form does not. Change the unit through a GRN
line, or adjust stock afterwards.

The Stock column shows the figure in the sell unit with the bought-as quantity
beneath it — present only when the two units differ, so the ordinary item stays
a single clean number.

## The Quantity box — one field, two jobs

It sits directly above Description, with the sell unit in its label
(`Quantity (MTR)`), and it always means **what is on the shelf** — not a
separate "opening" figure the operator has to reason about.

- **On create** it writes `Item.openingStock` *and* seeds the branch's
  `ItemStock` row, which is what the field always did.
- **On edit** it seeds from `currentStock` (the derived figure from
  `GET /api/items`, not `openingStock`, which never moves) and saving sets stock
  to **exactly that number** — an absolute figure, not a delta. The hint under
  the box turns amber and reads "Will be changed from 45" as soon as the value
  differs, because changing stock from an edit form should not be something
  discovered afterwards.

Stock previously could not be changed here at all; the only route to it was the
Purchases screen's adjust dialog.

### It is recorded, and it carries its own permission

`PUT /api/items/[id]` takes `{ branchId, stockQty }` and writes a
**`StockAdjustment`** row alongside the `ItemStock` upsert — magnitude plus
`ADD`/`SUBTRACT` direction, reason `"Set from item edit"`. Same reason
`/api/inventory/adjust` does it: stock that changes with no trace is stock
nobody can reconcile.

The route requires **`ADJUST_STOCK` in addition to `EDIT_ITEM`**. Without that
second check, editing an item would be a way around the stock permission —
anyone who may rename an item could set its quantity to anything.

`stockQty` is **not** in `pickItemFields` and never will be: stock lives on
`ItemStock`, per branch, and is not a column on `Item`. The route handles it
explicitly, which is also why a body carrying only `stockQty` no longer trips
the "Nothing to update" 400.

**The form sends `stockQty` only when the value actually changed.** The two
permissions are separately revocable on the roles page, so sending it on every
save would 403 an ordinary edit by anyone holding one but not the other. The
comparison is made at 4dp — `ItemStock.qty`'s precision — because a difference
the column cannot store is not a change.

## Two barcodes per item

- **`Item.systemBarcode`** — the shop's own code, `2` + 7 digits (`20000001`). Assigned by the
  database on insert (`next_item_system_barcode()`, migration `20260929000000_item_system_barcode`),
  unique by constraint, never written by the app (not in the `pickItemFields` whitelist). It is what
  `BarcodePrintModal` prints. Labels used to print `itemId.slice(-10)` for items without a barcode —
  a code nothing could scan back.
- **`Item.barcode`** — the optional company barcode off the packaging, registered by scanning it into
  the item form or via the scanner's "attach to item" flow.

A scan of either resolves the item: `matchesBarcode()` in `components/items/BarcodeScanner.tsx` is the
one equality check, used by the scanner and by the sales/GRN row boxes. `findBarcodeOwner` rejects a
company barcode equal to any active item's system code.

The generator's sequence is deliberately **not** owned by the column — backup restore resets owned
sequences with `MAX(col) + 1`, which fails on text. It instead skips codes already taken in either
column, so it catches up by itself after a restore.
