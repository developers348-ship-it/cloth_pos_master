/**
 * Support code for the Settings -> Clear Data tab: the env-var kill switch,
 * and disk storage for the automatic "before clear" backups it takes so a
 * clear can be undone with one click.
 *
 * The kill switch is deliberately checked server-side only, in every route
 * under app/api/settings/clear-test-data/**, never via a `NEXT_PUBLIC_*`
 * var — a client-visible flag would ship the toggle (and the fact that this
 * tool exists at all) in the JS bundle of every install, including ones
 * where an installer has turned it off. See docs/settings-accounts.md.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

/** Exactly "true" enables it; unset or anything else (including "false") is off. */
export function testDataToolsEnabled(): boolean {
  return process.env.ENABLE_TEST_DATA_TOOLS === "true";
}

const BACKUPS_DIR = path.join(process.cwd(), "data", "test-data-backups");

function ensureBackupsDir(): string {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  return BACKUPS_DIR;
}

/** Timestamped, filesystem-safe, and sorts newest-last alphabetically. */
function backupFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `clear-${stamp}.json`;
}

/**
 * Only a bare filename this module generated itself is ever accepted back —
 * no path separators, no "..", nothing outside BACKUPS_DIR. Every route that
 * takes a filename from the client (download, restore, delete) runs it
 * through this before touching the filesystem.
 */
export function resolveBackupPath(filename: string): string | null {
  if (typeof filename !== "string" || !/^[A-Za-z0-9._-]+\.json$/.test(filename)) return null;
  const resolved = path.join(BACKUPS_DIR, filename);
  if (path.dirname(resolved) !== BACKUPS_DIR) return null;
  return resolved;
}

export function saveBackupFile(jsonBackup: unknown): string {
  ensureBackupsDir();
  const filename = backupFilename();
  writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(jsonBackup));
  return filename;
}

export function readBackupFile(filename: string): string | null {
  const resolved = resolveBackupPath(filename);
  if (!resolved) return null;
  try {
    return readFileSync(resolved, "utf-8");
  } catch {
    return null;
  }
}

export function deleteBackupFile(filename: string): boolean {
  const resolved = resolveBackupPath(filename);
  if (!resolved) return false;
  try {
    unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

export type BackupListEntry = {
  file: string;
  createdAt: string;
  sizeBytes: number;
  tableCount: number | null;
  rowCount: number | null;
};

/**
 * Newest first. Reads each file's `meta` block to report table/row counts;
 * a file that fails to parse is still listed (so a broken backup isn't
 * silently hidden) with null counts.
 */
export function listBackupFiles(): BackupListEntry[] {
  ensureBackupsDir();
  const files = readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json"));

  return files
    .map((file) => {
      const full = path.join(BACKUPS_DIR, file);
      const stat = statSync(full);
      let tableCount: number | null = null;
      let rowCount: number | null = null;
      try {
        const meta = JSON.parse(readFileSync(full, "utf-8"))?.meta;
        tableCount = typeof meta?.tableCount === "number" ? meta.tableCount : null;
        rowCount = typeof meta?.rowCount === "number" ? meta.rowCount : null;
      } catch {
        // Listed anyway, with null counts — see doc comment above.
      }
      return { file, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size, tableCount, rowCount };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
