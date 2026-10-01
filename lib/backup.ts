import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Whole-database backup and restore.
 *
 * The old export walked a hand-written list of Prisma models for one branch and
 * emitted nested JSON. That is a fine data extract but it is not a backup: it
 * skipped whole tables (accounts, expenses, installments, settings, users), and
 * nothing could read it back. This module instead introspects the live
 * PostgreSQL catalog, so every table Prisma has migrated is included whether or
 * not anyone remembered to add it here, and it produces three artefacts from
 * one read:
 *
 *   - `.sql`  — BEGIN / TRUNCATE / INSERT / setval, importable with
 *               `psql -f backup.sql` into any schema-compatible database.
 *   - `.json` — the same rows with their table/column structure, which
 *               `restoreFromJson` can load back through the app itself.
 *   - `.zip`  — one CSV per table, for opening in Excel.
 *
 * Every value is encoded to a *string* (or null) exactly once, and every SQL
 * literal is written with an explicit `::type` cast taken from the live column
 * type. That is what lets one encoder feed all three formats: PostgreSQL parses
 * `'2026-01-31T10:00:00.000Z'::timestamp(3) without time zone` and
 * `'1234.50'::numeric(65,30)` back to the values they came from, so a JSON or
 * CSV round-trip is not lossy the way `Number(decimalString)` would be.
 */

/** Prisma's own bookkeeping table — restoring it would fight `migrate deploy`. */
const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

export const BACKUP_KIND = "cloth-pos-full-backup";
export const BACKUP_VERSION = 2;

export type ColumnMeta = { name: string; sqlType: string; nullable: boolean };

export type TableMeta = {
  name: string;
  columns: ColumnMeta[];
  primaryKey: string[];
  /** Nullable FK columns pointing at this same table — see `buildStatements`. */
  selfRefColumns: string[];
};

export type SchemaMeta = {
  tables: Map<string, TableMeta>;
  /** Parents before children, so inserts never violate a foreign key. */
  order: string[];
  sequences: { table: string; column: string }[];
};

/** One table's rows, every value already encoded to a string or null. */
export type TableDump = { table: string; columns: string[]; rows: (string | null)[][] };

export type DatabaseDump = { schema: SchemaMeta; tables: TableDump[]; exportedAt: Date };

// ─── Identifiers and literals ─────────────────────────────────────────────────

/** Quotes an identifier the way PostgreSQL does. Mixed-case names need it. */
function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Escapes a value for a single-quoted SQL string literal. */
function quoteText(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Encodes one raw PostgreSQL value as a string PostgreSQL can parse back with a
 * cast to the column's own type. Strings are the common denominator that
 * survives JSON and CSV alike — a `numeric` kept as a JS number would lose
 * precision, and a `Date` kept as one would not survive CSV at all.
 */
export function encodeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  // No scalar array columns exist today, but a future one must not silently
  // serialise to "[object Object]": PostgreSQL array input is `{a,b}`.
  if (Array.isArray(value)) {
    const parts = value.map((entry) => {
      const inner = encodeValue(entry);
      return inner === null ? "NULL" : `"${inner.replace(/(["\\])/g, "\\$1")}"`;
    });
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A single-quoted literal with an explicit cast to the destination column. */
function literal(value: string | null, sqlType: string): string {
  if (value === null) return "NULL";
  // A NUL byte cannot live in a PostgreSQL text value, so it cannot have come
  // out of one; strip it rather than emit a statement that will be rejected.
  return `'${quoteText(value.replace(/\0/g, ""))}'::${sqlType}`;
}

// ─── Schema introspection ─────────────────────────────────────────────────────

type ColumnRow = { table_name: string; column_name: string; sql_type: string; nullable: boolean };
type EdgeRow = { child_table: string; parent_table: string; child_column: string };
type KeyRow = { table_name: string; column_name: string };

export async function readSchema(): Promise<SchemaMeta> {
  // Generated columns (`attgenerated <> ''`) are computed by PostgreSQL and
  // cannot be inserted into, so they are left out of both dump and restore.
  const columnRows = await prisma.$queryRawUnsafe<ColumnRow[]>(`
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS sql_type,
           NOT a.attnotnull AS nullable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attgenerated = ''
    ORDER BY c.relname, a.attnum
  `);

  const edgeRows = await prisma.$queryRawUnsafe<EdgeRow[]>(`
    SELECT child.relname AS child_table,
           parent.relname AS parent_table,
           att.attname AS child_column
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f' AND n.nspname = 'public'
  `);

  const keyRows = await prisma.$queryRawUnsafe<KeyRow[]>(`
    SELECT c.relname AS table_name, att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'p' AND n.nspname = 'public'
  `);

  const sequenceRows = await prisma.$queryRawUnsafe<KeyRow[]>(`
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL
  `);

  const tables = new Map<string, TableMeta>();
  for (const row of columnRows) {
    if (EXCLUDED_TABLES.has(row.table_name)) continue;
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [], primaryKey: [], selfRefColumns: [] };
      tables.set(row.table_name, table);
    }
    table.columns.push({ name: row.column_name, sqlType: row.sql_type, nullable: row.nullable });
  }

  for (const row of keyRows) {
    tables.get(row.table_name)?.primaryKey.push(row.column_name);
  }

  for (const row of edgeRows) {
    if (row.child_table !== row.parent_table) continue;
    const table = tables.get(row.child_table);
    const column = table?.columns.find((c) => c.name === row.child_column);
    if (table && column?.nullable && !table.selfRefColumns.includes(column.name)) {
      table.selfRefColumns.push(column.name);
    }
  }

  const edges = edgeRows.filter(
    (edge) =>
      edge.child_table !== edge.parent_table &&
      tables.has(edge.child_table) &&
      tables.has(edge.parent_table)
  );

  const sequences = sequenceRows
    .filter((row) => tables.has(row.table_name))
    .map((row) => ({ table: row.table_name, column: row.column_name }));

  return { tables, order: topologicalOrder([...tables.keys()], edges), sequences };
}

/**
 * Parents first (Kahn). Ties break alphabetically so two dumps of the same
 * database diff cleanly. A cycle between two tables can't be ordered at all —
 * the remaining tables are appended in name order, which is the best that can
 * be done and is unreachable with the current schema.
 */
function topologicalOrder(names: string[], edges: EdgeRow[]): string[] {
  const dependencies = new Map<string, Set<string>>(names.map((name) => [name, new Set<string>()]));
  const dependents = new Map<string, Set<string>>(names.map((name) => [name, new Set<string>()]));
  for (const edge of edges) {
    dependencies.get(edge.child_table)!.add(edge.parent_table);
    dependents.get(edge.parent_table)!.add(edge.child_table);
  }

  const ready = names.filter((name) => dependencies.get(name)!.size === 0).sort();
  const ordered: string[] = [];
  const placed = new Set<string>();
  while (ready.length > 0) {
    const name = ready.shift()!;
    ordered.push(name);
    placed.add(name);
    const unlocked: string[] = [];
    for (const child of dependents.get(name)!) {
      const deps = dependencies.get(child)!;
      deps.delete(name);
      if (deps.size === 0) unlocked.push(child);
    }
    ready.push(...unlocked);
    ready.sort();
  }

  const stranded = names.filter((name) => !placed.has(name)).sort();
  return [...ordered, ...stranded];
}

// ─── Reading the data ─────────────────────────────────────────────────────────

export async function readDatabase(): Promise<DatabaseDump> {
  const schema = await readSchema();
  const tables: TableDump[] = [];

  for (const name of schema.order) {
    const meta = schema.tables.get(name)!;
    const columns = meta.columns.map((column) => column.name);
    // Ordered by primary key where there is one, so repeat dumps of an
    // unchanged database are byte-identical and easy to compare.
    const orderBy = meta.primaryKey.length > 0 ? ` ORDER BY ${meta.primaryKey.map(q).join(", ")}` : "";
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${columns.map(q).join(", ")} FROM ${q(name)}${orderBy}`
    );
    tables.push({
      table: name,
      columns,
      rows: rows.map((row) => columns.map((column) => encodeValue(row[column]))),
    });
  }

  return { schema, tables, exportedAt: new Date() };
}

// ─── Statement generation (shared by the .sql dump and the JSON restore) ──────

/** Rows per INSERT. Large enough to be fast, small enough not to blow a packet. */
const ROWS_PER_INSERT = 250;

/**
 * The statements that turn an empty (or populated) schema into this dump,
 * excluding the surrounding transaction. Used verbatim for both the `.sql`
 * download and the in-app restore, so there is only one thing to get right.
 *
 * Two ordering problems are handled here:
 *   - Tables are inserted parents-first, from `schema.order`.
 *   - A row referencing another row of its *own* table (a refund invoice
 *     pointing at the sale it refunds) cannot be ordered within the table, so
 *     that column is inserted NULL and set by an UPDATE once every row exists.
 */
export function buildStatements(dump: DatabaseDump): string[] {
  const statements: string[] = [];

  const truncatable = dump.schema.order.filter((name) => dump.schema.tables.has(name));
  if (truncatable.length > 0) {
    // One CASCADE truncate sidesteps delete ordering entirely, and RESTART
    // IDENTITY puts the serial sequences back to 1 before setval fixes them up.
    statements.push(`TRUNCATE TABLE ${truncatable.map(q).join(", ")} RESTART IDENTITY CASCADE;`);
  }

  const deferredUpdates: string[] = [];

  for (const table of dump.tables) {
    if (table.rows.length === 0) continue;
    const meta = dump.schema.tables.get(table.table);
    if (!meta) continue;

    const columnTypes = new Map(meta.columns.map((column) => [column.name, column.sqlType]));
    const insertable = table.columns.filter((column) => columnTypes.has(column));
    if (insertable.length === 0) continue;

    // Deferring only works if the row can be found again afterwards.
    const canDefer =
      meta.primaryKey.length > 0 && meta.primaryKey.every((key) => insertable.includes(key));
    const deferredColumns = canDefer
      ? meta.selfRefColumns.filter((column) => insertable.includes(column))
      : [];

    const indexOf = new Map(table.columns.map((column, index) => [column, index]));
    const cell = (row: (string | null)[], column: string) => row[indexOf.get(column)!] ?? null;

    for (let start = 0; start < table.rows.length; start += ROWS_PER_INSERT) {
      const chunk = table.rows.slice(start, start + ROWS_PER_INSERT);
      const tuples = chunk.map((row) => {
        const values = insertable.map((column) =>
          literal(deferredColumns.includes(column) ? null : cell(row, column), columnTypes.get(column)!)
        );
        return `  (${values.join(", ")})`;
      });
      statements.push(
        `INSERT INTO ${q(table.table)} (${insertable.map(q).join(", ")}) VALUES\n${tuples.join(",\n")};`
      );
    }

    for (const row of table.rows) {
      const pending = deferredColumns.filter((column) => cell(row, column) !== null);
      if (pending.length === 0) continue;
      const assignments = pending
        .map((column) => `${q(column)} = ${literal(cell(row, column), columnTypes.get(column)!)}`)
        .join(", ");
      const where = meta.primaryKey
        .map((key) => `${q(key)} = ${literal(cell(row, key), columnTypes.get(key)!)}`)
        .join(" AND ");
      deferredUpdates.push(`UPDATE ${q(table.table)} SET ${assignments} WHERE ${where};`);
    }
  }

  statements.push(...deferredUpdates);

  for (const sequence of dump.schema.sequences) {
    // `false` on setval means "the next nextval() returns exactly this value",
    // which is right because the value passed is max + 1.
    const target = `'${quoteText(q(sequence.table))}', '${quoteText(sequence.column)}'`;
    statements.push(
      `SELECT setval(pg_get_serial_sequence(${target}), ` +
        `COALESCE((SELECT MAX(${q(sequence.column)}) FROM ${q(sequence.table)}), 0) + 1, false);`
    );
  }

  return statements;
}

// ─── Output formats ───────────────────────────────────────────────────────────

export function countRows(dump: DatabaseDump): number {
  return dump.tables.reduce((sum, table) => sum + table.rows.length, 0);
}

export function toSqlDump(dump: DatabaseDump): string {
  const header = [
    `-- ${BACKUP_KIND} (SQL) v${BACKUP_VERSION}`,
    `-- Exported: ${dump.exportedAt.toISOString()}`,
    `-- Tables: ${dump.schema.tables.size}   Rows: ${countRows(dump)}`,
    `--`,
    `-- Data only. Point it at a database whose schema already matches --`,
    `-- create one with \`npx prisma migrate deploy\` -- then:`,
    `--`,
    `--   psql "postgresql://user:pass@host:5432/dbname" -f this-file.sql`,
    `--`,
    `-- It REPLACES all existing data in these tables, inside one transaction.`,
    ``,
    `SET standard_conforming_strings = on;`,
    `SET client_encoding = 'UTF8';`,
    `BEGIN;`,
    ``,
  ].join("\n");

  return `${header}${buildStatements(dump).join("\n\n")}\n\nCOMMIT;\n`;
}

export function toJsonBackup(dump: DatabaseDump) {
  return {
    meta: {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: dump.exportedAt.toISOString(),
      tableCount: dump.schema.tables.size,
      rowCount: countRows(dump),
    },
    // Kept so a restore replays tables in the order they were read, even if the
    // schema's foreign keys have shifted since.
    order: dump.schema.order,
    tables: dump.tables,
  };
}

function csvCell(value: string | null): string {
  if (value === null) return "";
  // Excel handles a newline inside a quoted field; quote doubling and CRLF line
  // endings are what it insists on.
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(table: TableDump): string {
  const lines = [table.columns.map(csvCell).join(",")];
  for (const row of table.rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function toCsvEntries(dump: DatabaseDump): { name: string; content: string }[] {
  const manifest = [
    "table,rows,columns",
    ...dump.tables.map(
      (table) => `${csvCell(table.table)},${table.rows.length},${csvCell(table.columns.join(" | "))}`
    ),
  ].join("\r\n");

  const readme = [
    `${BACKUP_KIND} (CSV) v${BACKUP_VERSION}`,
    `Exported: ${dump.exportedAt.toISOString()}`,
    `Tables: ${dump.schema.tables.size}   Rows: ${countRows(dump)}`,
    ``,
    `One CSV per database table. An empty cell means NULL.`,
    ``,
    `These files are for reading -- open them in Excel, LibreOffice or Sheets.`,
    `To put data BACK, use the JSON backup (Settings > Backup > Restore) or the`,
    `SQL backup (psql -f). CSV records no table order and cannot tell an empty`,
    `string apart from NULL, so it is not safe to load back.`,
    ``,
  ].join("\r\n");

  return [
    { name: "README.txt", content: readme },
    { name: "_manifest.csv", content: `${manifest}\r\n` },
    ...dump.tables.map((table) => ({ name: `${table.table}.csv`, content: toCsv(table) })),
  ];
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export type RestoreReport = {
  tablesRestored: number;
  rowsRestored: number;
  statements: number;
  warnings: string[];
};

type ParsedBackup = { order?: unknown; tables?: unknown; meta?: { kind?: unknown; version?: unknown } };

/**
 * Replays a JSON backup over the live database inside one transaction: either
 * every table lands or the shop's data is exactly as it was.
 *
 * Anything the file mentions that the schema no longer has is reported as a
 * warning rather than failing the restore — a backup taken before a column was
 * dropped is still worth loading.
 */
export async function restoreFromJson(parsed: unknown): Promise<RestoreReport> {
  const backup = (parsed ?? {}) as ParsedBackup;
  if (typeof backup !== "object" || !Array.isArray(backup.tables)) {
    throw new Error("Not a backup file: expected a JSON object with a `tables` array.");
  }
  if (backup.meta?.kind !== BACKUP_KIND) {
    throw new Error(
      "This file was not produced by Backup → Export JSON. Only a full-database JSON backup can be restored."
    );
  }

  const schema = await readSchema();
  const warnings: string[] = [];
  const tables: TableDump[] = [];

  for (const raw of backup.tables) {
    const entry = raw as Partial<TableDump>;
    if (
      !entry ||
      typeof entry.table !== "string" ||
      !Array.isArray(entry.columns) ||
      !Array.isArray(entry.rows)
    ) {
      warnings.push("Skipped a malformed table entry in the backup file.");
      continue;
    }

    const meta = schema.tables.get(entry.table);
    if (!meta) {
      warnings.push(`Table "${entry.table}" is in the backup but not in this database — skipped.`);
      continue;
    }

    const known = new Set(meta.columns.map((column) => column.name));
    const dropped = entry.columns.filter((column) => !known.has(column));
    if (dropped.length > 0) {
      warnings.push(`Table "${entry.table}": column(s) ${dropped.join(", ")} no longer exist — ignored.`);
    }
    const backupColumns = new Set(entry.columns);
    const missing = meta.columns.filter((column) => !column.nullable && !backupColumns.has(column.name));
    if (missing.length > 0) {
      warnings.push(
        `Table "${entry.table}": required column(s) ${missing
          .map((column) => column.name)
          .join(", ")} are absent from the backup — their column defaults were used.`
      );
    }

    tables.push({
      table: entry.table,
      columns: entry.columns,
      rows: (entry.rows as unknown[][]).map((row) =>
        row.map((value) => (value === null || value === undefined ? null : String(value)))
      ),
    });
  }

  if (tables.length === 0) {
    throw new Error("The backup file contains no table this database recognises.");
  }

  // Replay in the *live* schema's dependency order; the file's own `order` only
  // records how things stood when it was written.
  const rank = new Map(schema.order.map((name, index) => [name, index]));
  tables.sort((a, b) => (rank.get(a.table) ?? Infinity) - (rank.get(b.table) ?? Infinity));

  const statements = buildStatements({ schema, tables, exportedAt: new Date() });

  // Restoring a whole shop is one long transaction, and the app's usual client
  // points at Supabase's pgbouncer pooler (port 6543), which is not somewhere
  // to hold a transaction open for minutes. `DIRECT_URL` is the unpooled
  // connection the schema already declares for migrations; borrow it here and
  // hand it back, falling back to the shared client when it isn't set (local
  // PostgreSQL, where DATABASE_URL is already direct).
  const direct = process.env.DIRECT_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
    : null;
  const client = direct ?? prisma;

  try {
    await client.$transaction(
      async (tx) => {
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
      },
      // A shop's whole history is a lot of INSERTs; the 5 s default is not enough.
      { timeout: 300_000, maxWait: 30_000 }
    );
  } finally {
    await direct?.$disconnect();
  }

  return {
    tablesRestored: tables.length,
    rowsRestored: tables.reduce((sum, table) => sum + table.rows.length, 0),
    statements: statements.length,
    warnings,
  };
}
