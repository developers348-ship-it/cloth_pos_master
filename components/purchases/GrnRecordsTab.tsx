"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, FileText, Pencil, Search, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import {
  Chip, DateFilter, Money, MoneyGroup, TotalCard,
  applyDatePreset, monthStart, shownParts, today, type MoneyPart,
  PlanChip,
} from "@/components/reports/list-ui";
import { formatCurrency, formatDate, type DateRangePreset } from "@/lib/utils";
import { exportCSV } from "@/lib/csv-export";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";
import { usePermissions } from "@/lib/permissions-client";
import { readReportCache, isReportCacheFresh, writeReportCache } from "@/lib/report-cache";
import type { PaymentStatus } from "@/lib/grn-settlement";
import type { PlanSummary } from "@/lib/installments";
// Re-exported: the GRN records tab was this helper's original home, and other
// modules still import it from here.
import { grnHref } from "@/lib/document-links";
export { grnHref };

/**
 * **GRN Records** — every received bill as a record you can filter, read and
 * open, the purchase-side counterpart of the sales list in Reports → Sales.
 *
 * The GRN screen's left-hand picker answers "which GRN do I want to edit"; it
 * is 224px wide and shows four fields. This answers a different question —
 * what did we buy in this period, from whom, and what do we still owe on it —
 * and needs the room of a full table for it.
 *
 * Mounted in two places, deliberately the same component: as the Purchases
 * screen's third tab (where it also offers **Open in GRN Form**, since the form
 * is right there) and as Reports → Purchases. Two GRN lists that drifted apart
 * on what "paid" means is the outcome this avoids.
 */

export type GrnLine = {
  name: string; unit: string;
  qty: number; rate: number; amount: number; isReturn: boolean;
};

export type GrnRow = {
  id: string;
  grnNo: number;
  date: string;
  vendorId: string; vendorName: string; accountId: number;
  billNo: string; remarks: string; receivedBy: string;
  itemCount: number; purchaseItemCount: number; returnItemCount: number;
  items: GrnLine[];
  saleAmount: number; billAmount: number; returnAmount: number;
  discountPct: number; adjustment: number; netBill: number;
  totalPurchaseQty: number; totalReturnQty: number;
  paymentMethod: string;
  cashPaid: number; bankPaid: number; bankAccountName: string | null;
  collected: number; settled: number; outstanding: number;
  paymentStatus: PaymentStatus;
  hasPlan: boolean;
  /** Paid against this bill from the Ledger page's Payment tab. */
  paid: number;
  /** Repayment plan state, or null when the GRN has none. */
  plan: PlanSummary | null;
};

/** What this tab holds — and what gets cached across navigations. */
type GrnPayload = { grns: GrnRow[]; totals: GrnTotals | null };

/**
 * Cache namespace (see lib/report-cache.ts). Deliberately one slot shared by
 * both mounts of this tab — Reports → Purchases and the Purchases screen show
 * the same list off the same defaults, so a visit to either warms the other.
 */
const GRN_CACHE = "reports:purchases";

export type GrnTotals = {
  grnCount: number; saleAmount: number; returnAmount: number; netBill: number;
  paid: number; outstanding: number;
  totalPurchaseQty: number; totalReturnQty: number;
};

function grnItemsSummary(r: GrnRow): string {
  return r.items.map((i) => `${i.name} x${i.qty}${i.isReturn ? " (R)" : ""}`).join(", ");
}

/** What was paid at receipt, as a sub-line under the Paid column. */
function grnChannels(r: GrnRow, t: (key: TranslationKey) => string): string {
  const parts: string[] = [];
  if (r.cashPaid > 0.005) parts.push(`${t("reports_cash")} ${formatCurrency(r.cashPaid)}`);
  if (r.bankPaid > 0.005) parts.push(`${t("reports_bank")} ${formatCurrency(r.bankPaid)}`);
  if (r.collected > 0.005) parts.push(`${t("purchases_paidSince")} ${formatCurrency(r.collected)}`);
  return parts.join(" · ");
}

/**
 * The lines behind one GRN, shared by the table expander and the mobile card.
 * The same fixed-width figure columns as the sales list's, so a GRN and an
 * invoice read the same way when both are open.
 */
function GrnLineItems({ row }: { row: GrnRow }) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  const cols = "grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem_3.25rem_5.5rem_6rem] gap-2 px-3";
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <div className="min-w-[365px]">
        <div className={`${cols} bg-gray-50 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400`}>
          <div aria-hidden />
          <div className={u}>{t("purchases_itemName")}</div>
          <div className={`text-center ${u}`}>{t("purchases_unit")}</div>
          <div className={`text-right ${u}`}>{t("purchases_qty")}</div>
          <div className={`text-right ${u}`}>{t("purchases_costRate")}</div>
          <div className={`text-right ${u}`}>{t("amount")}</div>
        </div>
        <div className="divide-y divide-gray-100">
          {row.items.map((li, idx) => (
            <div key={idx} className={`${cols} items-center py-1.5 text-xs`}>
              <div aria-hidden />
              <div className="flex min-w-0 items-center gap-1.5">
                {/* PUR / RET, the same two marks the GRN form's line toggle uses */}
                <span className={`shrink-0 rounded px-1 text-[10px] font-bold leading-4 ${
                  li.isReturn ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                }`}>{li.isReturn ? "R" : "P"}</span>
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
 * The bill and what has been paid against it. Every figure is already on the
 * row; none of it is fetched. Read top to bottom in two halves, each closing on
 * the figure that matters — Net Bill and Outstanding — the same shape as the
 * sales breakdown and as the printed GRN.
 */
function GrnMoneyBreakdown({ row }: { row: GrnRow }) {
  const { t } = useI18n();
  const isReturnGrn = row.netBill < 0;
  // Not stored: the GRN keeps the percentage, and `billAmount` already has the
  // discount and the adjustment folded in (see the summary maths on the GRN
  // form). Deriving it here is what lets the panel show the step.
  const discountAmount = (row.saleAmount * row.discountPct) / 100;

  const bill: MoneyPart[] = [
    { label: t("purchases_purchaseAmount"), value: row.saleAmount, optional: true },
    {
      label: `${t("purchases_discount")}${row.discountPct > 0.005 ? ` (${row.discountPct}%)` : ""}`,
      value: -discountAmount, tone: "text-orange-600", optional: true,
    },
    { label: t("purchases_adjustment"), value: row.adjustment, optional: true },
    { label: t("purchases_returnAmount"), value: -row.returnAmount, tone: "text-red-600", optional: true },
    {
      label: isReturnGrn ? t("purchases_refundDue") : t("purchases_netBill"),
      value: row.netBill, tone: "text-gray-800", total: true,
    },
  ];

  // On a net-return GRN `cashAmount`/`bankAmount` are money coming back *from*
  // the vendor, so the two lines relabel to Refund — exactly as the GRN form
  // relabels its own fields.
  const paid: MoneyPart[] = [
    {
      label: isReturnGrn ? t("purchases_refundCash") : t("purchases_cashPaid"),
      value: row.cashPaid, tone: "text-green-700", optional: true,
    },
    {
      label: isReturnGrn ? t("purchases_refundBank") : t("purchases_bankPaid"),
      value: row.bankPaid, tone: "text-blue-700", optional: true,
    },
    { label: t("purchases_paidSince"), value: row.collected, tone: "text-teal-700", optional: true },
    // Ledger-page payments booked against this bill, separate from schedule
    // collections so the two channels stay readable.
    { label: t("purchases_paidLedger"), value: row.paid, tone: "text-teal-700", optional: true },
    { label: t("reports_outstanding"), value: row.outstanding, tone: "text-red-600", total: true },
  ];

  return (
    <dl className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <MoneyGroup parts={shownParts(bill)} />
      <div className="my-1.5 border-t border-dashed border-gray-200" />
      <MoneyGroup parts={shownParts(paid)} />
    </dl>
  );
}

/** Lines first, money under them — see the note on `SaleExpander`. */
function GrnExpander({ row }: { row: GrnRow }) {
  return (
    <div className="space-y-3">
      <GrnLineItems row={row} />
      <div className="ml-auto w-full max-w-sm">
        <GrnMoneyBreakdown row={row} />
      </div>
    </div>
  );
}

export default function GrnRecordsTab({
  branchId, onEditGrn,
}: {
  branchId: string;
  /**
   * Load this GRN into the GRN form for editing. Only passed on the Purchases
   * screen, where the form is one tab away; in Reports there is nothing to load
   * it into, so the action is simply absent there rather than navigating away.
   */
  onEditGrn?: (id: string) => void;
}) {
  const { t, isUrdu } = useI18n();
  const { can } = usePermissions();
  const router = useRouter();
  const u = isUrdu ? "urdu-text" : "";

  const [preset, setPreset] = useState<DateRangePreset>("thisMonth");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<"" | PaymentStatus>("");
  const [search, setSearch] = useState("");
  // Seeded from the cross-navigation cache so returning to this tab paints the
  // last result on the first frame and refetches underneath, instead of showing
  // an empty table for the length of the round trip. Lazy initialisers: the
  // cache is read once, at mount, not on every render.
  const [rows, setRows] = useState<GrnRow[]>(
    () => readReportCache<GrnPayload>(GRN_CACHE)?.grns ?? []
  );
  const [totals, setTotals] = useState<GrnTotals | null>(
    () => readReportCache<GrnPayload>(GRN_CACHE)?.totals ?? null
  );
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Which filters a cached payload belongs to. */
  const cacheKey = useMemo(
    () => [branchId, from, to, status].join("|"),
    [branchId, from, to, status]
  );
  // Only the newest request may write state or the cache: a slow early fetch
  // must not land after a fast later one and put the wrong filters' rows on
  // screen — easy to hit now that a stale list stays visible while the user
  // keeps adjusting the dates.
  const req = useRef(0);
  /**
   * True when the rows on screen came from the cache but belong to some other
   * set of filters — a placeholder until this request lands, so they are dimmed
   * rather than presented as the answer.
   */
  const stale = loading && !isReportCacheFresh(GRN_CACHE, cacheKey);

  const load = useCallback(async () => {
    if (!branchId) return;
    const seq = ++req.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ branchId });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (status) params.set("paymentStatus", status);
      const res = await fetch(`/api/reports/purchases?${params}`);
      const data = await res.json();
      if (seq !== req.current) return;
      const payload: GrnPayload = { grns: data.grns ?? [], totals: data.totals ?? null };
      writeReportCache(GRN_CACHE, cacheKey, payload);
      setRows(payload.grns);
      setTotals(payload.totals);
    } catch {
      if (seq === req.current) toast.error(t("purchases_loadGrnsFailed"));
    } finally {
      if (seq === req.current) setLoading(false);
    }
  }, [branchId, from, to, status, cacheKey, t]);

  // No Load button: the loader is keyed on its own filter state, so a preset,
  // date or status change refetches on its own. The 250ms debounce absorbs the
  // burst a date input emits while it is being typed into.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function applyPreset(next: DateRangePreset) {
    setPreset(next);
    applyDatePreset(next, setFrom, setTo);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete(row: GrnRow) {
    if (!confirm(t("purchases_deleteGrnConfirm"))) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/purchases/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("purchases_grnDeletedSuccess"));
      load();
    } catch {
      toast.error(t("purchases_deleteGrnFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(row: GrnRow): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    // Always first and never withdrawn — reading a GRN isn't gated (the report
    // endpoints are deliberately open, see lib/authz.ts).
    items.push({
      key: "detail", label: t("purchases_grnDetail"), icon: FileText,
      onSelect: () => router.push(grnHref(row.id)),
    });
    if (onEditGrn && can("EDIT_GRN")) {
      items.push({
        key: "edit", label: t("purchases_openInGrnForm"), icon: Pencil,
        onSelect: () => onEditGrn(row.id),
      });
    }
    if (can("DELETE_GRN")) {
      items.push({
        key: "delete", label: t("purchases_delete"), icon: Trash2, tone: "danger",
        onSelect: () => handleDelete(row),
      });
    }
    return items;
  }

  /**
   * One column's worth of state: the payment badge always, plus a chip only
   * when there is something else to say — the shape the sales list settled on
   * after two adjacent status columns read as the same thing twice.
   */
  function statusChips(r: GrnRow) {
    return (
      <>
        <Chip tone={
          r.paymentStatus === "PAID" ? "green" :
          r.paymentStatus === "PARTIAL" ? "amber" : "red"
        }>
          {r.paymentStatus === "PAID" ? t("reports_statusPaid") :
           r.paymentStatus === "PARTIAL" ? t("reports_statusPartial") :
           t("reports_statusUnpaid")}
          {r.outstanding > 0.005 && (
            <span className="font-normal">· <Money value={r.outstanding} /> {t("reports_due")}</span>
          )}
        </Chip>
        {r.netBill < 0 && <Chip tone="purple">{t("purchases_netReturn")}</Chip>}
        {/* Kind + progress + next due, not just "has a plan". */}
        <PlanChip plan={r.plan} />
      </>
    );
  }

  // Free-text search stays client-side, like the sales list's: the rows are
  // already in hand, so typing filters instantly and fires no request.
  const filtered = rows.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.vendorName.toLowerCase().includes(s)
      || String(r.grnNo).includes(s)
      || r.billNo.toLowerCase().includes(s)
      || String(r.accountId).includes(s);
  });

  return (
    <div className="space-y-4">
      <DateFilter
        from={from} to={to}
        onFromChange={setFrom} onToChange={setTo}
        preset={preset} onPresetChange={applyPreset}
        loading={loading}
        extra={
          <>
            <div>
              <label className={`mb-1 block text-xs font-medium text-gray-500 ${u}`}>{t("reports_paymentStatus")}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "" | PaymentStatus)}
                className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:w-auto ${u}`}>
                <option value="">{t("reports_statusAll")}</option>
                <option value="PAID">{t("reports_statusPaid")}</option>
                <option value="PARTIAL">{t("reports_statusPartial")}</option>
                <option value="UNPAID">{t("reports_statusUnpaid")}</option>
              </select>
            </div>
            <div className="relative col-span-2 sm:col-auto">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t("purchases_searchGrnVendorBill")}
                className={`w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm sm:w-56 ${u}`} />
            </div>
          </>
        }
      />

      {totals && (
        <div className={`grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6 ${stale ? "opacity-50" : ""}`}>
          <TotalCard label={t("reports_grns")} value={totals.grnCount} />
          <TotalCard label={t("purchases_purchaseAmount")} value={`Rs. ${formatCurrency(totals.saleAmount)}`} />
          <TotalCard label={t("purchases_returnAmount")} value={`Rs. ${formatCurrency(totals.returnAmount)}`} color="text-red-600" />
          <TotalCard label={t("reports_netBill")} value={`Rs. ${formatCurrency(totals.netBill)}`} color="text-teal-700" />
          <TotalCard label={t("reports_paid")} value={`Rs. ${formatCurrency(totals.paid)}`} color="text-green-700" />
          <TotalCard label={t("reports_outstanding")} value={`Rs. ${formatCurrency(totals.outstanding)}`} color="text-red-600" />
        </div>
      )}

      {/* Dimmed, not blanked, while a refetch is in flight. */}
      <div
        aria-busy={loading}
        className={`rounded-xl border border-gray-200 bg-white transition-opacity ${stale ? "opacity-50" : ""}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
          <span className={`text-sm text-gray-500 ${u}`}>{filtered.length} {t("reports_grns")}</span>
          {filtered.length > 0 && (
            <button
              onClick={() => exportCSV(`Purchases_${from}_${to}`, filtered.map((r) => ({
                "GRN No": r.grnNo, Date: formatDate(new Date(r.date)),
                Vendor: r.vendorName, "Account ID": r.accountId,
                "Bill No": r.billNo, "Received By": r.receivedBy,
                Items: r.itemCount, "Sale Amount": r.saleAmount,
                "Discount %": r.discountPct, Adjustment: r.adjustment,
                "Return Amount": r.returnAmount, "Net Bill": r.netBill,
                "Cash Paid": r.cashPaid, "Bank Paid": r.bankPaid,
                "Paid Since": r.collected, "Total Paid": r.settled,
                Outstanding: r.outstanding, "Payment Status": r.paymentStatus,
                "Purchase Qty": r.totalPurchaseQty, "Return Qty": r.totalReturnQty,
                Remarks: r.remarks,
              })))}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50">
              <Download className="h-3.5 w-3.5" /> <span className={u}>{t("reports_exportCsv")}</span>
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className={`py-12 text-center text-sm text-gray-400 ${u}`}>{t("reports_noGrnsPeriod")}</div>
        ) : (
          <>
            {/*
              Two renderings of the same rows, not two sources of truth: the
              table from md up, cards below it. Columns drop out in a fixed
              order as the window narrows (items at lg, bill no at xl) and
              everything they hide reappears in the expander, so no figure is
              only reachable by widening the window.
            */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="w-8 px-2 py-2.5" aria-hidden />
                    <th className={`px-3 py-2.5 text-left font-medium ${u}`}>{t("reports_grnNo")}</th>
                    <th className={`px-3 py-2.5 text-left font-medium ${u}`}>{t("reports_vendor")}</th>
                    <th className={`hidden px-3 py-2.5 text-left font-medium lg:table-cell ${u}`}>{t("reports_items")}</th>
                    <th className={`hidden px-3 py-2.5 text-left font-medium xl:table-cell ${u}`}>{t("reports_billNo")}</th>
                    <th className={`px-3 py-2.5 text-right font-medium ${u}`}>{t("reports_netBill")}</th>
                    <th className={`px-3 py-2.5 text-right font-medium ${u}`}>{t("reports_paid")}</th>
                    <th className={`px-3 py-2.5 text-left font-medium ${u}`}>{t("reports_paymentStatus")}</th>
                    {/* Pinned to the right edge of the scroll container, so the
                        menu stays reachable on a narrow window. */}
                    <th className={`sticky right-0 bg-gray-50 px-3 py-2.5 text-center font-medium ${u}`}>{t("reports_actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((r) => {
                    const isExpanded = expanded.has(r.id);
                    const channels = grnChannels(r, t);
                    return (
                      <Fragment key={r.id}>
                        <tr className="group transition-colors hover:bg-gray-50">
                          <td className="px-2 py-2 align-top">
                            <button
                              onClick={() => toggleExpand(r.id)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? t("reports_hideItems") : t("reports_viewItems")}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-teal-600"
                            >
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top">
                            <Link
                              href={grnHref(r.id)}
                              title={t("purchases_grnDetail")}
                              className="block font-mono text-xs font-semibold text-teal-700 underline-offset-2 hover:underline"
                            >#{r.grnNo}</Link>
                            <div className="text-[11px] text-gray-400">{formatDate(new Date(r.date))}</div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="max-w-[180px] truncate font-medium text-gray-800" title={r.vendorName}>{r.vendorName}</div>
                            <div className="max-w-[180px] truncate text-[11px] text-gray-400">
                              #{r.accountId}{r.receivedBy ? ` · ${r.receivedBy}` : ""}
                            </div>
                          </td>
                          <td className="hidden px-3 py-2 align-top lg:table-cell">
                            <div className="text-xs tabular-nums text-gray-600">{r.itemCount}</div>
                            <div className="max-w-[200px] truncate text-[11px] text-gray-400" title={grnItemsSummary(r)}>
                              {grnItemsSummary(r) || "—"}
                            </div>
                          </td>
                          <td className="hidden px-3 py-2 align-top text-xs text-gray-500 xl:table-cell">
                            {r.billNo || "—"}
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            <Money value={r.netBill} className={`font-semibold ${r.netBill < 0 ? "text-red-600" : "text-gray-800"}`} />
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            <Money
                              value={r.netBill < 0 ? -r.settled : r.settled}
                              className={r.settled > 0.005 ? "text-green-700" : ""}
                              muteZero
                            />
                            {channels && (
                              <div className="max-w-[130px] truncate text-[10px] text-gray-400" title={channels}>{channels}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-col items-start gap-1">{statusChips(r)}</div>
                          </td>
                          <td className="sticky right-0 bg-white px-3 py-2 align-top group-hover:bg-gray-50">
                            <div className="flex items-center justify-center">
                              <ActionMenu
                                label={t("reports_actions")}
                                disabled={busyId === r.id}
                                isUrdu={isUrdu}
                                items={rowActions(r)}
                              />
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-gray-50/70">
                            {/* The chevron column stays empty and the detail
                                spans the rest, so the panel starts under the
                                GRN column rather than at the table's edge. */}
                            <td className="w-8" aria-hidden />
                            <td colSpan={8} className="py-3 pl-1 pr-3 sm:pr-6">
                              <GrnExpander row={r} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* One card per GRN — below md, where a nine-column table is
                unreadable however it is squeezed */}
            <div className="divide-y divide-gray-100 md:hidden">
              {filtered.map((r) => {
                const isExpanded = expanded.has(r.id);
                return (
                  <div key={r.id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={grnHref(r.id)}
                            title={t("purchases_grnDetail")}
                            className="font-mono text-xs font-semibold text-teal-700 underline-offset-2 hover:underline"
                          >#{r.grnNo}</Link>
                          <span className="text-[11px] text-gray-400">{formatDate(new Date(r.date))}</span>
                        </div>
                        <div className="mt-0.5 truncate text-sm font-medium text-gray-800">{r.vendorName}</div>
                        <div className="truncate text-[11px] text-gray-400">
                          #{r.accountId}{r.billNo ? ` · ${r.billNo}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <Money value={r.netBill} className={`text-base font-bold ${r.netBill < 0 ? "text-red-600" : "text-gray-800"}`} />
                        <div className={`text-[11px] text-gray-400 ${u}`}>
                          <Money value={r.netBill < 0 ? -r.settled : r.settled} muteZero /> · {t("reports_paid")}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">{statusChips(r)}</div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => toggleExpand(r.id)}
                        aria-expanded={isExpanded}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        <span className={u}>{r.itemCount} {t("reports_items")}</span>
                      </button>
                      <ActionMenu
                        label={t("reports_actions")}
                        disabled={busyId === r.id}
                        isUrdu={isUrdu}
                        items={rowActions(r)}
                      />
                    </div>

                    {isExpanded && <div className="pt-1"><GrnExpander row={r} /></div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
