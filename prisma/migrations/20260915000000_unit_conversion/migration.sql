-- Buying in one unit and selling in another (buy gaz, sell metre; buy bundles,
-- sell pieces).
--
-- The conversion happens once, at the GRN: stock is always held in the unit the
-- item is SOLD in, and the item's purchase price is restated per that unit at
-- the same moment. Nothing downstream — sales, ledger, valuation, the
-- dashboard's profit figure — needed a column, because quantity and price stay
-- in step by construction. See lib/units.ts.
--
-- Every backfill below is a no-op in behavioural terms: existing items are
-- bought and sold in the same unit, so their purchaseUnit equals their unit and
-- their stockQty equals their qty. History is preserved exactly.

-- BUNDLE is a purchase-side counting unit. "Item"."unit" is never set to it.
ALTER TYPE "Unit" ADD VALUE IF NOT EXISTS 'BUNDLE';

-- ── Item ─────────────────────────────────────────────────────────────────────
-- purchaseUnit is informational: it pre-selects the GRN's buy-unit dropdown and
-- drives the "GAZ: 24" line under a stock figure. Nothing calculates from it.
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "purchaseUnit" "Unit";
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "piecesPerBundle" INTEGER;

UPDATE "Item" SET "purchaseUnit" = "unit" WHERE "purchaseUnit" IS NULL;

-- ── ItemStock ────────────────────────────────────────────────────────────────
-- 12,3 -> 14,4. One metre of a gaz-stocked item is 1.1111 gaz; at three
-- decimals nine metres leave a phantom 0.001 on hand and the sales screen
-- offers a metre of cloth that is not on the shelf. Widening a Postgres numeric
-- never loses data, so this needs no backfill.
ALTER TABLE "ItemStock" ALTER COLUMN "qty" TYPE DECIMAL(14,4);

-- ── GRNItem ──────────────────────────────────────────────────────────────────
-- "qty"/"costRate" stay as the vendor billed them, in "buyUnit" — the GRN's
-- money has to match the bill in the vendor's own terms. "stockQty" is that
-- quantity converted into the item's sell unit, which is what actually moved
-- stock. Stored rather than derived on read, so editing the gaz/metre settings
-- later can never rewrite what a past receipt did.
ALTER TABLE "GRNItem" ADD COLUMN IF NOT EXISTS "buyUnit" "Unit";
ALTER TABLE "GRNItem" ADD COLUMN IF NOT EXISTS "stockQty" DECIMAL(14,4);

UPDATE "GRNItem" gi
SET "buyUnit" = i."unit",
    "stockQty" = gi."qty"
FROM "Item" i
WHERE i."id" = gi."itemId"
  AND gi."buyUnit" IS NULL;

-- ── Settings ─────────────────────────────────────────────────────────────────
-- Inches per gaz and per metre, from which the 0.9 / 1.111 factors are derived.
-- Deliberately not the two factors themselves: those could be edited into
-- disagreeing with each other, and then a quantity converted out and back would
-- not come home.
INSERT INTO "Setting" ("id", "key", "value", "updatedAt")
VALUES
  ('seed_units_inches_gaz', 'units.inchesPerGaz', '36', NOW()),
  ('seed_units_inches_mtr', 'units.inchesPerMtr', '40', NOW())
ON CONFLICT ("key") DO NOTHING;
