"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store-context";
import toast from "react-hot-toast";
import {
  BookOpen, ArrowDownCircle, ArrowUpCircle, CalendarDays,
  AlertCircle, Search, Download, Printer, RefreshCw, X,
  Plus, ChevronRight, CalendarClock,
} from "lucide-react";
import { formatCurrency, formatDate, shopMonthStart, shopToday } from "@/lib/utils";
import { allocateFifo, type OpenDocument } from "@/lib/settlement-allocation";
import { exportCSV } from "@/lib/csv-export";
import LedgerPrintModal from "@/components/ledger/LedgerPrintModal";
import Pagination from "@/components/ui/Pagination";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { invoiceHref, grnHref } from "@/lib/document-links";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "ledger" | "recovery" | "payment" | "installments" | "daybook" | "outstanding";

type Account = {
  id: string; type: "CASH" | "BANK"; name: string; isActive: boolean;
};

type InstallmentRow = {
  id: string; seq: number; dueDate: string;
  amount: number; paidAmount: number; remaining: number;
  status: string; isOverdue: boolean;
  plan: {
    id: string; kind: string; periods: number; principal: number;
    side: "sales" | "purchase";
    invoiceId: string | null; grnId: string | null;
    invoiceNo: number | null; grnNo: number | null;
  };
  party: { id: string; name: string; accountId: number; type: string };
};

type Party = {
  id: string; accountId: number; name: string;
  type: string; city?: string; phone?: string;
};

/** One of the party's unsettled bills, from GET /api/ledger/open-documents. */
type OpenDocRow = OpenDocument;

type OpenDocsResponse = {
  documents: OpenDocRow[];
  summary: { count: number; totalOutstanding: number; totalBilled: number; oldestDate: string | null };
};

type LedgerRow = {
  id: string; date: string; type: string; reference: string | null;
  /**
   * The document behind the line, when there is one. Sale/purchase rows carry
   * it; a RECEIPT/PAYMENT row does not (see `buildSettlementOps`), and its
   * reference is a REC-/PAY- number rather than a bill.
   */
  invoiceId: string | null; grnId: string | null;
  debit: number; credit: number; balance: number; notes: string | null;
};

type RecoveryRow = {
  id: string; date: string; amount: number; paymentMethod: string;
  bankName: string | null; notes: string | null;
  /** The invoice this money was collected against, null if taken on account. */
  invoiceId: string | null; invoiceNo: number | null;
  party: { name: string; accountId: number; type: string };
};

type PaymentRow = {
  id: string; date: string; amount: number; paymentMethod: string;
  bankName: string | null; notes: string | null;
  /** The GRN this money was paid against, null if paid on the vendor balance. */
  grnId: string | null; grnNo: number | null;
  party: { name: string; accountId: number; type: string };
};

type DayEntry = {
  id: string; date: string; type: string; reference: string | null;
  invoiceId: string | null; grnId: string | null;
  partyName: string; partyType: string; debit: number; credit: number; notes: string | null;
};

type DaySummary = {
  cashIn: number; cashOut: number; creditSales: number;
  openingBalance: number; closingBalance: number;
};

type OutstandingRow = {
  partyId: string; accountId: number; name: string; city: string | null;
  phone: string | null; type: string; balance: number;
};

// Fallback (untranslated) labels — used only if a translated map isn't supplied.
const TYPE_LABELS: Record<string, string> = {
  SALE: "Sale", SALE_RETURN: "Sale Return", PURCHASE: "Purchase",
  PURCHASE_RETURN: "Purch. Return", PAYMENT: "Payment",
  RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", OPENING_BALANCE: "Opening Bal",
};

// Shop calendar, not UTC or the device — see `shopToday` / `shopMonthStart`.
const today = shopToday;
const monthStart = shopMonthStart;

const LEDGER_PAGE_SIZE = 50;

// ─── Document reference ───────────────────────────────────────────────────────

/**
 * An `INV-3` / `GRN-12` reference, as a link to that document's own page when
 * the row carries the document's id.
 *
 * Every tab on this screen ends up showing a bill number somewhere — a
 * statement line, a recovery, a payment, an installment, a day-book entry — and
 * the question each of them raised was "what was actually *on* that bill?".
 * The detail pages already existed; only the link was missing.
 *
 * Falls back to plain text rather than a dead link when there is no id, which
 * is the normal case for the settlement rows: a RECEIPT/PAYMENT ledger entry is
 * deliberately not tied to a document by FK (see `buildSettlementOps` in
 * lib/accounts.ts), so its `REC-XXXXXX` reference has nothing to open.
 */
function DocRef({
  invoiceId, grnId, children, className = "",
}: {
  invoiceId?: string | null;
  grnId?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const href = invoiceId ? invoiceHref(invoiceId) : grnId ? grnHref(grnId) : null;
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link
      href={href}
      className={`${className} text-teal-600 hover:text-teal-800 hover:underline underline-offset-2 transition-colors`}
    >
      {children}
    </Link>
  );
}

// ─── Party Search Popup ───────────────────────────────────────────────────────

function PartySearchPopup({
  parties, onSelect, onClose, filter,
}: {
  parties: Party[];
  onSelect: (p: Party) => void;
  onClose: () => void;
  /**
   * "VENDOR" for the vendor-payment side; "NOT_VENDOR" for recovery, which has
   * to include a CASH-type walk-in sold to on credit under their own name —
   * filtering to CREDIT-only used to hide them entirely, so their debt could
   * never be collected.
   */
  filter?: "CREDIT" | "VENDOR" | "NOT_VENDOR";
}) {
  const { t, isUrdu } = useI18n();
  const [q, setQ] = useState("");
  const filtered = parties.filter((p) => {
    if (filter === "NOT_VENDOR" ? p.type === "VENDOR" : filter ? p.type !== filter : false) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(s) ||
      String(p.accountId).includes(s) ||
      (p.city ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ledger_searchByNameIdCity")}
            className={`flex-1 outline-none text-sm ${isUrdu ? "urdu-text" : ""}`}
          />
          <button onClick={onClose}>
            <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
          {filtered.slice(0, 50).map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelect(p); onClose(); }}
              className="w-full text-left px-4 py-2.5 hover:bg-teal-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm text-gray-800">{p.name}</span>
                  <span className="ml-2 text-xs text-gray-400">#{p.accountId}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  p.type === "CREDIT" ? "bg-blue-100 text-blue-700" :
                  p.type === "VENDOR" ? "bg-purple-100 text-purple-700" :
                  "bg-gray-100 text-gray-600"
                }`}>
                  {p.type}
                </span>
              </div>
              {p.city && <div className="text-xs text-gray-400 mt-0.5">{p.city}</div>}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className={`text-center text-gray-400 text-sm py-6 ${isUrdu ? "urdu-text" : ""}`}>
              {t("ledger_noPartiesFound")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Record Form (Recovery / Payment) ────────────────────────────────────────

function RecordForm({
  type,
  branchId,
  parties,
  accounts,
  onSaved,
}: {
  type: "recovery" | "payment";
  branchId: string;
  parties: Party[];
  accounts: Account[];
  onSaved: () => void;
}) {
  const { t, isUrdu } = useI18n();
  // Recovery: anyone but a vendor. It used to be CREDIT-only, which hid every
  // walk-in who had been sold to on credit under a name — they simply could
  // not be selected, so their debt could never be collected here.
  const partyFilter = type === "recovery" ? "NOT_VENDOR" : "VENDOR";
  const [showPicker, setShowPicker] = useState(false);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const bankAccounts = accounts.filter((a) => a.type === "BANK");

  // ── The party's open bills ────────────────────────────────────────────────
  // Loaded as soon as a party is picked, so the cashier sees *where* the money
  // is owed from before typing an amount — and can't collect more than that.
  const [openDocs, setOpenDocs] = useState<OpenDocRow[]>([]);
  const [docsSummary, setDocsSummary] = useState<OpenDocsResponse["summary"] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  /** Per-bill split, keyed by document id. Pre-filled oldest-first, editable. */
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  /** Set once a row is hand-edited, so a later amount change stops re-filling. */
  const [allocTouched, setAllocTouched] = useState(false);

  // Both sides attach money to a specific bill: a recovery through
  // `Recovery.invoiceId`, a vendor payment through `Payment.grnId` (added by
  // the `payment_grn_link` migration — before that a vendor payment moved the
  // vendor's balance but left every unplanned GRN reading UNPAID).
  const canAllocate = true;

  const totalOutstanding = docsSummary?.totalOutstanding ?? 0;
  const amountNum = Number(amount) || 0;
  const overCollecting = amountNum - totalOutstanding > 0.005;
  const allocTotal = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);

  const loadOpenDocs = useCallback(async (partyId: string) => {
    setDocsLoading(true);
    try {
      const side = type === "recovery" ? "sales" : "purchase";
      const res = await fetch(
        `/api/ledger/open-documents?branchId=${branchId}&partyId=${partyId}&side=${side}`
      );
      const data: OpenDocsResponse = await res.json();
      setOpenDocs(data.documents ?? []);
      setDocsSummary(data.summary ?? null);
    } catch {
      setOpenDocs([]);
      setDocsSummary(null);
    } finally {
      setDocsLoading(false);
    }
  }, [branchId, type]);

  function pickParty(p: Party) {
    setSelectedParty(p);
    setAlloc({});
    setAllocTouched(false);
    setOpenDocs([]);
    setDocsSummary(null);
    loadOpenDocs(p.id);
  }

  /**
   * Re-runs the oldest-first split whenever the amount changes, using the same
   * `allocateFifo` the server falls back to — so the pre-fill is exactly what
   * would have happened had the cashier not looked. Stops once a row has been
   * hand-edited, so a deliberate split isn't silently overwritten.
   */
  useEffect(() => {
    if (!canAllocate || allocTouched || openDocs.length === 0) return;
    const { allocations } = allocateFifo(openDocs, amountNum);
    const next: Record<string, string> = {};
    for (const a of allocations) next[a.id] = String(a.amount);
    setAlloc(next);
  }, [amountNum, openDocs, allocTouched, canAllocate]);

  function editAlloc(id: string, value: string) {
    setAllocTouched(true);
    setAlloc((prev) => ({ ...prev, [id]: value }));
  }

  function resetAlloc() {
    setAllocTouched(false);
    setAlloc({});
  }

  const handleSave = async () => {
    if (!selectedParty) return toast.error(t("ledger_selectAParty"));
    if (!amount || isNaN(amountNum) || amountNum <= 0) return toast.error(t("ledger_enterValidAmount"));
    if (paymentMethod === "BANK" && !accountId) return toast.error(t("ledger_selectBankAccount"));
    // The shop's rule: never recover more than is actually owed. Re-checked
    // server-side against freshly read invoices, so this is the friendly copy
    // of the guard rather than the guard itself.
    if (overCollecting) {
      return toast.error(`${t("ledger_cannotExceedOutstanding")} Rs. ${formatCurrency(totalOutstanding)}`);
    }
    if (canAllocate && allocTotal - amountNum > 0.005) {
      return toast.error(t("ledger_allocationExceedsAmount"));
    }
    setSaving(true);
    try {
      const allocations = canAllocate
        ? Object.entries(alloc)
            .map(([id, v]) => ({ id, amount: Number(v) || 0 }))
            .filter((a) => a.amount > 0.005)
        : undefined;
      const res = await fetch(`/api/ledger/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId, partyId: selectedParty.id, date, amount: amountNum,
          paymentMethod, accountId: accountId || null, notes: notes || null,
          ...(allocations && allocations.length > 0 ? { allocations } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(type === "recovery" ? t("ledger_recoveryRecorded") : t("ledger_paymentRecorded"));
      setSelectedParty(null);
      setAmount("");
      setNotes("");
      setAccountId("");
      setPaymentMethod("CASH");
      setDate(today());
      setOpenDocs([]);
      setDocsSummary(null);
      resetAlloc();
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || t("ledger_failedToSaveTryAgain"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        {showPicker && (
          <PartySearchPopup
            parties={parties}
            filter={partyFilter}
            onSelect={pickParty}
            onClose={() => setShowPicker(false)}
          />
        )}
        <h3 className={`font-semibold text-gray-700 mb-4 ${isUrdu ? "urdu-text" : ""}`}>
          {type === "recovery" ? t("ledger_recordRecoveryHeading") : t("ledger_recordPaymentHeading")}
        </h3>

        <div className="space-y-3">
          {/* Party */}
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
              {type === "recovery" ? t("ledger_customerCr") : t("ledger_vendor")}
            </label>
            <button
              onClick={() => setShowPicker(true)}
              className="w-full text-left border border-gray-300 rounded-lg px-3 py-2 text-sm hover:border-teal-400 transition-colors"
            >
              {selectedParty
                ? <span className="font-medium">{selectedParty.name} <span className="text-gray-400 font-normal">#{selectedParty.accountId}</span></span>
                : <span className={`text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                    {type === "recovery" ? t("ledger_clickToSelectCustomer") : t("ledger_clickToSelectVendor")}
                  </span>}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
              />
            </div>

            {/* Amount */}
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_amountRs")}</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${
                  overCollecting ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-teal-400"
                }`}
              />
            </div>
          </div>

          {overCollecting && (
            <p className={`text-red-600 text-xs ${isUrdu ? "urdu-text" : ""}`}>
              {t("ledger_cannotExceedOutstanding")} Rs. {formatCurrency(totalOutstanding)}
            </p>
          )}

          {/* Payment Method */}
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_paymentMethod")}</label>
            <div className="flex gap-3">
              {["CASH", "BANK"].map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`pm_${type}`}
                    value={m}
                    checked={paymentMethod === m}
                    onChange={() => setPaymentMethod(m)}
                    className="accent-teal-600"
                  />
                  <span className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{m === "CASH" ? t("ledger_cash") : t("ledger_bank")}</span>
                </label>
              ))}
            </div>
          </div>

          {/* A real bank Account, not the old free-text name: this is what the
              AccountEntry posts against, so the branch's bank balance moves. */}
          {paymentMethod === "BANK" && (
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_bankAccount")}</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
              >
                <option value="">{t("ledger_selectBankAccount")}</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {bankAccounts.length === 0 && (
                <p className={`text-amber-600 text-xs mt-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_noBankAccounts")}</p>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notesOptional")}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("ledger_anyNotesPlaceholder")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || overCollecting}
            className={`w-full bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors ${isUrdu ? "urdu-text" : ""}`}
          >
            {saving ? t("ledger_saving") : (type === "recovery" ? t("ledger_saveRecovery") : t("ledger_savePayment"))}
          </button>
        </div>
      </div>

      {/* ── Where the money is owed from ───────────────────────────────────────
          The question this tab could not previously answer: which bills, and
          how much is left on each. */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>
              {type === "recovery" ? t("ledger_openInvoicesHeading") : t("ledger_openGrnsHeading")}
            </h3>
            <p className={`text-xs text-gray-400 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
              {selectedParty
                ? `${selectedParty.name} · ${docsSummary?.count ?? 0} ${t("ledger_openBillsCounted")}`
                : t("ledger_selectPartyToSeeBills")}
            </p>
          </div>
          {selectedParty && (
            <div className="text-right shrink-0">
              <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_totalOutstanding")}</div>
              <div className="text-lg font-bold text-red-600 tabular-nums">
                Rs. {formatCurrency(totalOutstanding)}
              </div>
            </div>
          )}
        </div>

        {!selectedParty ? (
          <div className="text-center py-12 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_selectPartyToSeeBills")}</p>
          </div>
        ) : docsLoading ? (
          <div className={`text-center py-12 text-gray-400 text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
        ) : openDocs.length === 0 ? (
          <div className={`text-center py-12 text-gray-400 text-sm ${isUrdu ? "urdu-text" : ""}`}>
            {t("ledger_nothingOutstanding")}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-2.5 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                    <th className={`px-4 py-2.5 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                    <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_billTotal")}</th>
                    <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_paidColumn")}</th>
                    <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_outstandingColumn")}</th>
                    {canAllocate && (
                      <th className={`px-4 py-2.5 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_applyColumn")}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {openDocs.map((d) => {
                    const applied = Number(alloc[d.id]) || 0;
                    const over = applied - d.outstanding > 0.005;
                    return (
                      <tr key={d.id} className={applied > 0.005 ? "bg-teal-50/40" : ""}>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">
                          {/* `d.id` is the document's own id — it is what the
                              allocation is posted under — so the bill being
                              settled can be opened before the money is taken. */}
                          <DocRef
                            invoiceId={type === "recovery" ? d.id : null}
                            grnId={type === "recovery" ? null : d.id}
                          >
                            {type === "recovery" ? `INV-${d.no}` : `GRN-${d.no}`}
                          </DocRef>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {formatDate(new Date(d.date))}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{formatCurrency(d.netBill)}</td>
                        <td className="px-4 py-2 text-right text-green-600 tabular-nums">
                          {d.settled > 0.005 ? formatCurrency(d.settled) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-red-600 tabular-nums">
                          {formatCurrency(d.outstanding)}
                        </td>
                        {canAllocate && (
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              min={0}
                              value={alloc[d.id] ?? ""}
                              onChange={(e) => editAlloc(d.id, e.target.value)}
                              placeholder="0"
                              className={`w-24 border rounded px-2 py-1 text-xs text-right tabular-nums focus:outline-none ${
                                over ? "border-red-400 text-red-600" : "border-gray-300 focus:border-teal-400"
                              }`}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {canAllocate ? (
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3 text-sm">
                <button
                  onClick={resetAlloc}
                  className={`text-xs px-2.5 py-1 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}
                >
                  {t("ledger_refillOldestFirst")}
                </button>
                <div className="flex items-center gap-2">
                  <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_allocated")}</span>
                  <span className={`font-bold tabular-nums ${allocTotal - amountNum > 0.005 ? "text-red-600" : "text-gray-800"}`}>
                    Rs. {formatCurrency(allocTotal)}
                  </span>
                  <span className="text-gray-400">/</span>
                  <span className="font-semibold tabular-nums text-gray-600">Rs. {formatCurrency(amountNum)}</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Collect Installment Modal ────────────────────────────────────────────────

/**
 * Collects money against one installment. The amount defaults to that row's
 * remaining balance, but a larger amount is allowed on purpose: the server
 * cascades the excess onto the following unpaid installments (a customer
 * clearing two at once, or the whole plan, is an everyday case).
 */
function CollectInstallmentModal({
  row,
  accounts,
  onClose,
  onCollected,
}: {
  row: InstallmentRow;
  accounts: Account[];
  onClose: () => void;
  onCollected: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const [amount, setAmount] = useState(String(row.remaining));
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const isPurchase = row.plan.side === "purchase";

  const handleCollect = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return toast.error(t("ledger_enterValidAmount"));
    if (paymentMethod === "BANK" && !accountId) return toast.error(t("ledger_selectBankAccount"));
    setSaving(true);
    try {
      const res = await fetch("/api/ledger/installments/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installmentId: row.id, amount: Number(amount),
          paymentMethod, accountId: accountId || null, date, notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const spread = data.applied?.length ?? 0;
      toast.success(
        spread > 1
          ? `${t("ledger_collectionRecorded")} — ${spread} ${t("ledger_installmentsSettled")}`
          : t("ledger_collectionRecorded")
      );
      // Money beyond the whole plan still lands on the party's balance, but no
      // longer maps to a scheduled row — worth saying out loud.
      if (data.leftover > 0) toast(`${t("ledger_leftoverOnAccount")} Rs. ${formatCurrency(data.leftover)}`);
      onCollected();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || t("ledger_failedToSaveTryAgain"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>
              {isPurchase ? t("ledger_payInstallment") : t("ledger_collectInstallment")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {row.party.name} <span className="text-gray-400">#{row.party.accountId}</span>
              {" · "}
              <DocRef invoiceId={row.plan.invoiceId} grnId={row.plan.grnId}>
                {row.plan.invoiceNo ? `INV-${row.plan.invoiceNo}` : `GRN-${row.plan.grnNo}`}
              </DocRef>
              {" · "}
              {t("ledger_installmentSeq")} {row.seq}/{row.plan.periods}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between text-sm">
          <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_dueOn")} {formatDate(new Date(row.dueDate))}</span>
          <span className="font-semibold text-gray-800">Rs. {formatCurrency(row.remaining)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
          </div>
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_amountRs")}</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
          </div>
        </div>

        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_paymentMethod")}</label>
          <div className="flex gap-3">
            {["CASH", "BANK"].map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="pm_collect" checked={paymentMethod === m}
                  onChange={() => setPaymentMethod(m)} className="accent-teal-600" />
                <span className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{m === "CASH" ? t("ledger_cash") : t("ledger_bank")}</span>
              </label>
            ))}
          </div>
        </div>

        {paymentMethod === "BANK" && (
          <div>
            <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_bankAccount")}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400">
              <option value="">{t("ledger_selectBankAccount")}</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notesOptional")}</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={t("ledger_anyNotesPlaceholder")}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400" />
        </div>

        {Number(amount) > row.remaining + 0.005 && (
          <p className={`text-xs text-amber-600 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_overpaymentCascades")}</p>
        )}

        <button onClick={handleCollect} disabled={saving}
          className={`w-full bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}>
          {saving ? t("ledger_saving") : (isPurchase ? t("ledger_recordPayment") : t("ledger_recordCollection"))}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const { t, isUrdu } = useI18n();
  // Recording money and collecting installments are gated on the same keys
  // the routes check, so a role that can only read the ledger sees no forms.
  const { can, loaded: permsLoaded } = usePermissions();
  const { data: session } = useSession();
  const { store } = useStore();
  const branchId = (session?.user as any)?.branchId ?? "";

  const [activeTab, setActiveTab] = useState<Tab>("ledger");
  const [parties, setParties] = useState<Party[]>([]);

  // ── Party Ledger state ──
  const [ledgerParty, setLedgerParty] = useState<Party | null>(null);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [ledgerFrom, setLedgerFrom] = useState(monthStart());
  const [ledgerTo, setLedgerTo] = useState(today());
  const [ledgerEntries, setLedgerEntries] = useState<LedgerRow[]>([]);
  const [ledgerTotals, setLedgerTotals] = useState<any>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  /** Fetched on demand for Print/CSV, which need the whole statement, not just
   * the page on screen — see exportLedgerAll(). */
  const [ledgerAllEntries, setLedgerAllEntries] = useState<LedgerRow[] | null>(null);
  /**
   * The selected party's still-open installments. Shown as a strip above their
   * ledger so the repayment arrangement — Promise Day / Weekly / Monthly and
   * when the next one falls due — is visible where their balance is, not only
   * in the Installments tab.
   */
  const [partyPlanRows, setPartyPlanRows] = useState<InstallmentRow[]>([]);
  const [ledgerOpeningBal, setLedgerOpeningBal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  // ── Recovery / Payment state ──
  const [recoveries, setRecoveries] = useState<RecoveryRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [recFrom, setRecFrom] = useState(monthStart());
  const [recTo, setRecTo] = useState(today());
  const [payFrom, setPayFrom] = useState(monthStart());
  const [payTo, setPayTo] = useState(today());

  // ── Day Book state ──
  const [daybookDate, setDaybookDate] = useState(today());
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  const [daybookLoading, setDaybookLoading] = useState(false);

  // ── Outstanding state ──
  const [accounts, setAccounts] = useState<Account[]>([]);

  // ── Installments ──
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [instSummary, setInstSummary] = useState<{ count: number; totalRemaining: number; overdueCount: number; overdueRemaining: number } | null>(null);
  const [instFilter, setInstFilter] = useState<"open" | "overdue" | "all">("open");
  /**
   * Which side of the business. Customer plans hang off a SaleInvoice and are
   * collected as a Recovery; vendor plans hang off a GRN and are settled as a
   * Payment. GET /api/ledger/installments has always supported this, but with
   * no control for it the two were interleaved in one list with nothing but
   * the INV-/GRN- reference to tell them apart.
   */
  const [instSide, setInstSide] = useState<"all" | "sales" | "purchase">("all");
  const [instLoading, setInstLoading] = useState(false);
  const [collectRow, setCollectRow] = useState<InstallmentRow | null>(null);

  const [outTab, setOutTab] = useState<"receivable" | "payable">("receivable");
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [outTotal, setOutTotal] = useState(0);
  const [outLoading, setOutLoading] = useState(false);

  // Load parties once
  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/parties?limit=500`)
      .then((r) => r.json())
      .then((d) => setParties(d.parties ?? []));
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    fetch(`/api/accounts?branchId=${branchId}`)
      .then((r) => r.json())
      .then((d) => setAccounts((d.accounts ?? []).filter((a: Account) => a.isActive)));
  }, [branchId]);

  // ── Installments ──
  const loadPartyPlans = useCallback(async (partyId: string) => {
    try {
      const res = await fetch(
        `/api/ledger/installments?branchId=${branchId}&partyId=${partyId}&status=open`
      );
      const data = await res.json();
      setPartyPlanRows(data.installments ?? []);
    } catch {
      setPartyPlanRows([]);
    }
  }, [branchId]);

  const loadInstallments = useCallback(async () => {
    if (!branchId) return;
    setInstLoading(true);
    try {
      const res = await fetch(`/api/ledger/installments?branchId=${branchId}&status=${instFilter}&side=${instSide}`);
      const data = await res.json();
      setInstallments(data.installments ?? []);
      setInstSummary(data.summary ?? null);
    } catch {
      toast.error(t("ledger_failedToSaveTryAgain"));
    } finally {
      setInstLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, instFilter, instSide]);

  useEffect(() => {
    if (activeTab === "installments") loadInstallments();
  }, [activeTab, loadInstallments]);

  // ── Ledger ──
  const loadLedger = useCallback(async () => {
    if (!branchId || !ledgerParty) return;
    setLedgerLoading(true);
    try {
      const url = `/api/ledger?branchId=${branchId}&partyId=${ledgerParty.id}&from=${ledgerFrom}&to=${ledgerTo}&page=${ledgerPage}&pageSize=${LEDGER_PAGE_SIZE}`;
      const res = await fetch(url);
      const data = await res.json();
      setLedgerEntries(data.entries ?? []);
      setLedgerTotals(data.totals ?? null);
      setLedgerOpeningBal(data.party?.openingBalance ?? 0);
      setLedgerTotal(data.total ?? 0);
      // Stale from whatever party/range was on screen before.
      setLedgerAllEntries(null);
    } catch {
      toast.error(t("ledger_failedToLoadLedger"));
    } finally {
      setLedgerLoading(false);
    }
  }, [branchId, ledgerParty, ledgerFrom, ledgerTo, ledgerPage]);

  useEffect(() => { loadLedger(); }, [loadLedger]);

  // A new party or date range invalidates whatever page we were on.
  useEffect(() => { setLedgerPage(1); }, [ledgerParty, ledgerFrom, ledgerTo]);

  /** Print and CSV need the whole statement, not just the page on screen —
   * fetched fresh (and cached in `ledgerAllEntries`) only when one of those
   * actions is actually used. */
  const loadLedgerAll = useCallback(async (): Promise<LedgerRow[]> => {
    if (ledgerAllEntries) return ledgerAllEntries;
    if (!branchId || !ledgerParty) return [];
    const url = `/api/ledger?branchId=${branchId}&partyId=${ledgerParty.id}&from=${ledgerFrom}&to=${ledgerTo}&all=true`;
    const res = await fetch(url);
    const data = await res.json();
    const all: LedgerRow[] = data.entries ?? [];
    setLedgerAllEntries(all);
    return all;
  }, [branchId, ledgerParty, ledgerFrom, ledgerTo, ledgerAllEntries]);

  // ── Recovery List ──
  const loadRecoveries = useCallback(async () => {
    if (!branchId) return;
    const url = `/api/ledger/recovery?branchId=${branchId}&from=${recFrom}&to=${recTo}`;
    const res = await fetch(url);
    const data = await res.json();
    setRecoveries(data.recoveries ?? []);
  }, [branchId, recFrom, recTo]);

  useEffect(() => {
    if (activeTab === "recovery") loadRecoveries();
  }, [activeTab, loadRecoveries]);

  // ── Payment List ──
  const loadPayments = useCallback(async () => {
    if (!branchId) return;
    const url = `/api/ledger/payment?branchId=${branchId}&from=${payFrom}&to=${payTo}`;
    const res = await fetch(url);
    const data = await res.json();
    setPayments(data.payments ?? []);
  }, [branchId, payFrom, payTo]);

  useEffect(() => {
    if (activeTab === "payment") loadPayments();
  }, [activeTab, loadPayments]);

  // ── Day Book ──
  const loadDaybook = useCallback(async () => {
    if (!branchId) return;
    setDaybookLoading(true);
    try {
      const url = `/api/ledger/daybook?branchId=${branchId}&date=${daybookDate}`;
      const res = await fetch(url);
      const data = await res.json();
      setDaySummary(data.summary ?? null);
      setDayEntries(data.entries ?? []);
    } catch {
      toast.error(t("ledger_failedToLoadDayBook"));
    } finally {
      setDaybookLoading(false);
    }
  }, [branchId, daybookDate]);

  useEffect(() => {
    if (activeTab === "daybook") loadDaybook();
  }, [activeTab, loadDaybook]);

  // ── Outstanding ──
  const loadOutstanding = useCallback(async () => {
    if (!branchId) return;
    setOutLoading(true);
    try {
      const url = `/api/ledger/outstanding?branchId=${branchId}&type=${outTab}`;
      const res = await fetch(url);
      const data = await res.json();
      setOutstanding(data.outstanding ?? []);
      setOutTotal(data.totalBalance ?? 0);
    } catch {
      toast.error(t("ledger_failedToLoadOutstanding"));
    } finally {
      setOutLoading(false);
    }
  }, [branchId, outTab]);

  useEffect(() => {
    if (activeTab === "outstanding") loadOutstanding();
  }, [activeTab, loadOutstanding]);

  // ─── TABS ──────────────────────────────────────────────────────────────────

  const ALL_TABS = [
    { id: "ledger" as Tab, label: t("ledger_tabPartyLedger"), icon: BookOpen },
    { id: "recovery" as Tab, label: t("ledger_recovery"), icon: ArrowDownCircle },
    { id: "payment" as Tab, label: t("ledger_payment"), icon: ArrowUpCircle },
    { id: "installments" as Tab, label: t("ledger_tabInstallments"), icon: CalendarClock },
    { id: "daybook" as Tab, label: t("ledger_tabDayBook"), icon: CalendarDays, permission: "VIEW_DAYBOOK" },
    { id: "outstanding" as Tab, label: t("ledger_tabOutstanding"), icon: AlertCircle, permission: "VIEW_OUTSTANDING" },
  ];
  const TABS = ALL_TABS.filter((tab) => !tab.permission || can(tab.permission));

  useEffect(() => {
    if (!permsLoaded) return;
    if (TABS.some((tab) => tab.id === activeTab)) return;
    if (TABS[0]) setActiveTab(TABS[0].id);
  }, [permsLoaded, TABS, activeTab]);

  // Translated transaction-type labels (module-level TYPE_LABELS is the untranslated fallback)
  const typeLabels: Record<string, string> = {
    SALE: t("ledger_typeSale"),
    SALE_RETURN: t("ledger_typeSaleReturn"),
    PURCHASE: t("ledger_typePurchase"),
    PURCHASE_RETURN: t("ledger_typePurchaseReturn"),
    PAYMENT: t("ledger_payment"),
    RECEIPT: t("ledger_typeReceipt"),
    ADJUSTMENT: t("ledger_typeAdjustment"),
    OPENING_BALANCE: t("ledger_typeOpeningBal"),
  };

  return (
    <div className="p-6 space-y-4">
      {/* Page header */}
      <div>
        <h1 className={`text-2xl font-bold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_title")}</h1>
        <p className={`text-sm text-gray-500 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_pageSubtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-white shadow-sm text-teal-700"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className={isUrdu ? "urdu-text" : ""}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── PARTY LEDGER TAB ──────────────────────────────────────────────── */}
      {activeTab === "ledger" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
            {/* Party selector */}
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_party")}</label>
              <button
                onClick={() => setShowPartyPicker(true)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm hover:border-teal-400 min-w-[200px] text-left"
              >
                {ledgerParty
                  ? <span className="font-medium">{ledgerParty.name} <span className="text-gray-400 font-normal">#{ledgerParty.accountId}</span></span>
                  : <span className={`text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_selectPartyPlaceholder")}</span>}
              </button>
            </div>
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("from")}</label>
              <input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("to")}</label>
              <input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={loadLedger}
              className={`flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors ${isUrdu ? "urdu-text" : ""}`}>
              <RefreshCw className="w-3.5 h-3.5" />
              {t("ledger_load")}
            </button>
            {ledgerTotal > 0 && (
              <>
                <button
                  onClick={async () => { await loadLedgerAll(); setPrintOpen(true); }}
                  className={`flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors ${isUrdu ? "urdu-text" : ""}`}>
                  <Printer className="w-3.5 h-3.5" />
                  {t("ledger_print")}
                </button>
                <button
                  onClick={async () => {
                    const all = await loadLedgerAll();
                    exportCSV(`Ledger_${ledgerParty?.name}_${ledgerFrom}_${ledgerTo}`, all.map((e) => ({
                      Date: formatDate(new Date(e.date)), Type: TYPE_LABELS[e.type] ?? e.type,
                      Reference: e.reference ?? "", Notes: e.notes ?? "",
                      Debit: e.debit, Credit: e.credit, Balance: e.balance,
                    })));
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors ${isUrdu ? "urdu-text" : ""}`}>
                  <Download className="w-3.5 h-3.5" />
                  {t("ledger_csv")}
                </button>
              </>
            )}
          </div>

          {showPartyPicker && (
            <PartySearchPopup
              parties={parties}
              onSelect={(p) => { setLedgerParty(p); setShowPartyPicker(false); setPartyPlanRows([]); loadPartyPlans(p.id); }}
              onClose={() => setShowPartyPicker(false)} />
          )}

          {/* Ledger Table */}
          {!ledgerParty ? (
            <div className="text-center py-16 text-gray-400">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className={isUrdu ? "urdu-text" : ""}>{t("ledger_selectPartyToViewLedger")}</p>
            </div>
          ) : ledgerLoading ? (
            <div className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Repayment arrangement, when this party has one running. The
                  Installments tab holds the full schedule and the collect
                  action; this is just "what did we agree, and when next". */}
              {partyPlanRows.length > 0 && (
                <div className="border-b border-gray-100 bg-amber-50/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarClock className="w-4 h-4 text-amber-600" />
                    <span className={`text-xs font-semibold text-amber-800 ${isUrdu ? "urdu-text" : ""}`}>
                      {t("ledger_activePlansHeading")}
                    </span>
                    <span className="text-xs text-amber-700 tabular-nums">
                      Rs. {formatCurrency(partyPlanRows.reduce((sum, r) => sum + r.remaining, 0))}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* One chip per open installment, soonest first — the API
                        already returns them ordered by due date. */}
                    {partyPlanRows.slice(0, 8).map((r) => (
                      <span
                        key={r.id}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                          r.isOverdue ? "bg-red-100 text-red-700" : "bg-white text-amber-800 border border-amber-200"
                        }`}
                      >
                        <DocRef invoiceId={r.plan.invoiceId} grnId={r.plan.grnId} className="font-mono">
                          {r.plan.invoiceNo ? `INV-${r.plan.invoiceNo}` : `GRN-${r.plan.grnNo}`}
                        </DocRef>
                        <span className={isUrdu ? "urdu-text" : undefined}>
                          {r.plan.kind === "PROMISE_DAY" ? t("ledger_planPromiseDay")
                            : r.plan.kind === "WEEKLY" ? t("ledger_planWeekly") : t("ledger_planMonthly")}
                        </span>
                        <span className="tabular-nums">{r.seq}/{r.plan.periods}</span>
                        <span className="tabular-nums">
                          {r.isOverdue ? t("ledger_overdue") : t("reports_planNextDue")} {formatDate(new Date(r.dueDate))}
                        </span>
                        <span className="tabular-nums font-semibold">Rs. {formatCurrency(r.remaining)}</span>
                      </span>
                    ))}
                    {partyPlanRows.length > 8 && (
                      <span className="inline-flex items-center text-[11px] text-amber-700 px-1">
                        +{partyPlanRows.length - 8}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Summary cards — each balance carries Dr/Cr plus a line saying
                  what that means for *this* party. The sign convention is the
                  same for both (positive = they owe the shop), but which side
                  is the normal one flips: a customer is usually Dr, a vendor Cr. */}
              {ledgerTotals && (() => {
                const u = isUrdu ? "urdu-text" : "";
                const isVendor = ledgerParty.type === "VENDOR";
                const direction = (b: number) =>
                  Math.abs(b) < 0.005 ? t("ledger_settledUp")
                    : b > 0 ? t(isVendor ? "ledger_hintVendorDr" : "ledger_hintCustomerDr")
                    : t(isVendor ? "ledger_hintVendorCr" : "ledger_hintCustomerCr");
                const drCr = (b: number) =>
                  Math.abs(b) < 0.005 ? null
                    : <span className={`text-sm ml-1 ${u}`}>{b > 0 ? t("ledger_dr") : t("ledger_cr")}</span>;
                const balanceTone = (b: number) =>
                  Math.abs(b) < 0.005 ? "text-gray-700" : b > 0 ? "text-red-600" : "text-green-600";
                return (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-100 border-b border-gray-100">
                      <div className="bg-white p-4">
                        <div className={`text-xs text-gray-500 ${u}`}>
                          {t("ledger_openingBalance")} <span className="text-gray-400">· {t("ledger_asOf")} {formatDate(new Date(ledgerFrom))}</span>
                        </div>
                        <div className={`text-lg font-bold tabular-nums ${balanceTone(ledgerOpeningBal)}`}>
                          Rs. {formatCurrency(Math.abs(ledgerOpeningBal))}{drCr(ledgerOpeningBal)}
                        </div>
                        <div className={`text-[11px] text-gray-500 ${u}`}>{direction(ledgerOpeningBal)}</div>
                      </div>
                      <div className="bg-white p-4">
                        <div className={`text-xs text-gray-500 ${u}`}>{t("ledger_totalCharged")}</div>
                        <div className="text-lg font-bold tabular-nums text-red-600">+ Rs. {formatCurrency(ledgerTotals.totalDebit)}</div>
                        <div className={`text-xs text-gray-500 ${u}`}>{ledgerTotal} {t("ledger_entriesInPeriod")}</div>
                      </div>
                      <div className="bg-white p-4">
                        <div className={`text-xs text-gray-500 ${u}`}>{t("ledger_totalReceived")}</div>
                        <div className="text-lg font-bold tabular-nums text-green-600">− Rs. {formatCurrency(ledgerTotals.totalCredit)}</div>
                      </div>
                      <div className={`p-4 ${ledgerTotals.closingBalance > 0.005 ? "bg-red-50" : ledgerTotals.closingBalance < -0.005 ? "bg-green-50" : "bg-gray-50"}`}>
                        <div className={`text-xs text-gray-500 ${u}`}>
                          {t("ledger_closingBalance")} <span className="text-gray-400">· {t("ledger_asOf")} {formatDate(new Date(ledgerTo))}</span>
                        </div>
                        <div className={`text-xl font-bold tabular-nums ${balanceTone(ledgerTotals.closingBalance)}`}>
                          Rs. {formatCurrency(Math.abs(ledgerTotals.closingBalance))}{drCr(ledgerTotals.closingBalance)}
                        </div>
                        <div className={`text-[11px] font-semibold ${balanceTone(ledgerTotals.closingBalance)} ${u}`}>{direction(ledgerTotals.closingBalance)}</div>
                      </div>
                    </div>
                    <div className={`px-4 py-2 text-[11px] text-gray-500 bg-gray-50/60 border-b border-gray-100 ${u}`}>
                      {t(isVendor ? "ledger_legendVendor" : "ledger_legendCustomer")}
                    </div>
                  </>
                );
              })()}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notes")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_debit")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_credit")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("balance")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* Where the running balance starts. Without this row the
                        first line's balance seems to come from nowhere. Only
                        on page 1; later pages start mid-statement. */}
                    {ledgerPage === 1 && (
                      <tr className="bg-gray-50/70">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(new Date(ledgerFrom))}</td>
                        <td colSpan={3} className={`px-4 py-2.5 text-gray-600 italic ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_broughtForward")}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">—</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">—</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${ledgerOpeningBal >= 0 ? "text-red-700" : "text-green-700"}`}>
                          Rs. {formatCurrency(Math.abs(ledgerOpeningBal))}
                          <span className={`text-xs ml-1 font-normal ${isUrdu ? "urdu-text" : ""}`}>{ledgerOpeningBal >= 0 ? t("ledger_dr") : t("ledger_cr")}</span>
                        </td>
                      </tr>
                    )}
                    {ledgerEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                          {t("ledger_noTransactionsInPeriod")}
                        </td>
                      </tr>
                    ) : (
                      ledgerEntries.map((row) => {
                        // A sale paid at the counter (or a GRN paid at receipt)
                        // is one line carrying both the bill and the payment,
                        // which reads as a contradiction unless it is spelled out.
                        const settledOnSpot = row.debit > 0 && row.credit > 0 ? Math.min(row.debit, row.credit) : 0;
                        const leftOwing = Math.abs(row.debit - row.credit);
                        return (
                          <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                              {formatDate(new Date(row.date))}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                row.type === "SALE" ? "bg-teal-100 text-teal-700" :
                                row.type === "RECEIPT" ? "bg-green-100 text-green-700" :
                                row.type === "PAYMENT" ? "bg-red-100 text-red-700" :
                                row.type === "PURCHASE" ? "bg-blue-100 text-blue-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>
                                {typeLabels[row.type] ?? row.type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              <DocRef invoiceId={row.invoiceId} grnId={row.grnId} className="text-gray-600">
                                {row.reference ?? "—"}
                              </DocRef>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[240px]">
                              <div className="truncate">{row.notes ?? ""}</div>
                              {settledOnSpot > 0 && (
                                <div className={`mt-0.5 text-[11px] ${leftOwing < 0.005 ? "text-green-700" : "text-amber-700"} ${isUrdu ? "urdu-text" : ""}`}>
                                  {leftOwing < 0.005
                                    ? t("ledger_paidInFullOnSpot")
                                    : `Rs. ${formatCurrency(settledOnSpot)} ${t("ledger_paidOnSpot")} · Rs. ${formatCurrency(leftOwing)} ${t("ledger_leftOwing")}`}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-600">
                              {row.debit > 0 ? `Rs. ${formatCurrency(row.debit)}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-green-600">
                              {row.credit > 0 ? `Rs. ${formatCurrency(row.credit)}` : "—"}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${row.balance >= 0 ? "text-red-700" : "text-green-700"}`}>
                              Rs. {formatCurrency(Math.abs(row.balance))}
                              <span className={`text-xs ml-1 font-normal ${isUrdu ? "urdu-text" : ""}`}>{row.balance >= 0 ? t("ledger_dr") : t("ledger_cr")}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {ledgerTotals && ledgerEntries.length > 0 && (
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                      <tr>
                        <td colSpan={4} className={`px-4 py-3 text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_periodTotal")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-700">Rs. {formatCurrency(ledgerTotals.totalDebit)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-green-700">Rs. {formatCurrency(ledgerTotals.totalCredit)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${ledgerTotals.closingBalance >= 0 ? "text-red-700" : "text-green-700"}`}>
                          Rs. {formatCurrency(Math.abs(ledgerTotals.closingBalance))}
                          <span className={`text-xs ml-1 font-normal ${isUrdu ? "urdu-text" : ""}`}>{ledgerTotals.closingBalance >= 0 ? t("ledger_dr") : t("ledger_cr")}</span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <Pagination page={ledgerPage} pageSize={LEDGER_PAGE_SIZE} total={ledgerTotal} onPageChange={setLedgerPage} />
            </div>
          )}

          {/* Print Modal */}
          <LedgerPrintModal
            open={printOpen}
            onClose={() => setPrintOpen(false)}
            partyName={ledgerParty?.name ?? ""}
            accountId={ledgerParty?.accountId ?? 0}
            from={ledgerFrom}
            to={ledgerTo}
            openingBalance={ledgerOpeningBal}
            entries={ledgerAllEntries ?? []}
            totals={ledgerTotals ?? { totalDebit: 0, totalCredit: 0, closingBalance: 0 }}
            storeName={store?.name ?? "POS"}
          />
        </div>
      )}

      {/* ── RECOVERY TAB ───────────────────────────────────────────────────── */}
      {activeTab === "recovery" && (
        <div className="space-y-4">
          {can("RECORD_RECOVERY") && (
            <RecordForm type="recovery" branchId={branchId} parties={parties} accounts={accounts} onSaved={loadRecoveries} />
          )}

          {/* List */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_recoveryHistory")}</h3>
              <div className="flex items-center gap-2">
                <input type="date" value={recFrom} onChange={(e) => setRecFrom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="date" value={recTo} onChange={(e) => setRecTo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <button onClick={loadRecoveries}
                  className={`px-3 py-1 bg-teal-600 text-white rounded-lg text-xs hover:bg-teal-700 ${isUrdu ? "urdu-text" : ""}`}>
                  {t("filter")}
                </button>
                {recoveries.length > 0 && (
                  <button
                    onClick={() => exportCSV("Recovery", recoveries.map((r) => ({
                      Date: formatDate(new Date(r.date)), Party: r.party.name,
                      AccountId: r.party.accountId,
                      Reference: r.invoiceNo ? `INV-${r.invoiceNo}` : "",
                      Amount: r.amount,
                      Method: r.paymentMethod, Bank: r.bankName ?? "", Notes: r.notes ?? "",
                    })))}
                    className={`px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                    <Download className="w-3 h-3" /> {t("ledger_csv")}
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_customer")}</th>
                    {/* The invoice the money landed on — one Recovery row is
                        written per bill settled, so this is never ambiguous. */}
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("amount")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_method")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notes")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recoveries.length === 0 ? (
                    <tr><td colSpan={6} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_noRecoveryRecords")}</td></tr>
                  ) : (
                    recoveries.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(new Date(r.date))}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800">{r.party.name}</div>
                          <div className="text-xs text-gray-400">#{r.party.accountId}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {r.invoiceNo ? (
                            <DocRef invoiceId={r.invoiceId}>INV-{r.invoiceNo}</DocRef>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-green-700">
                          Rs. {formatCurrency(r.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${r.paymentMethod === "BANK" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"} ${isUrdu ? "urdu-text" : ""}`}>
                            {r.paymentMethod === "BANK" ? t("ledger_bank") : t("ledger_cash")}{r.bankName ? ` (${r.bankName})` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{r.notes ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {recoveries.length > 0 && (
              <div className={`px-5 py-3 border-t border-gray-100 text-right text-sm font-semibold text-green-700 ${isUrdu ? "urdu-text" : ""}`}>
                {t("ledger_total")}: Rs. {formatCurrency(recoveries.reduce((s, r) => s + r.amount, 0))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT TAB ────────────────────────────────────────────────────── */}
      {activeTab === "payment" && (
        <div className="space-y-4">
          {can("RECORD_PAYMENT") && (
            <RecordForm type="payment" branchId={branchId} parties={parties} accounts={accounts} onSaved={loadPayments} />
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_paymentHistory")}</h3>
              <div className="flex items-center gap-2">
                <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <button onClick={loadPayments}
                  className={`px-3 py-1 bg-teal-600 text-white rounded-lg text-xs hover:bg-teal-700 ${isUrdu ? "urdu-text" : ""}`}>
                  {t("filter")}
                </button>
                {payments.length > 0 && (
                  <button
                    onClick={() => exportCSV("Payments", payments.map((p) => ({
                      Date: formatDate(new Date(p.date)), Vendor: p.party.name,
                      AccountId: p.party.accountId,
                      Reference: p.grnNo ? `GRN-${p.grnNo}` : "",
                      Amount: p.amount,
                      Method: p.paymentMethod, Bank: p.bankName ?? "", Notes: p.notes ?? "",
                    })))}
                    className={`px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                    <Download className="w-3 h-3" /> {t("ledger_csv")}
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_vendor")}</th>
                    {/* The GRN this payment was made against — null when the
                        money went against the vendor's balance as a whole. */}
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                    <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("amount")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_method")}</th>
                    <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notes")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {payments.length === 0 ? (
                    <tr><td colSpan={6} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_noPaymentRecords")}</td></tr>
                  ) : (
                    payments.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(new Date(p.date))}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800">{p.party.name}</div>
                          <div className="text-xs text-gray-400">#{p.party.accountId}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {p.grnNo ? (
                            <DocRef grnId={p.grnId}>GRN-{p.grnNo}</DocRef>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-700">
                          Rs. {formatCurrency(p.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${p.paymentMethod === "BANK" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"} ${isUrdu ? "urdu-text" : ""}`}>
                            {p.paymentMethod === "BANK" ? t("ledger_bank") : t("ledger_cash")}{p.bankName ? ` (${p.bankName})` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{p.notes ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {payments.length > 0 && (
              <div className={`px-5 py-3 border-t border-gray-100 text-right text-sm font-semibold text-red-700 ${isUrdu ? "urdu-text" : ""}`}>
                {t("ledger_totalPaid")}: Rs. {formatCurrency(payments.reduce((s, p) => s + p.amount, 0))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DAY BOOK TAB ───────────────────────────────────────────────────── */}
      {activeTab === "daybook" && can("VIEW_DAYBOOK") && (
        <div className="space-y-4">
          {/* Date picker */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-end gap-3">
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("date")}</label>
              <input type="date" value={daybookDate} onChange={(e) => setDaybookDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={loadDaybook}
              className={`flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 ${isUrdu ? "urdu-text" : ""}`}>
              <RefreshCw className="w-3.5 h-3.5" />
              {t("ledger_load")}
            </button>
          </div>

          {daybookLoading ? (
            <div className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
          ) : daySummary ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  { label: t("ledger_openingBalance"), value: daySummary.openingBalance, color: "text-gray-700" },
                  { label: t("ledger_cashIn"), value: daySummary.cashIn, color: "text-green-700" },
                  { label: t("ledger_cashOut"), value: daySummary.cashOut, color: "text-red-700" },
                  { label: t("ledger_creditSales"), value: daySummary.creditSales, color: "text-blue-700" },
                  { label: t("ledger_closingBalance"), value: daySummary.closingBalance, color: "text-gray-900 font-bold" },
                ].map((card) => (
                  <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className={`text-xs text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{card.label}</div>
                    <div className={`text-lg font-semibold ${card.color}`}>
                      Rs. {formatCurrency(card.value)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Detail table */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                  <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("ledger_tabDayBook")} — {formatDate(new Date(daybookDate))}
                  </h3>
                  {dayEntries.length > 0 && (
                    <button
                      onClick={() => exportCSV(`DayBook_${daybookDate}`, dayEntries.map((e) => ({
                        Time: formatDate(new Date(e.date)), Type: TYPE_LABELS[e.type] ?? e.type,
                        Party: e.partyName, Reference: e.reference ?? "",
                        Debit: e.debit, Credit: e.credit, Notes: e.notes ?? "",
                      })))}
                      className={`px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                      <Download className="w-3 h-3" /> {t("ledger_csv")}
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</th>
                        <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_party")}</th>
                        <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                        <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_debit")}</th>
                        <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_credit")}</th>
                        <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_notes")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {dayEntries.length === 0 ? (
                        <tr><td colSpan={6} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_noTransactionsToday")}</td></tr>
                      ) : (
                        dayEntries.map((e) => (
                          <tr key={e.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                e.type === "SALE" ? "bg-teal-100 text-teal-700" :
                                e.type === "RECEIPT" ? "bg-green-100 text-green-700" :
                                e.type === "PAYMENT" ? "bg-red-100 text-red-700" :
                                "bg-gray-100 text-gray-600"
                              } ${isUrdu ? "urdu-text" : ""}`}>
                                {typeLabels[e.type] ?? e.type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-medium text-gray-800">{e.partyName}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              <DocRef invoiceId={e.invoiceId} grnId={e.grnId} className="text-gray-500">
                                {e.reference ?? "—"}
                              </DocRef>
                            </td>
                            <td className="px-4 py-2.5 text-right text-red-600 font-medium">
                              {e.debit > 0 ? `Rs. ${formatCurrency(e.debit)}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-green-600 font-medium">
                              {e.credit > 0 ? `Rs. ${formatCurrency(e.credit)}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs">{e.notes ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className={isUrdu ? "urdu-text" : ""}>{t("ledger_selectDateToLoadDayBook")}</p>
            </div>
          )}
        </div>
      )}

      {/* ── OUTSTANDING TAB ────────────────────────────────────────────────── */}
      {/* ── INSTALLMENTS TAB ──────────────────────────────────────────────── */}
      {activeTab === "installments" && (
        <div className="space-y-4">
          {collectRow && (
            <CollectInstallmentModal
              row={collectRow}
              accounts={accounts}
              onClose={() => setCollectRow(null)}
              onCollected={loadInstallments}
            />
          )}

          {/* Filter sub-tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {([
              ["open", "ledger_instFilterOpen"],
              ["overdue", "ledger_instFilterOverdue"],
              ["all", "ledger_instFilterAll"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setInstFilter(key)}
                className={`px-5 py-1.5 rounded-md text-sm font-medium transition-all ${
                  instFilter === key ? "bg-white shadow-sm text-teal-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <span className={isUrdu ? "urdu-text" : ""}>{t(label)}</span>
              </button>
            ))}
            <button onClick={loadInstallments}
              className={`ml-2 px-3 py-1 bg-teal-600 text-white rounded-md text-xs hover:bg-teal-700 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
              <RefreshCw className="w-3 h-3" /> {t("ledger_refresh")}
            </button>
          </div>

          {/* Customer money coming in vs vendor money going out. */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {([
              ["all", "ledger_instSideAll"],
              ["sales", "ledger_instSideCustomer"],
              ["purchase", "ledger_instSideVendor"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setInstSide(key)}
                className={`px-5 py-1.5 rounded-md text-sm font-medium transition-all ${
                  instSide === key ? "bg-white shadow-sm text-teal-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <span className={isUrdu ? "urdu-text" : ""}>{t(label)}</span>
              </button>
            ))}
          </div>

          {instLoading ? (
            <div className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_installmentsHeading")}</h3>
                  <p className={`text-xs text-gray-400 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
                    {instSummary?.count ?? 0} {t("ledger_installmentsCounted")}
                    {(instSummary?.overdueCount ?? 0) > 0 && (
                      <span className="text-red-500 font-medium">
                        {" · "}{instSummary?.overdueCount} {t("ledger_overdue")} (Rs. {formatCurrency(instSummary?.overdueRemaining ?? 0)})
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_totalRemaining")}</div>
                  <div className="text-lg font-bold text-red-600">Rs. {formatCurrency(instSummary?.totalRemaining ?? 0)}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_dueDate")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_reference")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_planColumn")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_amountRs")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_paidColumn")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_remainingColumn")}</th>
                      <th className={`px-4 py-3 text-center ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_status")}</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {installments.length === 0 ? (
                      <tr><td colSpan={9} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                        {t("ledger_noInstallments")}
                      </td></tr>
                    ) : (
                      installments.map((row) => (
                        <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${row.isOverdue ? "bg-red-50/50" : ""}`}>
                          <td className={`px-4 py-2.5 whitespace-nowrap ${row.isOverdue ? "text-red-600 font-semibold" : "text-gray-600"}`}>
                            {formatDate(new Date(row.dueDate))}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-medium text-gray-800">{row.party.name}</span>
                            <span className="text-gray-400 text-xs ml-1">#{row.party.accountId}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 font-mono text-xs whitespace-nowrap">
                            <DocRef invoiceId={row.plan.invoiceId} grnId={row.plan.grnId}>
                              {row.plan.invoiceNo ? `INV-${row.plan.invoiceNo}` : `GRN-${row.plan.grnNo}`}
                            </DocRef>
                            {/* Which direction the money moves. Collecting on a
                                customer plan books a Recovery; settling a vendor
                                plan books a Payment. */}
                            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-sans font-medium ${
                              row.plan.side === "sales" ? "bg-teal-100 text-teal-700" : "bg-purple-100 text-purple-700"
                            } ${isUrdu ? "urdu-text" : ""}`}>
                              {row.plan.side === "sales" ? t("ledger_instSideCustomer") : t("ledger_instSideVendor")}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">
                            {row.plan.kind === "PROMISE_DAY" ? t("ledger_planPromiseDay")
                              : row.plan.kind === "WEEKLY" ? t("ledger_planWeekly") : t("ledger_planMonthly")}
                            {" "}({row.seq}/{row.plan.periods})
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700">Rs. {formatCurrency(row.amount)}</td>
                          <td className="px-4 py-2.5 text-right text-green-600">
                            {row.paidAmount > 0 ? `Rs. ${formatCurrency(row.paidAmount)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-red-600">
                            {row.remaining > 0 ? `Rs. ${formatCurrency(row.remaining)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              row.status === "PAID" ? "bg-green-100 text-green-700" :
                              row.isOverdue ? "bg-red-100 text-red-700" :
                              row.status === "PARTIAL" ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {row.status === "PAID" ? t("ledger_statusPaid")
                                : row.isOverdue ? t("ledger_overdue")
                                : row.status === "PARTIAL" ? t("ledger_statusPartial") : t("ledger_statusPending")}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {can("COLLECT_INSTALLMENT") && row.status !== "PAID" && (
                              <button
                                onClick={() => setCollectRow(row)}
                                className={`inline-flex items-center gap-1 px-3 py-1 bg-teal-600 text-white rounded-md text-xs hover:bg-teal-700 ${isUrdu ? "urdu-text" : ""}`}
                              >
                                <Plus className="w-3 h-3" />
                                {row.plan.side === "purchase" ? t("ledger_pay") : t("ledger_collect")}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {installments.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => exportCSV(`Installments_${instFilter}`, installments.map((r) => ({
                      DueDate: formatDate(new Date(r.dueDate)),
                      Party: r.party.name, AccountId: r.party.accountId,
                      Reference: r.plan.invoiceNo ? `INV-${r.plan.invoiceNo}` : `GRN-${r.plan.grnNo}`,
                      Plan: r.plan.kind, Seq: `${r.seq}/${r.plan.periods}`,
                      Amount: r.amount, Paid: r.paidAmount, Remaining: r.remaining,
                      Status: r.isOverdue && r.status !== "PAID" ? "OVERDUE" : r.status,
                    })))}
                    className={`px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                    <Download className="w-3 h-3" /> {t("export")} CSV
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "outstanding" && can("VIEW_OUTSTANDING") && (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(["receivable", "payable"] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setOutTab(tabKey)}
                className={`px-5 py-1.5 rounded-md text-sm font-medium transition-all ${
                  outTab === tabKey ? "bg-white shadow-sm text-teal-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <span className={isUrdu ? "urdu-text" : ""}>
                  {tabKey === "receivable" ? t("ledger_receivablesCrCustomers") : t("ledger_payablesVendors")}
                </span>
              </button>
            ))}
            <button onClick={loadOutstanding}
              className={`ml-2 px-3 py-1 bg-teal-600 text-white rounded-md text-xs hover:bg-teal-700 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
              <RefreshCw className="w-3 h-3" /> {t("ledger_refresh")}
            </button>
          </div>

          {outLoading ? (
            <div className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>
                    {outTab === "receivable" ? t("ledger_receivablesOwedToYou") : t("ledger_payablesYouOweVendors")}
                  </h3>
                  <p className={`text-xs text-gray-400 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
                    {outstanding.length} {t("ledger_partiesWithOutstandingBalance")}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_totalOutstanding")}</div>
                  <div className={`text-lg font-bold ${outTab === "receivable" ? "text-red-600" : "text-purple-600"}`}>
                    Rs. {formatCurrency(outTotal)}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_account")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_city")}</th>
                      <th className={`px-4 py-3 text-left ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_phone")}</th>
                      <th className={`px-4 py-3 text-right ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_outstandingColumn")}</th>
                      <th className={`px-4 py-3 text-center ${isUrdu ? "urdu-text" : ""}`}>{t("ledger_ledgerColumn")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {outstanding.length === 0 ? (
                      <tr><td colSpan={6} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                        {outTab === "receivable" ? t("ledger_noOutstandingReceivables") : t("ledger_noOutstandingPayables")}
                      </td></tr>
                    ) : (
                      outstanding.map((o) => (
                        <tr key={o.partyId} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500">#{o.accountId}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{o.name}</td>
                          <td className="px-4 py-2.5 text-gray-500">{o.city ?? "—"}</td>
                          <td className="px-4 py-2.5 text-gray-500">{o.phone ?? "—"}</td>
                          <td className={`px-4 py-2.5 text-right font-bold text-lg ${outTab === "receivable" ? "text-red-600" : "text-purple-600"}`}>
                            Rs. {formatCurrency(o.balance)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => {
                                const party = parties.find((p) => p.id === o.partyId);
                                if (party) { setLedgerParty(party); setActiveTab("ledger"); }
                              }}
                              className={`inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 transition-colors ${isUrdu ? "urdu-text" : ""}`}
                            >
                              {t("ledger_view")} <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {outstanding.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => exportCSV(`Outstanding_${outTab}`, outstanding.map((o) => ({
                      AccountId: o.accountId, Name: o.name, City: o.city ?? "",
                      Phone: o.phone ?? "", Balance: o.balance,
                    })))}
                    className={`px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                    <Download className="w-3 h-3" /> {t("export")} CSV
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
