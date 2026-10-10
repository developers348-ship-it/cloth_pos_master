/**
 * Pure helpers for scheduled backups — no Prisma, no filesystem, so they are
 * unit-tested exactly like the money logic (tests/backup-schedule.test.ts).
 *
 * The moving parts that touch the machine live elsewhere:
 *   - lib/backup-jobs.ts   reads/writes the config and writes the backup file.
 *   - lib/backup-task.ts   registers the Windows Task Scheduler task.
 *   - scripts/run-backup.ts is what the scheduled task actually runs.
 */

export const BACKUP_CONFIG_KEY = "backup_config";
export const BACKUP_HISTORY_KEY = "backup_history";
/** Everything a backup must never contain, and a restore must never overwrite. */
export const BACKUP_SECRET_KEY = "backup_google";
export const PRESERVED_SETTING_KEYS = [BACKUP_CONFIG_KEY, BACKUP_HISTORY_KEY, BACKUP_SECRET_KEY];

export const BACKUP_TASK_NAME = "POS_Database_Backup";
export const HISTORY_LIMIT = 50;

export type BackupFrequency = "daily" | "weekly";

/**
 * What a backup run writes. `json` is the only one the app can restore from
 * itself; `sql` is for `psql -f`; `csv` is a zip of one sheet per table, for
 * Excel. Any combination may be chosen — each run then writes one file per
 * format, all from the same read of the database.
 */
export type BackupFormat = "json" | "sql" | "csv";
export const BACKUP_FORMATS: readonly BackupFormat[] = ["json", "sql", "csv"];
export const FORMAT_EXTENSION: Record<BackupFormat, string> = { json: "json.gz", sql: "sql", csv: "csv.zip" };
export const FORMAT_MIME: Record<BackupFormat, string> = {
  json: "application/gzip",
  sql: "application/sql",
  csv: "application/zip",
};

export type BackupConfig = {
  /** Where `.json.gz` files are written. */
  localFolder: string;
  /** Which files every run writes. At least one. */
  formats: BackupFormat[];
  /** What a *scheduled* run does with the backup. Manual buttons choose for themselves. */
  saveToLocal: boolean;
  uploadToDrive: boolean;
  /** Folder name created (and only ever looked for) in the connected Drive. */
  driveFolderName: string;
  /** Run on a schedule at all. Manual buttons work either way. */
  scheduleEnabled: boolean;
  frequency: BackupFrequency;
  /** `HH:mm`, 24-hour, on the PC's clock (Task Scheduler uses local time). */
  time: string;
  /** 0 = Sunday … 6 = Saturday. Only used when frequency is weekly. */
  weekday: number;
  /** Local files older than this are deleted after each backup. 0 = keep all. */
  localRetentionDays: number;
  /** The same, for the Drive folder. */
  driveRetentionDays: number;
};

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  localFolder: "D:\\POS_Backups",
  formats: ["json"],
  saveToLocal: true,
  uploadToDrive: false,
  driveFolderName: "POS_Backups",
  scheduleEnabled: false,
  frequency: "daily",
  time: "23:30",
  weekday: 0,
  localRetentionDays: 30,
  driveRetentionDays: 60,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Known formats only, de-duplicated, in a fixed order; nothing valid means JSON. */
export function sanitizeFormats(input: unknown): BackupFormat[] {
  const wanted = new Set(Array.isArray(input) ? input : []);
  const chosen = BACKUP_FORMATS.filter((f) => wanted.has(f));
  return chosen.length > 0 ? chosen : ["json"];
}

/** Anything missing or out of range falls back to the default for that field. */
export function sanitizeConfig(input: unknown): BackupConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_BACKUP_CONFIG;
  const retention = (value: unknown, fallback: number) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 && n <= 3650 ? n : fallback;
  };
  const weekday = Math.round(Number(raw.weekday));
  return {
    localFolder: typeof raw.localFolder === "string" ? raw.localFolder.trim() : d.localFolder,
    formats: sanitizeFormats(raw.formats),
    saveToLocal: typeof raw.saveToLocal === "boolean" ? raw.saveToLocal : d.saveToLocal,
    uploadToDrive: typeof raw.uploadToDrive === "boolean" ? raw.uploadToDrive : d.uploadToDrive,
    driveFolderName:
      typeof raw.driveFolderName === "string" && raw.driveFolderName.trim()
        ? raw.driveFolderName.trim().slice(0, 100)
        : d.driveFolderName,
    scheduleEnabled: typeof raw.scheduleEnabled === "boolean" ? raw.scheduleEnabled : d.scheduleEnabled,
    frequency: raw.frequency === "weekly" ? "weekly" : "daily",
    time: typeof raw.time === "string" && TIME_RE.test(raw.time) ? raw.time : d.time,
    weekday: Number.isFinite(weekday) && weekday >= 0 && weekday <= 6 ? weekday : d.weekday,
    localRetentionDays: retention(raw.localRetentionDays, d.localRetentionDays),
    driveRetentionDays: retention(raw.driveRetentionDays, d.driveRetentionDays),
  };
}

// ─── File names ───────────────────────────────────────────────────────────────

/** `backup` = a normal run; `prerestore` = the safety copy taken just before a restore. */
export type BackupFileKind = "backup" | "prerestore";

/** Only files that look exactly like ours are ever listed, restored or deleted. */
const FILE_RE = /^pos-(backup|prerestore)-\d{4}-\d{2}-\d{2}_\d{4}\.(json\.gz|sql|csv\.zip)$/;

/** `stamp` is `YYYY-MM-DD_HHmm` on the shop's clock. */
export function backupFileName(stamp: string, kind: BackupFileKind = "backup", format: BackupFormat = "json"): string {
  return `pos-${kind}-${stamp}.${FORMAT_EXTENSION[format]}`;
}

export function isBackupFileName(name: string): boolean {
  return FILE_RE.test(name);
}

/** Which format a backup file name is, or null if it isn't one of ours. */
export function formatOfFileName(name: string): BackupFormat | null {
  if (!FILE_RE.test(name)) return null;
  return BACKUP_FORMATS.find((f) => name.endsWith(`.${FORMAT_EXTENSION[f]}`)) ?? null;
}

/**
 * Which files retention should delete — works for local files and Drive files
 * alike, since all it needs is a name and a modified time. Never touches a file
 * that doesn't match our own naming pattern (the folder may be shared with other
 * things), and never the newest backup *of each format*, so a clock jump can't
 * empty the folder and a run that writes three formats keeps all three.
 */
export function selectExpired<T extends { name: string; mtimeMs: number }>(
  files: T[],
  nowMs: number,
  retentionDays: number
): T[] {
  if (retentionDays <= 0) return [];
  const cutoff = nowMs - retentionDays * 86_400_000;
  const expired: T[] = [];
  for (const format of BACKUP_FORMATS) {
    const ours = files.filter((f) => formatOfFileName(f.name) === format).sort((a, b) => b.mtimeMs - a.mtimeMs);
    expired.push(...ours.slice(1).filter((f) => f.mtimeMs < cutoff));
  }
  return expired;
}

// ─── Windows Task Scheduler ───────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Doubles single quotes so a value can sit inside a PowerShell '...' literal. */
function ps(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The PowerShell that creates (or replaces) the task. `-StartWhenAvailable`
 * runs a missed backup as soon as the PC is back on; the restart settings retry
 * a failed run 3 times, 10 minutes apart. Runs as the current Windows user, so
 * no admin rights are needed — but only while that user is logged on.
 */
export function buildRegisterScript(config: BackupConfig, wrapperCmdPath: string): string {
  const [hh, mm] = config.time.split(":");
  const at = `${hh}:${mm}`;
  const trigger =
    config.frequency === "weekly"
      ? `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${WEEKDAYS[config.weekday]} -At ${ps(at)}`
      : `New-ScheduledTaskTrigger -Daily -At ${ps(at)}`;
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ${ps(`/c ""${wrapperCmdPath}""`)}`,
    `$trigger = ${trigger}`,
    `$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `Register-ScheduledTask -TaskName ${ps(BACKUP_TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
  ].join("\n");
}

export function buildUnregisterScript(): string {
  return `Unregister-ScheduledTask -TaskName ${ps(BACKUP_TASK_NAME)} -Confirm:$false -ErrorAction Stop`;
}

export function buildStatusScript(): string {
  return [
    `$t = Get-ScheduledTask -TaskName ${ps(BACKUP_TASK_NAME)} -ErrorAction SilentlyContinue`,
    `if (-not $t) { '{"registered":false}'; exit 0 }`,
    `$i = $t | Get-ScheduledTaskInfo`,
    // Windows PowerShell 5.1 writes DateTime to JSON as "/Date(…)/", which nothing
    // else reads; ISO text it is. A task that has never run reports year 1999.
    `$iso = { param($d) if ($d -and $d.Year -gt 2000) { $d.ToString('o') } else { $null } }`,
    `[pscustomobject]@{ registered = $true; state = [string]$t.State; lastRun = (& $iso $i.LastRunTime); nextRun = (& $iso $i.NextRunTime); lastResult = $i.LastTaskResult } | ConvertTo-Json -Compress`,
  ].join("\n");
}

/** `powershell -EncodedCommand` takes base64 UTF-16LE — no quoting to get wrong. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
