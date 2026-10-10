"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Check, Download, RefreshCw, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import type { BackupInspection } from "@/lib/backup";
import type { StoredBackup } from "@/lib/backup-jobs";
import { fmtWhen } from "@/components/settings/BackupAutomation";
import CollapsibleCard from "@/components/settings/CollapsibleCard";

/**
 * Settings → Backup → "Restore from Backup".
 *
 * A backup can come from three places — a file picked from this computer, the
 * local backup folder, or Google Drive — and in every case the file is
 * *inspected* before anything happens: how much it holds, which tables a
 * restore would leave empty because the file predates them, and whether the
 * person pressing the button would still be able to sign in afterwards. Warnings
 * must be acknowledged, and the RESTORE phrase typed, before the button works.
 * The server then saves the current data to a safety file first.
 */

type Source = "upload" | "local" | "drive";

type Selection = { source: Source; label: string; file?: File; name?: string; id?: string };

type Files = { local: StoredBackup[]; drive: StoredBackup[] | null; driveError: string | null };

type Report = {
  tablesRestored: number;
  rowsRestored: number;
  warnings: string[];
  safetyFile?: string;
};

/** Typed into the confirmation box before a restore will run. Matches the API. */
const RESTORE_PHRASE = "RESTORE";

function fmtBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupRestore({ onRestored }: { onRestored: () => void }) {
  const { t, isUrdu } = useI18n();
  const { can } = usePermissions();
  const u = isUrdu ? "urdu-text" : "";

  const [source, setSource] = useState<Source>("upload");
  const [files, setFiles] = useState<Files | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFiles() {
    const res = await fetch("/api/settings/backup/files").catch(() => null);
    if (res?.ok) setFiles(await res.json());
  }

  useEffect(() => {
    // Reload the list when the source changes; the setState happens after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (source !== "upload") loadFiles();
  }, [source]);

  function body(sel: Selection): FormData {
    const form = new FormData();
    form.append("source", sel.source);
    if (sel.file) form.append("file", sel.file);
    if (sel.name) form.append("name", sel.name);
    if (sel.id) form.append("id", sel.id);
    return form;
  }

  async function choose(sel: Selection) {
    setSelection(sel);
    setInspection(null);
    setAcknowledged(false);
    setReport(null);
    setInspecting(true);
    try {
      const form = body(sel);
      form.append("mode", "inspect");
      const res = await fetch("/api/settings/backup/restore", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);
      setInspection(data.inspection);
    } catch (e) {
      setSelection(null);
      toast.error(e instanceof Error && e.message ? e.message : t("settings_restoreFailedMsg"), { duration: 8000 });
    } finally {
      setInspecting(false);
    }
  }

  function changeSource(next: Source) {
    setSource(next);
    setSelection(null);
    setInspection(null);
    setReport(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const warned = Boolean(inspection && (inspection.willEmpty.length > 0 || inspection.containsCurrentUser === false));
  const ready =
    Boolean(selection && inspection) &&
    confirm.trim().toUpperCase() === RESTORE_PHRASE &&
    (!warned || acknowledged) &&
    !restoring;

  async function restore() {
    if (!selection || !inspection) return;
    if (warned && !acknowledged) { toast.error(t("bk_restoreNeedAck")); return; }
    if (!window.confirm(t("settings_confirmRestore"))) return;

    setRestoring(true);
    setReport(null);
    try {
      const form = body(selection);
      form.append("confirm", RESTORE_PHRASE);
      if (acknowledged) form.append("acknowledge", "yes");
      const res = await fetch("/api/settings/backup/restore", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);

      setReport(data);
      setSelection(null);
      setInspection(null);
      setConfirm("");
      setAcknowledged(false);
      if (fileRef.current) fileRef.current.value = "";
      toast.success(
        t("settings_restoreDoneMsg").replace("{tables}", String(data.tablesRestored)).replace("{rows}", Number(data.rowsRestored).toLocaleString()),
        { duration: 6000 }
      );
      onRestored();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("settings_restoreFailedMsg"), { duration: 8000 });
    } finally {
      setRestoring(false);
    }
  }

  // Only JSON can be restored in the app; SQL and CSV copies are for psql and Excel.
  const list = (source === "local" ? files?.local : files?.drive)?.filter((f) => f.format === "json");

  return (
    <CollapsibleCard urdu={isUrdu}
      title={<><Upload className="w-4 h-4 text-gray-500" /> {t("settings_restoreImport")}</>}
      hint={t("settings_restoreImportHint")}>

      {!can("DATABASE_RESTORE") ? (
        <p className={cn("text-sm text-gray-400 bg-gray-50 rounded-xl p-4", u)}>{t("settings_restoreNoPermission")}</p>
      ) : (
        <>
          <div className={cn("bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 flex gap-3", u)}>
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <strong className="block">{t("settings_restoreWarningTitle")}</strong>
              <span className="leading-relaxed">{t("settings_restoreWarningBody")}</span>
              <span className="block mt-1 text-red-700">{t("bk_safetyNote")}</span>
            </div>
          </div>

          {/* Where from */}
          <div className="space-y-2">
            <div className={cn("text-xs text-gray-500", u)}>{t("bk_restoreSource")}</div>
            <div className="flex flex-wrap gap-2">
              {(["upload", "local", "drive"] as const).map((s) => (
                <button key={s} onClick={() => changeSource(s)}
                  className={cn("px-4 py-2 rounded-lg text-sm border", u,
                    source === s ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50")}>
                  {t(s === "upload" ? "bk_srcUpload" : s === "local" ? "bk_srcLocal" : "bk_srcDrive")}
                </button>
              ))}
            </div>
          </div>

          {source === "upload" ? (
            <div>
              <label className={cn("text-xs text-gray-500", u)}>{t("bk_backupFileLabel")}</label>
              <input ref={fileRef} type="file" accept=".json,.gz,application/json,application/gzip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) choose({ source: "upload", file, label: file.name });
                  else { setSelection(null); setInspection(null); }
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm" />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end">
                <button onClick={loadFiles} title={t("bk_refresh")} className="text-gray-400 hover:text-gray-600">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              {source === "drive" && files?.driveError && (
                <p className="text-sm text-red-600">{t("bk_driveListError").replace("{error}", files.driveError)}</p>
              )}
              {list && list.length === 0 && !files?.driveError && (
                <p className={cn("text-sm text-gray-400", u)}>{t("bk_filesEmpty")}</p>
              )}
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl max-h-72 overflow-y-auto">
                {(list ?? []).map((f) => {
                  const picked = selection?.source === source && (source === "local" ? selection.name === f.name : selection.id === f.id);
                  return (
                    <div key={f.id ?? f.name} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-sm", picked && "bg-teal-50")}>
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-gray-800 truncate">{f.name}</div>
                        <div className={cn("text-xs text-gray-400", u)}>
                          {fmtWhen(f.mtimeMs)} · {fmtBytes(f.bytes)}
                          {f.kind === "prerestore" && ` · ${t("bk_kindPrerestore")}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <a title={t("bk_download")} className="text-gray-400 hover:text-teal-700"
                          href={`/api/settings/backup/files/download?source=${source}&${source === "local" ? `name=${encodeURIComponent(f.name)}` : `id=${encodeURIComponent(f.id ?? "")}`}`}>
                          <Download className="w-4 h-4" />
                        </a>
                        <button onClick={() => choose({ source, label: f.name, name: source === "local" ? f.name : undefined, id: source === "drive" ? f.id : undefined })}
                          className={cn("px-3 py-1 rounded-md text-xs border", u,
                            picked ? "bg-teal-600 text-white border-teal-600" : "border-gray-300 text-gray-600 hover:bg-gray-50")}>
                          {picked ? <Check className="w-3.5 h-3.5" /> : t("bk_select")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* What the chosen file would do */}
          {inspecting && (
            <p className={cn("text-sm text-gray-500 flex items-center gap-2", u)}>
              <RefreshCw className="w-4 h-4 animate-spin" /> {t("bk_inspecting")}
            </p>
          )}
          {selection && inspection && (
            <div className="border border-gray-200 rounded-xl p-4 space-y-3 text-sm">
              <div className={cn("font-semibold text-gray-700", u)}>{t("bk_inspectTitle")}</div>
              <div className="font-mono text-xs text-gray-500 break-all">{t("bk_selected").replace("{name}", selection.label)}</div>
              <div className={cn("text-gray-700", u)}>
                {t("bk_inspectSummary").replace("{tables}", String(inspection.tables)).replace("{rows}", inspection.rows.toLocaleString())}
                {inspection.exportedAt && ` — ${t("bk_takenAt").replace("{date}", fmtWhen(inspection.exportedAt))}`}
              </div>

              {inspection.willEmpty.length > 0 && (
                <div className={cn("bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900", u)}>
                  <div className="font-medium">{t("bk_warnEmpty")}</div>
                  <ul className="list-disc ps-5 mt-1 text-xs space-y-0.5">
                    {inspection.willEmpty.map((w) => (
                      <li key={w.table}><span className="font-mono">{w.table}</span> ({w.rows.toLocaleString()})</li>
                    ))}
                  </ul>
                </div>
              )}
              {inspection.containsCurrentUser === false && (
                <div className={cn("bg-red-50 border border-red-200 rounded-lg p-3 text-red-800", u)}>{t("bk_warnUser")}</div>
              )}
              {inspection.unknownTables.length > 0 && (
                <div className={cn("text-xs text-gray-500", u)}>
                  {t("bk_warnUnknown").replace("{tables}", inspection.unknownTables.join(", "))}
                </div>
              )}
              {warned && (
                <label className="flex items-center gap-2 cursor-pointer w-fit">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="w-4 h-4 accent-red-600" />
                  <span className={cn("font-medium", u)}>{t("bk_acknowledge")}</span>
                </label>
              )}
            </div>
          )}

          <div>
            <label className={cn("text-xs text-gray-500", u)}>{t("settings_typeToConfirmLabel").replace("{phrase}", RESTORE_PHRASE)}</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={RESTORE_PHRASE}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 font-mono tracking-widest max-w-xs" />
          </div>

          <button onClick={restore} disabled={!ready}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {restoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span className={u}>{restoring ? t("settings_restoring") : t("settings_restoreNow")}</span>
          </button>

          {report && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-900 space-y-2">
              <div className={cn("font-semibold flex items-center gap-2", u)}>
                <Check className="w-4 h-4" />
                {t("settings_restoreDoneMsg").replace("{tables}", String(report.tablesRestored)).replace("{rows}", report.rowsRestored.toLocaleString())}
              </div>
              {report.safetyFile && (
                <p className={cn("text-xs font-mono break-all", u)}>{t("bk_safetyDone").replace("{file}", report.safetyFile)}</p>
              )}
              {report.warnings.length > 0 && (
                <ul className="list-disc ps-5 space-y-1 text-amber-800">
                  {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <p className={cn("text-xs text-green-700", u)}>{t("settings_restoreReloadHint")}</p>
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
