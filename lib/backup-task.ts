import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import {
  buildRegisterScript,
  buildStatusScript,
  buildUnregisterScript,
  encodePowerShell,
  type BackupConfig,
} from "@/lib/backup-schedule";

const run = promisify(execFile);

/**
 * Talks to Windows Task Scheduler through PowerShell. Only meaningful on the
 * Windows shop PC the app runs on — elsewhere every call reports why it can't.
 */

export type TaskStatus = {
  supported: boolean;
  registered: boolean;
  state?: string;
  lastRun?: string | null;
  nextRun?: string | null;
  lastResult?: number;
  error?: string;
};

async function powershell(script: string): Promise<string> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)],
    { windowsHide: true, timeout: 30_000 }
  );
  return stdout.trim();
}

/** The `.cmd` the task launches — it lives in the project, next to the script. */
export function wrapperPath(): string {
  return path.join(process.cwd(), "scripts", "run-backup.cmd");
}

export async function taskStatus(): Promise<TaskStatus> {
  if (process.platform !== "win32") {
    return { supported: false, registered: false, error: "Scheduled backups need Windows Task Scheduler." };
  }
  try {
    const out = await powershell(buildStatusScript());
    const parsed = JSON.parse(out || "{}");
    return { supported: true, registered: Boolean(parsed.registered), ...parsed };
  } catch (error) {
    return { supported: true, registered: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Creates or replaces the task to match the saved schedule; removes it when the schedule is off. */
export async function applySchedule(config: BackupConfig): Promise<TaskStatus> {
  if (process.platform !== "win32") return taskStatus();
  if (config.scheduleEnabled) {
    await powershell(buildRegisterScript(config, wrapperPath()));
  } else if ((await taskStatus()).registered) {
    await powershell(buildUnregisterScript());
  }
  return taskStatus();
}
