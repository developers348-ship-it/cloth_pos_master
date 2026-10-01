"use client";

import { Fragment, useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store-context";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import toast from "react-hot-toast";
import {
  Settings, Store, Save, RefreshCw, Download, Upload,
  Users, Smartphone, Globe, Shield, Eye, EyeOff, UserPlus,
  ToggleLeft, ToggleRight, Trash2, ChevronRight, Plus,
  Pencil, X, Check, Database, FileCode, FileJson, FileSpreadsheet,
  AlertTriangle, KeyRound, UserCog, Ruler,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { invalidateUnitConfig } from "@/lib/use-unit-config";
import type { Lang } from "@/lib/translations";
import { canImpersonateRole } from "@/lib/impersonation";
import type { TranslationKey } from "@/lib/translations";
import BrandingUpload, { BRANDING_LABELS, type BrandingAsset } from "@/components/settings/BrandingUpload";
import {
  clampReceiptFontSize, receiptFontScale,
  RECEIPT_FONT_SIZE_DEFAULT, RECEIPT_FONT_SIZE_MIN,
  RECEIPT_FONT_SIZE_MAX, RECEIPT_FONT_SIZE_PRESETS,
} from "@/lib/receipt-font";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One row of `GET /api/settings/branding` — see lib/branding.ts. */
type BrandingSummary = {
  asset: BrandingAsset;
  uploaded: boolean;
  mime: string | null;
  bytes: number;
  updatedAt: string | null;
};

type BranchForm = {
  name: string; address: string; city: string; phone: string;
  mobile: string; email: string; website: string;
  logoUrl: string; footerTerms: string;
  /**
   * Held as a string while being edited, like the unit lengths below: a
   * half-cleared field would otherwise become NaN and reset the live preview
   * mid-keystroke. Clamped to a number on save (and again by the API).
   */
  receiptFontSize: string;
};

type UserRow = {
  id: string; name: string; email: string;
  role: string; isActive: boolean;
  branches: { id: string; name: string }[];
};

const EMPTY_FORM: BranchForm = {
  name: "", address: "", city: "", phone: "", mobile: "",
  email: "", website: "", logoUrl: "", footerTerms: "",
  receiptFontSize: String(RECEIPT_FONT_SIZE_DEFAULT),
};

/**
 * The five roles, with both label lengths each one needs: `full` carries the
 * "— can do X" gloss for the add/edit forms, `short` is the bare name for the
 * badge in the list. Driving the `<select>`s off this instead of hand-written
 * `<option>` blocks is what keeps the add and edit forms offering the same set.
 */
const ROLES = [
  { id: "SUPER_ADMIN", short: "settings_roleSuperAdmin", full: "settings_roleSuperAdminFull" },
  { id: "ADMIN", short: "settings_roleAdmin", full: "settings_roleAdminFull" },
  { id: "MANAGER", short: "settings_roleManager", full: "settings_roleManagerFull" },
  { id: "CASHIER", short: "settings_roleCashier", full: "settings_roleCashierFull" },
  { id: "ACCOUNTANT", short: "settings_roleAccountant", full: "settings_roleAccountantFull" },
] as const;

/** The three backup artefacts, in the order the tab offers them. */
const BACKUP_FORMATS = [
  { id: "sql" as const, icon: FileCode, ext: ".sql", label: "settings_formatSql", hint: "settings_formatSqlHint" },
  { id: "json" as const, icon: FileJson, ext: ".json", label: "settings_formatJson", hint: "settings_formatJsonHint" },
  { id: "csv" as const, icon: FileSpreadsheet, ext: ".zip", label: "settings_formatCsv", hint: "settings_formatCsvHint" },
] as const;

type BackupFormat = (typeof BACKUP_FORMATS)[number]["id"];

type BackupSummary = { tableCount: number; rowCount: number };

type RestoreReport = { tablesRestored: number; rowsRestored: number; warnings: string[] };

/** Typed into the confirmation box before a restore will run. Matches the API. */
const RESTORE_PHRASE = "RESTORE";

// ─── Clear Data ───────────────────────────────────────────────────────────────

/** Mirrors lib/clear-data.ts's ClearGroupId — kept in sync by hand, like the API shapes elsewhere on this page. */
type ClearGroupId =
  | "auditLog" | "ledgerMoney" | "sales" | "purchases" | "expenses"
  | "stockAdjustments" | "dayBook" | "catalog" | "accounts" | "parties";

type ClearGroup = {
  id: ClearGroupId;
  labelKey: TranslationKey;
  requires: ClearGroupId[];
  tables: { table: string; rows: number }[];
  rowCount: number;
};

type ClearBackupEntry = {
  file: string; createdAt: string; sizeBytes: number;
  tableCount: number | null; rowCount: number | null;
};

/** Typed into the confirmation box before a clear will run. Matches the API. */
const CLEAR_PHRASE = "CLEAR";

/** Every group `id` transitively requires, including itself. */
function requiresClosure(id: ClearGroupId, groups: ClearGroup[]): Set<ClearGroupId> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Set<ClearGroupId>();
  const visit = (x: ClearGroupId) => {
    const g = byId.get(x);
    if (!g || out.has(x)) return;
    out.add(x);
    for (const req of g.requires) visit(req);
  };
  visit(id);
  return out;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const sessionUser = session?.user as
    | { branchId?: string; role?: string; actor?: unknown }
    | undefined;
  const branchId = sessionUser?.branchId;
  const sessionRole = sessionUser?.role;
  // Set only while this admin is already signed in as somebody else — one
  // impersonation at a time, so the button is withheld rather than chained.
  const impersonating = Boolean(sessionUser?.actor);
  // Tab visibility now follows the same matrix the API routes enforce, instead
  // of the inline role array it used before (which could drift from them).
  const { can } = usePermissions();
  const { store, refresh } = useStore();
  const { t, lang, setLang, isUrdu } = useI18n();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"store" | "receipt" | "pwa" | "backup" | "clearData" | "users" | "language" | "units">("store");

  // Gaz/metre lengths. Held as strings while being edited so a half-typed
  // "3" on the way to "36" doesn't momentarily become the live conversion.
  const [unitForm, setUnitForm] = useState({ inchesPerGaz: "36", inchesPerMtr: "40" });
  const [savingUnits, setSavingUnits] = useState(false);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Users state
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "CASHIER" });
  const [showPwd, setShowPwd] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  // Which row is expanded into its edit form, and the draft it holds. An empty
  // `password` means "leave the current one alone" — the API reads it the same way.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState({ name: "", email: "", role: "CASHIER", password: "" });
  const [showEditPwd, setShowEditPwd] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  /** Set while a row action is in flight, so its buttons can't be double-clicked. */
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  /** Reported by the API so the UI can refuse to let someone lock themselves out. */
  const [currentUserId, setCurrentUserId] = useState("");

  /**
   * Which branding images the store has of its own, so each tile knows whether
   * to offer Remove. The images themselves are never held here — every preview
   * is the server's own `/api/branding/:asset` rendering, so what is on screen
   * is what a browser tab will show.
   */
  const [brandingAssets, setBrandingAssets] = useState<BrandingSummary[]>([]);

  // Backup state
  const [exporting, setExporting] = useState<BackupFormat | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  // Clear Data state
  const [clearDataEnabled, setClearDataEnabled] = useState(false);
  const [clearGroups, setClearGroups] = useState<ClearGroup[]>([]);
  const [clearBackups, setClearBackups] = useState<ClearBackupEntry[]>([]);
  const [clearLoading, setClearLoading] = useState(false);
  const [selectedClearGroups, setSelectedClearGroups] = useState<Set<ClearGroupId>>(new Set());
  const [clearConfirmInput, setClearConfirmInput] = useState("");
  const [clearing, setClearing] = useState(false);
  const [restoringBackupFile, setRestoringBackupFile] = useState<string | null>(null);
  const [deletingBackupFile, setDeletingBackupFile] = useState<string | null>(null);

  // ── Populate form from store ──
  useEffect(() => {
    if (store) {
      setForm({
        name: store.name ?? "", address: store.address ?? "",
        city: store.city ?? "", phone: store.phone ?? "",
        mobile: store.mobile ?? "", email: store.email ?? "",
        website: store.website ?? "", logoUrl: store.logoUrl ?? "",
        footerTerms: store.footerTerms ?? "",
        receiptFontSize: String(store.receiptFontSize ?? RECEIPT_FONT_SIZE_DEFAULT),
      });
    }
  }, [store]);

  // ── Load users on tab switch ──
  useEffect(() => {
    if (activeTab === "users") loadUsers();
    // The summary is two dozen COUNT(*)s, so it is fetched when the tab opens
    // rather than on every settings visit.
    if (activeTab === "backup") loadBackupSummary();
    // Only the two tabs that show branding tiles need to know which images are
    // the store's own — it decides whether each tile offers Remove.
    if (activeTab === "store" || activeTab === "pwa") loadBranding();
    if (activeTab === "clearData") loadClearData();
  }, [activeTab]);

  // ── Clear Data: whether the tab is even offered ──
  // Checked once, independently of the tab being open, since the tab itself
  // must not appear in `tabs` when ENABLE_TEST_DATA_TOOLS is off — an
  // installer who turned the env var off for a client's copy expects the tab
  // to be gone, not present-but-disabled.
  const canClearData = can("CLEAR_TEST_DATA");
  useEffect(() => {
    if (!canClearData) { setClearDataEnabled(false); return; }
    let alive = true;
    fetch("/api/settings/clear-test-data?status=1")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (alive) setClearDataEnabled(Boolean(d.enabled)); })
      .catch(() => { if (alive) setClearDataEnabled(false); });
    return () => { alive = false; };
  }, [canClearData]);

  async function loadClearData() {
    setClearLoading(true);
    try {
      const res = await fetch("/api/settings/clear-test-data");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setClearDataEnabled(false); return; }
      setClearGroups(data.groups ?? []);
      setClearBackups(data.backups ?? []);
      setClearDataEnabled(true);
    } catch {
      toast.error(t("settings_clearDataLoadFailedMsg"));
    } finally {
      setClearLoading(false);
    }
  }

  function toggleClearGroup(id: ClearGroupId) {
    setSelectedClearGroups((prev) => {
      const next = new Set(prev);
      const lockedBy = clearGroups.some(
        (g) => g.id !== id && next.has(g.id) && requiresClosure(g.id, clearGroups).has(id)
      );
      if (next.has(id)) {
        // Can't be unchecked directly while something selected still needs it
        // — the row's checkbox is disabled for the same reason.
        if (lockedBy) return prev;
        next.delete(id);
      } else {
        for (const req of requiresClosure(id, clearGroups)) next.add(req);
      }
      return next;
    });
  }

  const selectedClearRowCount = clearGroups
    .filter((g) => selectedClearGroups.has(g.id))
    .reduce((sum, g) => sum + g.rowCount, 0);
  const selectedClearTableCount = clearGroups
    .filter((g) => selectedClearGroups.has(g.id))
    .reduce((sum, g) => sum + g.tables.length, 0);

  async function handleClearData() {
    if (selectedClearGroups.size === 0) { toast.error(t("settings_clearDataNoGroupsMsg")); return; }
    if (clearConfirmInput.trim().toUpperCase() !== CLEAR_PHRASE) {
      toast.error(t("settings_clearDataTypeClearMsg").replace("{phrase}", CLEAR_PHRASE));
      return;
    }
    if (!confirm(t("settings_clearDataConfirmNative"))) return;

    setClearing(true);
    try {
      const res = await fetch("/api/settings/clear-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: Array.from(selectedClearGroups), confirm: CLEAR_PHRASE }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);

      toast.success(
        t("settings_clearDataDoneMsg")
          .replace("{rows}", Number(data.rowsDeleted ?? 0).toLocaleString())
          .replace("{tables}", String(data.tables?.length ?? 0)),
        { duration: 6000 }
      );
      setClearConfirmInput("");
      setSelectedClearGroups(new Set());
      await loadClearData();
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : t("settings_clearDataFailedMsg"), { duration: 8000 });
    } finally {
      setClearing(false);
    }
  }

  async function handleRestoreClearBackup(file: string, createdAt: string) {
    const when = new Date(createdAt).toLocaleString();
    if (!confirm(t("settings_clearDataConfirmRestoreBackup").replace("{date}", when))) return;

    setRestoringBackupFile(file);
    try {
      const res = await fetch("/api/settings/clear-test-data/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, confirm: RESTORE_PHRASE }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);

      toast.success(
        t("settings_restoreDoneMsg")
          .replace("{tables}", String(data.tablesRestored))
          .replace("{rows}", Number(data.rowsRestored).toLocaleString()),
        { duration: 6000 }
      );
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : t("settings_restoreFailedMsg"), { duration: 8000 });
    } finally {
      setRestoringBackupFile(null);
    }
  }

  function downloadClearBackup(file: string) {
    const a = document.createElement("a");
    a.href = `/api/settings/clear-test-data/backups/${encodeURIComponent(file)}`;
    a.download = file;
    a.click();
  }

  async function handleDeleteClearBackup(file: string) {
    if (!confirm(t("settings_clearDataConfirmDeleteBackup"))) return;
    setDeletingBackupFile(file);
    try {
      const res = await fetch(`/api/settings/clear-test-data/backups/${encodeURIComponent(file)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setClearBackups((prev) => prev.filter((b) => b.file !== file));
      toast.success(t("settings_clearDataBackupDeletedMsg"));
    } catch {
      toast.error(t("settings_clearDataBackupDeleteFailedMsg"));
    } finally {
      setDeletingBackupFile(null);
    }
  }

  // ── Site-wide feature toggles (DB-backed on Branch, apply to everyone) ──
  const pwaEnabled = store?.pwaOfflineEnabled !== false;
  const languageSwitcherEnabled = store?.languageSwitcherEnabled !== false;

  async function toggleSiteSetting(field: "pwaOfflineEnabled" | "languageSwitcherEnabled", next: boolean) {
    try {
      const res = await fetch("/api/settings/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, [field]: next }),
      });
      if (!res.ok) throw new Error();
      await refresh();
      toast.success(t("settings_savedMsg"));
    } catch {
      toast.error(t("settings_saveFailedMsg"));
    }
  }

  // ── Which branding images are the store's own ──
  // Fetched by the tab-switch effect above, and again by each tile after an
  // upload or a Remove (its `onChanged`). A plain function, like `loadUsers` —
  // neither caller cares about its identity between renders.
  async function loadBranding() {
    if (!branchId) return;
    try {
      const res = await fetch(`/api/settings/branding?branchId=${branchId}`);
      const data = await res.json();
      setBrandingAssets(data.assets ?? []);
    } catch {
      // A failed summary only costs the Remove links; the tiles still render
      // from the serving route, so there is nothing worth a toast here.
    }
  }

  const hasOwn = (asset: BrandingAsset) =>
    brandingAssets.find((a) => a.asset === asset)?.uploaded ?? false;

  /**
   * A tile plus its labels. The four assets differ only in which key they use,
   * so the page builds them from one helper rather than four near-identical
   * blocks — which is how the old two-icon dropzone started drifting.
   */
  function brandingTile(asset: BrandingAsset, previewClassName?: string) {
    const keys = BRANDING_LABELS[asset];
    return (
      <BrandingUpload
        asset={asset}
        branchId={branchId ?? ""}
        label={t(keys.label)}
        hint={t(keys.hint)}
        uploaded={hasOwn(asset)}
        previewClassName={previewClassName}
        onChanged={loadBranding}
      />
    );
  }

  function set(key: keyof BranchForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // ── Save store settings ──
  async function handleSave() {
    if (!form.name.trim()) { toast.error(t("settings_storeNameRequiredMsg")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId, ...form,
          // The only non-text field on this form — sent as the number the
          // column holds, so an empty or out-of-range box saves the default
          // rather than failing the whole update.
          receiptFontSize: clampReceiptFontSize(form.receiptFontSize),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      await refresh();
      toast.success(t("settings_savedMsg"));
    } catch {
      toast.error(t("settings_saveFailedMsg"));
    } finally {
      setSaving(false);
    }
  }

  // ── User management ──

  /** Every user action funnels through here so no failure can pass silently. */
  async function callUsersApi(
    url: string,
    init: RequestInit,
    successMessage: string
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API explains *why* it refused — "only active Super Admin",
        // "email already exists" — and that reason is the useful message.
        toast.error(String(data.error ?? t("settings_genericFailedMsg")));
        return { ok: false, data };
      }
      toast.success(successMessage);
      return { ok: true, data };
    } catch {
      toast.error(t("settings_genericFailedMsg"));
      return { ok: false, data: {} };
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/settings/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setUsers(data.users ?? []);
      setCurrentUserId(data.currentUserId ?? "");
    } catch {
      toast.error(t("settings_loadUsersFailedMsg"));
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleAddUser() {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast.error(t("settings_userFieldsRequiredMsg"));
      return;
    }
    setAddingUser(true);
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newUser, branchId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? t("settings_genericFailedMsg"));
      }
      toast.success(t("settings_userCreatedMsg"));
      setNewUser({ name: "", email: "", password: "", role: "CASHIER" });
      setShowAddUser(false);
      loadUsers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAddingUser(false);
    }
  }

  function startEditUser(user: UserRow) {
    setEditingId(user.id);
    setShowEditPwd(false);
    setEditUser({ name: user.name, email: user.email, role: user.role, password: "" });
  }

  function cancelEditUser() {
    setEditingId(null);
    setEditUser({ name: "", email: "", role: "CASHIER", password: "" });
  }

  async function saveEditUser(user: UserRow) {
    if (!editUser.name.trim() || !editUser.email.trim()) {
      toast.error(t("settings_userFieldsRequiredMsg"));
      return;
    }

    // Only send what actually changed, so an untouched email can't collide with
    // itself and an empty password box leaves the current one in place.
    const patch: Record<string, unknown> = {};
    if (editUser.name.trim() !== user.name) patch.name = editUser.name.trim();
    if (editUser.email.trim().toLowerCase() !== user.email.toLowerCase()) patch.email = editUser.email.trim();
    if (editUser.role !== user.role) patch.role = editUser.role;
    if (editUser.password) patch.password = editUser.password;

    if (Object.keys(patch).length === 0) {
      cancelEditUser();
      return;
    }

    setSavingUser(true);
    const { ok } = await callUsersApi(
      `/api/settings/users/${user.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      t("settings_userUpdatedMsg")
    );
    setSavingUser(false);
    if (ok) {
      cancelEditUser();
      loadUsers();
    }
  }

  async function toggleUserActive(user: UserRow) {
    setBusyUserId(user.id);
    const { ok } = await callUsersApi(
      `/api/settings/users/${user.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      },
      user.isActive ? t("settings_userDeactivatedMsg") : t("settings_userActivatedMsg")
    );
    setBusyUserId(null);
    if (ok) loadUsers();
  }

  /**
   * A real delete. When the account is referenced by sales, purchases or audit
   * records the API refuses and says so; the only safe alternative is to
   * deactivate, which is offered right there rather than as a dead end.
   */
  async function deleteUser(user: UserRow) {
    if (!confirm(t("settings_confirmDeleteUser").replace("{name}", user.name))) return;

    setBusyUserId(user.id);
    const res = await fetch(`/api/settings/users/${user.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusyUserId(null);

    if (res.ok) {
      toast.success(t("settings_userDeletedMsg"));
      if (editingId === user.id) cancelEditUser();
      loadUsers();
      return;
    }

    if (data?.canDeactivate) {
      // The message names the exact records standing in the way; show it, then
      // offer the one action that does work — unless it is already done.
      toast.error(String(data.error), { duration: 8000 });
      if (user.isActive && confirm(t("settings_deactivateInsteadPrompt").replace("{name}", user.name))) {
        await toggleUserActive(user);
      }
      return;
    }

    toast.error(String(data?.error ?? t("settings_genericFailedMsg")));
  }

  /**
   * Why "sign in as" is greyed out on this row, or null when it is offered.
   * Mirrors what lib/impersonation.ts will decide on the server, so the button
   * and the endpoint behind it never disagree — and says which rule applies,
   * since "it's an admin too" and "the account is off" need different fixes.
   */
  function loginAsBlockedReason(user: UserRow): string | null {
    if (impersonating) return t("settings_loginAsWhileImpersonating");
    if (!user.isActive) return t("settings_loginAsInactive");
    if (!canImpersonateRole(sessionRole, user.role)) return t("settings_loginAsRoleTooHigh");
    return null;
  }

  function loginAsAllowed(user: UserRow): boolean {
    return loginAsBlockedReason(user) === null;
  }

  /**
   * Sign in as this member of staff — the admin sees the menu they see and
   * works under their name until they switch back from the banner at the top.
   *
   * The route validates and records it; `updateSession` is what actually swaps
   * the token, and the hard navigation afterwards is deliberate: every page
   * already rendered for the admin, and the permission matrix fetched once per
   * load, have to be rebuilt for the user they have become.
   */
  async function loginAsUser(user: UserRow) {
    if (!confirm(t("settings_confirmLoginAs").replace("{name}", user.name))) return;

    setBusyUserId(user.id);
    const { ok } = await callUsersApi(
      "/api/impersonate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      },
      t("settings_loginAsStartedMsg").replace("{name}", user.name)
    );
    if (!ok) {
      setBusyUserId(null);
      return;
    }

    await updateSession({ impersonateUserId: user.id });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see the note above: the swap needs a full reload, not a push.
    window.location.href = "/dashboard";
  }

  // ── Backup export ──

  async function loadBackupSummary() {
    try {
      const res = await fetch("/api/settings/backup?summary=1");
      if (!res.ok) return;
      setSummary(await res.json());
    } catch {
      // Only a headline count; the export buttons work without it.
    }
  }

  async function handleExport(format: BackupFormat) {
    setExporting(format);
    try {
      const res = await fetch(`/api/settings/backup?format=${format}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error);
      }

      // The filename the server chose carries the timestamp, so it is read back
      // out of Content-Disposition rather than guessed at a second time here.
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const rows = res.headers.get("X-Backup-Rows");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named ?? `cloth-pos-backup.${format === "csv" ? "zip" : format}`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(
        rows
          ? t("settings_backupExportedRowsMsg").replace("{rows}", Number(rows).toLocaleString())
          : t("settings_backupExportedMsg")
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : t("settings_exportFailedMsg"));
    } finally {
      setExporting(null);
    }
  }

  // ── Restore ──

  async function handleRestore() {
    if (!restoreFile) { toast.error(t("settings_chooseBackupFileMsg")); return; }
    if (restoreConfirm.trim().toUpperCase() !== RESTORE_PHRASE) {
      toast.error(t("settings_typeRestoreMsg").replace("{phrase}", RESTORE_PHRASE));
      return;
    }
    if (!confirm(t("settings_confirmRestore"))) return;

    setRestoring(true);
    setRestoreReport(null);
    try {
      const body = new FormData();
      body.append("file", restoreFile);
      body.append("confirm", RESTORE_PHRASE);
      const res = await fetch("/api/settings/backup/restore", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);

      setRestoreReport(data);
      setRestoreFile(null);
      setRestoreConfirm("");
      if (restoreFileRef.current) restoreFileRef.current.value = "";
      toast.success(
        t("settings_restoreDoneMsg")
          .replace("{tables}", String(data.tablesRestored))
          .replace("{rows}", Number(data.rowsRestored).toLocaleString()),
        { duration: 6000 }
      );
      // Every table was replaced, including this branch's own settings row and
      // the permission matrix, so the cached copies in this tab are now stale.
      await refresh();
      loadBackupSummary();
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : t("settings_restoreFailedMsg"), {
        duration: 8000,
      });
    } finally {
      setRestoring(false);
    }
  }

  // ─── Unit conversion ───────────────────────────────────────────────────────

  useEffect(() => {
    if (activeTab !== "units") return;
    fetch("/api/settings/units")
      .then((r) => r.json())
      .then((d) => setUnitForm({
        inchesPerGaz: String(d.inchesPerGaz ?? 36),
        inchesPerMtr: String(d.inchesPerMtr ?? 40),
      }))
      .catch(() => {});
  }, [activeTab]);

  async function saveUnits() {
    setSavingUnits(true);
    try {
      const res = await fetch("/api/settings/units", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inchesPerGaz: Number(unitForm.inchesPerGaz),
          inchesPerMtr: Number(unitForm.inchesPerMtr),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      // Open tabs cache the lengths for the life of the page; drop that cache
      // so the GRN preview and the stock lines pick the new ones up.
      invalidateUnitConfig();
      toast.success(t("settings_savedMsg"));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSavingUnits(false);
    }
  }

  // ─── TABS ──────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "store" as const, label: t("storeInfo"), icon: Store },
    { id: "receipt" as const, label: t("receipt"), icon: Settings },
    { id: "language" as const, label: t("language"), icon: Globe },
    { id: "units" as const, label: t("settings_units"), icon: Ruler },
    { id: "pwa" as const, label: t("pwa"), icon: Smartphone },
    ...(can("DATABASE_BACKUP")
      ? [{ id: "backup" as const, label: t("backup"), icon: Download }]
      : []),
    ...(canClearData && clearDataEnabled
      ? [{ id: "clearData" as const, label: t("settings_clearData"), icon: Trash2 }]
      : []),
    ...(can("VIEW_USERS")
      ? [{ id: "users" as const, label: t("users"), icon: Users }]
      : []),
  ] as const;

  return (
    <div className="p-6 max-w-3xl lg:max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Settings className="w-6 h-6 text-gray-600" /> {t("settings_title")}
          </h1>
          <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
            {t("settings_subtitle")}
          </p>
        </div>
        {(activeTab === "store" || activeTab === "receipt") && (
          <button onClick={handleSave} disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t("settings_saving") : t("save")}
          </button>
        )}
      </div>

      {/* Roles & Permissions shortcut — always visible on settings page */}
      <button
        onClick={() => router.push("/dashboard/settings/roles")}
        className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-2xl p-4 mb-4 hover:border-teal-400 hover:shadow-sm transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 border border-teal-200 rounded-xl flex items-center justify-center group-hover:bg-teal-100 transition-colors">
            <Shield className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-left">
            <div className={`font-semibold text-gray-800 text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("settings_rolesPermissions")}</div>
            <div className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_rolesPermissionsHint")}</div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-teal-500 transition-colors shrink-0" />
      </button>

      {/* Live Preview Banner */}
      <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0">
          {form.name.split(" ").map(w => w[0]).slice(0, 3).join("").toUpperCase() || "POS"}
        </div>
        <div>
          <div className={`font-bold text-teal-800 text-sm ${isUrdu ? "urdu-text" : ""}`}>{form.name || t("settings_storeName")}</div>
          <div className={`text-teal-600 text-xs ${isUrdu ? "urdu-text" : ""}`}>
            {[form.address, form.city].filter(Boolean).join(", ") || t("settings_address")}
            {form.phone && ` · ${form.phone}`}
          </div>
        </div>
        <span className={`ml-auto text-xs text-teal-500 bg-teal-100 px-2 py-0.5 rounded ${isUrdu ? "urdu-text" : ""}`}>{t("settings_livePreview")}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 flex-wrap">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium transition-all min-w-[72px] whitespace-nowrap ${
              activeTab === tab.id ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            <tab.icon className="w-3.5 h-3.5" />
            <span className={isUrdu ? "urdu-text" : ""}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── STORE INFO TAB ──────────────────────────────────────────────────── */}
      {activeTab === "store" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h2 className={`font-semibold text-gray-700 border-b pb-3 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_storeInformation")}</h2>
          <div>
            <label className={`block text-sm font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_storeName")} <span className="text-red-500">*</span>
            </label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Sidhey Sheikh Cloth Center"
              className="w-full border-2 border-gray-200 focus:border-teal-500 rounded-xl px-4 py-3 text-base font-medium focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={`block text-sm font-medium text-gray-600 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_address")}</label>
              <input type="text" value={form.address} onChange={(e) => set("address", e.target.value)}
                placeholder={t("settings_streetArea")}
                className="w-full border border-gray-200 focus:border-teal-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
            </div>
            {([
              { key: "city", label: "settings_city", placeholder: "e.g. Warburton" },
              { key: "phone", label: "settings_phone", placeholder: "0307-1483620" },
              { key: "mobile", label: "settings_mobile", placeholder: "0300-4346090" },
              { key: "email", label: "settings_email", placeholder: "info@store.com" },
              { key: "website", label: "settings_website", placeholder: "www.store.com" },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className={`block text-sm font-medium text-gray-600 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t(label)}</label>
                <input type="text" value={form[key as keyof BranchForm]} onChange={(e) => set(key as keyof BranchForm, e.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 focus:border-teal-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
              </div>
            ))}
          </div>

          {/* ── Branding ─────────────────────────────────────────────────── */}
          {can("EDIT_STORE_SETTINGS") && (
            <div className="border-t pt-5">
              <h3 className={`font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_branding")}</h3>
              <p className={`text-sm text-gray-500 mb-4 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_brandingHint")}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {brandingTile("favicon")}
                {brandingTile("logo", "w-32 h-24")}
              </div>

              {/*
                The logo URL kept its own field but moved here from the Receipt
                tab: one setting with two homes is one too many, and a URL and
                an upload are two ways to do the same thing, so they belong side
                by side where the choice is visible.
              */}
              <div className="mt-4">
                <label className={`block text-sm font-medium text-gray-600 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_logoUrl")}</label>
                <input type="text" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)}
                  placeholder={t("settings_logoUrlPlaceholder")}
                  className="w-full border border-gray-200 focus:border-teal-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
                <p className={`text-xs text-gray-400 mt-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_logoUrlHint")}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RECEIPT TAB ────────────────────────────────────────────────────── */}
      {activeTab === "receipt" && (() => {
        // The preview below is driven by exactly the scale the printer gets,
        // so what the shopkeeper sees while dragging the number is the slip.
        const previewFont = receiptFontScale(clampReceiptFontSize(form.receiptFontSize));
        return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h2 className={`font-semibold text-gray-700 border-b pb-3 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_receiptPrintSettings")}</h2>

          {/* ── Receipt font size ─────────────────────────────────────────── */}
          <div>
            <label className={`block text-sm font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_receiptFontSizeLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min={RECEIPT_FONT_SIZE_MIN}
                  max={RECEIPT_FONT_SIZE_MAX}
                  step={1}
                  value={form.receiptFontSize}
                  onChange={(e) => set("receiptFontSize", e.target.value)}
                  onBlur={(e) => set("receiptFontSize", String(clampReceiptFontSize(e.target.value)))}
                  className="w-28 border border-gray-200 focus:border-teal-400 rounded-lg pl-3 pr-9 py-2.5 text-sm focus:outline-none tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">
                  {t("settings_receiptFontSizeUnit")}
                </span>
              </div>
              {RECEIPT_FONT_SIZE_PRESETS.map((px) => (
                <button
                  key={px}
                  type="button"
                  onClick={() => set("receiptFontSize", String(px))}
                  className={`px-3 py-2 rounded-lg text-sm font-medium tabular-nums border transition-colors ${
                    clampReceiptFontSize(form.receiptFontSize) === px
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:border-teal-400"
                  }`}
                >
                  {px}
                </button>
              ))}
            </div>
            <p className={`text-xs text-gray-400 mt-1 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_receiptFontSizeHint")}{" "}
              {t("settings_receiptFontSizeRange")
                .replace("{min}", String(RECEIPT_FONT_SIZE_MIN))
                .replace("{max}", String(RECEIPT_FONT_SIZE_MAX))}
            </p>
          </div>

          <div>
            <label className={`block text-sm font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_receiptFooterLabel")}
            </label>
            <textarea value={form.footerTerms} onChange={(e) => set("footerTerms", e.target.value)}
              rows={7} placeholder={"* ALL PRICES ARE FIXED\n* NO CLAIM ON STICH SUIT\n* SUIT EXCHANGED WITHIN SAME BRANDS ONLY"}
              className="w-full border border-gray-200 focus:border-teal-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none font-mono resize-none" />
            <p className={`text-xs text-gray-400 mt-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_receiptFooterHint")}</p>
          </div>
          {/*
            The logo moved to Store Info → Branding, next to the favicon and the
            PWA icons. It is one setting and it now has one home; a URL field
            here and an upload there would have been two ways to set the same
            thing in two different tabs.
          */}
          {/* Receipt preview */}
          <div>
            <label className={`block text-sm font-semibold text-gray-700 mb-2 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_receiptPreview")}</label>
            {/*
              Fixed at 80mm — the paper does not get wider when the type does,
              which is the whole point of previewing it: at 20px the shopkeeper
              can see the item line start to wrap before printing a roll of it.
            */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-4 bg-gray-50 font-mono text-gray-700 text-center mx-auto overflow-x-auto"
              style={{ width: "80mm", maxWidth: "100%", fontSize: previewFont.base }}
            >
              <div className={`font-bold ${isUrdu ? "urdu-text" : ""}`} style={{ fontSize: previewFont.xl }}>{form.name || t("settings_storeNamePreview")}</div>
              <div className="text-gray-500" style={{ fontSize: previewFont.xs }}>{form.address}</div>
              {form.phone && <div className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`} style={{ fontSize: previewFont.xs }}>{t("settings_ph")} {form.phone}</div>}
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className={`font-bold ${isUrdu ? "urdu-text" : ""}`}>{t("settings_cashBill")}</div>
              <div className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`} style={{ fontSize: previewFont.xs }}>{t("settings_invoiceNo")} XXXX &nbsp; DD/MM/YYYY</div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className={`text-left space-y-0.5 ${isUrdu ? "urdu-text" : ""}`} style={{ fontSize: previewFont.sm }}>
                <div className="flex justify-between"><span>{t("settings_itemName")}</span><span>Rs. 0.00</span></div>
                <div className="flex justify-between font-bold" style={{ fontSize: previewFont.lg }}><span>{t("settings_netBill")}</span><span>Rs. 0.00</span></div>
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className={`text-gray-500 text-left whitespace-pre-line leading-tight ${isUrdu ? "urdu-text" : ""}`} style={{ fontSize: previewFont.xs }}>
                {form.footerTerms || t("settings_footerTermsPlaceholder")}
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── LANGUAGE TAB ───────────────────────────────────────────────────── */}
      {activeTab === "units" && (() => {
        const gaz = Number(unitForm.inchesPerGaz);
        const mtr = Number(unitForm.inchesPerMtr);
        const valid = Number.isFinite(gaz) && gaz > 0 && Number.isFinite(mtr) && mtr > 0;
        return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h2 className={`font-semibold text-gray-700 border-b pb-3 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_unitsTitle")}</h2>

          <p className={`text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_unitsHint")}</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`block text-xs font-semibold text-gray-600 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_inchesPerGaz")}</label>
              <input
                type="number" min={0} step={1}
                value={unitForm.inchesPerGaz}
                onChange={(e) => setUnitForm((f) => ({ ...f, inchesPerGaz: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className={`block text-xs font-semibold text-gray-600 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_inchesPerMtr")}</label>
              <input
                type="number" min={0} step={1}
                value={unitForm.inchesPerMtr}
                onChange={(e) => setUnitForm((f) => ({ ...f, inchesPerMtr: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>

          {/* Derived, never editable in their own right. Two free-standing
              factors could be set to disagree with each other (0.9 and 1.2,
              say) and then a quantity converted out and back would not come
              home. One pair of lengths makes that unrepresentable. */}
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-900">
            <div className={`font-semibold mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_resultingConversion")}</div>
            {valid ? (
              <>
                <div>1 GAZ = {(gaz / mtr).toFixed(4)} MTR</div>
                <div>1 MTR = {(mtr / gaz).toFixed(4)} GAZ</div>
              </>
            ) : (
              <div className="text-red-600">{t("settings_unitsInvalid")}</div>
            )}
          </div>

          <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 ${isUrdu ? "urdu-text" : ""}`}>
            <strong>{t("settings_noteLabel")}</strong> {t("settings_unitsWarning")}
          </div>

          <button
            onClick={saveUnits}
            disabled={savingUnits || !valid}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
          >
            {savingUnits ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingUnits ? t("settings_saving") : t("save")}
          </button>
        </div>
        );
      })()}

      {activeTab === "language" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h2 className="font-semibold text-gray-700 border-b pb-3">Interface Language / زبان کی ترتیب</h2>

          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Select the language for menus, navigation, buttons and labels throughout the app.
            </p>
            <p className="text-sm text-gray-500 urdu-text">
              ایپ میں مینیو، نیویگیشن، بٹن اور لیبل کی زبان منتخب کریں۔
            </p>

            <div className="grid grid-cols-2 gap-4 mt-4">
              {(["en", "ur"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`border-2 rounded-xl p-6 text-center transition-all ${
                    lang === l
                      ? "border-teal-500 bg-teal-50"
                      : "border-gray-200 hover:border-teal-300"
                  }`}
                >
                  <div className="text-3xl mb-2">{l === "en" ? "🇬🇧" : "🇵🇰"}</div>
                  <div className={`font-bold text-gray-800 ${l === "ur" ? "urdu-text text-xl" : "text-lg"}`}>
                    {l === "en" ? "English" : "اردو"}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {l === "en" ? "Left-to-right" : "دائیں سے بائیں"}
                  </div>
                  {lang === l && (
                    <div className={`mt-2 text-teal-600 text-xs font-semibold ${isUrdu ? "urdu-text" : ""}`}>✓ {t("settings_active")}</div>
                  )}
                </button>
              ))}
            </div>

            {lang === "ur" && (
              <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 ${isUrdu ? "urdu-text" : ""}`}>
                <strong>{t("settings_noteLabel")}</strong> {t("settings_fontNote1")}{" "}
                <strong>Jameel Noori Nastaleeq Kasheeda</strong> {t("settings_fontNote2")}{" "}
                <a href="https://urdufonts.net/fonts/jameel-noori-nastaleeq-kasheeda" target="_blank" rel="noopener noreferrer" className="underline">
                  urdufonts.net
                </a>{" "}
                {t("settings_fontNote3")} <code>JameelNooriNastaleeqKasheeda.ttf</code> {t("settings_fontNote4")}{" "}
                <code>public/fonts/</code> {t("settings_fontNote5")}
              </div>
            )}
          </div>

          {/* Language switcher — site-wide toggle */}
          <div className="border-t pt-6">
            <h3 className={`font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_languageSwitcher")}</h3>
            <p className={`text-sm text-gray-500 mb-3 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_languageSwitcherHint")}
            </p>
            <button
              onClick={() => toggleSiteSetting("languageSwitcherEnabled", !languageSwitcherEnabled)}
              className="flex items-center gap-2 text-sm"
            >
              {languageSwitcherEnabled
                ? <ToggleRight className="w-8 h-8 text-teal-500" />
                : <ToggleLeft className="w-8 h-8 text-gray-300" />}
              <span className={`text-gray-600 ${isUrdu ? "urdu-text" : ""}`}>
                {languageSwitcherEnabled ? t("settings_syncIndicatorOn") : t("settings_syncIndicatorOff")}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── PWA TAB ────────────────────────────────────────────────────────── */}
      {activeTab === "pwa" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h2 className={`font-semibold text-gray-700 border-b pb-3 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_pwaAppSettings")}</h2>

          {/* Icon upload */}
          <div>
            <h3 className={`font-semibold text-gray-700 mb-3 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_appIcons")}</h3>
            <p className={`text-sm text-gray-500 mb-4 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_appIconsHint")}
            </p>
            {can("EDIT_STORE_SETTINGS") ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {brandingTile("icon192")}
                  {brandingTile("icon512")}
                </div>
              </>
            ) : (
              <p className={`text-sm text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_brandingNoPermission")}</p>
            )}
          </div>

          {/* PWA / Offline — site-wide toggle */}
          <div className="border-t pt-6">
            <h3 className={`font-semibold text-gray-700 mb-1 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_syncIndicator")}</h3>
            <p className={`text-sm text-gray-500 mb-3 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_syncIndicatorHint")}
            </p>
            <button
              onClick={() => toggleSiteSetting("pwaOfflineEnabled", !pwaEnabled)}
              className="flex items-center gap-2 text-sm"
            >
              {pwaEnabled
                ? <ToggleRight className="w-8 h-8 text-teal-500" />
                : <ToggleLeft className="w-8 h-8 text-gray-300" />}
              <span className={`text-gray-600 ${isUrdu ? "urdu-text" : ""}`}>
                {pwaEnabled ? t("settings_syncIndicatorOn") : t("settings_syncIndicatorOff")}
              </span>
            </button>
          </div>

          {/* PWA install instructions */}
          <div className={`bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-2 ${isUrdu ? "urdu-text" : ""}`}>
            <div className="font-semibold">{t("settings_howToInstall")}</div>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li><strong>Chrome / Edge</strong>: {t("settings_installChromeEdgeText")}</li>
              <li><strong>Android</strong>: {t("settings_installAndroidText")}</li>
              <li><strong>iOS / Safari</strong>: {t("settings_installIOSText")}</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── BACKUP TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "backup" && (
        <div className="space-y-4">
          {/* Export */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
            <div className="flex items-start justify-between border-b pb-3 gap-4">
              <div>
                <h2 className={`font-semibold text-gray-700 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                  <Database className="w-4 h-4 text-gray-500" /> {t("settings_backupExport")}
                </h2>
                <p className={`text-sm text-gray-500 mt-1 ${isUrdu ? "urdu-text" : ""}`}>
                  {t("settings_fullDataExportHint")}
                </p>
              </div>
              {summary && (
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-gray-800 tabular-nums">
                    {summary.rowCount.toLocaleString()}
                  </div>
                  <div className={`text-xs text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("settings_rowsAcrossTables").replace("{tables}", String(summary.tableCount))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3">
              {BACKUP_FORMATS.map((format) => {
                const Icon = format.icon;
                const busy = exporting === format.id;
                return (
                  <div key={format.id} className="bg-gray-50 rounded-xl p-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className={`font-semibold text-gray-800 text-sm ${isUrdu ? "urdu-text" : ""}`}>
                          {t(format.label)}
                          <span className="ml-2 font-mono text-xs font-normal text-gray-400">{format.ext}</span>
                        </div>
                        <p className={`text-xs text-gray-500 mt-1 leading-relaxed ${isUrdu ? "urdu-text" : ""}`}>
                          {t(format.hint)}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => handleExport(format.id)} disabled={exporting !== null}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-60 shrink-0">
                      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      <span className={isUrdu ? "urdu-text" : ""}>{busy ? t("settings_exporting") : t("settings_download")}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Answers the question the three buttons raise: which one do I use? */}
            <div className={`bg-sky-50 border border-sky-200 rounded-xl p-4 text-sm text-sky-900 space-y-2 ${isUrdu ? "urdu-text" : ""}`}>
              <strong className="block">{t("settings_whichFormatTitle")}</strong>
              <p className="leading-relaxed">{t("settings_whichFormatBody")}</p>
            </div>

            <div className={`bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 ${isUrdu ? "urdu-text" : ""}`}>
              <strong>💡 {t("settings_tipLabel")}</strong> {t("settings_tipText")}
            </div>
          </div>

          {/* Restore */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="border-b pb-3">
              <h2 className={`font-semibold text-gray-700 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                <Upload className="w-4 h-4 text-gray-500" /> {t("settings_restoreImport")}
              </h2>
              <p className={`text-sm text-gray-500 mt-1 ${isUrdu ? "urdu-text" : ""}`}>
                {t("settings_restoreImportHint")}
              </p>
            </div>

            {!can("DATABASE_RESTORE") ? (
              <p className={`text-sm text-gray-400 bg-gray-50 rounded-xl p-4 ${isUrdu ? "urdu-text" : ""}`}>
                {t("settings_restoreNoPermission")}
              </p>
            ) : (
              <>
                <div className={`bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 flex gap-3 ${isUrdu ? "urdu-text" : ""}`}>
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block">{t("settings_restoreWarningTitle")}</strong>
                    <span className="leading-relaxed">{t("settings_restoreWarningBody")}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
                      {t("settings_backupFileLabel")}
                    </label>
                    <input
                      ref={restoreFileRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => { setRestoreFile(e.target.files?.[0] ?? null); setRestoreReport(null); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
                    />
                    {restoreFile && (
                      <p className="text-xs text-gray-400 mt-1 font-mono">
                        {restoreFile.name} · {(restoreFile.size / 1024).toFixed(0)} KB
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
                      {t("settings_typeToConfirmLabel").replace("{phrase}", RESTORE_PHRASE)}
                    </label>
                    <input
                      value={restoreConfirm}
                      onChange={(e) => setRestoreConfirm(e.target.value)}
                      placeholder={RESTORE_PHRASE}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 font-mono tracking-widest max-w-xs"
                    />
                  </div>

                  <button
                    onClick={handleRestore}
                    disabled={restoring || !restoreFile || restoreConfirm.trim().toUpperCase() !== RESTORE_PHRASE}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {restoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span className={isUrdu ? "urdu-text" : ""}>
                      {restoring ? t("settings_restoring") : t("settings_restoreNow")}
                    </span>
                  </button>
                </div>

                {restoreReport && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-900 space-y-2">
                    <div className={`font-semibold flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                      <Check className="w-4 h-4" />
                      {t("settings_restoreDoneMsg")
                        .replace("{tables}", String(restoreReport.tablesRestored))
                        .replace("{rows}", restoreReport.rowsRestored.toLocaleString())}
                    </div>
                    {restoreReport.warnings.length > 0 && (
                      <ul className="list-disc ps-5 space-y-1 text-amber-800">
                        {restoreReport.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
                      </ul>
                    )}
                    <p className={`text-xs text-green-700 ${isUrdu ? "urdu-text" : ""}`}>
                      {t("settings_restoreReloadHint")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CLEAR DATA TAB ─────────────────────────────────────────────────── */}
      {activeTab === "clearData" && (
        <div className="space-y-4">
          {!clearDataEnabled ? (
            <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-sm text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
              {t("settings_clearDataDisabledMsg")}
            </div>
          ) : (
            <>
              {/* Clear */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
                <div className="border-b pb-3">
                  <h2 className={`font-semibold text-gray-700 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                    <Trash2 className="w-4 h-4 text-gray-500" /> {t("settings_clearDataTitle")}
                  </h2>
                  <p className={`text-sm text-gray-500 mt-1 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("settings_clearDataHint")}
                  </p>
                </div>

                <div className={`bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex gap-3 ${isUrdu ? "urdu-text" : ""}`}>
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block">{t("settings_clearDataWarningTitle")}</strong>
                    <span className="leading-relaxed">{t("settings_clearDataWarningBody")}</span>
                  </div>
                </div>

                {clearLoading ? (
                  <p className="text-sm text-gray-400">…</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={() =>
                          setSelectedClearGroups(
                            selectedClearGroups.size === clearGroups.length
                              ? new Set()
                              : new Set(clearGroups.map((g) => g.id))
                          )
                        }
                        className="text-sm text-teal-700 hover:underline shrink-0"
                      >
                        {t("settings_clearDataSelectAll")}
                      </button>
                      <span className={`text-xs text-gray-500 text-end ${isUrdu ? "urdu-text" : ""}`}>
                        {selectedClearGroups.size > 0
                          ? t("settings_clearDataRowsSelected")
                              .replace("{rows}", selectedClearRowCount.toLocaleString())
                              .replace("{tables}", String(selectedClearTableCount))
                          : t("settings_clearDataNoneSelected")}
                      </span>
                    </div>

                    <div className="grid gap-2">
                      {clearGroups.map((group) => {
                        const checked = selectedClearGroups.has(group.id);
                        const lockedBy = clearGroups.filter(
                          (g) =>
                            g.id !== group.id &&
                            selectedClearGroups.has(g.id) &&
                            requiresClosure(g.id, clearGroups).has(group.id)
                        );
                        return (
                          <label
                            key={group.id}
                            className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
                              checked ? "border-teal-300 bg-teal-50/50" : "border-gray-200"
                            } ${lockedBy.length ? "" : "cursor-pointer"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={lockedBy.length > 0}
                              onChange={() => toggleClearGroup(group.id)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className={`font-medium text-gray-800 flex items-center justify-between gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                                <span>{t(group.labelKey)}</span>
                                <span className="text-xs text-gray-400 font-mono tabular-nums shrink-0">
                                  {group.rowCount.toLocaleString()}
                                </span>
                              </div>
                              {lockedBy.length > 0 && (
                                <p className={`text-xs text-amber-700 mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
                                  {t("settings_clearDataRequiredNote").replace(
                                    "{group}",
                                    lockedBy.map((g) => t(g.labelKey)).join(", ")
                                  )}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div className="space-y-3 pt-2 border-t">
                      <div>
                        <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
                          {t("settings_typeToConfirmLabel").replace("{phrase}", CLEAR_PHRASE)}
                        </label>
                        <input
                          value={clearConfirmInput}
                          onChange={(e) => setClearConfirmInput(e.target.value)}
                          placeholder={CLEAR_PHRASE}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 font-mono tracking-widest max-w-xs"
                        />
                      </div>

                      <button
                        onClick={handleClearData}
                        disabled={clearing || selectedClearGroups.size === 0 || clearConfirmInput.trim().toUpperCase() !== CLEAR_PHRASE}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {clearing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        <span className={isUrdu ? "urdu-text" : ""}>
                          {clearing ? t("settings_clearing") : t("settings_clearDataButton")}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Backups */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
                <div className="border-b pb-3">
                  <h2 className={`font-semibold text-gray-700 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
                    <Database className="w-4 h-4 text-gray-500" /> {t("settings_clearDataBackupsTitle")}
                  </h2>
                  <p className={`text-sm text-gray-500 mt-1 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("settings_clearDataBackupsHint")}
                  </p>
                </div>

                {clearBackups.length === 0 ? (
                  <p className={`text-sm text-gray-400 bg-gray-50 rounded-xl p-4 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("settings_clearDataNoBackups")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {clearBackups.map((b) => (
                      <div key={b.file} className="bg-gray-50 rounded-xl p-3 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-800">{new Date(b.createdAt).toLocaleString()}</div>
                          <div className="text-xs text-gray-400 font-mono">
                            {b.tableCount !== null ? `${b.tableCount} tables · ${(b.rowCount ?? 0).toLocaleString()} rows · ` : ""}
                            {(b.sizeBytes / 1024).toFixed(0)} KB
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => downloadClearBackup(b.file)}
                            className="p-2 text-gray-500 hover:text-teal-700"
                            title={t("settings_clearDataBackupDownload")}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRestoreClearBackup(b.file, b.createdAt)}
                            disabled={restoringBackupFile !== null}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs hover:bg-teal-700 disabled:opacity-60"
                          >
                            {restoringBackupFile === b.file
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <Upload className="w-3.5 h-3.5" />}
                            <span>{restoringBackupFile === b.file ? t("settings_clearDataRestoringBackup") : t("settings_clearDataBackupRestore")}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteClearBackup(b.file)}
                            disabled={deletingBackupFile !== null}
                            className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-60"
                            title={t("settings_clearDataBackupDelete")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── USERS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className={`font-semibold text-gray-700 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_userManagement")}</h2>
              {can("CREATE_USER") && (
                <button onClick={() => { setShowAddUser((v) => !v); cancelEditUser(); }}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">
                  <UserPlus className="w-4 h-4" />
                  <span className={isUrdu ? "urdu-text" : ""}>{t("settings_addUser")}</span>
                </button>
              )}
            </div>

            {/* Add User Form */}
            {showAddUser && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3 border border-gray-200">
                <h3 className={`font-medium text-gray-700 text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("settings_newUser")}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</label>
                    <input value={newUser.name} onChange={(e) => setNewUser(p => ({...p, name: e.target.value}))}
                      placeholder={t("settings_fullNamePlaceholder")} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
                  </div>
                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_email")}</label>
                    <input type="email" value={newUser.email} onChange={(e) => setNewUser(p => ({...p, email: e.target.value}))}
                      placeholder="email@store.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
                  </div>
                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_password")}</label>
                    <div className="relative mt-1">
                      <input type={showPwd ? "text" : "password"} value={newUser.password}
                        onChange={(e) => setNewUser(p => ({...p, password: e.target.value}))}
                        placeholder={t("settings_minCharsPlaceholder")}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-9" />
                      <button onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-gray-400">
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_role")}</label>
                    <select value={newUser.role} onChange={(e) => setNewUser(p => ({...p, role: e.target.value}))}
                      disabled={!can("ASSIGN_ROLES")}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 disabled:bg-gray-100 disabled:text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                      {ROLES.map((role) => (
                        <option key={role.id} value={role.id}>{t(role.full)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddUser} disabled={addingUser}
                    className={`px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
                    {addingUser ? t("settings_saving") : t("settings_createUser")}
                  </button>
                  <button onClick={() => setShowAddUser(false)}
                    className={`px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 ${isUrdu ? "urdu-text" : ""}`}>
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* User List */}
            {usersLoading ? (
              <div className={`text-center py-8 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_loadingUsers")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={`bg-gray-50 text-xs text-gray-500 uppercase ${isUrdu ? "urdu-text" : ""}`}>
                    <tr>
                      <th className="px-4 py-3 text-left">{t("name")}</th>
                      <th className="px-4 py-3 text-left">{t("settings_email")}</th>
                      <th className="px-4 py-3 text-left">{t("settings_role")}</th>
                      <th className="px-4 py-3 text-left">{t("settings_branch")}</th>
                      <th className="px-4 py-3 text-center">{t("settings_status")}</th>
                      <th className="px-4 py-3 text-center">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((u) => {
                      const isSelf = u.id === currentUserId;
                      const busy = busyUserId === u.id;
                      const roleLabel = ROLES.find((role) => role.id === u.role)?.short;
                      return (
                        <Fragment key={u.id}>
                          <tr className={`hover:bg-gray-50 ${!u.isActive ? "opacity-60" : ""} ${editingId === u.id ? "bg-teal-50/60" : ""}`}>
                            <td className="px-4 py-3 font-medium text-gray-800">
                              {u.name}
                              {isSelf && (
                                <span className={`ml-2 text-xs text-teal-600 font-normal ${isUrdu ? "urdu-text" : ""}`}>
                                  ({t("settings_you")})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-500">{u.email}</td>
                            <td className={`px-4 py-3 ${isUrdu ? "urdu-text" : ""}`}>
                              {/* A badge, not a select: role now changes inside the edit
                                  form, so a stray scroll over the list can't reassign it. */}
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                {roleLabel ? t(roleLabel) : u.role}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-gray-500 text-xs ${isUrdu ? "urdu-text" : ""}`}>
                              {u.branches.map(b => b.name).join(", ") || "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"} ${isUrdu ? "urdu-text" : ""}`}>
                                {u.isActive ? t("settings_active") : t("settings_inactiveStatus")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                {can("IMPERSONATE_USER") && !isSelf && (
                                  <button
                                    onClick={() => loginAsUser(u)}
                                    disabled={busy || !loginAsAllowed(u)}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={loginAsBlockedReason(u) ?? t("settings_loginAsUser")}
                                  >
                                    <UserCog className="w-4 h-4" />
                                  </button>
                                )}
                                {can("EDIT_USER") && (
                                  <button
                                    onClick={() => (editingId === u.id ? cancelEditUser() : startEditUser(u))}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                                    title={t("settings_editUser")}
                                  >
                                    {editingId === u.id ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                                  </button>
                                )}
                                {can("EDIT_USER") && (
                                  <button
                                    onClick={() => toggleUserActive(u)}
                                    disabled={busy || isSelf}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={isSelf
                                      ? t("settings_cannotChangeOwnStatus")
                                      : u.isActive ? t("settings_deactivate") : t("settings_activate")}
                                  >
                                    {u.isActive
                                      ? <ToggleRight className="w-5 h-5 text-teal-500" />
                                      : <ToggleLeft className="w-5 h-5" />}
                                  </button>
                                )}
                                {can("DELETE_USER") && (
                                  <button
                                    onClick={() => deleteUser(u)}
                                    disabled={busy || isSelf}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={isSelf ? t("settings_cannotDeleteSelf") : t("settings_deleteUser")}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Edit form, expanded in place under the row it edits. */}
                          {editingId === u.id && (
                            <tr className="bg-teal-50/60">
                              <td colSpan={6} className="px-4 py-4">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</label>
                                    <input value={editUser.name}
                                      onChange={(e) => setEditUser(p => ({ ...p, name: e.target.value }))}
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white" />
                                  </div>
                                  <div>
                                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_email")}</label>
                                    <input type="email" value={editUser.email}
                                      onChange={(e) => setEditUser(p => ({ ...p, email: e.target.value }))}
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white" />
                                  </div>
                                  <div>
                                    <label className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_role")}</label>
                                    <select value={editUser.role}
                                      onChange={(e) => setEditUser(p => ({ ...p, role: e.target.value }))}
                                      disabled={isSelf || !can("ASSIGN_ROLES")}
                                      title={isSelf ? t("settings_cannotChangeOwnRole") : undefined}
                                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 bg-white disabled:bg-gray-100 disabled:text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>
                                      {ROLES.map((role) => (
                                        <option key={role.id} value={role.id}>{t(role.full)}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className={`text-xs text-gray-500 flex items-center gap-1 ${isUrdu ? "urdu-text" : ""}`}>
                                      <KeyRound className="w-3 h-3" /> {t("settings_resetPassword")}
                                    </label>
                                    <div className="relative mt-1">
                                      <input type={showEditPwd ? "text" : "password"} value={editUser.password}
                                        onChange={(e) => setEditUser(p => ({ ...p, password: e.target.value }))}
                                        placeholder={t("settings_leaveBlankToKeep")}
                                        className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-9 bg-white ${isUrdu ? "urdu-text" : ""}`} />
                                      <button onClick={() => setShowEditPwd(v => !v)} className="absolute end-2 top-2 text-gray-400">
                                        {showEditPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 mt-3">
                                  <button onClick={() => saveEditUser(u)} disabled={savingUser}
                                    className={`flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-60 ${isUrdu ? "urdu-text" : ""}`}>
                                    {savingUser ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    {savingUser ? t("settings_saving") : t("save")}
                                  </button>
                                  <button onClick={cancelEditUser}
                                    className={`px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-white ${isUrdu ? "urdu-text" : ""}`}>
                                    {t("cancel")}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <p className={`text-center text-gray-400 py-8 ${isUrdu ? "urdu-text" : ""}`}>{t("settings_noUsersFound")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save button (bottom — only for store/receipt, and only for a role that
          may actually save; PUT /api/settings/store enforces the same key) */}
      {(activeTab === "store" || activeTab === "receipt") && can("EDIT_STORE_SETTINGS") && (
        <div className="mt-6 flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-8 py-2.5 rounded-xl flex items-center gap-2 font-medium">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t("settings_saving") : t("save")}
          </button>
        </div>
      )}
    </div>
  );
}
