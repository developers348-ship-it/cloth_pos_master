"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingUp, Wallet, Percent, Receipt, Table2, ArrowDownCircle, PiggyBank } from "lucide-react";
import toast from "react-hot-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, getDateRangeForPreset, type DateRangePreset } from "@/lib/utils";
import SalesProfitChart, { bucketLabel, type SalesProfitPoint } from "./SalesProfitChart";

/**
 * The dashboard's sales-and-profit panel: one date filter scoping six headline
 * figures, a two-series chart and an optional table of the same numbers.
 *
 * Mirrors the Reports page's filter behaviour — the same preset list, the same
 * "no Load button, the filter *is* the trigger" rule, the same 250 ms debounce
 * so typing a custom date doesn't fire a request per keystroke.
 */

const PRESETS: DateRangePreset[] = [
  "today", "yesterday", "last7days", "thisMonth", "lastMonth",
  "last30days", "thisYear", "lastYear", "all", "custom",
];

type Totals = {
  invoiceCount: number; grossSale: number; discount: number; returnAmount: number;
  netSale: number; cogs: number; profit: number; marginPct: number;
  // Cost management. `profit` above stays the trading margin; `netProfit` is
  // that minus `expenses`. Withdrawals are shown but never netted off profit —
  // see the note under the chart.
  expenses: number; unpaidExpenses: number; withdrawals: number;
  injections: number; netProfit: number; netMarginPct: number;
};

type Payload = { granularity: "day" | "month"; series: SalesProfitPoint[]; totals: Totals };

function StatTile({
  label, value, sub, icon: Icon, tone,
}: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  const { isUrdu } = useI18n();
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{label}</span>
        <Icon className={`w-5 h-5 ${tone}`} />
      </div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      {sub && <div className={`text-xs text-gray-400 mt-1 ${isUrdu ? "urdu-text" : ""}`}>{sub}</div>}
    </div>
  );
}

export default function SalesProfitPanel({ branchId }: { branchId: string }) {
  const { t, isUrdu } = useI18n();
  const [preset, setPreset] = useState<DateRangePreset>("thisMonth");
  const [from, setFrom] = useState(() => getDateRangeForPreset("thisMonth").from);
  const [to, setTo] = useState(() => getDateRangeForPreset("thisMonth").to);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTable, setShowTable] = useState(false);

  function applyPreset(next: DateRangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const range = getDateRangeForPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ branchId });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/reports/dashboard?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
    } catch {
      toast.error(t("dash_loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [branchId, from, to, t]);

  // The filter is the trigger: `load` is keyed on the range, so changing a
  // preset or a date refetches. Debounced because a date input emits a change
  // per edit while the user is still typing the year.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const totals = data?.totals;
  const series = data?.series ?? [];
  const presetLabels: Record<DateRangePreset, string> = {
    today: t("reports_dateToday"),
    yesterday: t("reports_dateYesterday"),
    last7days: t("reports_dateLast7Days"),
    thisMonth: t("reports_dateThisMonth"),
    lastMonth: t("reports_dateLastMonth"),
    last30days: t("reports_dateLast30Days"),
    thisYear: t("reports_dateThisYear"),
    lastYear: t("reports_dateLastYear"),
    all: t("reports_dateAll"),
    custom: t("reports_dateCustom"),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-lg font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>
            {t("dash_salesProfit")}
          </h2>
          <p className={`text-xs text-gray-400 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
            {t("dash_salesProfitSubtitle")}
          </p>
        </div>
      </div>

      {/* Filters: one row, above everything they scope. */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
            {t("reports_dateRange")}
          </label>
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as DateRangePreset)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>{presetLabels[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("from")}</label>
          <input
            type="date" value={from} disabled={preset !== "custom" && preset !== "all"}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("to")}</label>
          <input
            type="date" value={to} disabled={preset !== "custom" && preset !== "all"}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
        {loading && (
          <span className={`py-2 text-sm text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</span>
        )}
      </div>

      {/* Headline figures for the selected range. Six rather than four since
          cost management landed: gross profit and net profit are different
          numbers and a shopkeeper needs to see both, plus what it cost to get
          from one to the other. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile
          label={t("dash_sales")} icon={TrendingUp} tone="text-blue-500"
          value={`Rs. ${formatCurrency(totals?.netSale ?? 0)}`}
          sub={`${totals?.invoiceCount ?? 0} ${t("dash_invoices")}`}
        />
        <StatTile
          label={t("dash_grossProfit")} icon={Wallet} tone="text-orange-500"
          value={`Rs. ${formatCurrency(totals?.profit ?? 0)}`}
          sub={`${t("dash_costOfGoods")}: Rs. ${formatCurrency(totals?.cogs ?? 0)}`}
        />
        <StatTile
          label={t("dash_expenses")} icon={ArrowDownCircle} tone="text-rose-500"
          value={`Rs. ${formatCurrency(totals?.expenses ?? 0)}`}
          sub={
            (totals?.unpaidExpenses ?? 0) > 0
              ? `Rs. ${formatCurrency(totals?.unpaidExpenses ?? 0)} ${t("expenses_stillOwed")}`
              : undefined
          }
        />
        <StatTile
          label={t("dash_netProfit")} icon={PiggyBank} tone="text-green-600"
          value={`Rs. ${formatCurrency(totals?.netProfit ?? 0)}`}
          sub={`${(totals?.netMarginPct ?? 0).toFixed(1)}% ${t("dash_afterCosts")}`}
        />
        <StatTile
          label={t("dash_margin")} icon={Percent} tone="text-teal-500"
          value={`${(totals?.marginPct ?? 0).toFixed(1)}%`}
          sub={`${t("dash_returns")}: Rs. ${formatCurrency(totals?.returnAmount ?? 0)}`}
        />
        <StatTile
          label={t("dash_discountGiven")} icon={Receipt} tone="text-purple-500"
          value={`Rs. ${formatCurrency(totals?.discount ?? 0)}`}
          sub={`${t("dash_period")}: ${presetLabels[preset]}`}
        />
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
            {data?.granularity === "month" ? t("dash_byMonth") : t("dash_byDay")}
          </span>
          {series.length > 0 && (totals?.invoiceCount ?? 0) > 0 && (
            <button
              onClick={() => setShowTable((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}
            >
              <Table2 className="h-3.5 w-3.5" />
              {showTable ? t("dash_hideTable") : t("dash_showTable")}
            </button>
          )}
        </div>

        {/* The API fills every bucket in the range, so a period with no trade
            comes back as a series of zeros, not an empty array — the invoice
            count is what actually says "nothing happened here". */}
        {series.length === 0 || (totals?.invoiceCount ?? 0) === 0 ? (
          <p className={`py-16 text-center text-sm text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
            {t("dash_noSalesInPeriod")}
          </p>
        ) : (
          <SalesProfitChart
            points={series}
            salesLabel={t("dash_sales")}
            profitLabel={t("dash_grossProfit")}
            formatValue={(n) => `Rs. ${formatCurrency(n)}`}
            dimmed={loading}
            isUrdu={isUrdu}
          />
        )}

        <div className={`mt-3 space-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
          <p>{t("dash_profitEstimateNote")}</p>
          {/* The chart plots gross profit, the tiles also show net — say which
              is which rather than leaving the reader to notice the gap. */}
          <p>{t("dash_netProfitNote")}</p>
        </div>
      </div>

      {/* Table view — the same numbers without hovering, and the accessible
          fallback for anyone the chart's colours don't serve. */}
      {showTable && series.length > 0 && (totals?.invoiceCount ?? 0) > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className={`px-4 py-2.5 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                  <th className={`px-4 py-2.5 text-center ${isUrdu ? "urdu-text" : ""}`}>{t("dash_invoiceCount")}</th>
                  <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("dash_sales")}</th>
                  <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("dash_grossProfit")}</th>
                  <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("dash_expenses")}</th>
                  <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("dash_netProfit")}</th>
                  <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("dash_margin")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {series.map((p) => (
                  <tr key={p.key} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">{bucketLabel(p.key)}</td>
                    <td className="px-4 py-2 text-center text-gray-500">{p.invoices}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-800">Rs. {formatCurrency(p.sales)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${p.profit < 0 ? "text-red-600" : "text-gray-800"}`}>
                      Rs. {formatCurrency(p.profit)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {(p.expenses ?? 0) !== 0 ? `Rs. ${formatCurrency(p.expenses ?? 0)}` : "—"}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium ${(p.netProfit ?? p.profit) < 0 ? "text-red-600" : "text-gray-800"}`}>
                      Rs. {formatCurrency(p.netProfit ?? p.profit)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {p.sales !== 0 ? `${((p.profit / p.sales) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
