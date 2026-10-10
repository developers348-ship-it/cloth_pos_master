import { describe, expect, it } from "vitest";
import {
  BACKUP_TASK_NAME,
  DEFAULT_BACKUP_CONFIG,
  backupFileName,
  buildRegisterScript,
  encodePowerShell,
  formatOfFileName,
  isBackupFileName,
  sanitizeFormats,
  sanitizeConfig,
  selectExpired,
} from "@/lib/backup-schedule";

const DAY = 86_400_000;

describe("sanitizeConfig", () => {
  it("returns the defaults for nothing or garbage", () => {
    expect(sanitizeConfig(undefined)).toEqual(DEFAULT_BACKUP_CONFIG);
    expect(sanitizeConfig("nope")).toEqual(DEFAULT_BACKUP_CONFIG);
  });

  it("rejects out-of-range values field by field", () => {
    const c = sanitizeConfig({ time: "25:99", weekday: 9, localRetentionDays: -4, frequency: "hourly" });
    expect(c.time).toBe(DEFAULT_BACKUP_CONFIG.time);
    expect(c.weekday).toBe(DEFAULT_BACKUP_CONFIG.weekday);
    expect(c.localRetentionDays).toBe(DEFAULT_BACKUP_CONFIG.localRetentionDays);
    expect(c.frequency).toBe("daily");
  });

  it("keeps valid values", () => {
    const c = sanitizeConfig({ time: "02:15", frequency: "weekly", weekday: 3, localFolder: " E:\\B ", localRetentionDays: 0 });
    expect(c).toMatchObject({ time: "02:15", frequency: "weekly", weekday: 3, localFolder: "E:\\B", localRetentionDays: 0 });
  });
});

describe("formats", () => {
  it("defaults to JSON when nothing valid is chosen", () => {
    expect(sanitizeFormats(undefined)).toEqual(["json"]);
    expect(sanitizeFormats([])).toEqual(["json"]);
    expect(sanitizeFormats(["xml", 3])).toEqual(["json"]);
  });
  it("keeps known formats once each, in a fixed order", () => {
    expect(sanitizeFormats(["csv", "sql", "csv", "nope"])).toEqual(["sql", "csv"]);
  });
  it("is part of the config", () => {
    expect(sanitizeConfig({ formats: ["sql", "json"] }).formats).toEqual(["json", "sql"]);
    expect(sanitizeConfig({}).formats).toEqual(["json"]);
  });
  it("gives each format its own file name and recognises it again", () => {
    expect(backupFileName("2026-10-09_2330", "backup", "json")).toBe("pos-backup-2026-10-09_2330.json.gz");
    expect(backupFileName("2026-10-09_2330", "backup", "sql")).toBe("pos-backup-2026-10-09_2330.sql");
    expect(backupFileName("2026-10-09_2330", "backup", "csv")).toBe("pos-backup-2026-10-09_2330.csv.zip");
    for (const f of ["json", "sql", "csv"] as const) {
      expect(formatOfFileName(backupFileName("2026-10-09_2330", "backup", f))).toBe(f);
    }
    expect(formatOfFileName("notes.sql")).toBeNull();
  });
});

describe("file names", () => {
  it("round-trips through the matcher", () => {
    expect(isBackupFileName(backupFileName("2026-10-09_2330"))).toBe(true);
    expect(isBackupFileName(backupFileName("2026-10-09_2330", "prerestore"))).toBe(true);
  });
  it("rejects path tricks", () => {
    expect(isBackupFileName("..\\pos-backup-2026-10-09_2330.json.gz")).toBe(false);
    expect(isBackupFileName("../pos-backup-2026-10-09_2330.json.gz")).toBe(false);
  });
  it("does not match anything else", () => {
    expect(isBackupFileName("notes.txt")).toBe(false);
    expect(isBackupFileName("pos-backup-2026-10-09_2330.json.gz.tmp")).toBe(false);
  });
});

describe("selectExpired", () => {
  const now = 100 * DAY;
  const f = (name: string, ageDays: number) => ({ name, mtimeMs: now - ageDays * DAY });

  it("deletes only our files older than the cutoff", () => {
    const files = [
      f("pos-backup-2026-01-01_0000.json.gz", 40),
      f("pos-backup-2026-02-01_0000.json.gz", 10),
      f("holiday-photos.zip", 400),
    ];
    // Newest is kept regardless, so this also proves the old one went.
    expect(selectExpired(files, now, 30).map((x) => x.name)).toEqual(["pos-backup-2026-01-01_0000.json.gz"]);
  });

  it("never deletes the newest backup, however old", () => {
    expect(selectExpired([f("pos-backup-2026-01-01_0000.json.gz", 900)], now, 30)).toEqual([]);
  });

  it("keeps the newest of each format, even when every format is old", () => {
    const files = [
      f("pos-backup-2026-01-01_0000.json.gz", 90), f("pos-backup-2026-01-01_0000.sql", 90), f("pos-backup-2026-01-01_0000.csv.zip", 90),
      f("pos-backup-2026-01-02_0000.json.gz", 89), f("pos-backup-2026-01-02_0000.sql", 89), f("pos-backup-2026-01-02_0000.csv.zip", 89),
    ];
    expect(selectExpired(files, now, 30).map((x) => x.name).sort()).toEqual([
      "pos-backup-2026-01-01_0000.csv.zip", "pos-backup-2026-01-01_0000.json.gz", "pos-backup-2026-01-01_0000.sql",
    ]);
  });

  it("keeps everything when retention is 0", () => {
    expect(selectExpired([f("pos-backup-2026-01-01_0000.json.gz", 900), f("pos-backup-2026-01-02_0000.json.gz", 899)], now, 0)).toEqual([]);
  });
});

describe("scheduled task script", () => {
  it("builds a daily trigger with catch-up and retries", () => {
    const s = buildRegisterScript(sanitizeConfig({ time: "23:30" }), "C:\\pos\\scripts\\run-backup.cmd");
    expect(s).toContain("-Daily -At '23:30'");
    expect(s).toContain("-StartWhenAvailable");
    expect(s).toContain("-RestartCount 3");
    expect(s).toContain(BACKUP_TASK_NAME);
  });

  it("builds a weekly trigger on the chosen day", () => {
    const s = buildRegisterScript(sanitizeConfig({ frequency: "weekly", weekday: 1, time: "01:00" }), "C:\\x.cmd");
    expect(s).toContain("-Weekly -DaysOfWeek Monday -At '01:00'");
  });

  it("escapes single quotes in the path", () => {
    expect(buildRegisterScript(sanitizeConfig({}), "C:\\o'brien\\run.cmd")).toContain("o''brien");
  });

  it("encodes as UTF-16LE base64", () => {
    expect(Buffer.from(encodePowerShell("ab"), "base64").toString("utf16le")).toBe("ab");
  });
});
