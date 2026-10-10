import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { listDriveBackups, listLocalBackups } from "@/lib/backup-jobs";
import { getStatus } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET — the backups that exist: in the local folder, and in the Drive folder when
 * Drive is connected. A Drive failure is reported beside the local list rather
 * than failing the whole call, so a Google outage never hides the local copies.
 */
export async function GET() {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const local = await listLocalBackups();
  let drive = null;
  let driveError: string | null = null;
  if ((await getStatus()).connected) {
    try {
      drive = await listDriveBackups();
    } catch (error) {
      driveError = error instanceof Error ? error.message : String(error);
    }
  }
  return NextResponse.json({ local, drive, driveError });
}
