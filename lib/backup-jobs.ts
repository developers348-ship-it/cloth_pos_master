import { promises as fs } from "fs";
import path from "path";
import { gzipSync, gunzipSync } from "zlib";
import { prisma } from "@/lib/prisma";
import { SHOP_UTC_OFFSET_MINUTES } from "@/lib/utils";
import { buildZip } from "@/lib/zip";
import { countRows, readDatabase, toCsvEntries, toJsonBackup, toSqlDump, type DatabaseDump } from "@/lib/backup";
import {
  BACKUP_CONFIG_KEY,
  BACKUP_HISTORY_KEY,
  HISTORY_LIMIT,
  FORMAT_MIME,
  backupFileName,
  formatOfFileName,
  isBackupFileName,
  sanitizeConfig,
  selectExpired,
  type BackupConfig,
  type BackupFileKind,
  type BackupFormat,
} from "@/lib/backup-schedule";
import * as drive from "@/lib/google-drive";

/**
 * Creates backup files, puts them in the local folder and/or Google Drive, and
 * trims old ones. Shared by the Settings buttons (through the API) and
 * `scripts/run-backup.ts`, the entry point Windows Task Scheduler runs — so a
 * scheduled backup and a manual one are the same code and the same file.
 *
 * Config and history live in the `Setting` table (keys in backup-schedule.ts),
 * which needs no migration. A restore replays the whole database, so
 * restoreFromJson puts these rows back afterwards.
 */

export type DestinationResult = {
  ok: boolean;
  /** Every file written there — one per chosen format. */
  files?: string[];
  deleted?: number;
  error?: string;
};

export type BackupHistoryEntry = {
  at: string;
  trigger: "manual" | "scheduled";
  /** True only if every destination that was asked for succeeded. */
  ok: boolean;
  bytes?: number;
  rows?: number;
  local?: DestinationResult;
  drive?: DestinationResult;
  /** A failure before any destination was reached (reading the database, bad settings). */
  error?: string;
};

// ─── Config + history ─────────────────────────────────────────────────────────

export async function getConfig(): Promise<BackupConfig> {
  const row = await prisma.setting.findUnique({ where: { key: BACKUP_CONFIG_KEY } });
  if (!row) return sanitizeConfig({});
  try {
    return sanitizeConfig(JSON.parse(row.value));
  } catch {
    return sanitizeConfig({});
  }
}

export async function saveConfig(input: unknown): Promise<BackupConfig> {
  const config = sanitizeConfig(input);
  await prisma.setting.upsert({
    where: { key: BACKUP_CONFIG_KEY },
    create: { key: BACKUP_CONFIG_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
  return config;
}

export async function getHistory(): Promise<BackupHistoryEntry[]> {
  const row = await prisma.setting.findUnique({ where: { key: BACKUP_HISTORY_KEY } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function addHistory(entry: BackupHistoryEntry): Promise<void> {
  const next = [entry, ...(await getHistory())].slice(0, HISTORY_LIMIT);
  await prisma.setting.upsert({
    where: { key: BACKUP_HISTORY_KEY },
    create: { key: BACKUP_HISTORY_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
}

// ─── Building and storing the file ────────────────────────────────────────────

/** `YYYY-MM-DD_HHmm` on the shop's clock. */
function shopStamp(date: Date): string {
  const shop = new Date(date.getTime() + SHOP_UTC_OFFSET_MINUTES * 60_000);
  return shop.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
}

/** One file's bytes for one format, all built from the same read of the database. */
function encodeDump(dump: DatabaseDump, format: BackupFormat): Buffer {
  const bytes =
    format === "sql"
      ? Buffer.from(toSqlDump(dump), "utf8")
      : format === "csv"
      ? Buffer.from(buildZip(toCsvEntries(dump), dump.exportedAt))
      : gzipSync(JSON.stringify(toJsonBackup(dump)));
  if (bytes.byteLength === 0) throw new Error("The backup came out empty — nothing was saved.");
  return bytes;
}

function gzipDump(dump: DatabaseDump): Buffer {
  return encodeDump(dump, "json");
}

/** Where safety copies go when no local folder is configured. */
function fallbackFolder(): string {
  return path.join(process.cwd(), "data", "restore-safety");
}

async function writeLocal(folder: string, file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, file);
  // Write beside the final name, then rename, so a crash never leaves a
  // half-written file that looks like a good backup.
  await fs.writeFile(`${target}.tmp`, bytes);
  await fs.rename(`${target}.tmp`, target);
  if ((await fs.stat(target)).size === 0) throw new Error(`${file} was written empty.`);
}

async function trimLocal(folder: string, days: number): Promise<number> {
  const names = await fs.readdir(folder);
  const files = await Promise.all(
    names.map(async (name) => ({ name, mtimeMs: (await fs.stat(path.join(folder, name))).mtimeMs }))
  );
  const expired = selectExpired(files, Date.now(), days);
  for (const f of expired) await fs.unlink(path.join(folder, f.name));
  return expired.length;
}

async function trimDrive(folderId: string, days: number): Promise<number> {
  const expired = selectExpired(
    (await drive.listFiles(folderId)).map((f) => ({ ...f })),
    Date.now(),
    days
  );
  for (const f of expired) await drive.deleteFile(f.id);
  return expired.length;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let running = false;

/**
 * Takes one backup and sends it to the chosen destinations. Never throws: the
 * outcome — success or the reason for each failure — is returned and recorded in
 * the history, because the caller is often a scheduled task nobody is watching.
 *
 * A failed destination does not stop the other: if Drive is unreachable the
 * local copy is still made, and the entry says exactly which half failed.
 */
export async function runBackup(opts: {
  trigger: "manual" | "scheduled";
  local: boolean;
  drive: boolean;
}): Promise<BackupHistoryEntry> {
  const at = new Date();
  const entry: BackupHistoryEntry = { at: at.toISOString(), trigger: opts.trigger, ok: false };

  if (running) {
    entry.error = "Another backup is already running in this app. Try again in a minute.";
    return entry;
  }
  running = true;

  try {
    if (!opts.local && !opts.drive) throw new Error("Choose at least one destination: the local folder or Google Drive.");
    const config = await getConfig();
    if (opts.local && !config.localFolder) throw new Error("No local backup folder is set. Choose one in Settings → Backup.");

    const dump = await readDatabase();
    const stamp = shopStamp(at);
    // One file per chosen format, every one built from this single read.
    const outputs = config.formats.map((format) => ({
      format,
      file: backupFileName(stamp, "backup", format),
      bytes: encodeDump(dump, format),
    }));
    entry.bytes = outputs.reduce((sum, o) => sum + o.bytes.byteLength, 0);
    entry.rows = countRows(dump);

    if (opts.local) {
      const written: string[] = [];
      const failures: string[] = [];
      for (const o of outputs) {
        try {
          await writeLocal(config.localFolder, o.file, o.bytes);
          written.push(o.file);
        } catch (error) {
          failures.push(`${o.file}: ${message(error)}`);
        }
      }
      let deleted = 0;
      if (written.length > 0) {
        try {
          deleted = await trimLocal(config.localFolder, config.localRetentionDays);
        } catch (error) {
          // The backup itself succeeded; a cleanup problem is not a failed backup.
          console.error("[backup] local retention failed", error);
        }
      }
      entry.local = { ok: failures.length === 0, files: written, deleted, ...(failures.length ? { error: failures.join("; ") } : {}) };
    }

    if (opts.drive) {
      const uploaded: string[] = [];
      const failures: string[] = [];
      let folderId: string | null = null;
      try {
        folderId = await drive.ensureFolder(config.driveFolderName);
      } catch (error) {
        failures.push(message(error));
      }
      if (folderId) {
        for (const o of outputs) {
          try {
            await drive.uploadFile(o.file, o.bytes, folderId, FORMAT_MIME[o.format]);
            uploaded.push(o.file);
          } catch (error) {
            failures.push(`${o.file}: ${message(error)}`);
          }
        }
      }
      let deleted = 0;
      if (folderId && uploaded.length > 0) {
        try {
          deleted = await trimDrive(folderId, config.driveRetentionDays);
        } catch (error) {
          console.error("[backup] Drive retention failed", error);
        }
      }
      entry.drive = { ok: failures.length === 0, files: uploaded, deleted, ...(failures.length ? { error: failures.join("; ") } : {}) };
    }

    entry.ok = [entry.local, entry.drive].filter(Boolean).every((d) => d!.ok);
  } catch (error) {
    entry.error = message(error);
  } finally {
    running = false;
  }

  try {
    await addHistory(entry);
  } catch (error) {
    console.error("[backup] could not record history", error);
  }
  return entry;
}

/** The scheduled task's job: whatever the saved schedule says to do. */
export async function runScheduledBackup(): Promise<BackupHistoryEntry> {
  const config = await getConfig();
  return runBackup({ trigger: "scheduled", local: config.saveToLocal, drive: config.uploadToDrive });
}

/**
 * A copy of the database taken just before a restore, so a restore of the wrong
 * file can itself be undone. Throws on failure — a restore without its safety
 * net should not go ahead.
 */
export async function createSafetySnapshot(): Promise<string> {
  const config = await getConfig();
  const folder = config.localFolder || fallbackFolder();
  const file = backupFileName(shopStamp(new Date()), "prerestore");
  await writeLocal(folder, file, gzipDump(await readDatabase()));
  return path.join(folder, file);
}

// ─── Browsing and reading stored backups ──────────────────────────────────────

export type StoredBackup = {
  name: string;
  bytes: number;
  mtimeMs: number;
  kind: BackupFileKind;
  format: BackupFormat;
  id?: string;
};

function kindOf(name: string): BackupFileKind {
  return name.startsWith("pos-prerestore-") ? "prerestore" : "backup";
}

export async function listLocalBackups(): Promise<StoredBackup[]> {
  const { localFolder } = await getConfig();
  if (!localFolder) return [];
  let names: string[];
  try {
    names = await fs.readdir(localFolder);
  } catch {
    return []; // Folder not created yet.
  }
  const out: StoredBackup[] = [];
  for (const name of names.filter(isBackupFileName)) {
    const stat = await fs.stat(path.join(localFolder, name));
    out.push({ name, bytes: stat.size, mtimeMs: stat.mtimeMs, kind: kindOf(name), format: formatOfFileName(name) ?? "json" });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Only names that match our own pattern are readable — no `..\` out of the folder. */
export async function readLocalBackup(name: string): Promise<Buffer> {
  if (!isBackupFileName(name)) throw new Error("That is not a backup file name.");
  const { localFolder } = await getConfig();
  return fs.readFile(path.join(localFolder, name));
}

export async function listDriveBackups(): Promise<StoredBackup[]> {
  const config = await getConfig();
  const folderId = await drive.ensureFolder(config.driveFolderName);
  return (await drive.listFiles(folderId))
    .filter((f) => isBackupFileName(f.name))
    .map((f) => ({ id: f.id, name: f.name, bytes: f.bytes, mtimeMs: f.mtimeMs, kind: kindOf(f.name), format: formatOfFileName(f.name) ?? "json" }));
}

/** Downloads a Drive backup — but only one that is actually inside our own folder. */
export async function readDriveBackup(id: string): Promise<{ name: string; bytes: Buffer }> {
  const found = (await listDriveBackups()).find((f) => f.id === id);
  if (!found) throw new Error("That file is not in the backup folder on Google Drive.");
  return { name: found.name, bytes: await drive.downloadFile(id) };
}

/** Gzip when the two magic bytes say so, whatever the file is called. */
export function decodeBackupBytes(bytes: Buffer): string {
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
}
