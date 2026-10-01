import { NextRequest, NextResponse } from "next/server";
import { invalidatePermissionsCache, requirePermission } from "@/lib/authz";
import { restoreFromJson } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** Typed into the confirmation box before the button will submit. */
const CONFIRM_PHRASE = "RESTORE";

/**
 * POST /api/settings/backup/restore
 *
 * Replaces the entire database with the contents of a JSON backup, in one
 * transaction — so a failure half-way leaves the shop's data untouched rather
 * than half-overwritten.
 *
 * Body: multipart/form-data with `file` (the .json backup) and
 * `confirm` = "RESTORE".
 *
 * Gated on DATABASE_RESTORE, which by default only SUPER_ADMIN holds — this is
 * the one endpoint in the app that can destroy every record at once.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("DATABASE_RESTORE");
  if (!gate.ok) return gate.response;

  let text: string;
  try {
    const form = await req.formData();
    if (String(form.get("confirm") ?? "") !== CONFIRM_PHRASE) {
      return NextResponse.json(
        { error: `Type ${CONFIRM_PHRASE} to confirm this replaces all existing data.` },
        { status: 400 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a .json backup file to restore." }, { status: 400 });
    }
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
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
    const report = await restoreFromJson(parsed);
    // The restored rows include Setting["role_permissions"], and the matrix is
    // cached in process for 15 s — drop it so the next request reads the
    // permissions that were just restored rather than the ones replaced.
    invalidatePermissionsCache();
    return NextResponse.json({ ok: true, ...report });
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
