"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  BookOpen, CalendarClock, Check, CloudUpload, Copy, FolderCheck, HardDriveDownload, Link2, Link2Off, RefreshCw, Save,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { cn, formatDateLong, formatTime12 } from "@/lib/utils";
import type { BackupConfig, BackupFormat } from "@/lib/backup-schedule";
import type { BackupHistoryEntry } from "@/lib/backup-jobs";
import type { GoogleStatus } from "@/lib/google-drive";
import type { TaskStatus } from "@/lib/backup-task";
import type { TranslationKey } from "@/lib/translations";
import CollapsibleCard from "@/components/settings/CollapsibleCard";

/**
 * Settings → Backup → "Automatic & Cloud Backup".
 *
 * Everything the owner needs to set up and watch unattended backups: run one now
 * (local, Drive or both), pick the folder, set the schedule, connect Google
 * Drive, and see what happened last. The schedule itself is kept by Windows
 * Task Scheduler — saving here creates, replaces or removes that task — and the
 * task runs `npm run backup:run`, so it works with the POS server switched off.
 *
 * Reading is open to anyone who may back up; changing the schedule or the
 * Google credentials needs SYSTEM_CONFIG (Super Admin by default).
 */

type Payload = {
  config: BackupConfig;
  history: BackupHistoryEntry[];
  task: TaskStatus;
  google: GoogleStatus;
};

const INPUT = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500";
const CARD = "bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5";

function fmtBytes(n?: number): string {
  if (!n) return "—";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtWhen(value: string | number | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return `${formatDateLong(d)}, ${formatTime12(d)}`;
}

export default function BackupAutomation() {
  const { t, isUrdu, lang } = useI18n();
  const { can } = usePermissions();
  const canConfigure = can("SYSTEM_CONFIG");
  const u = isUrdu ? "urdu-text" : "";

  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<BackupConfig | null>(null);
  const [running, setRunning] = useState<"local" | "drive" | "both" | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/settings/backup/config");
      if (!res.ok) return;
      const payload: Payload = await res.json();
      setData(payload);
      setForm((current) => current ?? payload.config);
      setClientId((current) => current || payload.google.clientId);
    } catch {
      // The panel simply stays on its loading state; nothing else depends on it.
    }
  }

  useEffect(() => {
    // Fetch on arrival: the setState calls happen after the response, not during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();

    // Google sends the browser back here with the outcome in the address bar.
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("drive");
    if (drive) {
      if (drive === "connected") toast.success(t("bk_driveConnectedToast"));
      else if (drive === "noclient") toast.error(t("bk_needClientFirst"));
      else setConnectError(params.get("msg") ?? "?");
      params.delete("drive");
      params.delete("msg");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
    // Runs once on arrival; `t` is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data || !form) {
    return (
      <div className={CARD}>
        <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }

  const set = <K extends keyof BackupConfig>(key: K, value: BackupConfig[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  const { google, task } = data;
  // Runs use the *saved* settings, so a half-edited form must be saved first.
  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);
  const toggleFormat = (format: BackupFormat) => {
    const has = form.formats.includes(format);
    if (has && form.formats.length === 1) return; // at least one must stay on
    set("formats", (["json", "sql", "csv"] as const).filter((f) => (f === format ? !has : form.formats.includes(f))));
  };
  // Computed here rather than in an effect: this point is only reached after the
  // data has loaded in the browser, so `window` is always there and nothing
  // rendered on the server can disagree with it.
  const redirectUri = `${window.location.origin}/api/settings/backup/google/callback`;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "long" })
  );

  async function runNow(local: boolean, drive: boolean) {
    setRunning(local && drive ? "both" : drive ? "drive" : "local");
    try {
      const res = await fetch("/api/settings/backup/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local, drive }),
      });
      const result: BackupHistoryEntry & { error?: string } = await res.json().catch(() => ({} as never));
      if (result.local?.ok) toast.success(t("bk_resultLocal").replace("{file}", (result.local.files ?? []).join(", ")));
      if (result.drive?.ok) toast.success(t("bk_resultDrive").replace("{file}", (result.drive.files ?? []).join(", ")));
      if (result.local && !result.local.ok) {
        toast.error(t("bk_partialFail").replace("{where}", t("bk_destLocal")).replace("{error}", result.local.error ?? ""), { duration: 10000 });
      }
      if (result.drive && !result.drive.ok) {
        toast.error(t("bk_partialFail").replace("{where}", t("bk_destDrive")).replace("{error}", result.drive.error ?? ""), { duration: 10000 });
      }
      if (result.error) toast.error(t("bk_resultFailed").replace("{error}", result.error), { duration: 10000 });
    } catch (e) {
      toast.error(t("bk_resultFailed").replace("{error}", e instanceof Error ? e.message : ""));
    } finally {
      setRunning(null);
      load();
    }
  }

  async function testFolder() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/backup/folder-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: form!.localFolder }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok) toast.success(t("bk_folderOk"));
      else toast.error(t("bk_folderFail").replace("{error}", body.error ?? ""), { duration: 8000 });
    } finally {
      setTesting(false);
    }
  }

  async function saveSchedule() {
    if (form!.scheduleEnabled && !form!.saveToLocal && !form!.uploadToDrive) {
      toast.error(t("bk_pickDestination"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/backup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error);
      setForm(body.config);
      toast.success(t("bk_scheduleSaved"));
      if (body.warning) toast(body.warning, { icon: "⚠️", duration: 10000 });
      load();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function saveClient() {
    setSavingClient(true);
    try {
      const res = await fetch("/api/settings/backup/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error);
      setClientSecret("");
      toast.success(t("bk_credentialsSaved"));
      load();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save");
    } finally {
      setSavingClient(false);
    }
  }

  async function disconnect(forget: boolean) {
    if (!confirm(t("bk_disconnectConfirm"))) return;
    await fetch(`/api/settings/backup/google${forget ? "?forget=1" : ""}`, { method: "DELETE" });
    if (forget) { setClientId(""); setClientSecret(""); }
    toast.success(t("bk_driveDisconnected"));
    load();
  }

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address is selectable on screen anyway.
    }
  }

  const folderMissing = !form.localFolder.trim();
  const busy = running !== null || dirty;

  return (
    <div className="space-y-4">
      {/* ── Run now + status ─────────────────────────────────────────────── */}
      <CollapsibleCard defaultOpen urdu={isUrdu}
        title={<><CloudUpload className="w-4 h-4 text-gray-500" /> {t("bk_autoTitle")}</>}
        hint={t("bk_autoHint")}>
        <div className="space-y-2">
          <div className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wide", u)}>{t("bk_runNow")}</div>
          <div className="flex flex-wrap gap-2">
            <RunButton busy={running === "local"} disabled={busy || folderMissing} onClick={() => runNow(true, false)}
              icon={<HardDriveDownload className="w-4 h-4" />} label={t("bk_saveLocal")} urdu={isUrdu} />
            <RunButton busy={running === "drive"} disabled={busy || !google.connected} onClick={() => runNow(false, true)}
              icon={<CloudUpload className="w-4 h-4" />} label={t("bk_uploadDrive")} urdu={isUrdu} />
            <RunButton busy={running === "both"} disabled={busy || folderMissing || !google.connected} onClick={() => runNow(true, true)}
              icon={<Save className="w-4 h-4" />} label={t("bk_both")} urdu={isUrdu} />
          </div>
          {!google.connected && <p className={cn("text-xs text-gray-400", u)}>{t("bk_driveNotConnected")}</p>}
          {dirty && <p className={cn("text-xs text-amber-600", u)}>{t("bk_unsavedHint")}</p>}
        </div>

        <TaskStrip task={task} urdu={isUrdu} t={t} />
      </CollapsibleCard>

      {/* ── Local folder + schedule ──────────────────────────────────────── */}
      <CollapsibleCard urdu={isUrdu}
        title={<><CalendarClock className="w-4 h-4 text-gray-500" /> {t("bk_scheduleTitle")}</>}
        hint={!canConfigure ? <span className="text-amber-700">{t("bk_noConfigPermission")}</span> : undefined}>

        <div>
          <label className={cn("text-xs text-gray-500", u)}>{t("bk_localFolder")}</label>
          <div className="flex gap-2 mt-1">
            <input value={form.localFolder} disabled={!canConfigure} onChange={(e) => set("localFolder", e.target.value)}
              placeholder="D:\POS_Backups" className={cn(INPUT, "font-mono")} />
            <button onClick={testFolder} disabled={testing || folderMissing}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 shrink-0">
              {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderCheck className="w-4 h-4" />}
              <span className={u}>{t("bk_testFolder")}</span>
            </button>
          </div>
          <p className={cn("text-xs text-gray-400 mt-1", u)}>{t("bk_localFolderHint")}</p>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer w-fit">
          <input type="checkbox" checked={form.scheduleEnabled} disabled={!canConfigure}
            onChange={(e) => set("scheduleEnabled", e.target.checked)} className="w-4 h-4 accent-teal-600" />
          <span className={u}>{t("bk_scheduleEnabled")}</span>
        </label>

        <div className={cn("grid gap-4 sm:grid-cols-3", !form.scheduleEnabled && "opacity-50")}>
          <div>
            <label className={cn("text-xs text-gray-500", u)}>{t("bk_frequency")}</label>
            <select value={form.frequency} disabled={!canConfigure || !form.scheduleEnabled}
              onChange={(e) => set("frequency", e.target.value as BackupConfig["frequency"])} className={cn(INPUT, "mt-1")}>
              <option value="daily">{t("bk_daily")}</option>
              <option value="weekly">{t("bk_weekly")}</option>
            </select>
          </div>
          {form.frequency === "weekly" && (
            <div>
              <label className={cn("text-xs text-gray-500", u)}>{t("bk_weekday")}</label>
              <select value={form.weekday} disabled={!canConfigure || !form.scheduleEnabled}
                onChange={(e) => set("weekday", Number(e.target.value))} className={cn(INPUT, "mt-1")}>
                {weekdays.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={cn("text-xs text-gray-500", u)}>{t("bk_time")}</label>
            <input type="time" value={form.time} disabled={!canConfigure || !form.scheduleEnabled}
              onChange={(e) => set("time", e.target.value)} className={cn(INPUT, "mt-1")} />
          </div>
        </div>

        <div className="space-y-2">
          <div className={cn("text-xs text-gray-500", u)}>{t("bk_formats")}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["json", "bk_fmtJson", "bk_fmtJsonHint", ".json.gz"],
              ["sql", "bk_fmtSql", "bk_fmtSqlHint", ".sql"],
              ["csv", "bk_fmtCsv", "bk_fmtCsvHint", ".csv.zip"],
            ] as const).map(([id, label, hint, ext]) => (
              <label key={id} className={cn("flex items-start gap-2 rounded-xl border p-3 cursor-pointer",
                form.formats.includes(id) ? "border-teal-400 bg-teal-50" : "border-gray-200", !canConfigure && "opacity-60 cursor-default")}>
                <input type="checkbox" checked={form.formats.includes(id)} disabled={!canConfigure}
                  onChange={() => toggleFormat(id)} className="w-4 h-4 mt-0.5 accent-teal-600" />
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium text-gray-800", u)}>
                    {t(label)} <span className="font-mono text-xs font-normal text-gray-400">{ext}</span>
                  </span>
                  <span className={cn("block text-xs text-gray-500 mt-0.5 leading-relaxed", u)}>{t(hint)}</span>
                </span>
              </label>
            ))}
          </div>
          {!form.formats.includes("json") && (
            <p className={cn("text-xs text-amber-700", u)}>{t("bk_noJsonWarn")}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className={cn("text-xs text-gray-500", u)}>{t("bk_destinations")}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.saveToLocal} disabled={!canConfigure}
                onChange={(e) => set("saveToLocal", e.target.checked)} className="w-4 h-4 accent-teal-600" />
              <span className={u}>{t("bk_destLocal")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.uploadToDrive} disabled={!canConfigure}
                onChange={(e) => set("uploadToDrive", e.target.checked)} className="w-4 h-4 accent-teal-600" />
              <span className={u}>{t("bk_destDrive")}</span>
            </label>
          </div>
        </div>

        <div>
          <label className={cn("text-xs text-gray-500", u)}>{t("bk_driveFolder")}</label>
          <input value={form.driveFolderName} disabled={!canConfigure} onChange={(e) => set("driveFolderName", e.target.value)}
            className={cn(INPUT, "mt-1 max-w-xs")} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={cn("text-xs text-gray-500", u)}>{t("bk_keepLocal")}</label>
            <input type="number" min={0} max={3650} value={form.localRetentionDays} disabled={!canConfigure}
              onChange={(e) => set("localRetentionDays", Number(e.target.value))} className={cn(INPUT, "mt-1")} />
          </div>
          <div>
            <label className={cn("text-xs text-gray-500", u)}>{t("bk_keepDrive")}</label>
            <input type="number" min={0} max={3650} value={form.driveRetentionDays} disabled={!canConfigure}
              onChange={(e) => set("driveRetentionDays", Number(e.target.value))} className={cn(INPUT, "mt-1")} />
          </div>
        </div>
        <p className={cn("text-xs text-gray-400 -mt-2", u)}>{t("bk_keepHint")}</p>

        <div className={cn("bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-900", u)}>{t("bk_scheduleNote")}</div>

        {canConfigure && (
          <button onClick={saveSchedule} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-60">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className={u}>{t("bk_saveSchedule")}</span>
          </button>
        )}
      </CollapsibleCard>

      {/* ── Google Drive ─────────────────────────────────────────────────── */}
      <CollapsibleCard urdu={isUrdu}
        title={<><CloudUpload className="w-4 h-4 text-gray-500" /> {t("bk_driveTitle")}</>}
        hint={t("bk_driveHint")}
        aside={
          <span className={cn("text-xs font-semibold rounded-full px-3 py-1", u,
            google.connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
            {google.connected
              ? (google.email ? t("bk_connectedAs").replace("{email}", google.email) : t("bk_connected"))
              : t("bk_notConnected")}
          </span>
        }>

        {canConfigure ? (
          <>
            {connectError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800 flex items-start justify-between gap-3">
                <span className={cn("break-words", u)}>{t("bk_driveConnectFailed").replace("{error}", connectError)}</span>
                <button onClick={() => setConnectError("")} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={cn("text-xs text-gray-500", u)}>{t("bk_clientId")}</label>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off"
                  placeholder="1234567890-abc….apps.googleusercontent.com" className={cn(INPUT, "mt-1 font-mono")} />
              </div>
              <div>
                <label className={cn("text-xs text-gray-500", u)}>{t("bk_clientSecret")}</label>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password"
                  placeholder={google.hasSecret ? t("bk_secretSaved") : "GOCSPX-…"} className={cn(INPUT, "mt-1 font-mono")} />
              </div>
            </div>

            <div>
              <label className={cn("text-xs text-gray-500", u)}>{t("bk_redirectUri")}</label>
              <div className="flex gap-2 mt-1">
                <input readOnly value={redirectUri} onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "font-mono bg-gray-50")} />
                <button onClick={copyRedirect}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 shrink-0">
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  <span className={u}>{copied ? t("bk_copied") : t("bk_copy")}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={saveClient} disabled={savingClient || !clientId.trim() || (!clientSecret.trim() && !google.hasSecret)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                {savingClient ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className={u}>{t("bk_saveCredentials")}</span>
              </button>
              {/* A plain navigation, not fetch: the browser is sent to Google and comes back. */}
              <a href={google.hasClient ? "/api/settings/backup/google/connect" : undefined}
                aria-disabled={!google.hasClient}
                className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white",
                  google.hasClient ? "bg-teal-600 hover:bg-teal-700" : "bg-gray-300 pointer-events-none")}>
                <Link2 className="w-4 h-4" />
                <span className={u}>{google.connected ? t("bk_reconnect") : t("bk_connect")}</span>
              </a>
              {google.connected && (
                <button onClick={() => disconnect(false)}
                  className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
                  <Link2Off className="w-4 h-4" /> <span className={u}>{t("bk_disconnect")}</span>
                </button>
              )}
              <button onClick={() => setGuideOpen(true)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                <BookOpen className="w-4 h-4" /> <span className={u}>{t("bk_setupTitle")}</span>
              </button>
              {google.hasClient && (
                <button onClick={() => disconnect(true)} className={cn("px-3 py-2 text-xs text-gray-400 hover:text-red-600", u)}>
                  {t("bk_forgetCredentials")}
                </button>
              )}
            </div>

            {guideOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                onClick={() => setGuideOpen(false)}>
                <div role="dialog" aria-modal="true" aria-label={t("bk_setupTitle")}
                  className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-start justify-between gap-4">
                    <strong className={cn("text-base text-gray-800", u)}>{t("bk_setupTitle")}</strong>
                    <button onClick={() => setGuideOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <ol className={cn("list-decimal ps-5 space-y-2 text-sm text-gray-700 leading-relaxed", u)}>
                    <li>{t("bk_setup1")}</li><li>{t("bk_setup2")}</li><li>{t("bk_setup3")}</li>
                    <li>{t("bk_setup4")}</li><li>{t("bk_setup5")}</li>
                  </ol>
                  <div className={cn("bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800", u)}>{t("bk_setupWarn")}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className={cn("text-sm text-gray-400", u)}>{t("bk_noConfigPermission")}</p>
        )}
      </CollapsibleCard>

      {/* ── History ──────────────────────────────────────────────────────── */}
      <CollapsibleCard urdu={isUrdu} title={t("bk_historyTitle")}
        aside={
          <span role="button" tabIndex={0} title={t("bk_refresh")} className="text-gray-400 hover:text-gray-600"
            onClick={(e) => { e.stopPropagation(); load(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); load(); } }}>
            <RefreshCw className="w-4 h-4" />
          </span>
        }>
        {data.history.length === 0 ? (
          <p className={cn("text-sm text-gray-400", u)}>{t("bk_historyEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={cn("text-left text-xs text-gray-500 border-b", u)}>
                  <th className="py-2 pe-3 font-medium">{t("bk_colWhen")}</th>
                  <th className="py-2 pe-3 font-medium">{t("bk_colHow")}</th>
                  <th className="py-2 pe-3 font-medium">{t("bk_colWhere")}</th>
                  <th className="py-2 pe-3 font-medium">{t("bk_colSize")}</th>
                  <th className="py-2 font-medium">{t("bk_colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice(0, 15).map((h) => (
                  <tr key={h.at} className="border-b border-gray-50 align-top">
                    <td className="py-2 pe-3 whitespace-nowrap">{fmtWhen(h.at)}</td>
                    <td className={cn("py-2 pe-3", u)}>{h.trigger === "scheduled" ? t("bk_scheduled") : t("bk_manual")}</td>
                    <td className={cn("py-2 pe-3", u)}>
                      {[h.local && t("bk_destLocal"), h.drive && t("bk_destDrive")].filter(Boolean).join(" + ") || "—"}
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {fmtBytes(h.bytes)}
                      {(h.local?.files?.length ?? h.drive?.files?.length ?? 0) > 1 && (
                        <span className="block text-xs text-gray-400">{h.local?.files?.length ?? h.drive?.files?.length} files</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={cn("font-semibold", u, h.ok ? "text-green-600" : "text-red-600")}>
                        {h.ok ? t("bk_ok") : t("bk_failed")}
                      </span>
                      {[h.error, h.local?.error && `${t("bk_destLocal")}: ${h.local.error}`, h.drive?.error && `${t("bk_destDrive")}: ${h.drive.error}`]
                        .filter(Boolean)
                        .map((msg, i) => <div key={i} className="text-xs text-red-500 break-words max-w-md">{msg}</div>)}
                      {h.ok && ((h.local?.deleted ?? 0) + (h.drive?.deleted ?? 0)) > 0 && (
                        <div className={cn("text-xs text-gray-400", u)}>
                          {t("bk_deletedOld").replace("{n}", String((h.local?.deleted ?? 0) + (h.drive?.deleted ?? 0)))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}

function RunButton({ busy, disabled, onClick, icon, label, urdu }: {
  busy: boolean; disabled: boolean; onClick: () => void; icon: React.ReactNode; label: string; urdu: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed">
      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : icon}
      <span className={urdu ? "urdu-text" : undefined}>{label}</span>
    </button>
  );
}

function TaskStrip({ task, urdu, t }: { task: TaskStatus; urdu: boolean; t: (k: TranslationKey) => string }) {
  const u = urdu ? "urdu-text" : "";
  if (!task.supported) {
    return <div className={cn("bg-gray-50 rounded-xl p-3 text-xs text-gray-500", u)}>{t("bk_taskUnsupported")}</div>;
  }
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className={cn("font-medium text-gray-700", u)}>{t("bk_taskTitle")}</span>
      <span className={cn("font-semibold", u, task.registered ? "text-green-600" : "text-gray-500")}>
        {task.registered ? t("bk_taskActive") : t("bk_taskNotScheduled")}
      </span>
      {task.registered && (
        <>
          <span className={cn("text-gray-600", u)}>{t("bk_taskNextRun")}: {task.nextRun ? fmtWhen(task.nextRun) : "—"}</span>
          <span className={cn("text-gray-600", u)}>{t("bk_taskLastRun")}: {task.lastRun ? fmtWhen(task.lastRun) : t("bk_taskNever")}</span>
        </>
      )}
      {task.error && <span className={cn("text-xs text-red-500", u)}>{t("bk_taskError").replace("{error}", task.error)}</span>}
    </div>
  );
}
