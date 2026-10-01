"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Landmark, Wallet, CreditCard, Plus, Pencil, Trash2, FileText,
  ToggleLeft, ToggleRight, ArrowLeft, Download, RefreshCw, ArrowRightLeft,
} from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import NumberInput from "@/components/ui/NumberInput";
import { formatCurrency, formatDate, getDateRangeForPreset, shopToday, type DateRangePreset } from "@/lib/utils";
import { exportCSV } from "@/lib/csv-export";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountType = "CASH" | "BANK" | "CARD";

type AccountRow = {
  id: string; type: AccountType; name: string;
  bankName: string | null; accountNumber: string | null;
  openingBalance: number; balance: number;
  isDefaultCash: boolean; isActive: boolean;
};

type StatementRow = {
  id: string; date: string; type: string; reference: string | null;
  partyName: string | null; invoiceNo: number | null; grnNo: number | null;
  notes: string | null;
  debit: number; credit: number;
  /** Null while an entry-type filter is applied — see the ledger route. */
  balance: number | null;
};

type Statement = {
  account: { id: string; name: string; type: AccountType; bankName: string | null; accountNumber: string | null };
  openingBalance: number | null;
  typeFiltered: boolean;
  entries: StatementRow[];
  totals: { totalDebit: number; totalCredit: number; closingBalance: number | null };
};

type AccountForm = { name: string; bankName: string; accountNumber: string; openingBalance: string };

const EMPTY_FORM: AccountForm = { name: "", bankName: "", accountNumber: "", openingBalance: "" };

const DATE_PRESETS: DateRangePreset[] = [
  "today", "yesterday", "last7days", "thisMonth", "lastMonth",
  "last30days", "thisYear", "lastYear", "all", "custom",
];

const ENTRY_TYPES = [
  "SALE_RECEIPT", "SALE_REFUND", "PURCHASE_PAYMENT", "PURCHASE_REFUND",
  "RECOVERY", "PAYMENT", "INSTALLMENT_COLLECTION", "ADJUSTMENT", "TRANSFER",
  // Cost management posts through the same accounts — see docs/expenses.md.
  "EXPENSE", "PROFIT_WITHDRAWAL", "CAPITAL_INJECTION",
] as const;

// The shop's today, not the UTC date — see `shopToday`.
const today = shopToday;

const TYPE_STYLES: Record<AccountType, { wrap: string; icon: string; Icon: typeof Landmark }> = {
  CASH: { wrap: "border-teal-200 bg-teal-50", icon: "bg-teal-100 text-teal-600", Icon: Wallet },
  CARD: { wrap: "border-purple-200 bg-purple-50", icon: "bg-purple-100 text-purple-600", Icon: CreditCard },
  BANK: { wrap: "border-gray-200 bg-white", icon: "bg-blue-50 text-blue-600", Icon: Landmark },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Bank & Cash accounts, lifted out of the Settings → Accounts tab into a page
 * of its own so it can carry a per-account statement (the thing a Settings tab
 * had no room for) and its own permission set.
 *
 * Two views in one route rather than a nested `[id]` page: the statement always
 * opens from a card here and closing it must not lose the list's scroll or
 * refetch every balance, which a real navigation would.
 */
export default function AccountsPage() {
  const { data: session } = useSession();
  const branchId = (session?.user as { branchId?: string } | undefined)?.branchId;
  const { can, loaded: permsLoaded } = usePermissions();
  const { t, isUrdu } = useI18n();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Add / edit form — `editing` null means the form is creating a new account.
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Settling a card-machine / cash balance into a bank account.
  const [settleFrom, setSettleFrom] = useState<AccountRow | null>(null);
  const [settleTo, setSettleTo] = useState("");
  const [settleAmount, setSettleAmount] = useState(0);
  const [settling, setSettling] = useState(false);

  // Statement view — non-null means the statement is open for that account.
  const [statementFor, setStatementFor] = useState<AccountRow | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      // includeInactive: this page has to list a deactivated account in order
      // to offer reactivating it; payment dropdowns call the same route without
      // the flag and so never see one.
      const res = await fetch(`/api/accounts?branchId=${branchId}&includeInactive=1`);
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ── Create / edit ──
  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(a: AccountRow) {
    setEditing(a);
    setForm({
      name: a.name,
      bankName: a.bankName ?? "",
      accountNumber: a.accountNumber ?? "",
      openingBalance: String(a.openingBalance ?? 0),
    });
    setShowForm(true);
  }

  async function saveAccount() {
    if (!form.name.trim()) return toast.error(t("accounts_nameRequiredMsg"));
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : 0,
      };
      const res = editing
        ? await fetch(`/api/accounts/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId, ...payload }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(t(editing ? "accounts_updatedMsg" : "accounts_createdMsg"));
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("accounts_actionFailedMsg"));
    } finally {
      setSaving(false);
    }
  }

  async function patchAccount(id: string, patch: Partial<{ isActive: boolean }>) {
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return toast.error(d.error ?? t("accounts_actionFailedMsg"));
    }
    loadAccounts();
  }

  async function deleteAccount(a: AccountRow) {
    if (!confirm(t("accounts_confirmDelete"))) return;
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The 409 body explains that the account carries transactions and should
      // be deactivated instead — worth showing in full rather than flattening
      // to "Action failed".
      return toast.error(data.error ?? t("accounts_actionFailedMsg"), { duration: 6000 });
    }
    toast.success(t("accounts_deletedMsg"));
    loadAccounts();
  }

  // ── Settle (transfer between the store's own accounts) ──
  async function settleAccount() {
    if (!settleFrom) return;
    if (!settleTo) return toast.error(t("accounts_selectDestination"));
    if (!(settleAmount > 0)) return toast.error(t("accounts_enterValidAmountMsg"));
    setSettling(true);
    try {
      const res = await fetch("/api/accounts/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId, fromAccountId: settleFrom.id, toAccountId: settleTo, amount: settleAmount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(t("accounts_transferRecordedMsg"));
      setSettleFrom(null);
      loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("accounts_actionFailedMsg"));
    } finally {
      setSettling(false);
    }
  }

  // The matrix is fetched once per page load; gating on `loaded` avoids a flash
  // of "no permission" before it arrives.
  if (permsLoaded && !can("VIEW_ACCOUNTS")) {
    return (
      <div className="p-6">
        <p className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_noPermissionMsg")}</p>
      </div>
    );
  }

  if (statementFor) {
    return (
      <AccountStatement
        account={statementFor}
        onBack={() => { setStatementFor(null); loadAccounts(); }}
      />
    );
  }

  const totalHoldings = accounts
    .filter((a) => a.isActive)
    .reduce((s, a) => s + a.balance, 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Landmark className="w-6 h-6 text-gray-600" /> {t("accounts_title")}
          </h1>
          <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
            {t("accounts_subtitle")}
          </p>
        </div>
        {can("CREATE_ACCOUNT") && (
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 shrink-0">
            <Plus className="w-4 h-4" />
            <span className={isUrdu ? "urdu-text" : ""}>{t("accounts_addBankAccount")}</span>
          </button>
        )}
      </div>

      {/* Total holdings */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-5 flex items-center justify-between">
        <span className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_totalHoldings")}</span>
        <span className={`text-xl font-bold ${totalHoldings < 0 ? "text-red-600" : "text-gray-800"}`}>
          {formatCurrency(totalHoldings)}
        </span>
      </div>

      {/* Account list */}
      {loading ? (
        <div className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_loading")}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {accounts.map((a) => {
            const style = TYPE_STYLES[a.type];
            const actions: ActionMenuItem[] = [];
            if (can("VIEW_ACCOUNT_LEDGER")) {
              actions.push({
                key: "statement", label: t("accounts_openStatement"), icon: FileText,
                onSelect: () => setStatementFor(a),
              });
            }
            if (a.type === "BANK" && can("EDIT_ACCOUNT")) {
              actions.push({
                key: "edit", label: t("accounts_edit"), icon: Pencil,
                onSelect: () => openEdit(a),
              });
            }
            if (a.type !== "BANK" && a.balance > 0 && can("TRANSFER_FUNDS")) {
              actions.push({
                key: "settle", label: t("accounts_settleToBank"), icon: ArrowRightLeft,
                onSelect: () => { setSettleFrom(a); setSettleTo(""); setSettleAmount(a.balance); },
              });
            }
            // The house Cash account can never be deactivated (it would orphan
            // every cash posting) and the Card account is not user-managed.
            if (a.type === "BANK" && can("EDIT_ACCOUNT")) {
              actions.push({
                key: "toggle",
                label: a.isActive ? t("accounts_deactivate") : t("accounts_activate"),
                icon: a.isActive ? ToggleLeft : ToggleRight,
                tone: a.isActive ? "warning" : "success",
                onSelect: () => patchAccount(a.id, { isActive: !a.isActive }),
              });
            }
            if (a.type === "BANK" && can("DELETE_ACCOUNT")) {
              actions.push({
                key: "delete", label: t("accounts_delete"), icon: Trash2, tone: "danger",
                onSelect: () => deleteAccount(a),
              });
            }

            return (
              <div key={a.id}
                className={`border rounded-xl p-4 flex items-start justify-between gap-3 transition-opacity ${style.wrap} ${!a.isActive ? "opacity-50" : ""}`}>
                <button
                  type="button"
                  onClick={() => can("VIEW_ACCOUNT_LEDGER") && setStatementFor(a)}
                  disabled={!can("VIEW_ACCOUNT_LEDGER")}
                  className="flex items-start gap-3 text-left min-w-0 disabled:cursor-default"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${style.icon}`}>
                    <style.Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                      <span className="truncate">{a.name}</span>
                      {!a.isActive && (
                        <span className={`text-[10px] uppercase tracking-wide bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded ${isUrdu ? "urdu-text" : ""}`}>
                          {t("accounts_inactive")}
                        </span>
                      )}
                    </div>
                    {a.bankName && (
                      <div className="text-xs text-gray-500 truncate">
                        {a.bankName}{a.accountNumber ? ` · ${a.accountNumber}` : ""}
                      </div>
                    )}
                    {a.type === "CARD" && (
                      <div className={`text-xs text-purple-600 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_cardPendingHint")}</div>
                    )}
                    {a.type === "CASH" && (
                      <div className={`text-xs text-teal-700 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_cashHint")}</div>
                    )}
                    <div className={`text-lg font-bold mt-1 ${a.balance < 0 ? "text-red-600" : "text-gray-800"}`}>
                      {formatCurrency(a.balance)}
                    </div>
                  </div>
                </button>

                {actions.length > 0 && <ActionMenu items={actions} />}
              </div>
            );
          })}

          {accounts.length === 0 && (
            <p className={`col-span-2 text-center text-gray-400 py-10 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_none")}</p>
          )}
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>
              {t(editing ? "accounts_editBankAccount" : "accounts_newBankAccount")}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_accountLabel")}</label>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t("accounts_accountLabelPlaceholder")}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_bankName")}</label>
                <input value={form.bankName} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
                  placeholder="e.g. HBL, MCB…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_accountNumber")}</label>
                <input value={form.accountNumber} onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div className="col-span-2">
                <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_openingBalance")}</label>
                <input type="number" value={form.openingBalance}
                  onChange={(e) => setForm((p) => ({ ...p, openingBalance: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 text-right" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowForm(false); setEditing(null); }}
                className={`flex-1 border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
                {t("cancel")}
              </button>
              <button onClick={saveAccount} disabled={saving}
                className={`flex-1 bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
                {t(editing ? "accounts_saveChanges" : "accounts_createAccount")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle modal */}
      {settleFrom && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-3">
            <div>
              <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_settleToBank")}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {settleFrom.name} — {formatCurrency(settleFrom.balance)}
              </p>
            </div>
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_toBankAccount")}</label>
              <select value={settleTo} onChange={(e) => setSettleTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">{t("accounts_selectDestination")}</option>
                {accounts.filter((b) => b.type === "BANK" && b.isActive).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_amountRs")}</label>
              <NumberInput value={settleAmount} onChange={setSettleAmount}
                transform={(v) => Math.min(Math.max(0, v), settleFrom.balance)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setSettleFrom(null)}
                className={`flex-1 border border-gray-300 rounded-lg py-2 text-sm ${isUrdu ? "urdu-text" : ""}`}>
                {t("cancel")}
              </button>
              <button onClick={settleAccount} disabled={settling}
                className={`flex-1 bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}>
                {settling ? t("settings_saving") : t("accounts_settle")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Statement ────────────────────────────────────────────────────────────────

/**
 * One account's statement. The filter bar mirrors Reports: a preset dropdown
 * that drives the two date inputs, which stay editable only on `custom`/`all`.
 * There is no Load button — every control feeds the loader and the effect below
 * refetches, debounced so typing a date doesn't fire a request per keystroke.
 */
function AccountStatement({ account, onBack }: { account: AccountRow; onBack: () => void }) {
  const { t, isUrdu } = useI18n();

  const [preset, setPreset] = useState<DateRangePreset>("thisMonth");
  const initial = getDateRangeForPreset("thisMonth");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to || today());
  const [type, setType] = useState("ALL");
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);

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

  function applyPreset(next: DateRangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const range = getDateRangeForPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (type !== "ALL") qs.set("type", type);
      const res = await fetch(`/api/accounts/${account.id}/ledger?${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t("accounts_actionFailedMsg"));
        setData(null);
        return;
      }
      setData(body);
    } finally {
      setLoading(false);
    }
  }, [account.id, from, to, type, t]);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  function entryTypeLabel(key: string): string {
    // Every AccountEntryType has a key in lib/translations/accounts.ts; the
    // raw enum is a last resort if the schema gains one before the strings do.
    const k = `accounts_type_${key}` as Parameters<typeof t>[0];
    const label = t(k);
    return label === k ? key.replace(/_/g, " ") : label;
  }

  function handleExport() {
    if (!data?.entries.length) return;
    exportCSV(
      `statement_${account.name.replace(/\s+/g, "-")}_${from || "all"}_${to || "all"}`,
      data.entries.map((e) => ({
        Date: formatDate(e.date),
        Type: entryTypeLabel(e.type),
        Reference: e.reference ?? "",
        Party: e.partyName ?? "",
        Details: e.notes ?? "",
        In: e.debit || "",
        Out: e.credit || "",
        Balance: e.balance ?? "",
      }))
    );
  }

  const rows = data?.entries ?? [];
  const showBalance = !data?.typeFiltered;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <button onClick={onBack}
            className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 mb-2 ${isUrdu ? "urdu-text" : ""}`}>
            <ArrowLeft className="w-4 h-4" /> {t("accounts_backToAccounts")}
          </button>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <FileText className="w-6 h-6 text-gray-600" /> {account.name}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {[account.bankName, account.accountNumber].filter(Boolean).join(" · ") || t("accounts_statement")}
          </p>
        </div>
        <button onClick={handleExport} disabled={!rows.length}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 shrink-0">
          <Download className="w-4 h-4" />
          <span className={isUrdu ? "urdu-text" : ""}>{t("accounts_exportStatement")}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("reports_dateRange")}</label>
          <select value={preset} onChange={(e) => applyPreset(e.target.value as DateRangePreset)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
            {DATE_PRESETS.map((p) => <option key={p} value={p}>{presetLabels[p]}</option>)}
          </select>
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("from")}</label>
          <input type="date" value={from} disabled={preset !== "custom" && preset !== "all"}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("to")}</label>
          <input type="date" value={to} disabled={preset !== "custom" && preset !== "all"}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("accounts_entryType")}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
            <option value="ALL">{t("accounts_allTypes")}</option>
            {ENTRY_TYPES.map((k) => <option key={k} value={k}>{entryTypeLabel(k)}</option>)}
          </select>
        </div>
        {loading && (
          <div className="flex items-center gap-1.5 py-2 text-sm text-gray-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className={isUrdu ? "urdu-text" : ""}>{t("loading")}</span>
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <TotalCard label={t("accounts_openingBalanceLabel")}
          value={data?.openingBalance == null ? "—" : formatCurrency(data.openingBalance)} />
        <TotalCard label={t("accounts_moneyIn")} value={formatCurrency(data?.totals.totalDebit ?? 0)} color="text-green-600" />
        <TotalCard label={t("accounts_moneyOut")} value={formatCurrency(data?.totals.totalCredit ?? 0)} color="text-red-600" />
        <TotalCard label={t("accounts_closingBalance")}
          value={data?.totals.closingBalance == null ? "—" : formatCurrency(data.totals.closingBalance)}
          color={(data?.totals.closingBalance ?? 0) < 0 ? "text-red-600" : "text-gray-800"} />
      </div>

      {!showBalance && (
        <p className={`text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 ${isUrdu ? "urdu-text" : ""}`}>
          {t("accounts_typeFilteredHint")}
        </p>
      )}

      {/* Entries */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left font-medium px-3 py-2">{t("accounts_date")}</th>
              <th className="text-left font-medium px-3 py-2">{t("accounts_type")}</th>
              <th className="text-left font-medium px-3 py-2">{t("accounts_reference")}</th>
              <th className="text-left font-medium px-3 py-2">{t("accounts_party")}</th>
              <th className="text-left font-medium px-3 py-2">{t("accounts_details")}</th>
              <th className="text-right font-medium px-3 py-2">{t("accounts_debit")}</th>
              <th className="text-right font-medium px-3 py-2">{t("accounts_credit")}</th>
              {showBalance && <th className="text-right font-medium px-3 py-2">{t("accounts_balance")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(e.date)}</td>
                <td className={`px-3 py-2 whitespace-nowrap ${isUrdu ? "urdu-text" : ""}`}>{entryTypeLabel(e.type)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">{e.reference ?? "—"}</td>
                <td className="px-3 py-2">{e.partyName ?? "—"}</td>
                <td className="px-3 py-2 text-gray-500 max-w-[18rem] truncate" title={e.notes ?? ""}>{e.notes ?? "—"}</td>
                <td className="px-3 py-2 text-right text-green-600">{e.debit ? formatCurrency(e.debit) : "—"}</td>
                <td className="px-3 py-2 text-right text-red-600">{e.credit ? formatCurrency(e.credit) : "—"}</td>
                {showBalance && (
                  <td className={`px-3 py-2 text-right font-medium ${(e.balance ?? 0) < 0 ? "text-red-600" : "text-gray-800"}`}>
                    {formatCurrency(e.balance ?? 0)}
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={showBalance ? 8 : 7}
                  className={`text-center text-gray-400 py-10 ${isUrdu ? "urdu-text" : ""}`}>
                  {t("accounts_noEntries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TotalCard({ label, value, color = "text-gray-800" }: { label: string; value: string; color?: string }) {
  const { isUrdu } = useI18n();
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
