# Automatic & cloud backup

Settings → **Backup** tab. Three layers sit on one engine:

| Layer | Where | What it does |
| --- | --- | --- |
| Engine | [lib/backup.ts](../lib/backup.ts) | Dumps every table (introspected, not hand-listed), builds `.sql` / `.json` / CSV zip, restores JSON in one transaction. Described in [settings-accounts.md](settings-accounts.md#backup-tab). |
| Jobs | [lib/backup-jobs.ts](../lib/backup-jobs.ts), [lib/google-drive.ts](../lib/google-drive.ts), [lib/backup-task.ts](../lib/backup-task.ts) | Writes a gzipped backup to a local folder and/or Google Drive, trims old ones, records history, registers the Windows scheduled task. |
| UI | [components/settings/BackupAutomation.tsx](../components/settings/BackupAutomation.tsx), [BackupRestore.tsx](../components/settings/BackupRestore.tsx) | Run now, folder, schedule, Drive connection, history; restore from a file / local folder / Drive. Strings are in [lib/translations/backup.ts](../lib/translations/backup.ts) (`bk_` prefix). |

The pure parts — config validation, file naming, retention selection, the PowerShell that registers the task — are in [lib/backup-schedule.ts](../lib/backup-schedule.ts) with no Prisma import, so [tests/backup-schedule.test.ts](../tests/backup-schedule.test.ts) covers them like the money logic. [tests/google-drive.test.ts](../tests/google-drive.test.ts) drives the Drive module against a faked Google (stubbed `fetch`, in-memory `Setting`).

## How a scheduled backup runs

**Windows Task Scheduler**, not a timer inside the web server. Saving the schedule in Settings makes the server run PowerShell (`Register-ScheduledTask`, see `buildRegisterScript`) to create the task **`POS_Database_Backup`**; switching the schedule off removes it. The task runs `scripts/run-backup.cmd` → `npm run backup:run` → [scripts/run-backup.ts](../scripts/run-backup.ts), which talks to the database directly. So:

- **It works with the POS server switched off.** Only the database has to be up.
- It loads `.env.local` itself (`@next/env`) and prints the database host it is using — check that line in `backup.log`; `.env` and `.env.local` can point at different databases in this repo (see CLAUDE.md).
- Output is appended to **`backup.log`** in the project root (gitignored). Exit code 0 = every chosen destination saved, 1 = something failed. Each run is also recorded in the history table.
- Task settings: `-StartWhenAvailable` (a run missed because the PC was off happens when it is next on), 3 retries 10 minutes apart, 2-hour limit.
- It runs **as the current Windows user, only while that user is logged in** — no password is stored. Running with nobody logged in would need that user's Windows password.
- It uses the **PC's clock**; set the PC's time zone to Pakistan so "23:30" means 23:30 in the shop.

Verified end to end on 2026-10-09: registered the task, started it through Windows, got exit 0, a file in the folder and a log entry, then removed it.

## Settings and storage

Everything is in the existing **`Setting`** table — no migration:

| Key | Holds |
| --- | --- |
| `backup_config` | Folder, schedule, destinations, retention, Drive folder name (`BackupConfig`, validated by `sanitizeConfig`). |
| `backup_history` | The last 50 runs: when, manual/scheduled, per-destination result, size, error. |
| `backup_google` | Google Client ID, Client Secret, refresh token, account email, cached Drive folder id. **Server-side only.** |

`backup_google` is **left out of every backup** (`readDatabase` filters it), and all three keys are **put back after a restore** (`PRESERVED_SETTING_KEYS` in `restoreFromJson`). A restore truncates `Setting` like every other table, and without that the owner would be disconnected from Drive by restoring a backup. Checked against a scratch database: schedule and credentials survive, and the secret never appears in a backup file.

**Formats are a setting** (`BackupConfig.formats`, any combination, JSON by default). Every run — scheduled or manual, local or Drive — writes one file per ticked format, all built from a single read of the database, so they describe the same moment:

| Format | File | Use |
| --- | --- | --- |
| `json` | `pos-backup-YYYY-MM-DD_HHmm.json.gz` | Gzipped JSON. **The only one the app can restore from**, found by gzip magic bytes rather than file name. |
| `sql` | `pos-backup-….sql` | `psql -f`, into a database whose schema already matches. Plain text, larger. |
| `csv` | `pos-backup-….csv.zip` | One CSV per table for Excel. Read-only. |

The screen warns when JSON is unticked, since then nothing can be restored in-app, and the restore lists show JSON files only. Runs use the **saved** settings, so the run buttons are disabled while the form has unsaved changes. Nothing is encrypted; anyone who can read the folder or the Drive can read the shop's data.

**Retention** (`selectExpired`) deletes only files matching our own name pattern, never the newest one *of each format*, and treats `0` days as "keep everything". The same function trims local files and Drive files.

## Permissions

| Action | Permission |
| --- | --- |
| See settings/history, run a backup, download stored backups, test the folder | `DATABASE_BACKUP` (Super Admin, Admin) |
| Change the schedule, folder, retention, Google credentials, connect/disconnect | `SYSTEM_CONFIG` (Super Admin) |
| Restore | `DATABASE_RESTORE` (Super Admin) |

## Google Drive

Plain `fetch` against Google's endpoints; no `googleapis` package. Scope is **`drive.file`** — the app sees only files it created itself. A folder with the same name that a person made by hand is therefore invisible and not reused; the app creates its own.

The owner creates an OAuth client (type **Web application**) in Google Cloud and pastes the Client ID and Secret into Settings. The Redirect URI to register is shown on screen (`<origin>/api/settings/backup/google/callback`) and must match exactly, including the port. **Connect** is a full-page redirect to Google and back; a random `state` in an httpOnly cookie guards the callback.

Two traps:

- **A consent screen left in "Testing" expires the refresh token after 7 days.** Every upload then fails with `invalid_grant` (turned into a "reconnect" message). The screen tells the owner to set it to "In production"; for a single shop's own use no Google verification is needed.
- **Don't use a service account.** On a normal personal Drive it has no storage quota and cannot own files.

Never commit the OAuth client download: `client_secret_*.json` is gitignored.

## Restore

[`POST /api/settings/backup/restore`](../app/api/settings/backup/restore/route.ts) takes a file, or a name in the local folder, or a Drive file id. It always **inspects first** (`inspectBackup`): row counts, the tables a restore would leave **empty** because the file predates them, tables the database doesn't have, and whether the signed-in user's id is in the file's `User` table. Warnings must be acknowledged. Before the real restore it writes **`pos-prerestore-….json.gz`** (to the local folder, or `data/restore-safety/` if none is set) and **refuses to restore if that fails**.

`TRUNCATE … CASCADE` runs on every live table, so a file missing a table empties it — that is the case the warning exists for.

## Not done / known limits

- No alert outside Settings when a scheduled run fails; the history and the task strip show it. A dashboard banner would be the next step.
- Drive upload is one resumable PUT of the whole file, not chunked; fine for a shop's data, revisit if backups reach hundreds of MB.
- `backup:run` needs Node and the project's `node_modules` on the PC; the `.cmd` assumes `npm` is on the PATH of the logged-in user.
- Task Scheduler is Windows-only; elsewhere the screen says so and manual backups still work.
