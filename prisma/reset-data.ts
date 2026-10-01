/**
 * Clears the transactional and catalogue data out of the database, keeping the
 * accounts you sign in with — for starting a round of testing on fresh data.
 *
 *   npm run db:reset -- --confirm
 *
 * It refuses to do anything without `--confirm`, and prints which database it
 * is pointed at before it starts. Read that line. This repo has two databases:
 * `.env` points the Prisma CLI at a local Postgres while `.env.local` points the
 * running app at Supabase, so "the database" is genuinely ambiguous here and
 * the wrong one is easy to hit. To act on the one the app actually uses, export
 * the `.env.local` values first.
 *
 * A restore-compatible JSON backup is written before the first row is deleted
 * (skip with `--no-backup`, choose where with `--out=<dir>`). It is the same
 * format Settings → Backup → Restore reads, so an accidental run can be put
 * back through the UI.
 *
 * This always clears every group in lib/clear-data.ts — the same engine the
 * Settings → Clear Data tab uses when only some groups are picked, so the two
 * never disagree about what "clear the transactional data" means.
 *
 * ## What is kept, and why
 *
 * | Kept | Why |
 * | --- | --- |
 * | `User`, `UserBranch` | The accounts you sign in with. Wiping these locks everyone out, including you. |
 * | `Organization`, `Branch` | The store itself: name, address, receipt footer, feature toggles. Every screen reads a `branchId` off the session, so with no branch the app has nothing to run against. |
 * | `Setting` | Two things you configured rather than generated: the role-permission matrix, and the uploaded branding images (see lib/branding.ts). |
 * | `Session` | Deleting them would just sign everyone out mid-test. |
 * | The **Walking Customer** `Party` | Required, not sentimental: the sales screen loads it via `/api/parties?isDefault=true` as the default party for a counter sale, and `PUT /api/parties/[id]` refuses to delete it. Its `previousBalance` is zeroed so it starts clean. |
 *
 * Everything else goes: parties, the item catalogue and stock, invoices, GRNs,
 * the party ledger, cash/bank accounts and their entries, recoveries and
 * payments, installment plans, expenses, day books, stock adjustments and the
 * audit log.
 *
 * Two counters look after themselves and are not reset here: `SaleInvoice.invoiceNo`
 * and `GRN.grnNo` are computed per branch as `max + 1`, so they return to 1 as
 * soon as the rows are gone. `Party.accountId` is a Postgres sequence and does
 * not, so it is explicitly set back to just above the Walking Customer's id.
 */

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { countRows, readDatabase, toJsonBackup } from "@/lib/backup";
import { ALL_GROUP_IDS, clearData, previewClearGroups, resolveGroupSelection } from "@/lib/clear-data";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirmed = args.includes("--confirm");
const skipBackup = args.includes("--no-backup");
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);

const GROUPS = resolveGroupSelection(ALL_GROUP_IDS);

function describeTarget(): string {
  const url = process.env.DATABASE_URL ?? "";
  // Host only — the URL carries a password.
  const match = /@([^/?]+)/.exec(url);
  const host = match?.[1] ?? "unknown";
  const looksSupabase = /supabase/i.test(url);
  return `${host}${looksSupabase ? "  (Supabase — the database the app uses)" : "  (not Supabase — check this is the one you meant)"}`;
}

async function main() {
  console.log("\n─────────────────────────────────────────────");
  console.log("  Reset data");
  console.log("─────────────────────────────────────────────");
  console.log(`  Target : ${describeTarget()}`);

  if (!confirmed) {
    // A read-only pass, so the run that does nothing still shows exactly what
    // the real one would take — the counts come from the same queries the
    // deletes use, not from a separate list that could drift out of step.
    console.log("\n  Nothing will be deleted — this is a dry run (add --confirm).\n");
    console.log("  Would delete:");
    const preview = await previewClearGroups(prisma, GROUPS);
    let total = 0;
    for (const { table, rows } of preview) {
      total += rows;
      console.log(`    ${String(rows).padStart(7)}  ${table}`);
    }
    console.log(`    ${"—".padStart(7)}`);
    console.log(`    ${String(total).padStart(7)}  rows in total`);

    const walking = await prisma.party.findFirst({
      where: { isDefault: true },
      select: { accountId: true },
    });
    console.log("\n  Would keep:");
    console.log(`    ${String(await prisma.user.count()).padStart(7)}  User`);
    console.log(`    ${String(await prisma.userBranch.count()).padStart(7)}  UserBranch`);
    console.log(`    ${String(await prisma.organization.count()).padStart(7)}  Organization`);
    console.log(`    ${String(await prisma.branch.count()).padStart(7)}  Branch`);
    console.log(`    ${String(await prisma.setting.count()).padStart(7)}  Setting  (permissions + branding images)`);
    console.log(`    ${String(await prisma.session.count()).padStart(7)}  Session`);
    console.log(walking
      ? `    ${String(1).padStart(7)}  Party    (Walking Customer #${walking.accountId})`
      : `    ${String(0).padStart(7)}  Party    ⚠ no default Walking Customer exists`);
    console.log("\n  Run again with --confirm to go ahead:\n");
    console.log("      npm run db:reset -- --confirm\n");
    return;
  }

  if (!skipBackup) {
    const dir = outArg ?? path.join(process.cwd(), "..", "cloth-pos-backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, `before-reset-${stamp}.json`);
    console.log("\n  Backing up first…");
    const dump = await readDatabase();
    writeFileSync(file, JSON.stringify(toJsonBackup(dump)));
    console.log(`  Backup : ${file}`);
    console.log(`           ${dump.schema.tables.size} tables, ${countRows(dump)} rows`);
    console.log("           Restorable via Settings → Backup → Restore.");
  }

  console.log("\n  Deleting…");
  const result = await clearData(prisma, GROUPS);
  for (const { table, rows } of result.tables) {
    if (rows > 0) console.log(`    ${String(rows).padStart(7)}  ${table}`);
  }

  if (result.walkingCustomerAccountId !== null) {
    console.log(`\n  Kept the Walking Customer (#${result.walkingCustomerAccountId}), balance zeroed.`);
    console.log(`  Next customer will be #${result.walkingCustomerAccountId + 1}.`);
  } else {
    // Nothing to keep it from, but the sales screen needs one, so say so
    // loudly rather than leaving it to be discovered at the till.
    console.log("\n  ⚠  No default Walking Customer exists. The sales screen needs one —");
    console.log("     add a party and mark it default, or run `npm run db:seed`.");
  }

  const remaining = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    parties: await prisma.party.count(),
    settings: await prisma.setting.count(),
  };
  console.log(`\n  Deleted ${result.rowsDeleted} rows.`);
  console.log(`  Kept   : ${remaining.users} users, ${remaining.branches} branch(es), ` +
    `${remaining.parties} party, ${remaining.settings} setting row(s).`);
  console.log("  Invoice and GRN numbering restarts at 1.\n");
}

main()
  .catch((e) => {
    console.error("\n  Reset failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
