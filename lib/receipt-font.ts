/**
 * The 80mm thermal slip's type scale, driven by one setting.
 *
 * Thermal printers differ enough in dot pitch that a receipt legible on one
 * comes out unreadably small on the next, so the base size is a per-branch
 * setting (`Branch.receiptFontSize`) rather than a constant. Every other size
 * on the slip is derived from it here, in one place, so the two receipt
 * renderers — the Sales page's print block and `InvoiceReceipt` (the re-print
 * from the sales report) — cannot drift apart or stop being proportional when
 * the shopkeeper turns the dial up.
 *
 * The offsets are absolute, not multiplicative: the gap between the body text
 * and the store name is a typographic step, and at 20px a 1.33x multiplier
 * would blow the header past the paper width.
 */

export const RECEIPT_FONT_SIZE_DEFAULT = 12;
export const RECEIPT_FONT_SIZE_MIN = 8;
export const RECEIPT_FONT_SIZE_MAX = 28;

/** Sizes the shopkeeper can pick with one click; the field still takes any number in range. */
export const RECEIPT_FONT_SIZE_PRESETS = [10, 12, 14, 16, 18, 20] as const;

/** Anything out of range (or not a number at all) falls back to the default. */
export function clampReceiptFontSize(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return RECEIPT_FONT_SIZE_DEFAULT;
  return Math.min(RECEIPT_FONT_SIZE_MAX, Math.max(RECEIPT_FONT_SIZE_MIN, n));
}

export type ReceiptFontScale = {
  /** Body copy: totals rows, the store address. */
  base: number;
  /** Item table and the invoice/customer meta lines. */
  sm: number;
  /** Footer terms and the printed-at stamp. */
  xs: number;
  /** Net bill / outstanding — the figure the customer looks for. */
  lg: number;
  /** Store name. */
  xl: number;
};

/**
 * `base` here is already-clamped px. The floors keep the small end from
 * collapsing (or inverting) once the base is turned down to the minimum.
 */
export function receiptFontScale(base: number): ReceiptFontScale {
  const b = clampReceiptFontSize(base);
  return {
    base: b,
    sm: Math.max(7, b - 1),
    xs: Math.max(6, b - 2),
    lg: b + 2,
    xl: b + 4,
  };
}
