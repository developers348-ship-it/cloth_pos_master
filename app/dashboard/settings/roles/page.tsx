"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Shield, ChevronLeft, ChevronDown, ChevronUp, Save,
  RefreshCw, RotateCcw, Check, X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useI18n } from "@/lib/i18n";

// ─── Permission groups ────────────────────────────────────────────────────────
// NOTE: `label` fields below hold translation keys (looked up via t()),
// not literal display text. See lib/translations/roles.ts.

const PERMISSION_GROUPS = [
  {
    label: "roles_group_userManagement",
    permissions: [
      { key: "VIEW_USERS",      label: "roles_perm_viewUsers" },
      { key: "CREATE_USER",     label: "roles_perm_createUser" },
      { key: "EDIT_USER",       label: "roles_perm_editUser" },
      { key: "DELETE_USER",     label: "roles_perm_deleteUser" },
      { key: "ASSIGN_ROLES",    label: "roles_perm_assignRoles" },
      { key: "IMPERSONATE_USER", label: "roles_perm_impersonateUser" },
    ],
  },
  {
    label: "roles_group_itemsCatalog",
    permissions: [
      { key: "VIEW_ITEMS",           label: "roles_perm_viewItems" },
      { key: "ADD_ITEM",             label: "roles_perm_addItem" },
      { key: "EDIT_ITEM",            label: "roles_perm_editItem" },
      { key: "DELETE_ITEM",          label: "roles_perm_deleteItem" },
      { key: "VIEW_PURCHASE_PRICE",  label: "roles_perm_viewPurchasePrice" },
      { key: "EDIT_SALE_PRICE",      label: "roles_perm_editSalePrice" },
      { key: "PRINT_BARCODE",        label: "roles_perm_printBarcode" },
    ],
  },
  {
    label: "roles_group_parties",
    permissions: [
      { key: "VIEW_PARTIES",     label: "roles_perm_viewParties" },
      { key: "ADD_PARTY",        label: "roles_perm_addParty" },
      { key: "EDIT_PARTY",       label: "roles_perm_editParty" },
      { key: "DELETE_PARTY",     label: "roles_perm_deleteParty" },
      { key: "SET_CREDIT_LIMIT", label: "roles_perm_setCreditLimit" },
      { key: "VIEW_PARTY_LEDGER",label: "roles_perm_viewPartyLedger" },
    ],
  },
  {
    label: "roles_group_sales",
    permissions: [
      { key: "CREATE_INVOICE",        label: "roles_perm_createInvoice" },
      { key: "DELETE_INVOICE",        label: "roles_perm_deleteInvoice" },
      { key: "APPLY_ITEM_DISCOUNT",   label: "roles_perm_applyItemDiscount" },
      { key: "APPLY_PACKAGE_DISCOUNT",label: "roles_perm_applyPackageDiscount" },
      { key: "OVERRIDE_SALE_PRICE",   label: "roles_perm_overrideSalePrice" },
      { key: "PROCESS_SALE_RETURN",   label: "roles_perm_processSaleReturn" },
      { key: "HOLD_INVOICE",          label: "roles_perm_holdInvoice" },
      { key: "PRINT_RECEIPT",         label: "roles_perm_printReceipt" },
      { key: "VOID_INVOICE",          label: "roles_perm_voidInvoice" },
      { key: "APPLY_STORE_CREDIT",    label: "roles_perm_applyStoreCredit" },
      { key: "MARK_INVOICE_PAID",     label: "roles_perm_markInvoicePaid" },
      { key: "MARK_INVOICE_UNPAID",   label: "roles_perm_markInvoiceUnpaid" },
      { key: "CHANGE_INVOICE_CUSTOMER", label: "roles_perm_changeInvoiceCustomer" },
    ],
  },
  {
    label: "roles_group_purchasesGrn",
    permissions: [
      { key: "CREATE_GRN", label: "roles_perm_createGrn" },
      { key: "EDIT_GRN",   label: "roles_perm_editGrn" },
      { key: "DELETE_GRN", label: "roles_perm_deleteGrn" },
      { key: "PRINT_GRN",  label: "roles_perm_printGrn" },
    ],
  },
  {
    label: "roles_group_inventory",
    permissions: [
      { key: "VIEW_STOCK",     label: "roles_perm_viewStock" },
      { key: "ADJUST_STOCK",   label: "roles_perm_adjustStock" },
    ],
  },
  {
    label: "roles_group_ledgerAccounts",
    permissions: [
      { key: "VIEW_DAYBOOK",     label: "roles_perm_viewDaybook" },
      { key: "RECORD_PAYMENT",   label: "roles_perm_recordPayment" },
      { key: "RECORD_RECOVERY",  label: "roles_perm_recordRecovery" },
      { key: "VIEW_OUTSTANDING", label: "roles_perm_viewOutstanding" },
      { key: "COLLECT_INSTALLMENT", label: "roles_perm_collectInstallment" },
    ],
  },
  {
    label: "roles_group_bankAccounts",
    permissions: [
      { key: "VIEW_ACCOUNTS",       label: "roles_perm_viewAccounts" },
      { key: "VIEW_ACCOUNT_LEDGER", label: "roles_perm_viewAccountLedger" },
      { key: "CREATE_ACCOUNT",      label: "roles_perm_createAccount" },
      { key: "EDIT_ACCOUNT",        label: "roles_perm_editAccount" },
      { key: "DELETE_ACCOUNT",      label: "roles_perm_deleteAccount" },
      { key: "TRANSFER_FUNDS",      label: "roles_perm_transferFunds" },
    ],
  },
  {
    label: "roles_group_costManagement",
    permissions: [
      { key: "VIEW_EXPENSES",             label: "roles_perm_viewExpenses" },
      { key: "CREATE_EXPENSE",            label: "roles_perm_createExpense" },
      { key: "EDIT_EXPENSE",              label: "roles_perm_editExpense" },
      { key: "DELETE_EXPENSE",            label: "roles_perm_deleteExpense" },
      { key: "WITHDRAW_PROFIT",           label: "roles_perm_withdrawProfit" },
      { key: "MANAGE_EXPENSE_CATEGORIES", label: "roles_perm_manageExpenseCategories" },
    ],
  },
  {
    label: "roles_group_reports",
    permissions: [
      { key: "VIEW_SALES_REPORT",     label: "roles_perm_viewSalesReport" },
      { key: "VIEW_CASH_REPORT",      label: "roles_perm_viewCashReport" },
      { key: "VIEW_PURCHASE_REPORT",  label: "roles_perm_viewPurchaseReport" },
      { key: "EXPORT_REPORT",         label: "roles_perm_exportReport" },
    ],
  },
  {
    label: "settings",
    permissions: [
      { key: "EDIT_STORE_SETTINGS", label: "roles_perm_editStoreSettings" },
      { key: "DATABASE_BACKUP",     label: "roles_perm_databaseBackup" },
      { key: "DATABASE_RESTORE",    label: "roles_perm_databaseRestore" },
      { key: "CLEAR_TEST_DATA",     label: "roles_perm_clearTestData" },
      { key: "SYSTEM_CONFIG",       label: "roles_perm_systemConfig" },
    ],
  },
] as const;

// ─── Role meta ────────────────────────────────────────────────────────────────
// `label` holds a translation key (looked up via t()), `key` remains the
// literal role enum used for permission-matching logic — do not translate it.

const ROLES = [
  { key: "SUPER_ADMIN", label: "roles_role_superAdmin", badgeBg: "bg-purple-600", ring: "ring-purple-300", locked: true },
  { key: "ADMIN",       label: "roles_role_admin",      badgeBg: "bg-blue-600",   ring: "ring-blue-300",   locked: false },
  { key: "MANAGER",     label: "roles_role_manager",    badgeBg: "bg-teal-600",   ring: "ring-teal-300",   locked: false },
  { key: "CASHIER",     label: "roles_role_cashier",    badgeBg: "bg-green-600",  ring: "ring-green-300",  locked: false },
  { key: "ACCOUNTANT",  label: "roles_role_accountant", badgeBg: "bg-amber-600",  ring: "ring-amber-300",  locked: false },
] as const;

type PermissionsMap = Record<string, string[]>;

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked, onChange, disabled,
}: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      title={disabled ? t("roles_toggleLockedTitle") : checked ? t("roles_toggleRevokeTitle") : t("roles_toggleGrantTitle")}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none
        ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
        ${checked ? "bg-teal-500" : "bg-gray-300"}
      `}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform
          ${checked ? "translate-x-4.5" : "translate-x-0.5"}
        `}
      />
    </button>
  );
}

// ─── Card View ────────────────────────────────────────────────────────────────

function RoleCard({
  role, permissions, canEdit, onChange,
}: {
  role: (typeof ROLES)[number];
  permissions: PermissionsMap;
  canEdit: boolean;
  onChange: (permKey: string, roleKey: string, granted: boolean) => void;
}) {
  const { t, isUrdu } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const total = Object.keys(permissions).length;
  const granted = Object.values(permissions).filter((r) => r.includes(role.key)).length;
  const pct = total > 0 ? Math.round((granted / total) * 100) : 0;

  const roleDescriptions: Record<string, string> = {
    SUPER_ADMIN: t("roles_desc_superAdmin"),
    ADMIN: t("roles_desc_admin"),
    MANAGER: t("roles_desc_manager"),
    CASHIER: t("roles_desc_cashier"),
    ACCOUNTANT: t("roles_desc_accountant"),
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className={`${role.badgeBg} px-5 py-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className={`font-bold text-white text-base ${isUrdu ? "urdu-text" : ""}`}>{t(role.label)}</div>
              <div className="text-white/70 text-xs font-mono">{role.key}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{granted}</div>
            <div className={`text-white/70 text-xs ${isUrdu ? "urdu-text" : ""}`}>/ {total} {t("roles_perms")}</div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div className={`text-white/60 text-xs mt-1 ${isUrdu ? "urdu-text" : ""}`}>{pct}% {t("roles_access")}</div>
      </div>

      {/* Description */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <p className={`text-xs text-gray-500 leading-relaxed ${isUrdu ? "urdu-text" : ""}`}>{roleDescriptions[role.key]}</p>
        {role.locked && (
          <span className={`inline-flex items-center gap-1 mt-1.5 text-[10px] text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 ${isUrdu ? "urdu-text" : ""}`}>
            🔒 {t("roles_lockedFullAccess")}
          </span>
        )}
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <span className={isUrdu ? "urdu-text" : ""}>{expanded ? t("roles_hidePermissions") : t("roles_showPermissions")}</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {/* Permission list */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4 max-h-96 overflow-y-auto">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label}>
              <div className={`text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 ${isUrdu ? "urdu-text" : ""}`}>
                {t(group.label)}
              </div>
              <div className="space-y-2">
                {group.permissions.map((perm) => {
                  const isGranted = permissions[perm.key]?.includes(role.key) ?? false;
                  const isLocked = role.locked;
                  return (
                    <div key={perm.key} className="flex items-center justify-between gap-3">
                      <span className={`text-xs ${isGranted ? "text-gray-700" : "text-gray-400"} ${isUrdu ? "urdu-text" : ""}`}>
                        {t(perm.label)}
                      </span>
                      {canEdit ? (
                        <ToggleSwitch
                          checked={isGranted}
                          onChange={() => onChange(perm.key, role.key, !isGranted)}
                          disabled={isLocked}
                        />
                      ) : (
                        isGranted
                          ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                          : <X className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t, isUrdu } = useI18n();
  const userRole = (session?.user as any)?.role ?? "";
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const canEdit = isSuperAdmin;

  const [view, setView] = useState<"cards" | "matrix">("matrix");
  const [permissions, setPermissions] = useState<PermissionsMap>({});
  const [original, setOriginal] = useState<PermissionsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [dirty, setDirty] = useState(false);

  // ── Load permissions from API ──
  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/permissions");
      const data = await res.json();
      setPermissions(data.permissions);
      setOriginal(data.permissions);
      setIsDefault(data.isDefault);
      setDirty(false);
    } catch {
      toast.error(t("roles_failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (status === "authenticated") loadPermissions();
  }, [status, loadPermissions]);

  // ── Guard ──
  // 1. Still fetching session → show spinner
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <span className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</span>
        </div>
      </div>
    );
  }
  // 2. Session confirmed but role is not admin → redirect
  if (status === "authenticated" && userRole && !["SUPER_ADMIN", "ADMIN"].includes(userRole)) {
    router.replace("/dashboard/settings");
    return null;
  }

  // ── Toggle handler ──
  function handleToggle(permKey: string, roleKey: string, grant: boolean) {
    setPermissions((prev) => {
      const current = prev[permKey] ?? [];
      const next = grant
        ? [...new Set([...current, roleKey])]
        : current.filter((r) => r !== roleKey);
      return { ...prev, [permKey]: next };
    });
    setDirty(true);
  }

  // ── Save ──
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setPermissions(data.permissions);
      setOriginal(data.permissions);
      setIsDefault(false);
      setDirty(false);
      toast.success(t("roles_savedSuccess"));
    } catch {
      toast.error(t("roles_failedSave"));
    } finally {
      setSaving(false);
    }
  }

  // ── Reset to defaults ──
  async function handleReset() {
    if (!confirm(t("roles_confirmReset"))) return;
    setSaving(true);
    try {
      // Delete the setting so API falls back to defaults
      await fetch("/api/settings/permissions", { method: "DELETE" });
      await loadPermissions();
      toast.success(t("roles_resetSuccess"));
    } catch {
      // If DELETE not supported, just reload
      await loadPermissions();
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setPermissions(original);
    setDirty(false);
  }

  const allPermKeys = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title={t("roles_backToSettings")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
              <Shield className="w-6 h-6 text-teal-600" />
              {t("roles_title")}
            </h1>
            <p className={`text-sm text-gray-500 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
              {canEdit
                ? t("roles_subtitleEditable")
                : t("roles_subtitleReadOnly")}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {canEdit && !isDefault && (
            <button
              onClick={handleReset}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 ${isUrdu ? "urdu-text" : ""}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("roles_resetDefaults")}
            </button>
          )}
          {canEdit && dirty && (
            <button
              onClick={handleDiscard}
              className={`px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}
            >
              {t("roles_discard")}
            </button>
          )}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className={`flex items-center gap-2 px-5 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors ${isUrdu ? "urdu-text" : ""}`}
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? t("roles_saving") : t("roles_saveChanges")}
            </button>
          )}
        </div>
      </div>

      {/* Unsaved changes banner */}
      {dirty && (
        <div className={`mb-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-amber-800 ${isUrdu ? "urdu-text" : ""}`}>
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
          {t("roles_unsavedPrefix")} <strong className="mx-1">{t("roles_saveChanges")}</strong> {t("roles_unsavedSuffix")}
        </div>
      )}

      {/* View toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView("matrix")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isUrdu ? "urdu-text" : ""} ${
            view === "matrix"
              ? "bg-teal-600 text-white shadow-sm"
              : "bg-white border border-gray-200 text-gray-600 hover:border-teal-300"
          }`}
        >
          {t("roles_permissionMatrix")}
        </button>
        <button
          onClick={() => setView("cards")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isUrdu ? "urdu-text" : ""} ${
            view === "cards"
              ? "bg-teal-600 text-white shadow-sm"
              : "bg-white border border-gray-200 text-gray-600 hover:border-teal-300"
          }`}
        >
          {t("roles_roleCards")}
        </button>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <span className={`text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("roles_loadingPermissions")}</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── MATRIX VIEW ──────────────────────────────────────────────── */}
          {view === "matrix" && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className={`text-left px-5 py-4 text-gray-500 font-medium text-xs uppercase tracking-wide min-w-[200px] sticky left-0 bg-gray-50 z-10 ${isUrdu ? "urdu-text" : ""}`}>
                        {t("roles_permissionCol")}
                      </th>
                      {ROLES.map((role) => (
                        <th key={role.key} className="px-4 py-4 text-center min-w-[120px]">
                          <div className="flex flex-col items-center gap-1.5">
                            <div className={`w-8 h-8 ${role.badgeBg} rounded-lg flex items-center justify-center`}>
                              <Shield className="w-4 h-4 text-white" />
                            </div>
                            <span className={`text-xs font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t(role.label)}</span>
                            {role.locked && (
                              <span className={`text-[9px] text-purple-500 bg-purple-50 border border-purple-200 rounded px-1 ${isUrdu ? "urdu-text" : ""}`}>
                                🔒 {t("roles_lockedBadge")}
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_GROUPS.map((group) => (
                      <>
                        {/* Group header */}
                        <tr key={`g-${group.label}`} className="bg-gray-50/80">
                          <td
                            colSpan={ROLES.length + 1}
                            className={`px-5 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest sticky left-0 bg-gray-50/80 ${isUrdu ? "urdu-text" : ""}`}
                          >
                            {t(group.label)}
                          </td>
                        </tr>

                        {/* Permission rows */}
                        {group.permissions.map((perm, pi) => (
                          <tr
                            key={perm.key}
                            className={`border-b border-gray-50 hover:bg-teal-50/30 transition-colors ${
                              pi % 2 === 0 ? "bg-white" : "bg-gray-50/20"
                            }`}
                          >
                            <td className={`px-5 py-3 text-gray-700 text-xs font-medium sticky left-0 bg-inherit ${isUrdu ? "urdu-text" : ""}`}>
                              {t(perm.label)}
                            </td>
                            {ROLES.map((role) => {
                              const isGranted = permissions[perm.key]?.includes(role.key) ?? false;
                              const isLocked = role.locked;
                              return (
                                <td key={role.key} className="px-4 py-3 text-center">
                                  {canEdit ? (
                                    <div className="flex justify-center">
                                      <ToggleSwitch
                                        checked={isGranted}
                                        onChange={() => handleToggle(perm.key, role.key, !isGranted)}
                                        disabled={isLocked}
                                      />
                                    </div>
                                  ) : (
                                    isGranted ? (
                                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100">
                                        <Check className="w-3.5 h-3.5 text-green-600" />
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100">
                                        <X className="w-3.5 h-3.5 text-gray-400" />
                                      </span>
                                    )
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </>
                    ))}

                    {/* Totals row */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <td className={`px-5 py-3 text-xs text-gray-600 uppercase tracking-wide sticky left-0 bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
                        {t("roles_totalGranted")}
                      </td>
                      {ROLES.map((role) => {
                        const count = allPermKeys.filter(
                          (k) => permissions[k]?.includes(role.key)
                        ).length;
                        return (
                          <td key={role.key} className="px-4 py-3 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold text-white ${role.badgeBg}`}>
                              {count}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── CARDS VIEW ───────────────────────────────────────────────── */}
          {view === "cards" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {ROLES.map((role) => (
                <RoleCard
                  key={role.key}
                  role={role}
                  permissions={permissions}
                  canEdit={canEdit}
                  onChange={handleToggle}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Info note */}
      <div className={`mt-6 rounded-xl p-4 text-sm border ${
        canEdit
          ? "bg-blue-50 border-blue-200 text-blue-800"
          : "bg-amber-50 border-amber-200 text-amber-800"
      } ${isUrdu ? "urdu-text" : ""}`}>
        {canEdit ? (
          <>
            <strong>{t("roles_noteLabel")}</strong> {t("roles_noteEditablePart1")} <strong>{t("roles_saveChanges")}</strong>{t("roles_noteEditablePart2")}
          </>
        ) : (
          <>
            <strong>{t("roles_readOnlyLabel")}</strong> {t("roles_readOnlyNote")}
          </>
        )}
      </div>
    </div>
  );
}
