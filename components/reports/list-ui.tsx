"use client";

import { formatCurrency, formatDate, getDateRangeForPreset, shopMonthStart, shopToday, type DateRangePreset } from "@/lib/utils";
import type { PlanSummary } from "@/lib/installments";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * The pieces every record list on this app is built from — the date-range bar,
 * the totals cards and the money/chip primitives.
 *
 * These began as private helpers inside `app/dashboard/reports/page.tsx`. They
 * moved here when the GRN Records list needed the same ones: two lists of
 * documents that render money and status differently is exactly the drift the
 * sales table already had to be rescued from (see docs/orders.md — `Rs.`
 * wrapping onto two lines, duplicate status columns), and copying them would
 * have re-introduced it on the purchase side.
 */

// Shop calendar, not UTC or the device — see `shopToday` / `shopMonthStart`.
export const today = shopToday;
export const monthStart = shopMonthStart;

export const DATE_PRESETS: DateRangePreset[] = [
  "today", "yesterday", "last7days", "thisMonth", "lastMonth",
  "last30days", "thisYear", "lastYear", "all", "custom",
];

/** The dropdown's labels, in the current language. */
export function usePresetLabels(): Record<DateRangePreset, string> {
  const { t } = useI18n();
  return {
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
}

/**
 * Applies a preset to a from/to pair. `custom` leaves the dates alone — it is
 * the mode in which the two inputs become editable, not a range of its own.
 */
export function applyDatePreset(
  preset: DateRangePreset,
  setFrom: (v: string) => void,
  setTo: (v: string) => void,
) {
  if (preset === "custom") return;
  const { from, to } = getDateRangeForPreset(preset);
  setFrom(from);
  setTo(to);
}

// ─── Date Range Filter Bar ────────────────────────────────────────────────────

/**
 * Date range + per-list filters. There is no Load button: every control here
 * feeds the list's `useCallback` loader, and the caller's auto-load effect
 * re-runs the fetch whenever one of them changes (debounced, so typing into a
 * date field doesn't fire a request per keystroke). `loading` only drives the
 * spinner that tells the user a refresh is in flight.
 */
export function DateFilter({
  from, to, onFromChange, onToChange, loading, extra,
  preset, onPresetChange,
}: {
  from: string; to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  loading?: boolean;
  extra?: React.ReactNode;
  preset?: DateRangePreset;
  onPresetChange?: (v: DateRangePreset) => void;
}) {
  const { t, isUrdu } = useI18n();
  const presetLabels = usePresetLabels();
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex sm:flex-wrap sm:items-end sm:p-4">
      {onPresetChange && (
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_dateRange")}</label>
          <select value={preset ?? "custom"} onChange={(e) => onPresetChange(e.target.value as DateRangePreset)}
            className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:w-auto ${isUrdu ? "urdu-text" : ""}`}>
            {DATE_PRESETS.map((p) => (
              <option key={p} value={p}>{presetLabels[p]}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("from")}</label>
        <input type="date" value={from} disabled={!!onPresetChange && preset !== "custom" && preset !== "all"}
          onChange={(e) => onFromChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 sm:w-auto" />
      </div>
      <div>
        <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("to")}</label>
        <input type="date" value={to} disabled={!!onPresetChange && preset !== "custom" && preset !== "all"}
          onChange={(e) => onToChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 sm:w-auto" />
      </div>
      {extra}
      {loading && (
        <div className="flex items-center gap-1.5 py-2 text-sm text-gray-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className={isUrdu ? "urdu-text" : ""}>{t("loading")}</span>
        </div>
      )}
    </div>
  );
}

// ─── Totals Row ───────────────────────────────────────────────────────────────

export function TotalCard({ label, value, color = "text-gray-800" }: {
  label: string; value: string | number; color?: string;
}) {
  const { isUrdu } = useI18n();
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3">
      <div className={`text-[11px] text-gray-500 mb-0.5 truncate ${isUrdu ? "urdu-text" : ""}`}>{label}</div>
      <div className={`text-base sm:text-lg font-bold tabular-nums whitespace-nowrap ${color}`}>{value}</div>
    </div>
  );
}

// ─── Money and status primitives ──────────────────────────────────────────────

/**
 * A rupee figure. Money in a table has to line up down the column and never
 * wrap — the old sales cells let `Rs.` and the digits break onto two lines
 * whenever a column got tight, which is what made the list hard to scan. A
 * negative amount (a refund, or any net-return document) puts the sign in front
 * of `Rs.` rather than between it and the digits.
 */
export function Money({ value, className = "", muteZero = false }: {
  value: number; className?: string; muteZero?: boolean;
}) {
  if (muteZero && Math.abs(value) < 0.005) {
    return <span className="text-gray-300">—</span>;
  }
  const negative = value < -0.005;
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {negative ? "− " : ""}Rs. {formatCurrency(Math.abs(value))}
    </span>
  );
}

const CHIP_TONE = {
  neutral: "bg-gray-100 text-gray-600",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  purple: "bg-purple-50 text-purple-700",
  slate: "bg-gray-200 text-gray-600",
} as const;

export function Chip({ tone = "neutral", children, className = "" }: {
  tone?: keyof typeof CHIP_TONE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${CHIP_TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

/**
 * A repayment plan reduced to one chip: its kind, how far through the schedule
 * it is, and when the next installment falls due. Turns red once that date has
 * passed.
 *
 * Shared by the sales rows and the GRN records list so a customer's plan and a
 * vendor's plan read identically. The plan-kind labels are the Ledger page's
 * (`ledger_plan*`) rather than new `reports_*` copies, so all three screens
 * name the arrangement the same way.
 */
export function PlanChip({ plan }: { plan: PlanSummary | null }) {
  const { t, isUrdu } = useI18n();
  if (!plan) return null;

  const kindLabel =
    plan.kind === "PROMISE_DAY" ? t("ledger_planPromiseDay")
      : plan.kind === "WEEKLY" ? t("ledger_planWeekly")
        : t("ledger_planMonthly");

  return (
    <Chip tone={plan.nextOverdue ? "red" : "blue"}>
      <span className={isUrdu ? "urdu-text" : undefined}>{kindLabel}</span>
      {plan.periods > 1 && <span className="tabular-nums">{plan.paidCount}/{plan.periods}</span>}
      {plan.nextDueDate && (
        <span className="tabular-nums">
          {plan.nextOverdue ? t("ledger_overdue") : t("reports_planNextDue")} {formatDate(new Date(plan.nextDueDate))}
        </span>
      )}
    </Chip>
  );
}

export type MoneyPart = {
  label: string;
  value: number;
  tone?: string;
  /** Dropped from the panel entirely when it is zero — see `shownParts`. */
  optional?: boolean;
  /** A closing figure: ruled off above, and always shown even at zero. */
  total?: boolean;
};

/**
 * Only the lines that actually carry a figure. A cash sale with no discount, no
 * return and no card payment was printing six labels with a dash against each,
 * so the two figures that mattered were buried among rows saying nothing. The
 * closing totals are exempt: "Outstanding Rs. 0.00" is a statement in itself,
 * where a missing Outstanding row would just look like an omission.
 */
export function shownParts(parts: MoneyPart[]): MoneyPart[] {
  return parts.filter((p) => !p.optional || Math.abs(p.value) >= 0.005);
}

/**
 * One half of a money breakdown. Module scope, not nested inside its caller: a
 * component created during render is a new type on every render, so React would
 * tear down and rebuild each line each time.
 */
export function MoneyGroup({ parts }: { parts: MoneyPart[] }) {
  const { isUrdu } = useI18n();
  return (
    <>
      {parts.map((p) => (
        <div
          key={p.label}
          className={`flex items-baseline justify-between gap-4 py-0.5 ${
            p.total ? "mt-0.5 border-t border-gray-300 pt-1.5" : ""
          }`}
        >
          <dt className={`text-[11px] ${
            p.total ? "font-semibold text-gray-600" : "text-gray-400"
          } ${isUrdu ? "urdu-text" : ""}`}>
            {p.label}
          </dt>
          <dd className={`${p.total ? "text-sm font-bold" : "text-xs font-medium"} ${p.tone ?? "text-gray-600"}`}>
            <Money value={p.value} />
          </dd>
        </div>
      ))}
    </>
  );
}
