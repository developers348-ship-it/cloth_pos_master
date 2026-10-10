import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requirePermission } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * POST /api/settings/backup/folder-test   body: { folder: string }
 *
 * Creates the folder if needed and writes then deletes a tiny probe file, so
 * "this path is typed wrong" or "this drive is read-only" shows up now rather
 * than at 11:30 pm when the scheduled backup fails.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const folder = typeof body?.folder === "string" ? body.folder.trim() : "";
  if (!folder) return NextResponse.json({ ok: false, error: "Enter a folder path first." }, { status: 400 });
  if (!path.isAbsolute(folder)) {
    return NextResponse.json({ ok: false, error: "Use a full path such as D:\\POS_Backups." }, { status: 400 });
  }

  const probe = path.join(folder, `.write-test-${Date.now()}.tmp`);
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
