"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Receipt, Plus, Pencil, Trash2, Download, ArrowLeft, ArrowDownCircle,
  ArrowUpCircle, PiggyBank, Wallet, Landmark, CheckCircle2, Clock,
  Tags, ToggleLeft, ToggleRight,
} from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import NumberInput from "@/components/ui/NumberInput";
import Pagination from "@/components/ui/Pagination";
import { formatCurrency, formatDate, getDateRangeForPreset, shopDateKey, shopToday, type DateRangePreset } from "@/lib/utils";
import { exportCSV } from "@/lib/csv-export";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import toast from "react-hot-toast";

const PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

type Kind = "EXPENSE" | "PROFIT_WITHDRAWAL" | "CAPITAL_INJECTION";
type Status = "PAID" | "UNPAID";

type ExpenseRow = {
  id: string;
  date: string;
  kind: Kind;
  title: string;
  amount: number;
  status: Status;
  paymentMethod: string | null;
  paidAt: string | null;
  payeeName: string | null;
  reference: string | null;
  notes: string | null;
  category: { id: string; name: string } | null;
  account: { id: string; name: string; type: string } | null;
  payeeUser: { id: string; name: string } | null;
  recordedBy: { id: string; name: string } | null;
};

type Totals = {
  expenses: number;
  unpaidExpenses: number;
  withdrawals: number;
  injections: number;
  count: number;
};

type Category = {
  id: string; name: string; note: string | null;
  isActive: boolean; expenseCount: number;
};

type AccountOption = { id: string; name: string; type: string; isActive: boolean };
type Payee = { id: string; name: string };

type FormState = {
  id: string | null;
  kind: Kind;
  date: string;
  categoryId: string;
  title: string;
  amount: number;
  status: Status;
  paymentMethod: "CASH" | "BANK";
  accountId: string;
  payeeUserId: string;
  payeeName: string;
  reference: string;
  notes: string;
};

const DATE_PRESETS: DateRangePreset[] = [
  "today", "yesterday", "last7days", "thisMonth", "lastMonth",
  "last30days", "thisYear", "lastYear", "all", "custom",
];

const KINDS: Kind[] = ["EXPENSE", "PROFIT_WITHDRAWAL", "CAPITAL_INJECTION"];

// The shop's today, not the UTC date — see `shopToday`.
const today = shopToday;

function emptyForm(kind: Kind): FormState {
  return {
    id: null,
    kind,
    date: today(),
    categoryId: "",
    title: "",
    amount: 0,
    status: "PAID",
    paymentMethod: "CASH",
    accountId: "",
    payeeUserId: "",
    payeeName: "",
    reference: "",
    notes: "",
  };
}

/** Badge colours per kind. Money out is warm, money in is cool. */
const KIND_STYLES: Record<Kind, string> = {
  EXPENSE: "bg-rose-50 text-rose-700 border-rose-200",
  PROFIT_WITHDRAWAL: "bg-amber-50 text-amber-700 border-amber-200",
  CAPITAL_INJECTION: "bg-blue-50 text-blue-700 border-blue-200",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Cost Management — what the shop spends, and what the owner takes out.
 *
 * The counterpart to the Bank & Cash page: that one answers "where is the
 * store's money", this one answers "where did it go". Every paid row here
 * writes exactly one `AccountEntry` (see lib/expenses.ts), so a salary paid out
 * of the till shows up on the cash account's statement alongside the sales that
 * put it there.
 *
 * Two views in one route rather than a nested page, same as the Accounts page:
 * the category manager always opens from here and closing it must not refetch
 * the whole list.
 *
 * Three things this page is deliberately careful about:
 *
 * 1. **A withdrawal is not a cost.** Both take money out of an account, and the
 *    summary tiles show them side by side, but only costs reduce profit. The
 *    tiles keep them in separate columns rather than one "money out" figure.
 * 2. **An unpaid cost is still a cost.** It counts in the period's total from
 *    the moment it is recorded, and moves no account balance until it is marked
 *    paid — which is why the total and the "still owed" figure sit together.
 * 3. **Permissions split at the drawer, not the page.** Recording the
 *    electricity bill is `CREATE_EXPENSE`; taking the owner's earnings is
 *    `WITHDRAW_PROFIT`, and the second button simply isn't rendered without it.
 */
export default function ExpensesPage() {
  const { data: session } = useSession();
  const branchId = (session?.user as { branchId?: string } | undefined)?.branchId;
  const { can, loaded: permsLoaded } = usePermissions();
  const { t, isUrdu } = useI18n();

  // ── Filters ──
  const [preset, setPreset] = useState<DateRangePreset>("thisMonth");
  const [from, setFrom] = useState(() => getDateRangeForPreset("thisMonth").from);
  const [to, setTo] = useState(() => getDateRangeForPreset("thisMonth").to);
  const [kindFilter, setKindFilter] = useState<"" | Kind>("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [query, setQuery] = useState("");

  // ── Data ──
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredAmount, setFilteredAmount] = useState(0);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);

  // ── Views / modals ──
  const [showCategories, setShowCategories] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [payFor, setPayFor] = useState<ExpenseRow | null>(null);
  const [payMethod, setPayMethod] = useState<"CASH" | "BANK">("CASH");
  const [payAccountId, setPayAccountId] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [paying, setPaying] = useState(false);

  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.type === "BANK" && a.isActive),
    [accounts]
  );
  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);

  function applyPreset(next: DateRangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const range = getDateRangeForPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  const loadRows = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ branchId, page: String(page), pageSize: String(PAGE_SIZE) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (kindFilter) params.set("kind", kindFilter);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`/api/expenses?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setRows(data.expenses ?? []);
      setTotal(data.total ?? 0);
      setFilteredAmount(data.filteredAmount ?? 0);
      setTotals(data.totals ?? null);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("expenses_actionFailedMsg"));
    } finally {
      setLoading(false);
    }
  }, [branchId, from, to, kindFilter, categoryFilter, statusFilter, query, page, t]);

  // A new filter invalidates whatever page we were on.
  useEffect(() => { setPage(1); }, [from, to, kindFilter, categoryFilter, statusFilter, query]);

  // The filter is the trigger — no Load button, same rule as Reports and the
  // Accounts statement. Debounced because the search box and the date inputs
  // both emit a change per keystroke.
  useEffect(() => {
    const timer = setTimeout(loadRows, 300);
    return () => clearTimeout(timer);
  }, [loadRows]);

  // Reference data the form needs, fetched once. `includeInactive=1` on
  // categories is for the manager view; the form filters to active itself.
  const loadReference = useCallback(async () => {
    if (!branchId) return;
    const [catRes, accRes, payeeRes] = await Promise.all([
      fetch(`/api/expenses/categories?branchId=${branchId}&includeInactive=1`),
      fetch(`/api/accounts?branchId=${branchId}`),
      fetch(`/api/expenses/payees?branchId=${branchId}`),
    ]);
    const [cats, accs, pays] = await Promise.all([
      catRes.json().catch(() => ({})),
      accRes.json().catch(() => ({})),
      payeeRes.json().catch(() => ({})),
    ]);
    if (catRes.ok) setCategories(cats.categories ?? []);
    if (accRes.ok) setAccounts(accs.accounts ?? []);
    if (payeeRes.ok) setPayees(pays.payees ?? []);
  }, [branchId]);

  useEffect(() => { loadReference(); }, [loadReference]);

  // ── Create / edit ──
  function openCreate(kind: Kind) {
    const next = emptyForm(kind);
    // One category makes the choice for the user; several don't.
    if (kind === "EXPENSE" && activeCategories.length === 1) {
      next.categoryId = activeCategories[0].id;
    }
    setForm(next);
  }

  function openEdit(row: ExpenseRow) {
    setForm({
      id: row.id,
      kind: row.kind,
      // Shop day, not the UTC date the ISO string starts with.
      date: shopDateKey(new Date(row.date)),
      categoryId: row.category?.id ?? "",
      title: row.title,
      amount: row.amount,
      status: row.status,
      paymentMethod: row.paymentMethod === "BANK" ? "BANK" : "CASH",
      accountId: row.paymentMethod === "BANK" ? row.account?.id ?? "" : "",
      payeeUserId: row.payeeUser?.id ?? "",
      payeeName: row.payeeName ?? "",
      reference: row.reference ?? "",
      notes: row.notes ?? "",
    });
  }

  async function saveForm() {
    if (!form) return;
    if (!form.title.trim()) return toast.error(t("expenses_titleRequiredMsg"));
    if (!(form.amount > 0)) return toast.error(t("expenses_amountRequiredMsg"));
    if (form.kind === "EXPENSE" && !form.categoryId) {
      return toast.error(t("expenses_categoryRequiredMsg"));
    }
    if (form.status === "PAID" && form.paymentMethod === "BANK" && !form.accountId) {
      return toast.error(t("expenses_bankRequiredMsg"));
    }

    setSaving(true);
    try {
      const payload = {
        kind: form.kind,
        date: form.date,
        categoryId: form.kind === "EXPENSE" ? form.categoryId : null,
        title: form.title,
        amount: form.amount,
        status: form.status,
        paymentMethod: form.status === "PAID" ? form.paymentMethod : null,
        accountId: form.status === "PAID" && form.paymentMethod === "BANK" ? form.accountId : null,
        payeeUserId: form.payeeUserId || null,
        payeeName: form.payeeName,
        reference: form.reference,
        notes: form.notes,
      };

      const res = form.id
        ? await fetch(`/api/expenses/${form.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId, ...payload }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);

      toast.success(t(form.id ? "expenses_updatedMsg" : "expenses_savedMsg"));
      setForm(null);
      loadRows();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("expenses_actionFailedMsg"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: ExpenseRow) {
    if (!confirm(t("expenses_confirmDelete"))) return;
    const res = await fetch(`/api/expenses/${row.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? t("expenses_actionFailedMsg"));
    toast.success(t("expenses_deletedMsg"));
    loadRows();
  }

  // ── Settle an unpaid cost ──
  function openPay(row: ExpenseRow) {
    setPayFor(row);
    setPayMethod("CASH");
    setPayAccountId("");
    setPayDate(today());
  }

  async function confirmPay() {
    if (!payFor) return;
    if (payMethod === "BANK" && !payAccountId) return toast.error(t("expenses_bankRequiredMsg"));
    setPaying(true);
    try {
      const res = await fetch(`/api/expenses/${payFor.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: payMethod,
          accountId: payMethod === "BANK" ? payAccountId : null,
          paidAt: payDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(t("expenses_paidMsg"));
      setPayFor(null);
      loadRows();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("expenses_actionFailedMsg"));
    } finally {
      setPaying(false);
    }
  }

  async function exportRows() {
    if (!branchId) return;
    // The button means "export everything matching the filter", not just the
    // page on screen — a dedicated `all=true` fetch, not the paginated `rows`.
    const params = new URLSearchParams({ branchId, all: "true" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (kindFilter) params.set("kind", kindFilter);
    if (categoryFilter) params.set("categoryId", categoryFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (query.trim()) params.set("q", query.trim());

    const res = await fetch(`/api/expenses?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(t("expenses_actionFailedMsg"));
      return;
    }
    const allRows: ExpenseRow[] = data.expenses ?? [];

    exportCSV(
      `costs-${from || "all"}-${to || "all"}`,
      allRows.map((r) => ({
        Date: formatDate(r.date),
        Kind: t(`expenses_kind_${r.kind}` as never),
        Category: r.category?.name ?? "",
        Description: r.title,
        PaidTo: r.payeeName ?? r.payeeUser?.name ?? "",
        Status: t(`expenses_status_${r.status}` as never),
        PaidFrom: r.account?.name ?? "",
        Amount: r.amount,
        Reference: r.reference ?? "",
        EnteredBy: r.recordedBy?.name ?? "",
        Notes: r.notes ?? "",
      }))
    );
  }

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

  // The matrix is fetched once per page load; gating on `loaded` avoids a flash
  // of "no permission" before it arrives.
  if (permsLoaded && !can("VIEW_EXPENSES")) {
    return (
      <div className="p-6">
        <p className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_noPermissionMsg")}</p>
      </div>
    );
  }

  if (showCategories) {
    return (
      <CategoryManager
        branchId={branchId}
        categories={categories}
        onChanged={loadReference}
        onBack={() => { setShowCategories(false); loadRows(); }}
      />
    );
  }

  const rangeTotal = filteredAmount;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Receipt className="w-6 h-6 text-gray-600" /> {t("expenses_title")}
          </h1>
          <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
            {t("expenses_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button onClick={() => setShowCategories(true)}
            className={`flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
            <Tags className="w-4 h-4" /> {t("expenses_manageCategories")}
          </button>
          {/* Two separate buttons, not one form with a kind dropdown: they are
              gated on different permissions, and a manager who may record the
              electricity bill should not see a profit-withdrawal option at all. */}
          {can("WITHDRAW_PROFIT") && (
            <button onClick={() => openCreate("PROFIT_WITHDRAWAL")}
              className={`flex items-center gap-2 px-3 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-lg text-sm hover:bg-amber-100 ${isUrdu ? "urdu-text" : ""}`}>
              <PiggyBank className="w-4 h-4" /> {t("expenses_withdrawProfit")}
            </button>
          )}
          {can("CREATE_EXPENSE") && (
            <button onClick={() => openCreate("EXPENSE")}
              className={`flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 ${isUrdu ? "urdu-text" : ""}`}>
              <Plus className="w-4 h-4" /> {t("expenses_addCost")}
            </button>
          )}
        </div>
      </div>

      {/* Summary tiles for the range. Costs and withdrawals stay in separate
          columns on purpose — only the first reduces profit. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <SummaryTile
          label={t("expenses_totalCosts")} icon={ArrowDownCircle} tone="text-rose-500"
          value={formatCurrency(totals?.expenses ?? 0)}
          sub={`${totals?.count ?? 0} ${t("expenses_entriesCount")}`}
        />
        <SummaryTile
          label={t("expenses_unpaidCosts")} icon={Clock} tone="text-orange-500"
          value={formatCurrency(totals?.unpaidExpenses ?? 0)}
          sub={t("expenses_stillOwed")}
        />
        <SummaryTile
          label={t("expenses_withdrawals")} icon={PiggyBank} tone="text-amber-500"
          value={formatCurrency(totals?.withdrawals ?? 0)}
          sub={`${t("expenses_netWithdrawn")}: ${formatCurrency((totals?.withdrawals ?? 0) - (totals?.injections ?? 0))}`}
        />
        <SummaryTile
          label={t("expenses_injections")} icon={ArrowUpCircle} tone="text-blue-500"
          value={formatCurrency(totals?.injections ?? 0)}
        />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
            {t("expenses_dateRange")}
          </label>
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
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_kind")}</label>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as "" | Kind)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
            <option value="">{t("expenses_allKinds")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(`expenses_kind_${k}` as never)}</option>)}
          </select>
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_category")}</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
            <option value="">{t("expenses_allCategories")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_status")}</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | Status)}
            className={`border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
            <option value="">{t("expenses_allStatuses")}</option>
            <option value="PAID">{t("expenses_status_PAID")}</option>
            <option value="UNPAID">{t("expenses_status_UNPAID")}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className={`block text-xs font-medium text-gray-500 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("search")}</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("expenses_searchPlaceholder")}
            className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ${isUrdu ? "urdu-text" : ""}`} />
        </div>
        <button onClick={exportRows} disabled={total === 0}
          className={`flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}>
          <Download className="w-4 h-4" /> {t("export")}
        </button>
      </div>

      {/* List */}
      <div className={`bg-white border border-gray-200 rounded-xl overflow-hidden transition-opacity ${loading ? "opacity-50" : ""}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_date")}</th>
                <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_titleCol")}</th>
                <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_payee")}</th>
                <th className={`px-3 py-2.5 text-left font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_paidFrom")}</th>
                <th className={`px-3 py-2.5 text-right font-medium ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_amount")}</th>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => {
                const actions: ActionMenuItem[] = [];
                const editable = r.kind === "EXPENSE" ? can("EDIT_EXPENSE") : can("WITHDRAW_PROFIT");
                const deletable = r.kind === "EXPENSE" ? can("DELETE_EXPENSE") : can("WITHDRAW_PROFIT");
                const payable = r.kind === "EXPENSE" ? can("CREATE_EXPENSE") : can("WITHDRAW_PROFIT");

                if (r.status === "UNPAID" && payable) {
                  actions.push({
                    key: "pay", label: t("expenses_markPaid"), icon: CheckCircle2,
                    tone: "success", onSelect: () => openPay(r),
                  });
                }
                if (editable) {
                  actions.push({ key: "edit", label: t("expenses_edit"), icon: Pencil, onSelect: () => openEdit(r) });
                }
                if (deletable) {
                  actions.push({
                    key: "delete", label: t("expenses_delete"), icon: Trash2,
                    tone: "danger", onSelect: () => deleteRow(r),
                  });
                }

                return (
                  <tr key={r.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{formatDate(r.date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-800">{r.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${KIND_STYLES[r.kind]} ${isUrdu ? "urdu-text" : ""}`}>
                          {t(`expenses_kind_${r.kind}` as never)}
                        </span>
                        {r.category && (
                          <span className="text-[11px] text-gray-500">{r.category.name}</span>
                        )}
                        {r.reference && (
                          <span className="text-[11px] text-gray-400">· {r.reference}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {r.payeeName || r.payeeUser?.name || "—"}
                      {r.recordedBy && (
                        <div className={`text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                          {t("expenses_recordedBy")}: {r.recordedBy.name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.status === "UNPAID" ? (
                        <span className={`inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 ${isUrdu ? "urdu-text" : ""}`}>
                          <Clock className="w-3 h-3" /> {t("expenses_status_UNPAID")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                          {r.paymentMethod === "BANK"
                            ? <Landmark className="w-3.5 h-3.5 text-blue-500" />
                            : <Wallet className="w-3.5 h-3.5 text-teal-500" />}
                          {r.account?.name ?? (r.paymentMethod === "BANK" ? t("expenses_bank") : t("expenses_cash"))}
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${r.kind === "CAPITAL_INJECTION" ? "text-blue-700" : "text-gray-800"}`}>
                      {r.kind === "CAPITAL_INJECTION" ? "+" : "−"}{formatCurrency(r.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      {actions.length > 0 && <ActionMenu items={actions} isUrdu={isUrdu} />}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className={`px-3 py-12 text-center text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("expenses_none")}
                  </td>
                </tr>
              )}
            </tbody>
            {total > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={4} className={`px-3 py-2.5 text-right text-xs font-medium text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("expenses_rangeTotal")}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums text-gray-800">
                    {formatCurrency(rangeTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <p className={`mt-3 text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
        {t("expenses_accrualNote")} {t("expenses_withdrawalNote")}
      </p>

      {/* Add / edit modal */}
      {form && (
        <ExpenseFormModal
          form={form}
          setForm={setForm}
          categories={activeCategories}
          bankAccounts={bankAccounts}
          payees={payees}
          saving={saving}
          onCancel={() => setForm(null)}
          onSave={saveForm}
        />
      )}

      {/* Settle modal */}
      {payFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-3">
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_payTitle")}</h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="text-sm font-medium text-gray-800">{payFor.title}</div>
              <div className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(payFor.amount)}</div>
            </div>

            <div>
              <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_paidWith")}</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <MethodButton active={payMethod === "CASH"} onClick={() => setPayMethod("CASH")}
                  icon={Wallet} label={t("expenses_cash")} isUrdu={isUrdu} />
                <MethodButton active={payMethod === "BANK"} onClick={() => setPayMethod("BANK")}
                  icon={Landmark} label={t("expenses_bank")} isUrdu={isUrdu} />
              </div>
            </div>

            {payMethod === "BANK" && (
              <div>
                <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_bankAccount")}</label>
                <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white ${isUrdu ? "urdu-text" : ""}`}>
                  <option value="">{t("expenses_selectBankAccount")}</option>
                  {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {bankAccounts.length === 0 && (
                  <p className={`text-[11px] text-amber-700 mt-1 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_noBankAccounts")}</p>
                )}
              </div>
            )}

            <div>
              <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_paidOn")}</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setPayFor(null)}
                className={`flex-1 border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
                {t("cancel")}
              </button>
              <button onClick={confirmPay} disabled={paying}
                className={`flex-1 bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
                {t("expenses_confirmPay")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function SummaryTile({
  label, value, sub, icon: Icon, tone,
}: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; tone: string;
}) {
  const { isUrdu } = useI18n();
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{label}</span>
        <Icon className={`w-4 h-4 ${tone}`} />
      </div>
      <div className="text-xl font-bold text-gray-800 tabular-nums">{value}</div>
      {sub && <div className={`text-[11px] text-gray-400 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>{sub}</div>}
    </div>
  );
}

function MethodButton({
  active, onClick, icon: Icon, label, isUrdu,
}: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>; label: string; isUrdu?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active ? "border-teal-500 bg-teal-50 text-teal-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"
      } ${isUrdu ? "urdu-text" : ""}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

// ─── Add / edit form ──────────────────────────────────────────────────────────

/**
 * One modal for all three kinds, because the fields are 90% shared. What
 * changes with the kind:
 *
 * - a cost picks a category; a drawing has none (it isn't a heading of running
 *   cost) and instead picks a direction — out of the shop, or back into it;
 * - a cost can be recorded unpaid; a drawing cannot. "I took money out but
 *   haven't taken it yet" isn't a state that means anything.
 */
function ExpenseFormModal({
  form, setForm, categories, bankAccounts, payees, saving, onCancel, onSave,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
  categories: Category[];
  bankAccounts: AccountOption[];
  payees: Payee[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const isCost = form.kind === "EXPENSE";
  const set = (patch: Partial<FormState>) =>
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const heading = form.id
    ? t(isCost ? "expenses_editCost" : "expenses_editWithdrawal")
    : t(isCost ? "expenses_newCost" : "expenses_newWithdrawal");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-lg p-5 space-y-3 my-8">
        <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>{heading}</h3>

        {/* Direction — withdrawals only. A cost has only one direction. */}
        {!isCost && (
          <div>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_direction")}</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <MethodButton active={form.kind === "PROFIT_WITHDRAWAL"} onClick={() => set({ kind: "PROFIT_WITHDRAWAL" })}
                icon={ArrowDownCircle} label={t("expenses_directionOut")} isUrdu={isUrdu} />
              <MethodButton active={form.kind === "CAPITAL_INJECTION"} onClick={() => set({ kind: "CAPITAL_INJECTION" })}
                icon={ArrowUpCircle} label={t("expenses_directionIn")} isUrdu={isUrdu} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_titleLabel")}</label>
            <input value={form.title} onChange={(e) => set({ title: e.target.value })}
              placeholder={t("expenses_titlePlaceholder")}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
          </div>

          {isCost && (
            <div>
              <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_category")}</label>
              <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}
                className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white ${isUrdu ? "urdu-text" : ""}`}>
                <option value="">{t("expenses_selectCategory")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className={isCost ? "" : "col-span-1"}>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_amountRs")}</label>
            <NumberInput value={form.amount} onChange={(amount) => set({ amount })} blankZero
              transform={(n) => Math.max(0, n)} placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 text-right tabular-nums" />
          </div>

          <div>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_date")}</label>
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>

          <div>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_reference")}</label>
            <input value={form.reference} onChange={(e) => set({ reference: e.target.value })}
              placeholder={t("expenses_referencePlaceholder")}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
          </div>

          {/* Payee: a staff member, a typed name, or both. Picking a staff
              member fills the name box so the row still reads correctly if that
              user is ever removed. */}
          <div>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_payeeStaff")}</label>
            <select value={form.payeeUserId}
              onChange={(e) => {
                const id = e.target.value;
                const picked = payees.find((p) => p.id === id);
                set({ payeeUserId: id, payeeName: picked ? picked.name : form.payeeName });
              }}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white ${isUrdu ? "urdu-text" : ""}`}>
              <option value="">{t("expenses_payeeStaffNone")}</option>
              {payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_payeeName")}</label>
            <input value={form.payeeName} onChange={(e) => set({ payeeName: e.target.value })}
              placeholder={t("expenses_payeeNamePlaceholder")}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
          </div>

          <p className={`col-span-2 -mt-1 text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
            {t("expenses_payeeHint")}
          </p>

          {/* Payment */}
          <div className="col-span-2 border-t border-gray-100 pt-3">
            <label className={`text-xs font-medium text-gray-600 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_payment")}</label>

            {isCost && (
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <MethodButton active={form.status === "PAID"} onClick={() => set({ status: "PAID" })}
                  icon={CheckCircle2} label={t("expenses_payNow")} isUrdu={isUrdu} />
                <MethodButton active={form.status === "UNPAID"} onClick={() => set({ status: "UNPAID" })}
                  icon={Clock} label={t("expenses_payLater")} isUrdu={isUrdu} />
              </div>
            )}

            {form.status === "UNPAID" ? (
              <p className={`mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 ${isUrdu ? "urdu-text" : ""}`}>
                {t("expenses_payLaterHint")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <MethodButton active={form.paymentMethod === "CASH"} onClick={() => set({ paymentMethod: "CASH" })}
                    icon={Wallet} label={t("expenses_cash")} isUrdu={isUrdu} />
                  <MethodButton active={form.paymentMethod === "BANK"} onClick={() => set({ paymentMethod: "BANK" })}
                    icon={Landmark} label={t("expenses_bank")} isUrdu={isUrdu} />
                </div>
                {form.paymentMethod === "BANK" && (
                  <div className="mt-2">
                    <select value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white ${isUrdu ? "urdu-text" : ""}`}>
                      <option value="">{t("expenses_selectBankAccount")}</option>
                      {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {bankAccounts.length === 0 && (
                      <p className={`text-[11px] text-amber-700 mt-1 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_noBankAccounts")}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="col-span-2">
            <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_notes")}</label>
            <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
          </div>
        </div>

        {!isCost && (
          <p className={`text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_withdrawalNote")}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel}
            className={`flex-1 border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
            {t("cancel")}
          </button>
          <button onClick={onSave} disabled={saving}
            className={`flex-1 bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Category manager ─────────────────────────────────────────────────────────

/**
 * The second view of this route. Deactivating rather than deleting is the
 * normal move once anything is booked under a heading — the API refuses the
 * delete in that case and says so, because nulling `categoryId` would quietly
 * drop that spending out of every per-category total.
 */
function CategoryManager({
  branchId, categories, onChanged, onBack,
}: {
  branchId?: string;
  categories: Category[];
  onChanged: () => void;
  onBack: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const { can } = usePermissions();
  const manage = can("MANAGE_EXPENSE_CATEGORIES");

  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setNote("");
    setShowForm(true);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setName(c.name);
    setNote(c.note ?? "");
    setShowForm(true);
  }

  async function save() {
    if (!name.trim()) return toast.error(t("expenses_categoryName"));
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/expenses/categories/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, note }),
          })
        : await fetch("/api/expenses/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId, name, note }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(t("expenses_categorySavedMsg"));
      setShowForm(false);
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("expenses_actionFailedMsg"), { duration: 6000 });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Category) {
    const res = await fetch(`/api/expenses/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return toast.error(d.error ?? t("expenses_actionFailedMsg"));
    }
    onChanged();
  }

  async function remove(c: Category) {
    if (!confirm(t("expenses_confirmDeleteCategory"))) return;
    const res = await fetch(`/api/expenses/categories/${c.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    // The 409 explains that costs are booked under it and it should be
    // deactivated instead — worth showing in full, not flattened.
    if (!res.ok) return toast.error(data.error ?? t("expenses_actionFailedMsg"), { duration: 6000 });
    toast.success(t("expenses_categoryDeletedMsg"));
    onChanged();
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <button onClick={onBack}
            className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-2 ${isUrdu ? "urdu-text" : ""}`}>
            <ArrowLeft className="w-4 h-4" /> {t("expenses_backToCosts")}
          </button>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Tags className="w-6 h-6 text-gray-600" /> {t("expenses_categoriesTitle")}
          </h1>
        </div>
        {manage && (
          <button onClick={openCreate}
            className={`flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 shrink-0 ${isUrdu ? "urdu-text" : ""}`}>
            <Plus className="w-4 h-4" /> {t("expenses_addCategory")}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {categories.map((c) => {
          const actions: ActionMenuItem[] = [];
          if (manage) {
            actions.push({ key: "edit", label: t("expenses_edit"), icon: Pencil, onSelect: () => openEdit(c) });
            actions.push({
              key: "toggle",
              label: c.isActive ? t("expenses_deactivate") : t("expenses_activate"),
              icon: c.isActive ? ToggleLeft : ToggleRight,
              tone: c.isActive ? "warning" : "success",
              onSelect: () => toggle(c),
            });
            actions.push({ key: "delete", label: t("expenses_delete"), icon: Trash2, tone: "danger", onSelect: () => remove(c) });
          }

          return (
            <div key={c.id}
              className={`bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${!c.isActive ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <div className="font-medium text-gray-800 text-sm flex items-center gap-2">
                  <span className="truncate">{c.name}</span>
                  {!c.isActive && (
                    <span className={`text-[10px] uppercase tracking-wide bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded ${isUrdu ? "urdu-text" : ""}`}>
                      {t("expenses_inactive")}
                    </span>
                  )}
                </div>
                <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
                  {c.note ? `${c.note} · ` : ""}{c.expenseCount} {t("expenses_categoryUsage")}
                </div>
              </div>
              {actions.length > 0 && <ActionMenu items={actions} isUrdu={isUrdu} />}
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-3">
            <h3 className={`font-semibold text-gray-800 ${isUrdu ? "urdu-text" : ""}`}>
              {t(editing ? "expenses_editCategory" : "expenses_newCategory")}
            </h3>
            <div>
              <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_categoryName")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder={t("expenses_categoryNamePlaceholder")}
                className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
            </div>
            <div>
              <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("expenses_categoryNote")}</label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={t("expenses_categoryNotePlaceholder")}
                className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 ${isUrdu ? "urdu-text" : ""}`} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowForm(false); setEditing(null); }}
                className={`flex-1 border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
                {t("cancel")}
              </button>
              <button onClick={save} disabled={saving}
                className={`flex-1 bg-teal-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
                {t("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
