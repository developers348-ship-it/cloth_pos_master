import { NextRequest, NextResponse } from "next/server";
import { invalidatePermissionsCache, requirePermission } from "@/lib/authz";
import { inspectBackup, restoreFromJson } from "@/lib/backup";
import { createSafetySnapshot, decodeBackupBytes, readDriveBackup, readLocalBackup } from "@/lib/backup-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Typed into the confirmation box before the button will submit. */
const CONFIRM_PHRASE = "RESTORE";

/**
 * POST /api/settings/backup/restore
 *
 * Replaces the entire database with a backup, in one transaction — so a failure
 * half-way leaves the shop's data untouched rather than half-overwritten.
 *
 * Body: multipart/form-data.
 *   source   "upload" (default) | "local" | "drive"
 *   file     the .json / .json.gz file          (source = upload)
 *   name     a file in the local backup folder  (source = local)
 *   id       a file in the Drive folder         (source = drive)
 *   mode     "inspect" → report what the restore would do and stop
 *   confirm  "RESTORE"
 *   acknowledge  "yes" — required when the inspection found something to warn about
 *
 * Before a real restore the current database is saved to a `pos-prerestore-…`
 * file, and the restore is refused if that cannot be written: a restore of the
 * wrong file should itself be undoable.
 *
 * Gated on DATABASE_RESTORE, which by default only SUPER_ADMIN holds — this is
 * the one endpoint in the app that can destroy every record at once.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("DATABASE_RESTORE");
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }

  const inspectOnly = form.get("mode") === "inspect";
  if (!inspectOnly && String(form.get("confirm") ?? "") !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Type ${CONFIRM_PHRASE} to confirm this replaces all existing data.` },
      { status: 400 }
    );
  }

  // Where the backup comes from. Scheduled backups are gzipped; a manual
  // download is plain JSON — decodeBackupBytes tells them apart by content.
  let text: string;
  try {
    const source = String(form.get("source") ?? "upload");
    let bytes: Buffer;
    if (source === "local") {
      bytes = await readLocalBackup(String(form.get("name") ?? ""));
    } else if (source === "drive") {
      bytes = (await readDriveBackup(String(form.get("id") ?? ""))).bytes;
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Choose a backup file to restore." }, { status: 400 });
      }
      bytes = Buffer.from(await file.arrayBuffer());
    }
    text = decodeBackupBytes(bytes);
  } catch (error) {
    return NextResponse.json(
      { error: `Could not read that backup: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "That file is not valid JSON. A SQL backup has to be imported with psql instead." },
      { status: 400 }
    );
  }

  try {
    const inspection = await inspectBackup(parsed, gate.userId);
    if (inspectOnly) return NextResponse.json({ ok: true, inspection });

    const needsAcknowledgement = inspection.willEmpty.length > 0 || inspection.containsCurrentUser === false;
    if (needsAcknowledgement && form.get("acknowledge") !== "yes") {
      return NextResponse.json(
        { error: "This backup would empty tables or remove your own login. Review the warnings and confirm again.", inspection },
        { status: 409 }
      );
    }

    let safetyFile: string;
    try {
      safetyFile = await createSafetySnapshot();
    } catch (error) {
      return NextResponse.json(
        {
          error: `Nothing was restored: the safety copy of the current data could not be saved (${
            error instanceof Error ? error.message : String(error)
          }).`,
        },
        { status: 500 }
      );
    }

    const report = await restoreFromJson(parsed);
    // The restored rows include Setting["role_permissions"], and the matrix is
    // cached in process for 15 s — drop it so the next request reads the
    // permissions that were just restored rather than the ones replaced.
    invalidatePermissionsCache();
    return NextResponse.json({ ok: true, ...report, safetyFile });
  } catch (error) {
    console.error("[restore] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Restore failed. No data was changed.",
      },
      { status: 400 }
    );
  }
}
