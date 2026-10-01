import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { buildZip } from "@/lib/zip";
import { SHOP_UTC_OFFSET_MINUTES } from "@/lib/utils";
import {
  BACKUP_VERSION,
  countRows,
  readDatabase,
  readSchema,
  toCsvEntries,
  toJsonBackup,
  toSqlDump,
} from "@/lib/backup";

export const dynamic = "force-dynamic";

/**
 * Whole-database backup.
 *
 * Until now this route emitted one branch's invoices, GRNs and ledger as nested
 * JSON. That left out users, accounts, expenses, installments, settings and
 * stock adjustments, and nothing could read the file back — so it was an
 * extract, not a backup. It now dumps every table Prisma has migrated, in three
 * formats, all built from one read of the database (see lib/backup.ts):
 *
 *   ?format=sql   .sql   — data-only dump for `psql -f`, into any database whose
 *                          schema matches (`prisma migrate deploy`).
 *   ?format=json  .json  — the format POST /api/settings/backup/restore reads.
 *   ?format=csv   .zip   — one CSV per table, for Excel. Read-only by design.
 *   ?summary=1           — table and row counts only, for the Settings screen.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);

  if (searchParams.get("summary") === "1") {
    return NextResponse.json(await summarize());
  }

  const format = (searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "sql" && format !== "json" && format !== "csv") {
    return NextResponse.json(
      { error: "format must be one of: sql, json, csv" },
      { status: 400 }
    );
  }

  let dump;
  try {
    dump = await readDatabase();
  } catch (error) {
    console.error("[backup] export failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup failed" },
      { status: 500 }
    );
  }

  const stamp = fileStamp(dump.exportedAt);
  const rows = String(countRows(dump));
  const tables = String(dump.schema.tables.size);

  if (format === "sql") {
    return download(toSqlDump(dump), `cloth-pos-backup-${stamp}.sql`, "application/sql", tables, rows);
  }

  if (format === "csv") {
    const zip = buildZip(toCsvEntries(dump), dump.exportedAt);
    // A Buffer may be a view into a pooled (SharedArrayBuffer-compatible)
    // allocation, which the Response body type rejects; copy it into a plain one.
    const bytes = new Uint8Array(zip.byteLength);
    bytes.set(zip);
    return download(bytes, `cloth-pos-backup-csv-${stamp}.zip`, "application/zip", tables, rows);
  }

  return download(
    JSON.stringify(toJsonBackup(dump)),
    `cloth-pos-backup-${stamp}.json`,
    "application/json",
    tables,
    rows
  );
}

/**
 * What a backup would contain, without building one — so the Settings screen can
 * show the size of the job before someone downloads their whole shop.
 */
async function summarize() {
  const schema = await readSchema();
  const tables: { table: string; rows: number }[] = [];

  for (const name of schema.order) {
    // COUNT(*) returns bigint, which Prisma hands back as a JS BigInt and
    // JSON.stringify refuses to serialise.
    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${name.replace(/"/g, '""')}"`
    );
    tables.push({ table: name, rows: Number(count) });
  }

  return {
    version: BACKUP_VERSION,
    tableCount: tables.length,
    rowCount: tables.reduce((sum, entry) => sum + entry.rows, 0),
    tables,
  };
}

/** `YYYY-MM-DD_HHmm` on the shop's clock, so the file name matches the day it was taken. */
function fileStamp(date: Date): string {
  const shop = new Date(date.getTime() + SHOP_UTC_OFFSET_MINUTES * 60_000);
  return shop.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
}

function download(
  body: BodyInit,
  filename: string,
  contentType: string,
  tableCount: string,
  rowCount: string
) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Read by the client so the toast can report what actually came down.
      "X-Backup-Tables": tableCount,
      "X-Backup-Rows": rowCount,
      "Cache-Control": "no-store",
    },
  });
}
