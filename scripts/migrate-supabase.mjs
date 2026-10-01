/**
 * Applies pending migrations to the database the **app** actually uses.
 *
 * `prisma migrate deploy` on its own reads `.env`, which in this repo points at
 * a local Postgres, while the running app reads `.env.local`, which points at
 * Supabase. So the plain command reports "migrations applied" against the wrong
 * database and leaves the app broken in exactly the way it started — a column
 * the Prisma client selects but the live database has never heard of, surfacing
 * as a 500 from every route that touches that table.
 *
 * `npm run db:migrate:supabase` used to be that plain command, which made the
 * script's name a lie. This reads `.env.local` and passes its connection string
 * through explicitly, so the name is now true.
 *
 * `DIRECT_URL`, not `DATABASE_URL`: the latter goes through pgbouncer on port
 * 6543, and migrations cannot run over a transaction-mode pooler.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

let raw;
try {
  raw = readFileSync(envPath, "utf8");
} catch {
  console.error(`Could not read ${envPath}.`);
  console.error("That file holds the connection string the app runs against.");
  process.exit(1);
}

/** Minimal .env parsing — enough for one quoted or bare value. */
function readVar(name) {
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trimStart().startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const directUrl = readVar("DIRECT_URL") ?? readVar("DATABASE_URL");
if (!directUrl) {
  console.error("Neither DIRECT_URL nor DATABASE_URL is set in .env.local.");
  process.exit(1);
}

// Host and port only — the connection string carries a password.
const target = directUrl.replace(/^.*@/, "").replace(/\?.*$/, "");
const statusOnly = process.argv.includes("--status");
console.log(`${statusOnly ? "Checking" : "Applying"} migrations against ${target}\n`);

if (/:6543(\/|$)/.test(directUrl)) {
  console.warn(
    "Warning: that looks like the pgbouncer port (6543). Migrations need the\n" +
      "direct connection (5432) — set DIRECT_URL in .env.local.\n"
  );
}

// `--status` is the read-only half: it says what is pending without writing
// anything, which is the first thing worth knowing when a route starts
// answering 500 after a schema change.
const args = statusOnly
  ? ["prisma", "migrate", "status"]
  : ["prisma", "migrate", "deploy"];

const result = spawnSync("npx", args, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    // Both, because the datasource block reads `url` and `directUrl` and
    // migrate uses whichever it is given.
    DATABASE_URL: directUrl,
    DIRECT_URL: directUrl,
  },
});

process.exit(result.status ?? 1);
