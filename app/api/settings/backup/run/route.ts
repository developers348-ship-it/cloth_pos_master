import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { runBackup } from "@/lib/backup-jobs";
import { getStatus } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
// A whole shop's data can take a while to read, compress and upload.
export const maxDuration = 300;

/**
 * POST /api/settings/backup/run   body: { local: boolean, drive: boolean }
 *
 * The "Save to local folder" / "Upload to Google Drive" / "Both" buttons. The
 * outcome comes back per destination and is also written to the history, the
 * same as a scheduled run.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const local = body?.local === true;
  const drive = body?.drive === true;

  if (drive && !(await getStatus()).connected) {
    return NextResponse.json({ error: "Google Drive is not connected. Connect it first." }, { status: 400 });
  }

  const result = await runBackup({ trigger: "manual", local, drive });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
