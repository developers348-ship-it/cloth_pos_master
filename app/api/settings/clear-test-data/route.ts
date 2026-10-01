import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { readDatabase, toJsonBackup } from "@/lib/backup";
import {
  ALL_GROUP_IDS,
  CLEAR_GROUPS,
  clearData,
  isClearConfirmed,
  previewClearGroups,
  resolveGroupSelection,
} from "@/lib/clear-data";
import { listBackupFiles, saveBackupFile, testDataToolsEnabled } from "@/lib/test-data-tools";

export const dynamic = "force-dynamic";

/**
 * Settings -> Clear Data: wipe some or all transactional data to start a
 * fresh round of local testing, with an automatic backup first.
 *
 * Behind two independent gates, both required:
 *   - ENABLE_TEST_DATA_TOOLS=true in the environment (lib/test-data-tools.ts)
 *     — the kill switch an installer sets once for a client deployment, so
 *     this whole route tree acts as if it doesn't exist (404, not 403 —
 *     nothing here should be discoverable from a disabled install).
 *   - CLEAR_TEST_DATA permission (lib/permissions.ts), SUPER_ADMIN by default.
 *
 * GET  ?status=1  -> { enabled } only, cheap — decides whether the Settings
 *                    tab renders at all.
 * GET             -> { enabled, groups, backups } — group definitions with
 *                    live row counts, and the list of restorable backups.
 * POST            -> body { groupIds: string[], confirm: "CLEAR" }. Runs the
 *                    same engine prisma/reset-data.ts uses (lib/clear-data.ts),
 *                    expanded to every group a selection depends on.
 */
export async function GET(req: NextRequest) {
  if (!testDataToolsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requirePermission("CLEAR_TEST_DATA");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  if (searchParams.get("status") === "1") {
    return NextResponse.json({ enabled: true });
  }

  const rows = await previewClearGroups(prisma, ALL_GROUP_IDS);
  const groups = CLEAR_GROUPS.map((group) => {
    const tables = rows.filter((r) => r.id === group.id);
    return {
      id: group.id,
      labelKey: group.labelKey,
      requires: group.requires,
      tables: tables.map(({ table, rows: rowCount }) => ({ table, rows: rowCount })),
      rowCount: tables.reduce((sum, r) => sum + r.rows, 0),
    };
  });

  return NextResponse.json({ enabled: true, groups, backups: listBackupFiles() });
}

export async function POST(req: NextRequest) {
  if (!testDataToolsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requirePermission("CLEAR_TEST_DATA");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { groupIds, confirm } = (body ?? {}) as { groupIds?: unknown; confirm?: unknown };

  if (!isClearConfirmed(confirm)) {
    return NextResponse.json({ error: "Type CLEAR to confirm this deletes the selected data." }, { status: 400 });
  }
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return NextResponse.json({ error: "Choose at least one group to clear." }, { status: 400 });
  }

  const resolved = resolveGroupSelection(groupIds.filter((id): id is string => typeof id === "string"));
  if (resolved.length === 0) {
    return NextResponse.json({ error: "None of the selected groups were recognized." }, { status: 400 });
  }

  let backupFile: string;
  try {
    const dump = await readDatabase();
    backupFile = saveBackupFile(toJsonBackup(dump));
  } catch (error) {
    console.error("[clear-test-data] backup failed", error);
    return NextResponse.json({ error: "Could not take a backup first, so nothing was cleared." }, { status: 500 });
  }

  try {
    const result = await clearData(prisma, resolved);
    return NextResponse.json({ ok: true, backupFile, ...result });
  } catch (error) {
    console.error("[clear-test-data] clear failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Clear failed. No data was changed.",
        backupFile,
      },
      { status: 400 }
    );
  }
}
