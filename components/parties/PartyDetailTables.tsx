"use client";

import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, CalendarClock, FileText } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { grnHref, invoiceHref } from "@/lib/document-links";
import { Chip, Money, PlanChip } from "@/components/reports/list-ui";
import type {
  PartyGrnRow,
  PartyInvoiceRow,
  PartyLedgerRow,
  PartyPlanRow,
  PartySettlementRow,
  PaymentStatus,
} from "@/components/parties/party-detail";

/**
 * The five tables behind the Party Detail page's tabs.
 *
 * They live here rather than in the page for the reason the reports list-ui
 * primitives do: the page is already the profile card, six summary tiles, a
 * filter bar and the tab strip, and a single file holding all of that plus five
 * tables is one nobody can find anything in.
 *
 * Every money figure goes through `<Money>` and every badge through `<Chip>`,
 * both from `components/reports/list-ui` — the same components the Sales and
 * GRN lists use, so an invoice reads identically whether it is found through
 * Reports or through its customer.
 */

// ─── Shared bits ──────────────────────────────────────────────────────────────

/** A table shell: rounded card, horizontal scroll, and nothing else. */
export function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/**
 * A header cell. `align` maps to a literal class rather than interpolating
 * `text-${align}` — Tailwind scans source text, so a built class name is one it
 * never emits, and the column silently stays left-aligned in production.
 */
const TH_ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function Th({
  children, align = "left", className = "",
}: { children?: React.ReactNode; align?: keyof typeof TH_ALIGN; className?: string }) {
  const { isUrdu } = useI18n();
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 ${TH_ALIGN[align]} font-semibold text-gray-600 ${isUrdu ? "urdu-text" : ""} ${className}`}>
      {children}
    </th>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  const { isUrdu } = useI18n();
  return (
    <tr>
      <td colSpan={colSpan} className={`py-10 text-center text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
        {label}
      </td>
    </tr>
  );
}

/** PAID / PARTIAL / UNPAID, worded and coloured the same way the reports do. */
export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  const { t, isUrdu } = useI18n();
  const tone = status === "PAID" ? "green" : status === "PARTIAL" ? "amber" : "red";
  const label =
    status === "PAID" ? t("partyDetail_statusPaid")
      : status === "PARTIAL" ? t("partyDetail_statusPartial")
        : t("partyDetail_statusUnpaid");
  return <Chip tone={tone}><span className={isUrdu ? "urdu-text" : undefined}>{label}</span></Chip>;
}

/** Translated LedgerEntryType labels — the Ledger page's own map, not a copy. */
export function useLedgerTypeLabels(): Record<string, string> {
  const { t } = useI18n();
  return {
    SALE: t("ledger_typeSale"),
    SALE_RETURN: t("ledger_typeSaleReturn"),
    PURCHASE: t("ledger_typePurchase"),
    PURCHASE_RETURN: t("ledger_typePurchaseReturn"),
    PAYMENT: t("ledger_payment"),
    RECEIPT: t("ledger_typeReceipt"),
    ADJUSTMENT: t("ledger_typeAdjustment"),
    OPENING_BALANCE: t("ledger_typeOpeningBal"),
  };
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export function PartySalesTable({ rows }: { rows: PartyInvoiceRow[] }) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";

  return (
    <TableCard>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <Th>{t("partyDetail_invoiceNo")}</Th>
            <Th>{t("date")}</Th>
            <Th align="center">{t("partyDetail_items")}</Th>
            <Th align="right">{t("partyDetail_netBill")}</Th>
            <Th align="right">{t("partyDetail_paidCol")}</Th>
            <Th align="right">{t("partyDetail_outstanding")}</Th>
            <Th align="center">{t("partyDetail_status")}</Th>
            <Th>{t("partyDetail_by")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 ? (
            <EmptyRow colSpan={8} label={t("partyDetail_noSales")} />
          ) : rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-3 py-2.5 whitespace-nowrap">
                <Link href={invoiceHref(r.id)}
                  className="font-semibold text-teal-600 underline-offset-2 hover:text-teal-800 hover:underline">
                  #{r.invoiceNo}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {r.recordStatus === "VOIDED" && (
                    <Chip tone="slate"><span className={u}>{t("partyDetail_voided")}</span></Chip>
                  )}
                  {r.recordStatus === "HELD" && (
                    <Chip tone="amber"><span className={u}>{t("partyDetail_held")}</span></Chip>
                  )}
                  {r.refundOfInvoiceNo != null && (
                    <Chip tone="purple">
                      <span className={u}>{t("partyDetail_refundOf")}</span> #{r.refundOfInvoiceNo}
                    </Chip>
                  )}
                  {r.refundedByInvoiceNo != null && (
                    <Chip tone="red">
                      <span className={u}>{t("partyDetail_refunded")}</span> #{r.refundedByInvoiceNo}
                    </Chip>
                  )}
                  <PlanChip plan={r.plan} />
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{formatDate(r.date)}</td>
              <td className="px-3 py-2.5 text-center tabular-nums text-gray-500">{r.itemCount}</td>
              <td className="px-3 py-2.5 text-right font-medium text-gray-800"><Money value={r.netBill} /></td>
              <td className="px-3 py-2.5 text-right text-gray-600"><Money value={r.settled} muteZero /></td>
              <td className="px-3 py-2.5 text-right font-semibold text-red-600"><Money value={r.outstanding} muteZero /></td>
              <td className="px-3 py-2.5 text-center"><PaymentStatusChip status={r.paymentStatus} /></td>
              <td className="max-w-[140px] truncate px-3 py-2.5 text-gray-500">{r.cashier}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

// ─── Purchases ────────────────────────────────────────────────────────────────

export function PartyPurchasesTable({ rows }: { rows: PartyGrnRow[] }) {
  const { t } = useI18n();

  return (
    <TableCard>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <Th>{t("partyDetail_grnNo")}</Th>
            <Th>{t("date")}</Th>
            <Th>{t("partyDetail_billNo")}</Th>
            <Th align="center">{t("partyDetail_items")}</Th>
            <Th align="right">{t("partyDetail_netBill")}</Th>
            <Th align="right">{t("partyDetail_paidCol")}</Th>
            <Th align="right">{t("partyDetail_outstanding")}</Th>
            <Th align="center">{t("partyDetail_status")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 ? (
            <EmptyRow colSpan={8} label={t("partyDetail_noPurchases")} />
          ) : rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-3 py-2.5 whitespace-nowrap">
                <Link href={grnHref(r.id)}
                  className="font-semibold text-teal-600 underline-offset-2 hover:text-teal-800 hover:underline">
                  #{r.grnNo}
                </Link>
                <div className="mt-0.5"><PlanChip plan={r.plan} /></div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{formatDate(r.date)}</td>
              <td className="max-w-[140px] truncate px-3 py-2.5 font-mono text-xs text-gray-500">{r.billNo ?? "—"}</td>
              <td className="px-3 py-2.5 text-center tabular-nums text-gray-500">{r.itemCount}</td>
              <td className="px-3 py-2.5 text-right font-medium text-gray-800"><Money value={r.netBill} /></td>
              <td className="px-3 py-2.5 text-right text-gray-600"><Money value={r.settled} muteZero /></td>
              <td className="px-3 py-2.5 text-right font-semibold text-orange-600"><Money value={r.outstanding} muteZero /></td>
              <td className="px-3 py-2.5 text-center"><PaymentStatusChip status={r.paymentStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

// ─── Ledger statement ─────────────────────────────────────────────────────────

/**
 * A running-balance figure with its Dr/Cr tag — red when the party owes the
 * store, green when the store owes them, the one convention the whole app uses.
 *
 * Module scope, not nested inside the table: a component created during render
 * is a new type on every render, so React tears down and rebuilds every cell
 * each time (the same reason `MoneyGroup` in list-ui.tsx lives at module scope).
 */
function BalanceCell({ value }: { value: number }) {
  const { t, isUrdu } = useI18n();
  return (
    <span className={`font-semibold tabular-nums ${value >= 0 ? "text-red-700" : "text-green-700"}`}>
      <Money value={Math.abs(value)} />
      <span className={`ml-1 text-xs font-normal ${isUrdu ? "urdu-text" : ""}`}>
        {value >= 0 ? t("ledger_dr") : t("ledger_cr")}
      </span>
    </span>
  );
}

/**
 * The party's statement over the window, opening at the balance carried in.
 *
 * The brought-forward row is part of the table rather than a card above it: the
 * running balance column only makes sense read downwards from it, and a reader
 * who starts at row one otherwise sees a balance that appears from nowhere.
 */
export function PartyLedgerTable({
  rows, openingBalance, totals,
}: {
  rows: PartyLedgerRow[];
  openingBalance: number;
  totals: { totalDebit: number; totalCredit: number; closingBalance: number };
}) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  const typeLabels = useLedgerTypeLabels();

  const typeTone = (type: string) =>
    type === "SALE" ? "bg-teal-100 text-teal-700"
      : type === "RECEIPT" ? "bg-green-100 text-green-700"
        : type === "PAYMENT" ? "bg-red-100 text-red-700"
          : type === "PURCHASE" ? "bg-blue-100 text-blue-700"
            : "bg-gray-100 text-gray-600";

  return (
    <TableCard>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <Th>{t("date")}</Th>
            <Th>{t("type")}</Th>
            <Th>{t("ledger_reference")}</Th>
            <Th>{t("parties_notes")}</Th>
            <Th align="right">{t("ledger_debit")}</Th>
            <Th align="right">{t("ledger_credit")}</Th>
            <Th align="right">{t("balance")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          <tr className="bg-gray-50/60">
            <td colSpan={6} className={`px-3 py-2 text-xs font-medium text-gray-500 ${u}`}>
              {t("partyDetail_broughtForward")}
            </td>
            <td className="px-3 py-2 text-right"><BalanceCell value={openingBalance} /></td>
          </tr>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} label={t("partyDetail_noLedger")} />
          ) : rows.map((r) => {
            const href = r.invoiceId ? invoiceHref(r.invoiceId) : r.grnId ? grnHref(r.grnId) : null;
            return (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{formatDate(r.date)}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeTone(r.type)} ${u}`}>
                    {typeLabels[r.type] ?? r.type}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {href ? (
                    <Link href={href} className="text-teal-600 underline-offset-2 hover:text-teal-800 hover:underline">
                      {r.reference ?? "—"}
                    </Link>
                  ) : (
                    <span className="text-gray-600">{r.reference ?? "—"}</span>
                  )}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-gray-500">{r.notes ?? ""}</td>
                <td className="px-3 py-2.5 text-right font-medium text-red-600"><Money value={r.debit} muteZero /></td>
                <td className="px-3 py-2.5 text-right font-medium text-green-600"><Money value={r.credit} muteZero /></td>
                <td className="px-3 py-2.5 text-right"><BalanceCell value={r.balance} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-gray-200 bg-gray-50">
          <tr>
            <td colSpan={4} className={`px-3 py-2.5 text-xs font-semibold text-gray-600 ${u}`}>
              {t("partyDetail_closingBalance")}
            </td>
            <td className="px-3 py-2.5 text-right font-bold text-red-600"><Money value={totals.totalDebit} /></td>
            <td className="px-3 py-2.5 text-right font-bold text-green-600"><Money value={totals.totalCredit} /></td>
            <td className="px-3 py-2.5 text-right"><BalanceCell value={totals.closingBalance} /></td>
          </tr>
        </tfoot>
      </table>
    </TableCard>
  );
}

// ─── Settlements ──────────────────────────────────────────────────────────────

/**
 * Money in and money out in one chronological list. A party can be on both
 * sides — a vendor the store also sells to — and two separate tables would hide
 * that the same person paid on Monday and was paid on Tuesday.
 */
export function PartyPaymentsTable({ rows }: { rows: PartySettlementRow[] }) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";

  return (
    <TableCard>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <Th>{t("date")}</Th>
            <Th>{t("partyDetail_direction")}</Th>
            <Th align="right">{t("amount")}</Th>
            <Th>{t("partyDetail_method")}</Th>
            <Th>{t("partyDetail_against")}</Th>
            <Th>{t("parties_notes")}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} label={t("partyDetail_noPayments")} />
          ) : rows.map((r) => {
            const received = r.kind === "RECOVERY";
            const href = r.invoiceId ? invoiceHref(r.invoiceId) : r.grnId ? grnHref(r.grnId) : null;
            const docLabel = r.invoiceNo != null ? `#${r.invoiceNo}` : r.grnNo != null ? `GRN #${r.grnNo}` : null;
            return (
              <tr key={`${r.kind}-${r.id}`} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{formatDate(r.date)}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${received ? "text-green-700" : "text-red-700"} ${u}`}>
                    {received ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                    {received ? t("partyDetail_received") : t("partyDetail_paidOut")}
                  </span>
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold ${received ? "text-green-700" : "text-red-700"}`}>
                  <Money value={r.amount} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600">
                  {r.accountName ?? r.paymentMethod}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {href && docLabel ? (
                    <Link href={href} className="text-teal-600 underline-offset-2 hover:text-teal-800 hover:underline">
                      {docLabel}
                    </Link>
                  ) : (
                    // No document means it was collected against the party's
                    // balance as a whole, not one bill — see `Recovery.invoiceId`.
                    <span className={`text-gray-400 ${u}`}>{t("partyDetail_partyBalance")}</span>
                  )}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-gray-500">{r.notes ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

// ─── Installment plans ────────────────────────────────────────────────────────

/**
 * One card per plan, each with its full schedule. Cards rather than one flat
 * table: the schedules belong to different bills, and a single list of "seq 1,
 * seq 2, seq 1…" reads as nonsense.
 */
export function PartyPlansPanel({ rows }: { rows: PartyPlanRow[] }) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";

  if (rows.length === 0) {
    return (
      <div className={`rounded-xl border border-gray-100 bg-white py-12 text-center text-gray-400 shadow-sm ${u}`}>
        {t("partyDetail_noPlans")}
      </div>
    );
  }

  const kindLabel = (kind: string) =>
    kind === "PROMISE_DAY" ? t("ledger_planPromiseDay")
      : kind === "WEEKLY" ? t("ledger_planWeekly")
        : t("ledger_planMonthly");

  return (
    <div className="space-y-4">
      {rows.map((p) => {
        const href = p.invoiceId ? invoiceHref(p.invoiceId) : p.grnId ? grnHref(p.grnId) : null;
        const docLabel = p.invoiceNo != null ? `#${p.invoiceNo}` : p.grnNo != null ? `GRN #${p.grnNo}` : null;
        return (
          <div key={p.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarClock className="h-4 w-4 text-gray-500" />
                <span className={`font-semibold text-gray-800 ${u}`}>{kindLabel(p.kind)}</span>
                {href && docLabel && (
                  <Link href={href}
                    className="font-mono text-xs text-teal-600 underline-offset-2 hover:text-teal-800 hover:underline">
                    {docLabel}
                  </Link>
                )}
                <Chip tone={p.summary.overdueCount > 0 ? "red" : "blue"}>
                  <span className="tabular-nums">{p.summary.paidCount}/{p.periods}</span>
                </Chip>
                {p.summary.overdueCount > 0 && (
                  <Chip tone="red">
                    <span className={u}>{t("ledger_overdue")}</span>
                    <span className="tabular-nums">{p.summary.overdueCount}</span>
                  </Chip>
                )}
              </div>
              <div className="flex gap-5 text-xs">
                <span>
                  <span className={`text-gray-400 ${u}`}>{t("partyDetail_principal")} </span>
                  <span className="font-semibold text-gray-700"><Money value={p.principal} /></span>
                </span>
                <span>
                  <span className={`text-gray-400 ${u}`}>{t("partyDetail_remaining")} </span>
                  <span className="font-semibold text-red-600"><Money value={p.summary.remaining} /></span>
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-white">
                  <tr>
                    <Th>{t("partyDetail_installmentNo")}</Th>
                    <Th>{t("partyDetail_dueDate")}</Th>
                    <Th align="right">{t("amount")}</Th>
                    <Th align="right">{t("partyDetail_paidCol")}</Th>
                    <Th align="center">{t("partyDetail_status")}</Th>
                    <Th>{t("partyDetail_paidOn")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {p.installments.map((i) => {
                    const overdue = i.status !== "PAID" && new Date(i.dueDate) < new Date();
                    return (
                      <tr key={i.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 tabular-nums text-gray-500">{i.seq}</td>
                        <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-medium text-red-600" : "text-gray-600"}`}>
                          {formatDate(i.dueDate)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-800"><Money value={i.amount} /></td>
                        <td className="px-3 py-2 text-right text-green-700"><Money value={i.paidAmount} muteZero /></td>
                        <td className="px-3 py-2 text-center">
                          <Chip tone={i.status === "PAID" ? "green" : i.status === "PARTIAL" ? "amber" : overdue ? "red" : "neutral"}>
                            <span className={u}>
                              {i.status === "PAID" ? t("partyDetail_statusPaid")
                                : i.status === "PARTIAL" ? t("partyDetail_statusPartial")
                                  : overdue ? t("ledger_overdue") : t("ledger_statusPending")}
                            </span>
                          </Chip>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                          {i.paidAt ? formatDate(i.paidAt) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Overview mini-lists ──────────────────────────────────────────────────────

/**
 * A short "latest five" list for the Overview tab. Deliberately not a table:
 * Overview answers "what has been happening", and a reader who wants columns
 * and totals is one click away on the tab that has them.
 */
export function RecentList({
  title, icon: Icon, emptyLabel, onSeeAll, rows,
}: {
  title: string;
  icon: typeof FileText;
  emptyLabel: string;
  onSeeAll?: () => void;
  rows: { key: string; href: string | null; label: string; sub: string; amount: number; tone?: string }[];
}) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className={`flex items-center gap-2 text-sm font-semibold text-gray-700 ${u}`}>
          <Icon className="h-4 w-4 text-gray-400" /> {title}
        </h3>
        {onSeeAll && rows.length > 0 && (
          <button onClick={onSeeAll} className={`text-xs font-medium text-teal-600 hover:text-teal-800 ${u}`}>
            {t("partyDetail_seeAll")}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className={`px-4 py-8 text-center text-sm text-gray-400 ${u}`}>{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50">
              <div className="min-w-0">
                {r.href ? (
                  <Link href={r.href} className="text-sm font-medium text-teal-600 underline-offset-2 hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-gray-700">{r.label}</span>
                )}
                <div className="truncate text-xs text-gray-400">{r.sub}</div>
              </div>
              <span className={`shrink-0 text-sm font-semibold ${r.tone ?? "text-gray-700"}`}>
                <Money value={r.amount} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
