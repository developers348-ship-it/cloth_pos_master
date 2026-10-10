import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { getConfig, getHistory, saveConfig } from "@/lib/backup-jobs";
import { applySchedule, taskStatus } from "@/lib/backup-task";
import { sanitizeConfig } from "@/lib/backup-schedule";
import { getStatus } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET  /api/settings/backup/config — saved settings, recent runs, what Windows
 *                                    Task Scheduler currently holds, and the
 *                                    Google Drive connection (never its secrets).
 * PUT  /api/settings/backup/config — saves the settings and makes the Windows
 *                                    task match them (or removes it when the
 *                                    schedule is switched off).
 *
 * Reading needs DATABASE_BACKUP; changing needs SYSTEM_CONFIG (Super Admin by
 * default), because a schedule decides where the shop's whole database is sent.
 */
export async function GET() {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const [config, history, task, google] = await Promise.all([getConfig(), getHistory(), taskStatus(), getStatus()]);
  return NextResponse.json({ config, history, task, google });
}

export async function PUT(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send the backup settings as JSON." }, { status: 400 });
  }

  const config = await saveConfig(sanitizeConfig(body));
  let warning: string | undefined;
  if (config.scheduleEnabled && config.uploadToDrive && !(await getStatus()).connected) {
    warning = "Saved, but Google Drive is not connected — scheduled uploads will fail until it is.";
  }
  try {
    const task = await applySchedule(config);
    return NextResponse.json({ config, task, warning });
  } catch (error) {
    // The settings are saved; only the Windows task could not be updated.
    console.error("[backup] could not update the scheduled task", error);
    return NextResponse.json({
      config,
      task: await taskStatus(),
      warning: `Settings saved, but Windows Task Scheduler could not be updated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}
