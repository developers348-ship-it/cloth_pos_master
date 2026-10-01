import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { deleteBackupFile, readBackupFile, testDataToolsEnabled } from "@/lib/test-data-tools";

export const dynamic = "force-dynamic";

/**
 * GET    /api/settings/clear-test-data/backups/[file]  -> download it
 * DELETE /api/settings/clear-test-data/backups/[file]  -> remove it from disk
 *
 * `file` is matched against lib/test-data-tools.ts's resolveBackupPath, which
 * only accepts a bare filename this app generated — anything else (a path
 * separator, "..", a name it never wrote) is a 404, not a filesystem read.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  if (!testDataToolsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requirePermission("CLEAR_TEST_DATA");
  if (!gate.ok) return gate.response;

  const { file } = await params;
  const text = readBackupFile(file);
  if (text === null) {
    return NextResponse.json({ error: "That backup could not be found." }, { status: 404 });
  }

  return new NextResponse(text, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  if (!testDataToolsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requirePermission("CLEAR_TEST_DATA");
  if (!gate.ok) return gate.response;

  const { file } = await params;
  const removed = deleteBackupFile(file);
  if (!removed) {
    return NextResponse.json({ error: "That backup could not be found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
