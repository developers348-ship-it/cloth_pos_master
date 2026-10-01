import { NextRequest, NextResponse } from "next/server";
import { invalidatePermissionsCache, requirePermission } from "@/lib/authz";
import { restoreFromJson } from "@/lib/backup";
import { readBackupFile, testDataToolsEnabled } from "@/lib/test-data-tools";

export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "RESTORE";

/**
 * POST /api/settings/clear-test-data/restore
 *
 * One-click undo for a Clear Data run: replaces the entire database with one
 * of the automatic backups already sitting on disk, so there is no file to
 * find and re-upload. Otherwise identical to (and gated the same as)
 * POST /api/settings/backup/restore — DATABASE_RESTORE, since replacing every
 * table is the same operation regardless of where the JSON came from.
 *
 * Body: { file: string, confirm: "RESTORE" }. `file` must be a filename this
 * app generated itself (lib/test-data-tools.ts's resolveBackupPath rejects
 * anything else, including path traversal attempts).
 */
export async function POST(req: NextRequest) {
  if (!testDataToolsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requirePermission("DATABASE_RESTORE");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { file, confirm } = (body ?? {}) as { file?: unknown; confirm?: unknown };

  if (String(confirm ?? "") !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Type ${CONFIRM_PHRASE} to confirm this replaces all existing data.` },
      { status: 400 }
    );
  }
  if (typeof file !== "string") {
    return NextResponse.json({ error: "Choose a backup to restore." }, { status: 400 });
  }

  const text = readBackupFile(file);
  if (text === null) {
    return NextResponse.json({ error: "That backup could not be found." }, { status: 404 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "That backup file is corrupt." }, { status: 400 });
  }

  try {
    const report = await restoreFromJson(parsed);
    // Same reasoning as the Backup tab's restore: the matrix cached for 15s
    // may now be stale.
    invalidatePermissionsCache();
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    console.error("[clear-test-data restore] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Restore failed. No data was changed." },
      { status: 400 }
    );
  }
}
