import { Prisma } from "@prisma/client";
import { STOCK_UNITS, TX_UNITS, isClothType } from "@/lib/units";

/**
 * Normalises an item payload coming off the wire into exactly the columns
 * `Item` has.
 *
 * Both item routes used to hand the parsed request body straight to
 * `prisma.item.create/update({ data: body })`. That broke the edit form: the
 * rows `GET /api/items` returns carry `currentStock`, which lives on
 * `ItemStock` and is not an `Item` column, so Prisma rejected the whole update
 * and every edit failed. It was also wider than intended — any caller could set
 * any column, `isActive` included, by adding it to the JSON.
 *
 * Only the fields listed here are ever written, and the numeric ones are
 * coerced, so an empty text input arriving as `""` becomes 0 rather than a
 * Prisma type error.
 */

const TEXT_FIELDS = [
  "name", "description", "group", "category", "brand", "barcode",
] as const;

const RELATION_FIELDS = ["categoryId", "brandId", "groupId"] as const;

const NUMBER_FIELDS = [
  "purchasePrice", "salePrice", "discountRS", "discountPct",
  "openingStock", "minLevel",
] as const;

/**
 * `Item.unit` is the **sell** unit, and the unit stock is held in — so it can
 * never be BUNDLE, which is a purchase-side counting unit only. `purchaseUnit`
 * may be any of the four. See `lib/units.ts`.
 */
const UNITS = STOCK_UNITS;

/** A blank optional field means "cleared", which is null in the DB, not "". */
function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function pickItemFields(
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): Prisma.ItemUncheckedUpdateInput {
  const data: Record<string, unknown> = {};

  for (const key of TEXT_FIELDS) {
    if (!(key in body)) continue;
    // `name` is required, so it is never nulled out by a blank string.
    if (key === "name") {
      const name = String(body.name ?? "").trim();
      if (name) data.name = name;
      continue;
    }
    data[key] = textOrNull(body[key]);
  }

  for (const key of RELATION_FIELDS) {
    if (!(key in body)) continue;
    data[key] = textOrNull(body[key]);
  }

  for (const key of NUMBER_FIELDS) {
    if (!(key in body)) continue;
    const n = toNumber(body[key]);
    if (n !== undefined) data[key] = n;
    else if (!partial) data[key] = 0;
  }

  // Nullable on the model, so it round-trips as null rather than 0 when blank.
  if ("altSalePrice" in body) {
    data.altSalePrice = toNumber(body.altSalePrice) ?? null;
  }

  if (typeof body.unit === "string" && (UNITS as readonly string[]).includes(body.unit)) {
    data.unit = body.unit as (typeof UNITS)[number];
  }

  // Informational only — it pre-selects the GRN's buy-unit dropdown and drives
  // the "GAZ: 24" line under a stock figure. Blank clears it back to null
  // rather than to a unit nobody chose.
  if ("purchaseUnit" in body) {
    const value = body.purchaseUnit;
    data.purchaseUnit =
      typeof value === "string" && (TX_UNITS as readonly string[]).includes(value)
        ? (value as (typeof TX_UNITS)[number])
        : null;
  }

  // A bundle size has to be a whole count of pieces — half a piece in a bundle
  // makes the expansion at the GRN meaningless. 0 and blank both mean "this
  // item isn't sold in bundles", which is null, so `allowedTxUnits` stops
  // offering BUNDLE.
  if ("piecesPerBundle" in body) {
    const n = toNumber(body.piecesPerBundle);
    data.piecesPerBundle =
      n !== undefined && Number.isInteger(n) && n > 0 ? n : null;
  }

  // Optional; anything that isn't a known type clears it.
  if ("clothType" in body) {
    data.clothType = isClothType(body.clothType) ? body.clothType : null;
  }

  // Deliberately not taken from the body on create/update: deactivating an item
  // is what DELETE /api/items/[id] is for, and it carries its own permission.
  delete data.isActive;

  return data as Prisma.ItemUncheckedUpdateInput;
}

/**
 * Just enough of the Prisma client to look an item up. Passed in rather than
 * imported so this module stays free of side effects — importing `lib/prisma`
 * here would spin up a `PrismaClient` inside the unit tests that exercise
 * `pickItemFields`.
 */
type ItemFinder = {
  item: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: { id: true; name: true };
    }): Promise<{ id: string; name: string } | null>;
  };
};

/**
 * The item already carrying `barcode`, or null when the code is free.
 *
 * A barcode is what the sales and GRN screens scan to resolve one item, so two
 * items sharing a code means a scan silently picks whichever the query happens
 * to return first — the wrong price on the bill, and the wrong item's stock
 * moving. `Item.barcode` is only indexed, not unique (see prisma/schema.prisma),
 * so nothing in the database stops that; this check is what does.
 *
 * Matched case-insensitively: an alphanumeric code re-keyed by hand in a
 * different case is the same physical label, not a second item.
 *
 * **Only active items are considered.** A deleted item is soft-deleted
 * (`isActive: false`) and no longer scannable, so its code is free again —
 * blocking it would be a dead end, since the item is not in the list to be
 * found and corrected.
 */
export async function findBarcodeOwner(
  db: ItemFinder,
  barcode: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  return db.item.findFirst({
    where: {
      // A company barcode must not collide with any item's system code either,
      // or a scan of that label could resolve to two items.
      OR: [
        { barcode: { equals: barcode, mode: "insensitive" } },
        { systemBarcode: barcode },
      ],
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/**
 * The active item already called `name`, or null when the name is free.
 *
 * Two items with the same name can't be told apart in the item search, the
 * sale and GRN pickers or the reports, so both write routes refuse it. Same
 * rules as `findBarcodeOwner`: case-insensitive (the name arrives trimmed from
 * `pickItemFields`), and a soft-deleted item's name is free again.
 */
export async function findNameOwner(
  db: ItemFinder,
  name: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  return db.item.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/** The 409 body both write routes return for a taken name. */
export function nameConflictMessage(owner: { name: string }): string {
  return `An item named "${owner.name}" already exists`;
}

/** The 409 body both write routes return for a taken barcode. */
export function barcodeConflictMessage(barcode: string, owner: { name: string }): string {
  return `Barcode ${barcode} is already used by "${owner.name}"`;
}
