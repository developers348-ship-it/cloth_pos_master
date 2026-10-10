/**
 * The command Windows Task Scheduler runs (through scripts/run-backup.cmd):
 *
 *   npm run backup:run
 *
 * It talks to the database directly, so a scheduled backup does not need the POS
 * web server to be running. It reads `.env.local` the way `next start` does —
 * the Prisma CLI's own `.env` points at a different (local) database in this
 * repo, and a backup of the wrong database is worse than no backup.
 *
 * Does whatever Settings → Backup → Schedule says (local folder, Google Drive, or
 * both). Exit code 0 = every chosen destination saved, 1 = something failed; the reason is printed, and recorded in the
 * history shown at Settings → Backup.
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  // Imported after the environment is loaded: the Prisma client reads
  // DATABASE_URL when it is constructed.
  const { runScheduledBackup } = await import("@/lib/backup-jobs");
  const { prisma } = await import("@/lib/prisma");

  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`[backup] database host: ${host || "(unknown)"}`);

  const entry = await runScheduledBackup();
  await prisma.$disconnect();

  const size = entry.bytes ? ` (${entry.bytes} bytes, ${entry.rows} rows)` : "";
  for (const [label, result] of [["local", entry.local], ["drive", entry.drive]] as const) {
    if (!result) continue;
    console.log(
      result.ok
        ? `[backup] ${label}: saved ${(result.files ?? []).join(", ")}${size}, ${result.deleted ?? 0} old file(s) removed`
        : `[backup] ${label}: FAILED — ${result.error}`
    );
  }
  if (entry.error) console.error(`[backup] FAILED: ${entry.error}`);
  process.exit(entry.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[backup] FAILED:", error);
  process.exit(1);
});
