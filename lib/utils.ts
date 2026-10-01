import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = Number(amount ?? 0);
  return num.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Profit as a percentage of cost (markup): cost 100, sale 130 → 30.
 * Null when there is no cost to measure against.
 */
export function profitPctOf(cost: number, sale: number): number | null {
  if (!(cost > 0)) return null;
  return Math.round(((sale - cost) / cost) * 100 * 100) / 100;
}

/** The sale price that earns `pct` percent on `cost`, rounded to paisa. */
export function saleFromProfitPct(cost: number, pct: number): number {
  return Math.round(cost * (1 + pct / 100) * 100) / 100;
}

/**
 * Price of one unit after a line's discount. `disRS` is a flat amount off the
 * whole line and wins over `disPct` when set — the same rule the Sales page
 * uses to compute a line's amount.
 */
export function netUnitPrice(rate: number, qty: number, disRS: number, disPct: number): number {
  const q = qty > 0 ? qty : 1;
  const discount = disRS > 0 ? disRS : (rate * q * disPct) / 100;
  return (rate * q - discount) / q;
}

/**
 * True when a discounted price has dropped under the purchase price. An item
 * with no recorded cost (0) is never below it. Compared at paisa precision so
 * float noise on an exact break-even price is not a warning.
 */
export function isBelowCost(netUnit: number, purchasePrice: number | null | undefined): boolean {
  const cost = Number(purchasePrice ?? 0);
  if (!(cost > 0)) return false;
  return Math.round(netUnit * 100) < Math.round(cost * 100);
}

/**
 * `dd/mm/yyyy` on the **shop's** calendar. It used the device's local clock,
 * which is the server's UTC when a server component renders it — so an invoice
 * rung up at 02:00 printed as the previous day there, and on any device set to
 * another timezone.
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const [yyyy, mm, dd] = shopDateKey(d).split("-");
  return `${dd}/${mm}/${yyyy}`;
}

/** `HH:mm:ss` (24-hour) on the shop's clock — same reason as `formatDate`. */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return toShopClock(d).toISOString().slice(11, 19);
}

export function generateLocalId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export type DateRangePreset =
  | "today" | "yesterday" | "last7days" | "thisMonth" | "lastMonth"
  | "last30days" | "thisYear" | "lastYear" | "all" | "custom";

/**
 * The shop's timezone, as a fixed offset from UTC in minutes.
 *
 * **Pakistan Standard Time, UTC+5.** Pakistan observes no daylight saving, so a
 * fixed offset is not an approximation here — it is exactly right all year, and
 * that is why this is a constant rather than a tz database lookup.
 *
 * Every date *window* in the application is anchored to this rather than to the
 * server's clock or the browser's. Both of those are wrong for a till:
 *
 * - The server runs in **UTC** on Vercel, so a business day computed there
 *   starts at 05:00 shop time.
 * - The browser's timezone is whatever the device happens to be set to, so two
 *   staff could pull "today's sales" and get different answers.
 *
 * The books close on shop time. One constant, one answer.
 *
 * If the shop ever moves, this is the only line to change.
 */
export const SHOP_UTC_OFFSET_MINUTES = 5 * 60;

const MS_PER_MINUTE = 60_000;

/**
 * An instant re-expressed so that its **UTC** parts read as the shop's wall
 * clock. Only ever used with the `getUTC*` accessors — mixing it with local
 * ones would apply the device's offset a second time.
 */
function toShopClock(d: Date): Date {
  return new Date(d.getTime() + SHOP_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * The shop-calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * This is what grouping by day must use. `d.toISOString().slice(0, 10)` is the
 * UTC day, and a sale rung up between 00:00 and 05:00 lands on the *previous*
 * UTC day — the Cash report and the Dashboard chart both filed early-morning
 * sales under yesterday that way.
 */
export function shopDateKey(d: Date): string {
  return toShopClock(d).toISOString().slice(0, 10);
}

/** The shop-calendar month an instant falls in, as `YYYY-MM`. */
export function shopMonthKey(d: Date): string {
  return toShopClock(d).toISOString().slice(0, 7);
}

/**
 * Today on the shop's calendar, `YYYY-MM-DD` — the default for a date input or
 * a report's "to" box. Replaces `new Date().toISOString().slice(0, 10)`, which
 * is the UTC date and named yesterday until 05:00.
 */
export function shopToday(): string {
  return shopDateKey(new Date());
}

/**
 * The 1st of this month on the shop's calendar, `YYYY-MM-DD`. Replaces
 * `new Date(y, m, 1).toISOString()`, which is *local* midnight printed in
 * UTC — in Pakistan that is 19:00 on the last day of the previous month, so
 * every "this month" default quietly started a day early.
 */
export function shopMonthStart(): string {
  return `${shopMonthKey(new Date())}-01`;
}

/**
 * The UTC instants bounding one or more whole **shop** days.
 *
 * This replaces the `new Date(from)` / `toDate.setHours(23, 59, 59, 999)` pair
 * that every date-filtered route used to inline, and which was wrong twice
 * over: `new Date("2026-09-15")` parses as UTC midnight, while `setHours`
 * writes *local* hours onto it, so the two ends of the window were measured
 * from different clocks.
 *
 * On a UTC server the net effect was a window of
 * `2026-09-15T00:00Z .. 2026-09-15T18:59Z` — which both missed the shop's first
 * five hours (a sale rung up at 02:00 appeared in **no** date range at all) and
 * leaked the next day's first five hours in. Every report that filtered by date
 * had a five-hour blind spot, every day.
 *
 * `from`/`to` are inclusive whole days as the shop counts them, in
 * `YYYY-MM-DD`. Anything else is passed to `new Date` unchanged, so a caller
 * that already holds a precise instant keeps it.
 */
export function shopDayWindow(
  from?: string | null,
  to?: string | null
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;

  const window: { gte?: Date; lte?: Date } = {};
  if (from) window.gte = shopDayBoundary(from, "start");
  if (to) window.lte = shopDayBoundary(to, "end");
  return window;
}

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function shopDayBoundary(value: string, edge: "start" | "end"): Date {
  const match = PLAIN_DATE.exec(value.trim());
  if (!match) return new Date(value);

  const [, y, m, d] = match;
  const utcOfShopWallClock =
    edge === "start"
      ? Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0)
      : Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);

  // Subtract, because the figure above is a shop-clock reading and the stored
  // timestamps are UTC — shop 00:00 is UTC 19:00 the previous day.
  return new Date(utcOfShopWallClock - SHOP_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * Midnight at the start of the shop's today, as a UTC instant.
 *
 * `new Date(); d.setHours(0, 0, 0, 0)` is the thing this replaces, and it is
 * wrong wherever it runs: on a UTC server it lands at 05:00 shop time, so the
 * first five hours of trading fall outside "today"; in a browser it follows the
 * device, so two people get two answers.
 */
export function shopStartOfToday(): Date {
  return shopDayWindow(getDateRangeForPreset("today").from)!.gte!;
}

/**
 * Resolve a named date-range preset into `from`/`to` date strings (yyyy-mm-dd),
 * **in shop time**.
 *
 * All the arithmetic runs on a shop-clock `Date` through the `getUTC*`/`setUTC*`
 * accessors. It used to use the local ones, so on a machine east of UTC the
 * "today" preset named yesterday for the first five hours of every day.
 */
export function getDateRangeForPreset(preset: DateRangePreset): { from: string; to: string } {
  const now = toShopClock(new Date());
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const todayStr = iso(now);
  const shift = (days: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };

  switch (preset) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "yesterday": {
      const y = iso(shift(-1));
      return { from: y, to: y };
    }
    case "last7days":
      return { from: iso(shift(-6)), to: todayStr };
    case "last30days":
      return { from: iso(shift(-29)), to: todayStr };
    case "thisMonth":
      return {
        from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
        to: todayStr,
      };
    case "lastMonth":
      return {
        from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
        // Day 0 of this month is the last day of the previous one.
        to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
      };
    case "thisYear":
      return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: todayStr };
    case "lastYear":
      return {
        from: iso(new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))),
        to: iso(new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31))),
      };
    case "all":
      return { from: "", to: "" };
    default:
      return { from: todayStr, to: todayStr };
  }
}

/** Calculate invoice totals from line items */
export function calculateInvoiceTotals(params: {
  items: Array<{
    qty: number;
    rate: number;
    disRS: number;
    disPct: number;
    isReturn: boolean;
    unit: string;
  }>;
  packageDiscount: number;
  adjustment: number;
  adjustType: "add" | "sub";
  courierCharges: number;
  cardAmount: number;
  cashReceived: number;
  bankAmount?: number;
  creditApplied?: number;
}) {
  const { items, packageDiscount, adjustment, adjustType, courierCharges, cardAmount, cashReceived, bankAmount = 0, creditApplied: requestedCredit = 0 } = params;

  let grossSale = 0;
  let returnAmount = 0;
  let soldPcs = 0, soldGaz = 0, soldMtr = 0;
  let returnPcs = 0, returnGaz = 0, returnMtr = 0;

  for (const item of items) {
    const discountAmount = item.disRS > 0 ? item.disRS : (item.rate * item.qty * item.disPct) / 100;
    const amount = item.rate * item.qty - discountAmount;

    if (item.isReturn) {
      returnAmount += amount;
      if (item.unit === "PCS") returnPcs += item.qty;
      else if (item.unit === "GAZ") returnGaz += item.qty;
      else if (item.unit === "MTR") returnMtr += item.qty;
    } else {
      grossSale += amount;
      if (item.unit === "PCS") soldPcs += item.qty;
      else if (item.unit === "GAZ") soldGaz += item.qty;
      else if (item.unit === "MTR") soldMtr += item.qty;
    }
  }

  const saleAmount = grossSale - packageDiscount;
  const slipAmount = saleAmount - returnAmount;
  const adjustedSlip = adjustType === "add" ? slipAmount + adjustment : slipAmount - adjustment;
  const netBill = adjustedSlip + courierCharges;
  // A net-return invoice (netBill < 0) is money owed BY the store TO the
  // customer — "change" there means the cashier paid out more than that
  // owed amount, not "more than a positive bill". Comparing against the
  // magnitude of netBill (rather than netBill itself) handles both
  // directions with one formula.
  const isRefund = netBill < 0;

  // Store credit only ever reduces a bill the customer owes: there is nothing
  // for it to reduce on a net-return invoice (the store owes them), and credit
  // beyond the bill total would otherwise inflate `change` into a cash payout
  // of credit the customer hasn't been refunded. Clamped here rather than at
  // the call site so every caller (and the value posted to the server, which
  // comes from this returned object) gets the same bounded number.
  const creditApplied = isRefund ? 0 : Math.min(Math.max(0, requestedCredit), netBill);
  // What still has to be collected at the till after credit is applied.
  const amountDue = Math.max(0, netBill - creditApplied);
  // Credit counts toward settling the bill even though no cash moved, so that
  // handing over exactly `amountDue` shows no change.
  const totalReceived = cardAmount + cashReceived + bankAmount + creditApplied;
  const change = Math.max(0, totalReceived - Math.abs(netBill));

  return {
    grossSale,
    saleAmount,
    returnAmount,
    slipAmount: adjustedSlip,
    netBill,
    isRefund,
    creditApplied,
    amountDue,
    change,
    ...moneyKeptFromTender({ netBill, cardAmount, cashReceived, bankAmount, change }),
    soldPcs, soldGaz, soldMtr,
    returnPcs, returnGaz, returnMtr,
  };
}

/**
 * The cash that actually stayed in the drawer.
 *
 * `cashReceived` on the checkout screen is what the customer *handed over*
 * (the tender) and `change` is what was handed back, so only the difference
 * is money the store kept. Everything downstream of the invoice — the party
 * ledger's credit side, the Cash `Account` balance, the amount an installment
 * plan treats as already paid, and every "Cash Received" figure in the
 * reports — has to be this number, not the tender. Posting the tender gave
 * the customer store credit they never earned and overstated cash in hand by
 * exactly the change.
 *
 * A net-return invoice is the one case with nothing to net off: there
 * `cashReceived` is money paid *out* and `change` means "over-refunded", and
 * that cash genuinely left the drawer too.
 */
export function cashKeptFromTender(params: {
  netBill: number;
  cashReceived: number;
  change: number;
}): number {
  const { netBill, cashReceived, change } = params;
  if (netBill < 0) return Math.max(0, cashReceived);
  return Math.max(0, cashReceived - Math.max(0, change));
}

/**
 * The same netting as `cashKeptFromTender`, applied across *every* payment
 * channel rather than cash alone.
 *
 * `change` is derived from card + cash + bank + credit, so an overpayment made
 * by card or bank produces change that the cash figure alone cannot absorb: it
 * clamps at 0 and the full tender still reaches the ledger, crediting the
 * customer a store balance worth exactly the change handed back. (A 1000 bill
 * settled with a 1200 bank transfer left the party balance at -200.)
 *
 * The change physically leaves the till, so it is absorbed cash first, then
 * bank, then card. Every returned figure stays >= 0 and they always sum to
 * `totalKept`, which is what the party ledger credits and what an installment
 * plan treats as already paid.
 *
 * As with the cash-only helper, a net-return invoice has nothing to net: the
 * amounts are money paid *out* and `change` means "over-refunded", which left
 * the till as well.
 */
export function moneyKeptFromTender(params: {
  netBill: number;
  cardAmount: number;
  cashReceived: number;
  bankAmount: number;
  change: number;
}): { cardKept: number; cashKept: number; bankKept: number; totalKept: number } {
  const { netBill, change } = params;
  const cardAmount = Math.max(0, params.cardAmount);
  const cashReceived = Math.max(0, params.cashReceived);
  const bankAmount = Math.max(0, params.bankAmount);

  if (netBill < 0) {
    return {
      cardKept: cardAmount,
      cashKept: cashReceived,
      bankKept: bankAmount,
      totalKept: cardAmount + cashReceived + bankAmount,
    };
  }

  let remaining = Math.max(0, change);
  const take = (amount: number) => {
    const used = Math.min(amount, remaining);
    remaining -= used;
    return amount - used;
  };
  const cashKept = take(cashReceived);
  const bankKept = take(bankAmount);
  const cardKept = take(cardAmount);

  return { cardKept, cashKept, bankKept, totalKept: cardKept + cashKept + bankKept };
}

/**
 * One invoice's stored `cashReceived` / `bankAmount` / `cardAmount`, signed as
 * money **into** the shop — what every "Cash Received" style total must sum.
 *
 * Those columns are always >= 0 and already net of change (see
 * `moneyKeptFromTender`), but on a net-return invoice (`netBill < 0`) they are
 * money paid *out* to the customer. Summing them raw counted a 500 cash refund
 * as 500 cash received, so a total over a period has to subtract them instead.
 */
export function moneyInFromInvoice(netBill: number, amount: number): number {
  return netBill < 0 ? -amount : amount;
}

/**
 * Splits a sale's total payment into the party-ledger debit/credit pair.
 * A normal sale bills `netBill` (debit) and offsets it by whatever was paid
 * now (credit). A net-return invoice (netBill < 0) instead nets the payout
 * directly into the debit side: money flowing TO the customer settles the
 * store's obligation the same way a payment FROM the customer settles a
 * debt, and folding it into `credit` here would double-subtract instead of
 * moving the balance back toward zero.
 */
export function computeSaleLedgerSplit(netBill: number, totalPaid: number) {
  const isRefund = netBill < 0;
  return {
    debit: isRefund ? netBill + totalPaid : netBill,
    credit: isRefund ? 0 : totalPaid,
  };
}

/**
 * The vendor-ledger row for a GRN: what the purchase adds to the payable, and
 * what was handed over at receipt time.
 *
 * Sign convention for a vendor is the mirror of a customer's — `credit`
 * increases what the store owes, `debit` reduces it:
 *
 * - A normal purchase (`netBill >= 0`) credits the full bill (we now owe it)
 *   and debits whatever was paid on the spot.
 * - A net-return GRN (`netBill < 0`, more returned than received) is typed
 *   `PURCHASE_RETURN` — until now a defined-but-never-written ledger type. It
 *   debits the returned value (the vendor owes us that) and credits any refund
 *   they handed back, which settles that claim toward zero. Both columns stay
 *   positive: the direction is carried by the type, not by a negative amount.
 */
export function computePurchaseLedgerSplit(netBill: number, paidNow: number) {
  const isReturn = netBill < 0;
  return {
    type: (isReturn ? "PURCHASE_RETURN" : "PURCHASE") as "PURCHASE" | "PURCHASE_RETURN",
    debit: isReturn ? -netBill : paidNow,
    credit: isReturn ? paidNow : netBill,
  };
}
