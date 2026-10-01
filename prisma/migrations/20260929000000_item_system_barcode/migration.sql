-- The shop's own barcode for every item: numeric, unique, assigned by the
-- database so no insert path (the app, the seed, a backup restore) can leave an
-- item without one or hand two items the same code. "2" + 7 digits keeps it in
-- the GS1 in-store range, clear of real manufacturers' codes. Item.barcode stays
-- as the optional company barcode; a scan of either resolves the item.
--
-- The sequence is deliberately NOT owned by the column: backup restore resets
-- owned sequences with MAX(col) + 1, which cannot work on text. Instead the
-- function skips any code already taken — by either column — so it heals by
-- itself after a restore puts rows back ahead of the sequence.
CREATE SEQUENCE "item_system_barcode_seq";

CREATE FUNCTION next_item_system_barcode() RETURNS TEXT AS $$
DECLARE
  n BIGINT;
  code TEXT;
BEGIN
  LOOP
    n := nextval('item_system_barcode_seq');
    code := '2' || lpad(n::text, GREATEST(7, length(n::text)), '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "Item" WHERE "systemBarcode" = code OR "barcode" = code
    );
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "Item" ADD COLUMN "systemBarcode" TEXT;

-- Existing items numbered in the order they were created.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM "Item" ORDER BY "createdAt", id LOOP
    UPDATE "Item" SET "systemBarcode" = next_item_system_barcode() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "Item" ALTER COLUMN "systemBarcode" SET DEFAULT next_item_system_barcode();
ALTER TABLE "Item" ALTER COLUMN "systemBarcode" SET NOT NULL;
CREATE UNIQUE INDEX "Item_systemBarcode_key" ON "Item"("systemBarcode");
