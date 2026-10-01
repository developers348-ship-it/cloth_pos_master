"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  AlertTriangle, ArrowLeft, ArrowUpDown, BookOpen, CalendarClock, Download,
  Edit2, FileText, Mail, MapPin, Phone, ShoppingCart, StickyNote, Truck, User,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { exportCSV } from "@/lib/csv-export";
import { formatCurrency, formatDate, getDateRangeForPreset, type DateRangePreset } from "@/lib/utils";
import { grnHref, invoiceHref } from "@/lib/document-links";
import { DateFilter, Money } from "@/components/reports/list-ui";
import PartyFormModal from "@/components/parties/PartyFormModal";
import { usePartyDetail } from "@/components/parties/party-detail";
import {
  PartyLedgerTable, PartyPaymentsTable, PartyPlansPanel, PartyPurchasesTable,
  PartySalesTable, RecentList, useLedgerTypeLabels,
} from "@/components/parties/PartyDetailTables";

/**
 * One customer or vendor, in full — reached from the Parties list by clicking
 * a name or its **View detail** action.
 *
 * A page rather than a modal, for the reasons the invoice and GRN details are
 * pages: the party gets a URL that can be linked, bookmarked, opened in a
 * second tab and walked back through, and there is far too much here to scroll
 * inside a box that is itself scrolling the list behind it.
 *
 * The screen is in two halves, and they answer different questions:
 *
 * - **Above the filter** — who this party is and where they stand *today*: the
 *   profile, the live balance, and lifetime trading totals. None of it moves
 *   when the date range changes, because "what do they still owe" is not a
 *   question about March.
 * - **Below the filter** — what happened in a chosen period, across six tabs.
 *
 * Every invoice number and GRN number is a link into that document's own detail
 * page, which is the thread the user asked for: from a customer, to the sale,
 * to the goods on it.
 */

const DEFAULT_PRESET: DateRangePreset = "all";

export default function PartyDetailPage() {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data: session } = useSession();
  const { can } = usePermissions();
  const branchId = (session?.user as { branchId?: string } | undefined)?.branchId;

  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const initial = getDateRangeForPreset(DEFAULT_PRESET);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  const { detail, error, loading, reload } = usePartyDetail({
    partyId: params.id,
    branchId,
    from,
    to,
    fallbackError: t("partyDetail_loadFailed"),
  });

  const ledgerTypeLabels = useLedgerTypeLabels();

  function applyPreset(next: DateRangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const range = getDateRangeForPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  // ── CSV of whatever is on screen ───────────────────────────────────────────
  // One button rather than one per tab: the export is "what I am looking at",
  // and a toolbar of five download buttons is a worse answer to that.
  const exportRows = useMemo(() => {
    if (!detail) return [];
    switch (tab) {
      case "sales":
      case "overview":
        return detail.invoices.map((r) => ({
          Invoice: r.invoiceNo, Date: formatDate(r.date), Items: r.itemCount,
          NetBill: r.netBill, Paid: r.settled, Outstanding: r.outstanding,
          Status: r.paymentStatus, Record: r.recordStatus, By: r.cashier,
        }));
      case "purchases":
        return detail.grns.map((r) => ({
          GRN: r.grnNo, Date: formatDate(r.date), Bill: r.billNo ?? "", Items: r.itemCount,
          NetBill: r.netBill, Paid: r.settled, Outstanding: r.outstanding, Status: r.paymentStatus,
        }));
      case "ledger":
        return detail.ledger.entries.map((r) => ({
          Date: formatDate(r.date), Type: ledgerTypeLabels[r.type] ?? r.type,
          Reference: r.reference ?? "", Details: r.notes ?? "",
          Debit: r.debit || "", Credit: r.credit || "", Balance: r.balance,
        }));
      case "payments":
        return detail.settlements.map((r) => ({
          Date: formatDate(r.date),
          Direction: r.kind === "RECOVERY" ? "Received" : "Paid out",
          Amount: r.amount, Method: r.accountName ?? r.paymentMethod,
          Against: r.invoiceNo != null ? `Invoice #${r.invoiceNo}`
            : r.grnNo != null ? `GRN #${r.grnNo}` : "",
          Details: r.notes ?? "",
        }));
      case "plans":
        return detail.plans.flatMap((p) =>
          p.installments.map((i) => ({
            Plan: p.kind,
            Document: p.invoiceNo != null ? `Invoice #${p.invoiceNo}`
              : p.grnNo != null ? `GRN #${p.grnNo}` : "",
            No: i.seq, Due: formatDate(i.dueDate), Amount: i.amount,
            Paid: i.paidAmount, Status: i.status,
            PaidOn: i.paidAt ? formatDate(i.paidAt) : "",
          }))
        );
    }
  }, [detail, tab, ledgerTypeLabels]);

  function handleExport() {
    if (!detail || exportRows.length === 0) return;
    const slug = detail.party.name.replace(/\s+/g, "-");
    exportCSV(`${slug}_${tab}_${from || "all"}_${to || "all"}`, exportRows);
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-6">
        <BackLink onClick={() => router.push("/dashboard/parties")} label={t("partyDetail_back")} />
        <div className={`mt-6 rounded-xl border border-red-100 bg-red-50 p-6 text-center text-red-600 ${u}`}>
          <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
          {error}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6">
        <BackLink onClick={() => router.push("/dashboard/parties")} label={t("partyDetail_back")} />
        <div className={`mt-6 py-20 text-center text-gray-400 ${u}`}>{t("loading")}</div>
      </div>
    );
  }

  const { party, balance, lifetime, windowTotals } = detail;
  const liveBalance = balance?.balance ?? party.previousBalance;
  const owes = liveBalance > 0.005;
  const owed = liveBalance < -0.005;

  const typeChip = party.type === "CASH" ? "bg-green-100 text-green-700"
    : party.type === "CREDIT" ? "bg-orange-100 text-orange-700"
      : "bg-blue-100 text-blue-700";
  const typeLabel = party.type === "CASH" ? t("parties_cash")
    : party.type === "CREDIT" ? t("parties_credit")
      : t("parties_vendor");

  const allTabs: { id: Tab; label: string; icon: typeof FileText; count?: number; permission?: string }[] = [
    { id: "overview", label: t("partyDetail_tabOverview"), icon: User },
    { id: "sales", label: t("partyDetail_tabSales"), icon: ShoppingCart, count: detail.invoices.length },
    { id: "purchases", label: t("partyDetail_tabPurchases"), icon: Truck, count: detail.grns.length },
    { id: "ledger", label: t("partyDetail_tabLedger"), icon: BookOpen, count: detail.ledger.entries.length, permission: "VIEW_PARTY_LEDGER" },
    { id: "payments", label: t("partyDetail_tabPayments"), icon: ArrowUpDown, count: detail.settlements.length },
    { id: "plans", label: t("partyDetail_tabPlans"), icon: CalendarClock, count: detail.plans.length },
  ];
  const tabs = allTabs.filter((tabDef) => !tabDef.permission || can(tabDef.permission));

  return (
    <div className="p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <BackLink onClick={() => router.push("/dashboard/parties")} label={t("partyDetail_back")} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-gray-800">
              <span>{party.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeChip} ${u}`}>{typeLabel}</span>
              {party.isDefault && (
                <span className={`rounded bg-teal-100 px-1.5 py-0.5 text-[10px] text-teal-700 ${u}`}>{t("parties_default")}</span>
              )}
              {!party.isActive && (
                <span className={`rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 ${u}`}>{t("partyDetail_inactive")}</span>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              <span className="font-mono">#{party.accountId}</span>
              <span className="mx-1.5">·</span>
              <span className={u}>{t("partyDetail_onFile")}</span> {formatDate(party.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {!party.isDefault && can("EDIT_PARTY") && (
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                <Edit2 className="h-4 w-4 text-blue-500" />
                <span className={u}>{t("partyDetail_edit")}</span>
              </button>
            )}
            <button onClick={handleExport} disabled={exportRows.length === 0}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
              <Download className="h-4 w-4" />
              <span className={u}>{t("export")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Profile + balance ───────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {/* Contact details and the staff note, side by side so neither is buried */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className={`mb-3 text-sm font-semibold text-gray-700 ${u}`}>{t("partyDetail_profile")}</h2>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Field icon={Phone} label={t("parties_mobile")} value={party.mobile} />
            <Field icon={Mail} label={t("parties_phone")} value={party.phone} />
            <Field icon={MapPin} label={t("parties_city")} value={party.city} />
            <Field icon={MapPin} label={t("parties_address")} value={party.address} />
            <Field
              label={t("parties_creditLimit")}
              value={party.creditLimit > 0 ? `Rs. ${formatCurrency(party.creditLimit)}` : null}
            />
            <Field
              label={t("parties_prevBalance")}
              value={party.previousBalance !== 0 ? `Rs. ${formatCurrency(party.previousBalance)}` : null}
            />
          </dl>
          <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className={`text-sm ${party.notes ? "whitespace-pre-wrap text-gray-700" : `text-gray-400 ${u}`}`}>
              {party.notes || t("partyDetail_noNotes")}
            </p>
          </div>
        </div>

        {/* The one figure most people open this page for. */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className={`mb-1 text-sm font-semibold text-gray-700 ${u}`}>{t("partyDetail_currentBalance")}</h2>
          <div className={`text-3xl font-bold tabular-nums ${owes ? "text-red-600" : owed ? "text-green-600" : "text-gray-400"}`}>
            <Money value={Math.abs(liveBalance)} />
            {(owes || owed) && (
              <span className={`ml-1.5 text-base font-normal ${u}`}>{owes ? t("parties_dr") : t("parties_cr")}</span>
            )}
          </div>
          <p className={`mt-0.5 text-xs text-gray-500 ${u}`}>
            {owes ? t("partyDetail_owesStore") : owed ? t("partyDetail_storeOwes") : t("partyDetail_settledUp")}
          </p>

          <dl className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 text-xs">
            {/* Only shown when there is credit that can actually be spent —
                `availableCredit` is already 0 for the walking customer and for
                vendors, which is where the rule lives (lib/party-balance.ts). */}
            {(balance?.availableCredit ?? 0) > 0.005 && (
              <SideStat label={t("partyDetail_availableCredit")} tone="text-green-700">
                <Money value={balance!.availableCredit} />
              </SideStat>
            )}
            {party.creditLimit > 0 && (
              <SideStat
                label={liveBalance > party.creditLimit ? t("partyDetail_overLimit") : t("partyDetail_creditHeadroom")}
                tone={liveBalance > party.creditLimit ? "text-red-600" : "text-gray-700"}
              >
                <Money value={Math.abs(party.creditLimit - Math.max(liveBalance, 0))} />
              </SideStat>
            )}
            <SideStat label={t("partyDetail_firstActivity")}>
              {lifetime.firstActivity ? formatDate(lifetime.firstActivity) : <span className={u}>{t("partyDetail_noActivity")}</span>}
            </SideStat>
            <SideStat label={t("partyDetail_lastActivity")}>
              {lifetime.lastActivity ? formatDate(lifetime.lastActivity) : "—"}
            </SideStat>
          </dl>
        </div>
      </div>

      {/* ── Lifetime tiles ──────────────────────────────────────────────────── */}
      <div className="mb-1 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label={t("partyDetail_totalSales")} value={lifetime.salesNet}
          sub={`${lifetime.invoiceCount} ${t("partyDetail_invoicesCounted")}`} />
        <Tile label={t("partyDetail_unpaidSales")} value={lifetime.salesOutstanding} tone="text-red-600"
          sub={`${lifetime.openInvoiceCount} ${t("partyDetail_openCounted")}`} />
        <Tile label={t("partyDetail_moneyReceived")} value={lifetime.recoveryTotal} tone="text-green-600"
          sub={`${lifetime.recoveryCount} ${t("partyDetail_receiptsCounted")}`} />
        <Tile label={t("partyDetail_totalPurchases")} value={lifetime.purchaseNet}
          sub={`${lifetime.grnCount} ${t("partyDetail_billsCounted")}`} />
        <Tile label={t("partyDetail_unpaidPurchases")} value={lifetime.purchaseOutstanding} tone="text-orange-600"
          sub={`${lifetime.openGrnCount} ${t("partyDetail_openCounted")}`} />
        <Tile label={t("partyDetail_moneyPaidOut")} value={lifetime.paymentTotal} tone="text-red-600"
          sub={`${lifetime.paymentCount} ${t("partyDetail_paymentsCounted")}`} />
      </div>
      <p className={`mb-4 text-xs text-gray-400 ${u}`}>{t("partyDetail_lifetimeNote")}</p>

      {/* ── Date window ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <DateFilter
          from={from} to={to}
          onFromChange={setFrom} onToChange={setTo}
          preset={preset} onPresetChange={applyPreset}
          loading={loading}
        />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === id
                ? "border-orange-600 text-orange-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            <Icon className="h-4 w-4" />
            <span className={u}>{label}</span>
            {count != null && count > 0 && (
              <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-500">{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <RecentList
              title={t("partyDetail_recentSales")} icon={ShoppingCart}
              emptyLabel={t("partyDetail_noSales")} onSeeAll={() => setTab("sales")}
              rows={detail.invoices.slice(0, 5).map((r) => ({
                key: r.id,
                href: invoiceHref(r.id),
                label: `#${r.invoiceNo}`,
                sub: `${formatDate(r.date)} · ${r.itemCount} ${t("partyDetail_items")}`,
                amount: r.netBill,
                tone: r.outstanding > 0.005 ? "text-red-600" : "text-gray-700",
              }))}
            />
            <RecentList
              title={t("partyDetail_recentPurchases")} icon={Truck}
              emptyLabel={t("partyDetail_noPurchases")} onSeeAll={() => setTab("purchases")}
              rows={detail.grns.slice(0, 5).map((r) => ({
                key: r.id,
                href: grnHref(r.id),
                label: `#${r.grnNo}`,
                sub: `${formatDate(r.date)} · ${r.itemCount} ${t("partyDetail_items")}`,
                amount: r.netBill,
                tone: r.outstanding > 0.005 ? "text-orange-600" : "text-gray-700",
              }))}
            />
          </div>
          <RecentList
            title={t("partyDetail_recentPayments")} icon={ArrowUpDown}
            emptyLabel={t("partyDetail_noPayments")} onSeeAll={() => setTab("payments")}
            rows={detail.settlements.slice(0, 5).map((r) => ({
              key: `${r.kind}-${r.id}`,
              href: r.invoiceId ? invoiceHref(r.invoiceId) : r.grnId ? grnHref(r.grnId) : null,
              label: r.kind === "RECOVERY" ? t("partyDetail_received") : t("partyDetail_paidOut"),
              sub: `${formatDate(r.date)} · ${r.accountName ?? r.paymentMethod}`,
              amount: r.amount,
              tone: r.kind === "RECOVERY" ? "text-green-700" : "text-red-700",
            }))}
          />
        </div>
      )}

      {tab === "sales" && (
        <>
          <PartySalesTable rows={detail.invoices} />
          <WindowTotals
            parts={[
              { label: t("partyDetail_netBill"), value: windowTotals.salesNet },
              { label: t("partyDetail_outstanding"), value: windowTotals.salesOutstanding, tone: "text-red-600" },
            ]}
          />
        </>
      )}

      {tab === "purchases" && (
        <>
          <PartyPurchasesTable rows={detail.grns} />
          <WindowTotals
            parts={[
              { label: t("partyDetail_netBill"), value: windowTotals.purchaseNet },
              { label: t("partyDetail_outstanding"), value: windowTotals.purchaseOutstanding, tone: "text-orange-600" },
            ]}
          />
        </>
      )}

      {tab === "ledger" && can("VIEW_PARTY_LEDGER") && (
        <PartyLedgerTable
          rows={detail.ledger.entries}
          openingBalance={detail.ledger.openingBalance}
          totals={detail.ledger.totals}
        />
      )}

      {tab === "payments" && (
        <>
          <PartyPaymentsTable rows={detail.settlements} />
          <WindowTotals
            parts={[
              { label: t("partyDetail_received"), value: windowTotals.received, tone: "text-green-700" },
              { label: t("partyDetail_paidOut"), value: windowTotals.paidOut, tone: "text-red-700" },
            ]}
          />
        </>
      )}

      {tab === "plans" && <PartyPlansPanel rows={detail.plans} />}

      <PartyFormModal
        open={editing}
        onClose={() => setEditing(false)}
        editParty={party}
        onSaved={reload}
      />
    </div>
  );
}

type Tab = "overview" | "sales" | "purchases" | "ledger" | "payments" | "plans";

// ─── Small pieces ─────────────────────────────────────────────────────────────

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  const { isUrdu } = useI18n();
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-600 ${isUrdu ? "urdu-text" : ""}`}>
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

/** One profile field. Renders an em dash rather than vanishing, so the grid keeps its shape. */
function Field({ icon: Icon, label, value }: {
  icon?: typeof Phone; label: string; value?: string | null;
}) {
  const { isUrdu } = useI18n();
  return (
    <div className="flex items-start gap-2">
      {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" /> : <span className="w-3.5" />}
      <div className="min-w-0">
        <dt className={`text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{label}</dt>
        <dd className={`text-sm ${value ? "text-gray-700" : "text-gray-300"}`}>{value || "—"}</dd>
      </div>
    </div>
  );
}

function SideStat({ label, tone = "text-gray-700", children }: {
  label: string; tone?: string; children: React.ReactNode;
}) {
  const { isUrdu } = useI18n();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone}`}>{children}</dd>
    </div>
  );
}

function Tile({ label, value, sub, tone = "text-gray-800" }: {
  label: string; value: number; sub?: string; tone?: string;
}) {
  const { isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className={`mb-0.5 truncate text-[11px] text-gray-500 ${u}`}>{label}</div>
      <div className={`whitespace-nowrap text-base font-bold tabular-nums sm:text-lg ${tone}`}>
        <Money value={value} />
      </div>
      {sub && <div className={`mt-0.5 truncate text-[11px] text-gray-400 ${u}`}>{sub}</div>}
    </div>
  );
}

/**
 * The footer under a tab's table. Named "window" deliberately: these are the
 * period's figures, not the lifetime ones in the tiles above the filter, and
 * the two disagreeing is the whole reason they sit in different places.
 */
function WindowTotals({ parts }: { parts: { label: string; value: number; tone?: string }[] }) {
  const { isUrdu } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap justify-end gap-6 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
      {parts.map((p) => (
        <div key={p.label} className="flex items-center gap-2">
          <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{p.label}</span>
          <span className={`font-bold ${p.tone ?? "text-gray-800"}`}><Money value={p.value} /></span>
        </div>
      ))}
    </div>
  );
}
