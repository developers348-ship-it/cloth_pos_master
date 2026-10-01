"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, ShoppingCart, PackagePlus, Package, Banknote, Users, Download, RefreshCw, Search, X, BadgeCheck, Undo2, UserCog, Trash2, Ban, RotateCcw, ChevronDown, CornerUpLeft, FileText, Receipt } from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import Pagination from "@/components/ui/Pagination";
import ReceiptPrintTrigger from "@/components/sales/ReceiptPrintTrigger";
import GrnRecordsTab from "@/components/purchases/GrnRecordsTab";
import {
  Chip, DateFilter, Money, MoneyGroup, TotalCard,
  monthStart, shownParts, today, type MoneyPart,
  PlanChip,
} from "@/components/reports/list-ui";
import { formatCurrency, formatDate, getDateRangeForPreset, type DateRangePreset } from "@/lib/utils";
import { exportCSV } from "@/lib/csv-export";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";
import { usePermissions } from "@/lib/permissions-client";
import { readReportCache, isReportCacheFresh, writeReportCache } from "@/lib/report-cache";
import { invoiceRefundable } from "@/lib/invoice-settlement";
import { invoiceHref } from "@/lib/document-links";
import { formatStock } from "@/lib/units";
import { useUnitConfig } from "@/lib/use-unit-config";
import type { PlanSummary } from "@/lib/installments";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "sales" | "purchases" | "stock" | "cash" | "contacts";

type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";
type RecordStatus = "SAVED" | "HELD" | "VOIDED";

type SaleLineItem = {
  name: string; unit: string; qty: number; rate: number; amount: number; isReturn: boolean;
};

type SaleRow = {
  id: string;
  invoiceNo: number; date: string; partyId: string; partyName: string; accountId: number;
  cashier: string; partyOption: string; itemCount: number; items: SaleLineItem[];
  grossSale: number; packageDiscount: number; returnAmount: number;
  netBill: number; cashReceived: number; cardAmount: number;
  bankAmount: number; creditApplied: number;
  /** Collected against this invoice after the sale. */
  recovered: number;
  /** The part of `recovered` that Mark Unpaid can reverse (i.e. not installment collections). */
  recoveredMarkPaid: number;
  outstanding: number;
  /** What the customer handed back — shown so a settled total above the bill doesn't read as unexplained. */
  change: number;
  /** Estimate: cost of goods valued at the item's *current* purchasePrice, not what it was bought at. */
  cogs: number; profit: number;
  hasPlan: boolean;
  /** Repayment plan state, or null when the invoice has none. */
  plan: PlanSummary | null;
  /** Set when this row *is* a refund — the invoice number of the sale it reverses. */
  refundOfInvoiceNo: number | null;
  /** Set when this row is a sale that has been refunded — the refund's number. */
  refundedByInvoiceNo: number | null;
  paymentStatus: PaymentStatus; recordStatus: RecordStatus;
};

/** What the sales tab holds — and what gets cached across navigations. */
type SalesPayload = { invoices: SaleRow[]; totals: any };

/** Cache namespace for the sales report (see lib/report-cache.ts). */
const SALES_CACHE = "reports:sales";
const SALES_PAGE_SIZE = 50;

type Account = { id: string; type: "CASH" | "BANK"; name: string; isActive: boolean };

type PartyOption = { id: string; name: string; accountId: number; type: string; isDefault: boolean; city: string | null };

type StockRow = {
  itemId: string; name: string; category: string; brand: string;
  barcode: string; unit: string; purchaseUnit?: string | null; piecesPerBundle?: number | null;
  purchasePrice: number; salePrice: number;
  openingStock: number; currentStock: number; minLevel: number;
  status: "OK" | "LOW" | "OUT";
};

type CashDay = {
  date: string; cashSales: number; cardSales: number; bankSales: number;
  creditSales: number; recoveries: number; cashRecoveries: number; totalCashIn: number;
};

type ContactRow = {
  accountId: number; name: string; type: string; address: string;
  city: string; phone: string; mobile: string; creditLimit: number; balance: number;
};

/**
 * `SaleInvoice.partyOption` is stored as CASH or CC (older rows may still hold
 * CR / 1INCH / 5INCH from the pre-Phase-2 tiers). CC is shown as "Loan" — the
 * stored value is deliberately unchanged, so nothing has to be migrated.
 */
function partyOptionLabel(
  option: string,
  t: (key: "sales_paymentOptionCash" | "sales_paymentOptionCC") => string
): string {
  return option === "CASH" ? t("sales_paymentOptionCash") : t("sales_paymentOptionCC");
}

/** Everything that has been paid against the invoice, by any channel. */
function saleSettled(r: SaleRow): number {
  return r.cashReceived + r.cardAmount + r.bankAmount + r.creditApplied + r.recovered;
}

/**
 * Which channels the money came through, e.g. "Cash 1,000 · Card 950". Sits
 * under the Received figure so a glance at the row says how the bill was
 * settled without opening it; the full breakdown is in the expander.
 */
function saleChannels(r: SaleRow, t: (key: TranslationKey) => string): string {
  const parts: string[] = [];
  if (r.cashReceived > 0.005) parts.push(`${t("reports_cash")} ${formatCurrency(r.cashReceived)}`);
  if (r.cardAmount > 0.005) parts.push(`${t("reports_card")} ${formatCurrency(r.cardAmount)}`);
  if (r.bankAmount > 0.005) parts.push(`${t("reports_bank")} ${formatCurrency(r.bankAmount)}`);
  if (r.creditApplied > 0.005) parts.push(`${t("sales_creditApplied")} ${formatCurrency(r.creditApplied)}`);
  if (r.recovered > 0.005) parts.push(`${t("reports_recovered")} ${formatCurrency(r.recovered)}`);
  return parts.join(" · ");
}

function saleItemsSummary(r: SaleRow): string {
  return r.items.map((i) => `${i.name} x${i.qty}${i.isReturn ? " (R)" : ""}`).join(", ");
}

// ─── Sales-table display helpers ──────────────────────────────────────────────

/**
 * The line items behind one invoice, shared by the desktop expander row and the
 * mobile card so the two can't drift. Replaces the nested `<table>` that used to
 * sit inside the expanded row: its columns lined up with nothing above them, so
 * the detail read as floating text rather than as part of the invoice.
 */
function SaleLineItems({ row }: { row: SaleRow }) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  // The four figure columns are fixed-width so they line up down the panel,
  // which means the panel itself has to scroll rather than the page when the
  // screen is narrower than they are.
  //
  // The leading column is deliberately empty. It indents the lines away from
  // the panel edge so they read as sitting *inside* the invoice rather than
  // butting against its border, and lands them under the row's own first
  // column, where the expand chevron is.
  const cols = "grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem_3.25rem_5.5rem_6rem] gap-2 px-3";
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <div className="min-w-[365px]">
        <div className={`${cols} bg-gray-50 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400`}>
          <div aria-hidden />
          <div className={u}>{t("sales_itemName")}</div>
          <div className={`text-center ${u}`}>{t("sales_unit")}</div>
          <div className={`text-right ${u}`}>{t("sales_qty")}</div>
          <div className={`text-right ${u}`}>{t("sales_rate")}</div>
          <div className={`text-right ${u}`}>{t("amount")}</div>
        </div>
        <div className="divide-y divide-gray-100">
          {row.items.map((li, idx) => (
            <div key={idx} className={`${cols} items-center py-1.5 text-xs`}>
              <div aria-hidden />
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`shrink-0 rounded px-1 text-[10px] font-bold leading-4 ${
                  li.isReturn ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                }`}>{li.isReturn ? "R" : "S"}</span>
                <span className="truncate text-gray-700" title={li.name}>{li.name}</span>
              </div>
              <div className="text-center text-gray-400">{li.unit}</div>
              <div className="text-right tabular-nums text-gray-600">{li.qty}</div>
              <div className="text-right text-gray-600"><Money value={li.rate} /></div>
              <div className="text-right font-medium text-gray-800"><Money value={li.amount} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The money breakdown that the narrow screens and the collapsed columns leave
 * out. Every figure here is already on the row object; none of it is fetched.
 *
 * A **vertical** panel, read top to bottom like the bill it describes, rather
 * than the five-across grid this used to be: ten figures spread over a wide row
 * put the label of one column next to the amount of the previous one, so the
 * eye had to travel sideways to pair them up and the totals lined up with
 * nothing.
 *
 * Each pair is one line — label on the left, amount on the right, the way a
 * bill is read aloud. Stacking the amount under its label was tried and made
 * the panel twice as tall for no gain: it pushed Outstanding well below the
 * fold of a short invoice. The panel is narrow enough (`max-w-sm`) that the two
 * ends of a line stay visibly paired.
 *
 * The two halves — what the goods came to, and what was paid against it — are
 * separated the same way as on the printed invoice, each closing on the figure
 * that matters: Net Bill and Outstanding.
 */
function SaleMoneyBreakdown({ row }: { row: SaleRow }) {
  const { t } = useI18n();
  // Withheld from a role without VIEW_PURCHASE_PRICE, same as the Items page
  // and the totals tile above — profit is a cost-derived figure.
  const { can } = usePermissions();
  const bill: MoneyPart[] = [
    { label: t("reports_gross"), value: row.grossSale, optional: true },
    { label: t("reports_discount"), value: row.packageDiscount, tone: "text-orange-600", optional: true },
    { label: t("reports_returns"), value: row.returnAmount, tone: "text-red-600", optional: true },
    { label: t("reports_netBill"), value: row.netBill, tone: "text-gray-800", total: true },
  ];
  const paid: MoneyPart[] = [
    { label: t("reports_cash"), value: row.cashReceived, tone: "text-green-700", optional: true },
    { label: t("reports_card"), value: row.cardAmount, tone: "text-blue-700", optional: true },
    { label: t("reports_bank"), value: row.bankAmount, tone: "text-blue-700", optional: true },
    { label: t("sales_creditApplied"), value: row.creditApplied, tone: "text-purple-700", optional: true },
    { label: t("reports_recovered"), value: row.recovered, tone: "text-teal-700", optional: true },
    // What the customer tendered above the bill and got handed back — shown
    // so Cash/Card/Bank above never reads as "the store kept all of this".
    // The stored channels are net of change, so what was handed over is
    // their sum plus the change — named in the label so "20" has a source.
    { label: t("sales_changeFrom").replace("{amount}", formatCurrency(row.cashReceived + row.cardAmount + row.bankAmount + row.change)), value: row.change, tone: "text-amber-600", optional: true },
    { label: t("reports_outstanding"), value: row.outstanding, tone: "text-red-600", total: true },
  ];

  return (
    <dl className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <MoneyGroup parts={shownParts(bill)} />
      <div className="my-1.5 border-t border-dashed border-gray-200" />
      <MoneyGroup parts={shownParts(paid)} />
      {can("VIEW_PURCHASE_PRICE") && (
        <>
          <div className="my-1.5 border-t border-dashed border-gray-200" />
          <MoneyGroup parts={[{ label: t("reports_profit"), value: row.profit, tone: "text-purple-700", total: true }]} />
        </>
      )}
    </dl>
  );
}

/**
 * What one expanded invoice shows: the lines first, the money under them.
 *
 * Under, not beside. A right-hand column alongside the items was tried and read
 * worse — it squeezed the item table into whatever width was left, and the two
 * panels competed for the eye instead of being read in the order the sale
 * happened: what was bought, then what it came to.
 *
 * The breakdown is capped rather than stretched to the full table width — a
 * label pinned to the far left with its amount at the far right is the same
 * problem the old five-across grid had — and `ml-auto` pushes that column to
 * the right edge, under the Net Bill / Received columns of the row above, where
 * the figures it repeats already sit.
 *
 * One component for the table expander and the mobile card, so the two
 * renderings can't drift.
 */
function SaleExpander({ row }: { row: SaleRow }) {
  return (
    <div className="space-y-3">
      <SaleLineItems row={row} />
      <div className="ml-auto w-full max-w-sm">
        <SaleMoneyBreakdown row={row} />
      </div>
    </div>
  );
}

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────

/**
 * Records money collected against one invoice after the sale. The amount
 * defaults to the whole outstanding balance — the everyday case of a credit
 * customer coming back to clear a bill — but a smaller figure is allowed for a
 * part payment. Overpayment is refused server-side: money beyond this invoice
 * belongs on the party's ledger via the Ledger page, not on the invoice.
 */
function MarkPaidModal({
  row, accounts, onClose, onSaved,
}: {
  row: SaleRow;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const [amount, setAmount] = useState(String(row.outstanding));
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const settled = row.netBill - row.outstanding;

  const handleSave = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return toast.error(t("reports_enterValidAmount"));
    if (paymentMethod === "BANK" && !accountId) return toast.error(t("reports_selectBankAccount"));
    setSaving(true);
    try {
      const res = await fetch(`/api/sales/${row.id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount), paymentMethod,
          accountId: accountId || null, date, notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        data.paymentStatus === "PAID"
          ? t("reports_markedPaid")
          : `${t("reports_paymentRecorded")} — Rs. ${formatCurrency(data.outstanding)} ${t("reports_stillDue")}`
      );
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || t("reports_actionFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_markPaidTitle")}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              INV-{row.invoiceNo} · {row.partyName} <span className="text-gray-400">#{row.accountId}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_netBill")}</span>
            <span className="text-gray-700">Rs. {formatCurrency(row.netBill)}</span>
          </div>
          <div className="flex justify-between">
            <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_alreadySettled")}</span>
            <span className="text-gray-700">Rs. {formatCurrency(settled)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
            <span className={`text-gray-600 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_outstanding")}</span>
            <span className="text-red-600">Rs. {formatCurrency(row.outstanding)}</span>
          </div>
        </div>

        {row.hasPlan && (
          <p className={`text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2 ${isUrdu ? "urdu-text" : ""}`}>
            {t("reports_markPaidClosesPlan")}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
          </div>
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_amountRs")}</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
          </div>
        </div>

        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_paymentMethod")}</label>
          <div className="flex gap-3">
            {["CASH", "BANK"].map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="pm_markpaid" checked={paymentMethod === m}
                  onChange={() => setPaymentMethod(m)} className="accent-teal-600" />
                <span className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{m === "CASH" ? t("reports_cash") : t("reports_bank")}</span>
              </label>
            ))}
          </div>
        </div>

        {paymentMethod === "BANK" && (
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_bankAccount")}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400">
              <option value="">{t("reports_selectBankAccount")}</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_notesOptional")}</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
        </div>

        {Number(amount) > row.outstanding + 0.005 && (
          <p className={`text-xs text-amber-600 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_amountExceedsOutstanding")}</p>
        )}

        <button onClick={handleSave} disabled={saving}
          className={`w-full bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}>
          {saving ? t("loading") : t("reports_recordPayment")}
        </button>
      </div>
    </div>
  );
}

// ─── Refund Modal ─────────────────────────────────────────────────────────────

/**
 * Refunds a whole order. The customer's goods come back into stock and the
 * money they paid is handed back out of the till or a bank account, as a refund
 * invoice against the original — see POST /api/sales/[id]/refund for why this
 * is a second document rather than an edit of the first.
 *
 * The amount defaults to everything the customer actually paid (counter
 * payments plus anything collected since) and may be reduced for a part
 * payout; whatever is left behind stays on their ledger as store credit. It
 * cannot be raised above what they paid — the server refuses that, because
 * money the store never took can't be handed back here.
 */
function RefundModal({
  row, accounts, onClose, onSaved,
}: {
  row: SaleRow;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  // The same figure the server enforces, from the same function — see
  // lib/invoice-settlement.ts on why store credit is not part of it.
  const refundable = invoiceRefundable(row);
  const [amount, setAmount] = useState(String(refundable.toFixed(2)));
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const payout = Number(amount) || 0;
  const overRefund = payout > refundable + 0.005;
  const keptAsCredit = Math.max(0, refundable - payout) + row.creditApplied;

  const handleSave = async () => {
    if (isNaN(Number(amount)) || Number(amount) < 0) return toast.error(t("reports_enterValidAmount"));
    if (overRefund) return toast.error(t("reports_refundExceeds"));
    if (paymentMethod === "BANK" && payout > 0 && !accountId) return toast.error(t("reports_selectBankAccount"));
    setSaving(true);
    try {
      const res = await fetch(`/api/sales/${row.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: payout, paymentMethod,
          accountId: accountId || null, date, notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${t("reports_refundDone")} — ${t("reports_refundCreated")} INV-${data.invoiceNo}`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || t("reports_actionFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`font-semibold text-gray-800 ${u}`}>{t("reports_refundTitle")}</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              INV-{row.invoiceNo} · {row.partyName} <span className="text-gray-400">#{row.accountId}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <p className={`rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ${u}`}>{t("reports_refundExplains")}</p>

        <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className={`text-gray-500 ${u}`}>{t("reports_netBill")}</span>
            <span className="text-gray-700"><Money value={row.netBill} /></span>
          </div>
          <div className="flex justify-between">
            <span className={`text-gray-500 ${u}`}>{t("reports_items")}</span>
            <span className="text-gray-700 tabular-nums">{row.items.length}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
            <span className={`text-gray-600 ${u}`}>{t("reports_customerPaid")}</span>
            <span className="text-green-700"><Money value={refundable} /></span>
          </div>
        </div>

        {row.hasPlan && (
          <p className={`rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700 ${u}`}>{t("reports_refundClosesPlan")}</p>
        )}

        {refundable <= 0.005 ? (
          <p className={`rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ${u}`}>{t("reports_refundNothingPaid")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("date")}</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
              </div>
              <div>
                <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("reports_refundAmount")}</label>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
              </div>
            </div>

            <div>
              <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("reports_refundMethod")}</label>
              <div className="flex gap-3">
                {["CASH", "BANK"].map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="pm_refund" checked={paymentMethod === m}
                      onChange={() => setPaymentMethod(m)} className="accent-teal-600" />
                    <span className={`text-sm ${u}`}>{m === "CASH" ? t("reports_cash") : t("reports_bank")}</span>
                  </label>
                ))}
              </div>
            </div>

            {paymentMethod === "BANK" && (
              <div>
                <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("reports_bankAccount")}</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none">
                  <option value="">{t("reports_selectBankAccount")}</option>
                  {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        <div>
          <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("reports_notesOptional")}</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
        </div>

        {overRefund && <p className={`text-xs text-red-600 ${u}`}>{t("reports_refundExceeds")}</p>}
        {!overRefund && keptAsCredit > 0.005 && (
          <p className={`text-xs text-purple-700 ${u}`}>
            {t("reports_refundKeepsCredit")} <Money value={keptAsCredit} className="font-medium" />
          </p>
        )}

        <button onClick={handleSave} disabled={saving || overRefund}
          className={`w-full rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 ${u}`}>
          {saving ? t("loading") : t("reports_refundButton")}
        </button>
      </div>
    </div>
  );
}

// ─── Change Customer Modal ────────────────────────────────────────────────────

/**
 * Reassigns an invoice to a different customer. Everything booked against the
 * invoice moves with it server-side (ledger, cash/bank attribution, installment
 * plan and any later collections) — see PATCH /api/sales/[id]/party.
 */
function ChangeCustomerModal({
  row, onClose, onSaved,
}: {
  row: SaleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PartyOption[]>([]);
  const [selected, setSelected] = useState<PartyOption | null>(null);
  const [saving, setSaving] = useState(false);

  // Vendors are filtered out here as well as refused server-side — a sale can
  // never be billed to one, so offering them would only invite the error.
  useEffect(() => {
    const controller = new AbortController();
    const url = search.trim()
      ? `/api/parties?q=${encodeURIComponent(search.trim())}&limit=20`
      : `/api/parties?recent=true&limit=20`;
    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setResults((d.parties ?? []).filter((p: PartyOption) => p.type !== "VENDOR" && p.id !== row.partyId)))
      .catch(() => {});
    return () => controller.abort();
  }, [search, row.partyId]);

  const handleSave = async () => {
    if (!selected) return toast.error(t("reports_selectCustomerFirst"));
    setSaving(true);
    try {
      const res = await fetch(`/api/sales/${row.id}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${t("reports_customerChanged")} — ${data.partyName}`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || t("reports_actionFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_changeCustomerTitle")}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              INV-{row.invoiceNo} · {t("reports_currently")} {row.partyName} <span className="text-gray-400">#{row.accountId}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {(row.recovered > 0.005 || row.creditApplied > 0.005 || row.hasPlan) && (
          <p className={`text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 ${isUrdu ? "urdu-text" : ""}`}>
            {t("reports_changeCustomerMovesEverything")}
          </p>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("reports_searchCustomer")}
            className={`w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-teal-400 ${isUrdu ? "urdu-text" : ""}`} />
        </div>

        <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
          {results.length === 0 ? (
            <div className={`text-center py-6 text-xs text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_noContactsFound")}</div>
          ) : results.map((p) => (
            <button key={p.id} onClick={() => setSelected(p)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selected?.id === p.id ? "bg-teal-50" : ""}`}>
              <span className="font-medium text-gray-800">{p.name}</span>
              <span className="ml-2 text-xs text-gray-400">#{p.accountId}</span>
              {p.city && <span className="ml-2 text-xs text-gray-400">{p.city}</span>}
            </button>
          ))}
        </div>

        <button onClick={handleSave} disabled={saving || !selected}
          className={`w-full bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}>
          {saving ? t("loading") : t("reports_changeCustomer")}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { data: session } = useSession();
  const { t, isUrdu } = useI18n();
  const unitCfg = useUnitConfig();
  // Row actions are hidden for roles that can't perform them; the API routes
  // enforce the same keys, so this only spares the cashier a button that would
  // come back 403 (see lib/authz.ts).
  const { can, loaded: permsLoaded } = usePermissions();
  const branchId = (session?.user as any)?.branchId ?? "";

  const [activeTab, setActiveTab] = useState<Tab>("sales");

  // Sales
  const [salesPreset, setSalesPreset] = useState<DateRangePreset>("thisMonth");
  const [salesFrom, setSalesFrom] = useState(monthStart());
  const [salesTo, setSalesTo] = useState(today());
  // Seeded from the cross-navigation cache, so coming back to this page paints
  // the last result on the first frame and refetches underneath instead of
  // showing an empty table for the length of the round trip. Lazy initialisers:
  // the cache is read once, at mount, not on every render.
  const [salesRows, setSalesRows] = useState<SaleRow[]>(
    () => readReportCache<SalesPayload>(SALES_CACHE)?.invoices ?? []
  );
  const [salesTotals, setSalesTotals] = useState<any>(
    () => readReportCache<SalesPayload>(SALES_CACHE)?.totals ?? null
  );
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesSearch, setSalesSearch] = useState("");
  const [salesStatus, setSalesStatus] = useState<"" | PaymentStatus>("");
  const [salesRecordStatus, setSalesRecordStatus] = useState<"ACTIVE" | "VOIDED" | "ALL">("ACTIVE");
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotal, setSalesTotal] = useState(0);
  const router = useRouter();
  const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set());
  const [salesActionBusy, setSalesActionBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [markPaidRow, setMarkPaidRow] = useState<SaleRow | null>(null);
  const [refundRow, setRefundRow] = useState<SaleRow | null>(null);
  const [changeCustomerRow, setChangeCustomerRow] = useState<SaleRow | null>(null);
  // Set while a row's Receipt action is printing — see ReceiptPrintTrigger.
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<string | null>(null);

  function applySalesPreset(preset: DateRangePreset) {
    setSalesPreset(preset);
    if (preset === "custom") return;
    const { from, to } = getDateRangeForPreset(preset);
    setSalesFrom(from);
    setSalesTo(to);
  }
  // Stock
  // Stock
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [stockTotals, setStockTotals] = useState<any>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  const [stockSearch, setStockSearch] = useState("");

  // Cash
  const [cashFrom, setCashFrom] = useState(monthStart());
  const [cashTo, setCashTo] = useState(today());
  const [cashDays, setCashDays] = useState<CashDay[]>([]);
  const [cashTotals, setCashTotals] = useState<any>(null);
  const [cashLoading, setCashLoading] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactTypeFilter, setContactTypeFilter] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  // ── Load functions ──

  /** Which filters a cached sales payload belongs to. */
  const salesKey = useMemo(
    () => [branchId, salesFrom, salesTo, salesStatus, salesRecordStatus, salesSearch, salesPage].join("|"),
    [branchId, salesFrom, salesTo, salesStatus, salesRecordStatus, salesSearch, salesPage]
  );
  // Only the newest request may write state or the cache. Without this a slow
  // early fetch can land after a fast later one and put the wrong filters'
  // rows on screen — easy to hit now that a stale list stays visible and the
  // user keeps adjusting dates while it does.
  const salesReq = useRef(0);
  /**
   * True when the rows on screen came from the cache and belong to some other
   * set of filters — they are a placeholder until this request lands, so the
   * totals row is held back rather than shown against the wrong period.
   */
  const salesStale = salesLoading && !isReportCacheFresh(SALES_CACHE, salesKey);

  const loadSales = useCallback(async () => {
    if (!branchId) return;
    const seq = ++salesReq.current;
    setSalesLoading(true);
    try {
      const params = new URLSearchParams({
        branchId, from: salesFrom, to: salesTo, recordStatus: salesRecordStatus,
        page: String(salesPage), pageSize: String(SALES_PAGE_SIZE),
      });
      if (salesStatus) params.set("paymentStatus", salesStatus);
      if (salesSearch.trim()) params.set("q", salesSearch.trim());
      const res = await fetch(`/api/reports/sales?${params.toString()}`);
      const data = await res.json();
      if (seq !== salesReq.current) return;
      const payload: SalesPayload = { invoices: data.invoices ?? [], totals: data.totals ?? null };
      writeReportCache(SALES_CACHE, salesKey, payload);
      setSalesRows(payload.invoices);
      setSalesTotals(payload.totals);
      setSalesTotal(data.total ?? 0);
    } catch {
      if (seq === salesReq.current) toast.error("Failed to load sales report");
    }
    finally { if (seq === salesReq.current) setSalesLoading(false); }
  }, [branchId, salesFrom, salesTo, salesStatus, salesRecordStatus, salesSearch, salesPage, salesKey]);

  // A new date range, status filter or search term invalidates whatever page
  // we were on — jumping back to page 1 rather than silently landing on a page
  // number that may no longer exist under the new filter.
  useEffect(() => { setSalesPage(1); }, [salesFrom, salesTo, salesStatus, salesRecordStatus, salesSearch]);

  /** CSV export means "every invoice matching the filter", not just the page
   * on screen — a dedicated `all=true` fetch, not `salesRows`. */
  async function exportSales() {
    if (!branchId) return;
    const params = new URLSearchParams({
      branchId, from: salesFrom, to: salesTo, recordStatus: salesRecordStatus, all: "true",
    });
    if (salesStatus) params.set("paymentStatus", salesStatus);
    if (salesSearch.trim()) params.set("q", salesSearch.trim());
    const res = await fetch(`/api/reports/sales?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error("Failed to export sales report"); return; }
    const allRows: SaleRow[] = data.invoices ?? [];
    exportCSV(`Sales_${salesFrom}_${salesTo}`, allRows.map((r) => ({
      "Invoice No": r.invoiceNo, Date: formatDate(new Date(r.date)),
      Party: r.partyName, "Account ID": r.accountId, Cashier: r.cashier,
      "Party Option": partyOptionLabel(r.partyOption, t), Items: r.itemCount,
      "Gross Sale": r.grossSale, "Package Discount": r.packageDiscount,
      "Return Amount": r.returnAmount, "Net Bill": r.netBill,
      "Cash Received": r.cashReceived, "Card Amount": r.cardAmount,
      "Bank Amount": r.bankAmount, "Store Credit": r.creditApplied,
      Recovered: r.recovered, Change: r.change, Outstanding: r.outstanding,
      "Payment Status": r.paymentStatus, "Record Status": r.recordStatus,
      "Refund Of": r.refundOfInvoiceNo ?? "", "Refunded By": r.refundedByInvoiceNo ?? "",
    })));
  }

  function toggleExpandSale(id: string) {
    setExpandedSales((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function voidInvoice(row: SaleRow) {
    if (!confirm(t("reports_confirmVoid"))) return;
    setSalesActionBusy(row.id);
    try {
      const res = await fetch(`/api/sales/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "VOIDED" }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("reports_invoiceVoided"));
      loadSales();
    } catch { toast.error(t("reports_actionFailed")); }
    finally { setSalesActionBusy(null); }
  }

  async function restoreInvoice(row: SaleRow) {
    if (!confirm(t("reports_confirmRestore"))) return;
    setSalesActionBusy(row.id);
    try {
      const res = await fetch(`/api/sales/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SAVED" }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("reports_invoiceRestored"));
      loadSales();
    } catch { toast.error(t("reports_actionFailed")); }
    finally { setSalesActionBusy(null); }
  }

  async function deleteInvoice(row: SaleRow) {
    if (!confirm(t("reports_confirmDeleteInvoice"))) return;
    setSalesActionBusy(row.id);
    try {
      const res = await fetch(`/api/sales/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("reports_invoiceDeleted"));
      loadSales();
    } catch { toast.error(t("reports_actionFailed")); }
    finally { setSalesActionBusy(null); }
  }

  /**
   * Puts the invoice back to owing its balance: the recoveries Mark Paid booked
   * *and* whatever was taken at the counter are both reversed, so a fully paid
   * invoice can be reopened. Store credit already applied stays consumed — see
   * the DELETE handler in app/api/sales/[id]/payment/route.ts.
   */
  async function markUnpaid(row: SaleRow) {
    if (!confirm(t("reports_confirmMarkUnpaid"))) return;
    setSalesActionBusy(row.id);
    try {
      const res = await fetch(`/api/sales/${row.id}/payment`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${t("reports_markedUnpaid")} — Rs. ${formatCurrency(data.reversed)}`);
      loadSales();
    } catch (err: any) { toast.error(err?.message || t("reports_actionFailed")); }
    finally { setSalesActionBusy(null); }
  }

  /**
   * The row's action list, in the order a cashier reaches for them. Entries are
   * dropped rather than disabled when the role can't perform them — the API
   * enforces the same keys, so a hidden item would only ever come back 403.
   */
  /**
   * One column's worth of state, instead of the two adjacent "Payment Status"
   * and "Status" columns the list used to carry — side by side they read as the
   * same thing twice, and the second only ever said "Active". The payment badge
   * always shows; the rest appear only when there is something to say.
   */
  function salesStatusChips(r: SaleRow) {
    const isVoided = r.recordStatus === "VOIDED";
    return (
      <>
        <Chip tone={
          r.paymentStatus === "PAID" ? "green" :
          r.paymentStatus === "PARTIAL" ? "amber" : "red"
        }>
          {r.paymentStatus === "PAID" ? t("reports_statusPaid") :
           r.paymentStatus === "PARTIAL" ? t("reports_statusPartial") :
           t("reports_statusUnpaid")}
          {!isVoided && r.outstanding > 0.005 && (
            <span className="font-normal">· <Money value={r.outstanding} /> {t("reports_due")}</span>
          )}
        </Chip>
        {isVoided && <Chip tone="slate">{t("reports_recordVoided")}</Chip>}
        {r.refundedByInvoiceNo !== null && (
          <Chip tone="red">{t("reports_refunded")} · #{r.refundedByInvoiceNo}</Chip>
        )}
        {r.refundOfInvoiceNo !== null && (
          <Chip tone="purple">{t("reports_refundOf")} #{r.refundOfInvoiceNo}</Chip>
        )}
        {/* Kind + progress + next due, not just "has a plan". */}
        <PlanChip plan={r.plan} />
      </>
    );
  }

  function salesRowActions(r: SaleRow): ActionMenuItem[] {
    const isVoided = r.recordStatus === "VOIDED";
    // Everything Mark Unpaid is able to give back: money booked afterwards plus
    // whatever the counter took on the day of the sale.
    const reversible = r.recoveredMarkPaid + r.cashReceived + r.cardAmount + r.bankAmount;
    // A refunded sale is closed: its goods are back in stock and its money has
    // been handed over, all recorded on the refund invoice. Settling it, undoing
    // its payments, moving it to another customer or voiding it would all be
    // acting on figures the refund has already reversed — the way to undo a
    // refund is to delete the refund invoice, which the server also enforces.
    const isRefunded = r.refundedByInvoiceNo !== null;
    const isRefundDoc = r.refundOfInvoiceNo !== null;
    const items: ActionMenuItem[] = [];

    // Always first, and always present. Reading an invoice is not gated — the
    // report endpoints are deliberately open (see lib/authz.ts) — and a voided
    // or refunded row, whose other actions are all withdrawn, is exactly the
    // one you want to be able to open and read.
    items.push({
      key: "detail", label: t("reports_orderDetail"), icon: FileText,
      onSelect: () => router.push(invoiceHref(r.id)),
    });
    // A customer coming back for their slip is the everyday case, so the
    // receipt prints straight from the row rather than by way of the detail
    // page — one click instead of three.
    if (can("PRINT_RECEIPT")) {
      items.push({
        key: "receipt", label: t("reports_printReceipt"), icon: Receipt,
        onSelect: () => setReceiptInvoiceId(r.id),
      });
    }

    if (isVoided) {
      if (can("VOID_INVOICE")) {
        items.push({
          key: "restore", label: t("reports_restore"), icon: RotateCcw,
          onSelect: () => restoreInvoice(r),
        });
      }
    } else if (isRefunded) {
      // Deliberately no items: even Delete is refused server-side while the
      // refund invoice exists, so the menu disappears entirely and the row's
      // "Refunded by #N" chip is what points at the document to act on.
    } else {
      if (can("MARK_INVOICE_PAID") && r.outstanding > 0.005) {
        items.push({
          key: "markPaid", label: t("reports_markPaid"), icon: BadgeCheck, tone: "success",
          onSelect: () => setMarkPaidRow(r),
        });
      }
      if (can("MARK_INVOICE_UNPAID") && reversible > 0.005) {
        items.push({
          key: "markUnpaid", label: t("reports_markUnpaid"), icon: Undo2, tone: "warning",
          onSelect: () => markUnpaid(r),
        });
      }
      // Only an actual sale can be refunded — a refund invoice is itself the
      // reversal, and a net-return invoice has nothing to give back.
      if (can("PROCESS_SALE_RETURN") && !isRefundDoc && r.netBill > 0.005) {
        items.push({
          key: "refund", label: t("reports_refund"), icon: CornerUpLeft, tone: "danger",
          onSelect: () => setRefundRow(r),
        });
      }
      if (can("CHANGE_INVOICE_CUSTOMER")) {
        items.push({
          key: "customer", label: t("reports_changeCustomer"), icon: UserCog,
          onSelect: () => setChangeCustomerRow(r),
        });
      }
      if (can("VOID_INVOICE")) {
        items.push({
          key: "void", label: t("reports_void"), icon: Ban, tone: "warning",
          onSelect: () => voidInvoice(r),
        });
      }
    }

    if (can("DELETE_INVOICE") && !isRefunded) {
      items.push({
        key: "delete", label: t("reports_delete"), icon: Trash2, tone: "danger",
        onSelect: () => deleteInvoice(r),
      });
    }
    return items;
  }

  const loadStock = useCallback(async () => {
    if (!branchId) return;
    setStockLoading(true);
    try {
      const res = await fetch(`/api/reports/stock?branchId=${branchId}&lowOnly=${lowOnly}`);
      const data = await res.json();
      setStockRows(data.stock ?? []);
      setStockTotals(data.totals ?? null);
    } catch { toast.error("Failed to load stock report"); }
    finally { setStockLoading(false); }
  }, [branchId, lowOnly]);

  const loadCash = useCallback(async () => {
    if (!branchId) return;
    setCashLoading(true);
    try {
      const res = await fetch(`/api/reports/cash?branchId=${branchId}&from=${cashFrom}&to=${cashTo}`);
      const data = await res.json();
      setCashDays(data.days ?? []);
      setCashTotals(data.totals ?? null);
    } catch { toast.error("Failed to load cash report"); }
    finally { setCashLoading(false); }
  }, [branchId, cashFrom, cashTo]);

  const loadContacts = useCallback(async () => {
    if (!branchId) return;
    setContactsLoading(true);
    try {
      const url = `/api/reports/contacts?branchId=${branchId}${contactTypeFilter ? `&type=${contactTypeFilter}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } catch { toast.error("Failed to load contacts"); }
    finally { setContactsLoading(false); }
  }, [branchId, contactTypeFilter]);

  // Bank accounts for the Mark Paid modal's dropdown — same source as the
  // Ledger page's recovery form, so both offer exactly the active accounts.
  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/accounts?branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => setAccounts((d.accounts ?? []).filter((a: Account) => a.isActive)))
      .catch(() => {});
  }, [branchId]);

  // Auto-load: on tab switch, and again whenever that tab's filters change.
  // Each loader is a `useCallback` keyed on its own filter state, so listing it
  // as a dependency is what makes a preset/date/status change refetch — this is
  // the whole reason the Load button could go. The short debounce absorbs the
  // burst a date input emits while it is being typed into, and the cleanup
  // cancels a pending fetch when the user keeps changing filters.
  //
  // `purchases` has no entry: GrnRecordsTab owns its own filters and runs this
  // same debounced pattern internally, so there is nothing for this page to
  // fetch on its behalf. Hence `Partial` and the guard below.
  const loadForTab: Partial<Record<Tab, () => void>> = {
    sales: loadSales,
    stock: loadStock,
    cash: loadCash,
    contacts: loadContacts,
  };
  const activeLoader = loadForTab[activeTab];

  useEffect(() => {
    if (!activeLoader) return;
    const timer = setTimeout(activeLoader, 250);
    return () => clearTimeout(timer);
  }, [activeLoader]);

  // ─── TABS ──────────────────────────────────────────────────────────────────

  const ALL_TABS = [
    { id: "sales" as Tab, label: t("reports_tabSales"), icon: ShoppingCart, permission: "VIEW_SALES_REPORT" },
    { id: "purchases" as Tab, label: t("reports_tabPurchases"), icon: PackagePlus, permission: "VIEW_PURCHASE_REPORT" },
    { id: "stock" as Tab, label: t("reports_tabStock"), icon: Package, permission: "VIEW_STOCK" },
    { id: "cash" as Tab, label: t("reports_tabCash"), icon: Banknote, permission: "VIEW_CASH_REPORT" },
    { id: "contacts" as Tab, label: t("reports_tabContacts"), icon: Users },
  ];
  const TABS = ALL_TABS.filter((tab) => !tab.permission || can(tab.permission));

  // If the matrix denies whatever tab is currently active (the default is
  // "sales", or Settings → Roles was just edited under this session), land on
  // the first tab still available rather than showing a blank panel.
  useEffect(() => {
    if (!permsLoaded) return;
    if (TABS.some((tab) => tab.id === activeTab)) return;
    if (TABS[0]) setActiveTab(TABS[0].id);
  }, [permsLoaded, TABS, activeTab]);

  // Search (`salesSearch`) is now a server-side filter — see loadSales — so
  // these rows already reflect it and the page in view.
  const filteredSales = salesRows;

  const filteredStock = stockRows.filter((r) => {
    if (!stockSearch) return true;
    const s = stockSearch.toLowerCase();
    return r.name.toLowerCase().includes(s) || r.barcode.includes(s);
  });

  const filteredContacts = contacts.filter((c) => {
    if (!contactSearch) return true;
    const s = contactSearch.toLowerCase();
    return c.name.toLowerCase().includes(s) || String(c.accountId).includes(s) || c.city.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className={`text-xl font-bold text-gray-800 sm:text-2xl ${isUrdu ? "urdu-text" : ""}`}>{t("reports_title")}</h1>
        <p className={`mt-0.5 text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_subtitle")}</p>
      </div>

      {/* Tabs — five of them don't fit a phone, so the strip scrolls sideways */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-fit gap-1 rounded-xl bg-gray-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all sm:px-4 ${
                activeTab === tab.id ? "bg-white text-teal-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              <span className={isUrdu ? "urdu-text" : ""}>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── SALES TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "sales" && can("VIEW_SALES_REPORT") && (
        <div className="space-y-4">
          <DateFilter
            from={salesFrom} to={salesTo}
            onFromChange={setSalesFrom} onToChange={setSalesTo}
            preset={salesPreset} onPresetChange={applySalesPreset}
            loading={salesLoading}
            extra={
              <>
                <div>
                  <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_paymentStatus")}</label>
                  <select value={salesStatus} onChange={(e) => setSalesStatus(e.target.value as "" | PaymentStatus)}
                    className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:w-auto ${isUrdu ? "urdu-text" : ""}`}>
                    <option value="">{t("reports_statusAll")}</option>
                    <option value="PAID">{t("reports_statusPaid")}</option>
                    <option value="PARTIAL">{t("reports_statusPartial")}</option>
                    <option value="UNPAID">{t("reports_statusUnpaid")}</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_recordStatus")}</label>
                  <select value={salesRecordStatus} onChange={(e) => setSalesRecordStatus(e.target.value as "ACTIVE" | "VOIDED" | "ALL")}
                    className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:w-auto ${isUrdu ? "urdu-text" : ""}`}>
                    <option value="ACTIVE">{t("reports_recordActive")}</option>
                    <option value="VOIDED">{t("reports_recordVoided")}</option>
                    <option value="ALL">{t("reports_statusAll")}</option>
                  </select>
                </div>
                <div className="relative col-span-2 sm:col-auto">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input value={salesSearch} onChange={(e) => setSalesSearch(e.target.value)}
                    placeholder={t("reports_searchPartyInvoice")}
                    className={`w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm sm:w-52 ${isUrdu ? "urdu-text" : ""}`} />
                </div>
              </>
            }
          />

          {/* Totals */}
          {salesTotals && (
            <div className={`grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-7 ${salesStale ? "opacity-50" : ""}`}>
              <TotalCard label={t("reports_invoices")} value={salesTotals.invoiceCount} />
              <TotalCard label={t("reports_grossSale")} value={`Rs. ${formatCurrency(salesTotals.grossSale)}`} />
              <TotalCard label={t("reports_discount")} value={`Rs. ${formatCurrency(salesTotals.packageDiscount)}`} color="text-orange-600" />
              <TotalCard label={t("reports_returns")} value={`Rs. ${formatCurrency(salesTotals.returnAmount)}`} color="text-red-600" />
              <TotalCard label={t("reports_netBill")} value={`Rs. ${formatCurrency(salesTotals.netBill)}`} color="text-teal-700" />
              <TotalCard label={t("reports_outstanding")} value={`Rs. ${formatCurrency(salesTotals.outstanding ?? 0)}`} color="text-red-600" />
              {/* Estimate — cost of goods is valued at the item's *current*
                  purchasePrice (no cost snapshot on a sale line), same caveat
                  as the Dashboard's Sales & Profit panel. Withheld from a role
                  without VIEW_PURCHASE_PRICE, same as the Items page. */}
              {can("VIEW_PURCHASE_PRICE") && (
                <TotalCard label={t("reports_profit")} value={`Rs. ${formatCurrency(salesTotals.profit ?? 0)}`} color="text-purple-700" />
              )}
            </div>
          )}

          {/* Invoices — dimmed, not blanked, while a refetch is in flight. */}
          <div
            aria-busy={salesLoading}
            className={`rounded-xl border border-gray-200 bg-white transition-opacity ${salesStale ? "opacity-50" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
              <span className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{salesTotal} {t("reports_invoices")}</span>
              {salesTotal > 0 && can("EXPORT_REPORT") && (
                <button
                  onClick={exportSales}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50">
                  <Download className="h-3.5 w-3.5" /> <span className={isUrdu ? "urdu-text" : ""}>{t("reports_exportCsv")}</span>
                </button>
              )}
            </div>

            {filteredSales.length === 0 ? (
              <div className={`py-12 text-center text-sm text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_noSalesPeriod")}</div>
            ) : (
              <>
                {/*
                  Two renderings of the same rows, not two sources of truth: the
                  table from md up, cards below it. Columns drop out in a fixed
                  order as the window narrows (items at lg, type and gross at
                  xl) and everything they hide reappears in the expander, so no
                  figure is only reachable by widening the window. Below md a
                  ten-column table is unreadable however it is squeezed, so each
                  invoice becomes a card instead.
                */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="w-8 px-2 py-2.5" aria-hidden />
                        <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_invoice")}</th>
                        <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_party")}</th>
                        <th className={`hidden px-3 py-2.5 text-left font-medium lg:table-cell ${isUrdu ? "urdu-text" : ""}`}>{t("reports_items")}</th>
                        <th className={`hidden px-3 py-2.5 text-left font-medium xl:table-cell ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</th>
                        <th className={`hidden px-3 py-2.5 text-right font-medium xl:table-cell ${isUrdu ? "urdu-text" : ""}`}>{t("reports_gross")}</th>
                        <th className={`px-3 py-2.5 text-right font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_netBill")}</th>
                        <th className={`px-3 py-2.5 text-right font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_received")}</th>
                        <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_paymentStatus")}</th>
                        {/*
                          Pinned to the right edge of the scroll container: on a
                          narrow window the Actions menu stays reachable without
                          scrolling back across the table.
                        */}
                        <th className={`sticky right-0 bg-gray-50 px-3 py-2.5 text-center font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("reports_actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredSales.map((r) => {
                        const isExpanded = expandedSales.has(r.id);
                        const isBusy = salesActionBusy === r.id;
                        const isVoided = r.recordStatus === "VOIDED";
                        const settled = saleSettled(r);
                        const channels = saleChannels(r, t);
                        return (
                          <Fragment key={r.id}>
                            <tr className={`group transition-colors hover:bg-gray-50 ${isVoided ? "opacity-60" : ""}`}>
                              <td className="px-2 py-2 align-top">
                                <button
                                  onClick={() => toggleExpandSale(r.id)}
                                  aria-expanded={isExpanded}
                                  aria-label={isExpanded ? t("reports_hideItems") : t("reports_viewItems")}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-teal-600"
                                >
                                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 align-top">
                                <Link
                                  href={invoiceHref(r.id)}
                                  title={t("reports_orderDetail")}
                                  className="block font-mono text-xs font-semibold text-teal-700 underline-offset-2 hover:underline"
                                >#{r.invoiceNo}</Link>
                                <div className="text-[11px] text-gray-400">{formatDate(new Date(r.date))}</div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="max-w-[180px] truncate font-medium text-gray-800" title={r.partyName}>{r.partyName}</div>
                                <div className="max-w-[180px] truncate text-[11px] text-gray-400">#{r.accountId} · {r.cashier}</div>
                              </td>
                              <td className="hidden px-3 py-2 align-top lg:table-cell">
                                <div className="text-xs tabular-nums text-gray-600">{r.itemCount}</div>
                                <div className="max-w-[200px] truncate text-[11px] text-gray-400" title={saleItemsSummary(r)}>
                                  {saleItemsSummary(r) || "—"}
                                </div>
                              </td>
                              <td className="hidden px-3 py-2 align-top xl:table-cell">
                                <Chip tone={r.partyOption === "CASH" ? "neutral" : "blue"}>{partyOptionLabel(r.partyOption, t)}</Chip>
                              </td>
                              <td className="hidden px-3 py-2 text-right align-top text-gray-600 xl:table-cell">
                                <Money value={r.grossSale} muteZero />
                              </td>
                              <td className="px-3 py-2 text-right align-top">
                                <Money value={r.netBill} className={`font-semibold ${r.netBill < 0 ? "text-red-600" : "text-gray-800"}`} />
                              </td>
                              <td className="px-3 py-2 text-right align-top">
                                <Money
                                  value={r.netBill < 0 ? -settled : settled}
                                  className={settled > 0.005 ? "text-green-700" : ""}
                                  muteZero
                                />
                                {channels && (
                                  <div className="max-w-[130px] truncate text-[10px] text-gray-400" title={channels}>{channels}</div>
                                )}
                                {/* Received can look larger than Net Bill when the
                                    customer tendered more than the bill and got
                                    change back — this line is why, instead of
                                    leaving the reader to guess (or worse, assume
                                    the store kept the difference). */}
                                {r.change > 0.005 && (
                                  <div className="text-[10px] font-medium text-amber-600">
                                    {t("sales_changeFrom").replace("{amount}", formatCurrency(r.cashReceived + r.cardAmount + r.bankAmount + r.change))}: {formatCurrency(r.change)}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="flex flex-col items-start gap-1">{salesStatusChips(r)}</div>
                              </td>
                              <td className="sticky right-0 bg-white px-3 py-2 align-top group-hover:bg-gray-50">
                                <div className="flex items-center justify-center">
                                  <ActionMenu
                                    label={t("reports_actions")}
                                    disabled={isBusy}
                                    isUrdu={isUrdu}
                                    items={salesRowActions(r)}
                                  />
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-gray-50/70">
                                {/*
                                  The chevron column is left empty and the
                                  detail spans the other nine, so the panel
                                  starts under the Invoice column rather than at
                                  the table's edge — the indent is what marks it
                                  as belonging to the row above.
                                */}
                                <td className="w-8" aria-hidden />
                                <td colSpan={9} className="py-3 pl-1 pr-3 sm:pr-6">
                                  <SaleExpander row={r} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* One card per invoice — below md */}
                <div className="divide-y divide-gray-100 md:hidden">
                  {filteredSales.map((r) => {
                    const isExpanded = expandedSales.has(r.id);
                    const isBusy = salesActionBusy === r.id;
                    const isVoided = r.recordStatus === "VOIDED";
                    const settled = saleSettled(r);
                    return (
                      <div key={r.id} className={`space-y-2 p-3 ${isVoided ? "opacity-60" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                href={invoiceHref(r.id)}
                                title={t("reports_orderDetail")}
                                className="font-mono text-xs font-semibold text-teal-700 underline-offset-2 hover:underline"
                              >#{r.invoiceNo}</Link>
                              <span className="text-[11px] text-gray-400">{formatDate(new Date(r.date))}</span>
                            </div>
                            <div className="mt-0.5 truncate text-sm font-medium text-gray-800">{r.partyName}</div>
                            <div className="truncate text-[11px] text-gray-400">#{r.accountId} · {r.cashier}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <Money value={r.netBill} className={`text-base font-bold ${r.netBill < 0 ? "text-red-600" : "text-gray-800"}`} />
                            <div className={`text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                              <Money value={r.netBill < 0 ? -settled : settled} muteZero /> · {t("reports_received")}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip tone={r.partyOption === "CASH" ? "neutral" : "blue"}>{partyOptionLabel(r.partyOption, t)}</Chip>
                          {salesStatusChips(r)}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => toggleExpandSale(r.id)}
                            aria-expanded={isExpanded}
                            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50"
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            <span className={isUrdu ? "urdu-text" : ""}>{r.itemCount} {t("reports_items")}</span>
                          </button>
                          <ActionMenu
                            label={t("reports_actions")}
                            disabled={isBusy}
                            isUrdu={isUrdu}
                            items={salesRowActions(r)}
                          />
                        </div>

                        {isExpanded && (
                          <div className="pt-1">
                            <SaleExpander row={r} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <Pagination page={salesPage} pageSize={SALES_PAGE_SIZE} total={salesTotal} onPageChange={setSalesPage} />
          </div>
        </div>
      )}

      {receiptInvoiceId && (
        <ReceiptPrintTrigger
          invoiceId={receiptInvoiceId}
          onDone={() => setReceiptInvoiceId(null)}
        />
      )}

      {markPaidRow && (
        <MarkPaidModal
          row={markPaidRow}
          accounts={accounts}
          onClose={() => setMarkPaidRow(null)}
          onSaved={loadSales}
        />
      )}

      {refundRow && (
        <RefundModal
          row={refundRow}
          accounts={accounts}
          onClose={() => setRefundRow(null)}
          onSaved={loadSales}
        />
      )}

      {changeCustomerRow && (
        <ChangeCustomerModal
          row={changeCustomerRow}
          onClose={() => setChangeCustomerRow(null)}
          onSaved={loadSales}
        />
      )}

      {/*
        ── PURCHASES TAB ────────────────────────────────────────────────────
        The same GRN Records list the Purchases screen carries as its third
        tab, mounted here rather than reimplemented: this tab used to be a
        seven-column table with no payment side and no way to open a GRN,
        and keeping a second, thinner GRN list in sync with the first was
        never going to happen. **Open in GRN Form** is deliberately absent —
        there is no form on this page to open one into.
      */}
      {activeTab === "purchases" && can("VIEW_PURCHASE_REPORT") && <GrnRecordsTab branchId={branchId} />}

      {/* ── STOCK TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "stock" && can("VIEW_STOCK") && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)}
                placeholder={t("reports_searchItemBarcode")}
                className={`border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm w-56 ${isUrdu ? "urdu-text" : ""}`} />
            </div>
            <label className={`flex items-center gap-2 cursor-pointer text-sm ${isUrdu ? "urdu-text" : ""}`}>
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)}
                className="accent-teal-600 w-4 h-4" />
              {t("reports_lowStockOnly")}
            </label>
            {stockLoading && (
              <div className="flex items-center gap-1.5 py-2 text-sm text-gray-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className={isUrdu ? "urdu-text" : ""}>{t("loading")}</span>
              </div>
            )}
          </div>

          {stockTotals && (
            <div className="flex flex-wrap gap-3">
              <TotalCard label={t("reports_items")} value={stockTotals.itemCount} />
              <TotalCard label={t("reports_retailValue")} value={`Rs. ${formatCurrency(stockTotals.totalValue)}`} color="text-teal-700" />
              <TotalCard label={t("reports_totalSalePrice")} value={`Rs. ${formatCurrency(stockTotals.totalSalePrice ?? 0)}`} color="text-indigo-700" />
              <TotalCard label={t("reports_lowStock")} value={stockTotals.lowCount} color="text-orange-600" />
              <TotalCard label={t("reports_outOfStock")} value={stockTotals.outCount} color="text-red-600" />
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
              <span className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{filteredStock.length} {t("reports_items")}</span>
              {filteredStock.length > 0 && can("EXPORT_REPORT") && (
                <button
                  onClick={() => exportCSV("StockReport", filteredStock.map((r) => ({
                    Name: r.name, Category: r.category, Brand: r.brand, Barcode: r.barcode,
                    Unit: r.unit, "Buy Unit": r.purchaseUnit ?? r.unit,
                    "Purchase Price": r.purchasePrice, "Sale Price": r.salePrice,
                    "Opening Stock": r.openingStock, "Current Stock": r.currentStock,
                    "Min Level": r.minLevel, Status: r.status,
                  })))}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                  <Download className="w-3.5 h-3.5" /> <span className={isUrdu ? "urdu-text" : ""}>{t("reports_exportCsv")}</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_item")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_category")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_barcode")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_salePrice")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_opening")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_current")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_minLevel")}</th>
                    <th className={`px-4 py-3 text-center ${isUrdu ? "urdu-text" : ""}`}>{t("reports_status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredStock.length === 0 ? (
                    <tr><td colSpan={8} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                      {stockLoading ? t("loading") : t("reports_noStockData")}
                    </td></tr>
                  ) : (
                    filteredStock.map((r) => (
                      <tr key={r.itemId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800 truncate max-w-[200px]">{r.name}</div>
                          <div className="text-xs text-gray-400">{r.unit}</div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{r.category}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{r.barcode || "—"}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">Rs. {formatCurrency(r.salePrice)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{r.openingStock.toFixed(2)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${
                          r.status === "OUT" ? "text-red-700" : r.status === "LOW" ? "text-orange-600" : "text-gray-800"
                        }`}>
                          {r.currentStock.toFixed(2)}
                          {/* Only rendered for an item bought in one unit and
                              sold in another — see lib/units.ts. */}
                          {(() => {
                            const alt = formatStock(r.currentStock, r, unitCfg).secondary;
                            return alt ? (
                              <div className="text-[11px] font-normal text-gray-400">{alt}</div>
                            ) : null;
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400">{r.minLevel.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.status === "OK" ? "bg-green-100 text-green-700" :
                            r.status === "LOW" ? "bg-orange-100 text-orange-700" :
                            "bg-red-100 text-red-700"
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── CASH TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "cash" && can("VIEW_CASH_REPORT") && (
        <div className="space-y-4">
          <DateFilter
            from={cashFrom} to={cashTo}
            onFromChange={setCashFrom} onToChange={setCashTo}
            loading={cashLoading}
          />

          {cashTotals && (
            <div className="flex flex-wrap gap-3">
              <TotalCard label={t("reports_cashSales")} value={`Rs. ${formatCurrency(cashTotals.cashSales)}`} color="text-green-700" />
              <TotalCard label={t("reports_cardSales")} value={`Rs. ${formatCurrency(cashTotals.cardSales)}`} color="text-blue-700" />
              <TotalCard label={t("reports_bankSales")} value={`Rs. ${formatCurrency(cashTotals.bankSales)}`} color="text-indigo-700" />
              <TotalCard label={t("reports_creditSales")} value={`Rs. ${formatCurrency(cashTotals.creditSales)}`} color="text-orange-600" />
              <TotalCard label={t("reports_recoveries")} value={`Rs. ${formatCurrency(cashTotals.recoveries)}`} color="text-teal-700" />
              <TotalCard label={t("reports_totalCashIn")} value={`Rs. ${formatCurrency(cashTotals.totalCashIn)}`} color="text-gray-900" />
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
              <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_dailyCashBreakdown")}</h3>
              {cashDays.length > 0 && can("EXPORT_REPORT") && (
                <button
                  onClick={() => exportCSV(`Cash_${cashFrom}_${cashTo}`, cashDays.map((d) => ({
                    Date: d.date, "Cash Sales": d.cashSales, "Card Sales": d.cardSales, "Bank Sales": d.bankSales,
                    "Credit Sales": d.creditSales, Recoveries: d.recoveries, "Cash Recoveries": d.cashRecoveries,
                    "Total Cash In": d.totalCashIn,
                  })))}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                  <Download className="w-3.5 h-3.5" /> <span className={isUrdu ? "urdu-text" : ""}>{t("reports_exportCsv")}</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_cashSales")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_cardSales")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_bankSales")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_creditSales")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_recoveries")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_totalCashIn")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cashDays.length === 0 ? (
                    <tr><td colSpan={7} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_noDataPeriod")}</td></tr>
                  ) : (
                    cashDays.map((d) => (
                      <tr key={d.date} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-gray-700">{formatDate(new Date(d.date))}</td>
                        <td className="px-4 py-2.5 text-right text-green-700">Rs. {formatCurrency(d.cashSales)}</td>
                        <td className="px-4 py-2.5 text-right text-blue-700">Rs. {formatCurrency(d.cardSales)}</td>
                        <td className="px-4 py-2.5 text-right text-indigo-700">Rs. {formatCurrency(d.bankSales)}</td>
                        <td className="px-4 py-2.5 text-right text-orange-600">Rs. {formatCurrency(d.creditSales)}</td>
                        <td className="px-4 py-2.5 text-right text-teal-700">
                          Rs. {formatCurrency(d.recoveries)}
                          {/* Only the cash part reaches Total Cash In. */}
                          {Math.abs(d.recoveries - d.cashRecoveries) > 0.005 && (
                            <div className={`text-xs text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{formatCurrency(d.cashRecoveries)} {t("reports_inCash")}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">Rs. {formatCurrency(d.totalCashIn)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {cashDays.length > 0 && cashTotals && (
                  <tfoot>
                    <tr className="bg-gray-100 font-semibold">
                      <td className={`px-4 py-2.5 text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_totals")}</td>
                      <td className="px-4 py-2.5 text-right text-green-700">Rs. {formatCurrency(cashTotals.cashSales)}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700">Rs. {formatCurrency(cashTotals.cardSales)}</td>
                      <td className="px-4 py-2.5 text-right text-indigo-700">Rs. {formatCurrency(cashTotals.bankSales)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-600">Rs. {formatCurrency(cashTotals.creditSales)}</td>
                      <td className="px-4 py-2.5 text-right text-teal-700">Rs. {formatCurrency(cashTotals.recoveries)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-900">Rs. {formatCurrency(cashTotals.totalCashIn)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── CONTACTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)}
                placeholder={t("reports_searchNameIdCity")}
                className={`border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm w-56 ${isUrdu ? "urdu-text" : ""}`} />
            </div>
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</label>
              <select value={contactTypeFilter} onChange={(e) => setContactTypeFilter(e.target.value)}
                className={`border border-gray-300 rounded-lg px-3 py-2 text-sm ${isUrdu ? "urdu-text" : ""}`}>
                <option value="">{t("reports_allTypes")}</option>
                <option value="CASH">{t("reports_cash")}</option>
                <option value="CREDIT">{t("reports_creditCr")}</option>
                <option value="VENDOR">{t("reports_vendor")}</option>
              </select>
            </div>
            {contactsLoading && (
              <div className="flex items-center gap-1.5 py-2 text-sm text-gray-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className={isUrdu ? "urdu-text" : ""}>{t("loading")}</span>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
              <span className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{filteredContacts.length} {t("reports_contacts")}</span>
              {filteredContacts.length > 0 && can("EXPORT_REPORT") && (
                <button
                  onClick={() => exportCSV("ContactList", filteredContacts.map((c) => ({
                    "Account ID": c.accountId, Name: c.name, Type: c.type,
                    Address: c.address, City: c.city, Phone: c.phone, Mobile: c.mobile,
                    "Credit Limit": c.creditLimit, Balance: c.balance,
                  })))}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                  <Download className="w-3.5 h-3.5" /> <span className={isUrdu ? "urdu-text" : ""}>{t("reports_exportCsv")}</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_account")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_city")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("reports_phoneMobile")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("reports_creditLimit")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("balance")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredContacts.length === 0 ? (
                    <tr><td colSpan={7} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                      {contactsLoading ? t("loading") : t("reports_noContactsFound")}
                    </td></tr>
                  ) : (
                    filteredContacts.map((c) => (
                      <tr key={c.accountId} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">#{c.accountId}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{c.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            c.type === "CREDIT" ? "bg-blue-100 text-blue-700" :
                            c.type === "VENDOR" ? "bg-purple-100 text-purple-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{c.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{c.city || "—"}</td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {c.phone || c.mobile || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {c.creditLimit > 0 ? `Rs. ${formatCurrency(c.creditLimit)}` : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${isUrdu ? "urdu-text" : ""} ${
                          c.balance > 0 ? "text-red-600" : c.balance < 0 ? "text-green-600" : "text-gray-400"
                        }`}>
                          {c.balance !== 0 ? `Rs. ${formatCurrency(Math.abs(c.balance))} ${c.balance > 0 ? t("reports_dr") : t("reports_cr")}` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
