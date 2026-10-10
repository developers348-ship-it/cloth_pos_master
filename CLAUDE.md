@AGENTS.md

# Dev gotcha

The service worker (`public/sw.js`) serves `/_next/static/` **cache first**. That is right in production, where every build hashes its filenames, but wrong under `next dev`, where chunk URLs are reused as their contents change — the browser then keeps serving stale JavaScript, and the symptom is raw translation keys on screen or a fix that appears not to have taken. `components/layout/SwRegister.tsx` therefore unregisters any worker and clears its caches whenever `NODE_ENV !== "production"`. To exercise the PWA, run `npm run build && npm start`.

Two more traps in the same area, both found the hard way and both silent:

- **A generated manifest is served at `/manifest.webmanifest`, not `/manifest.json`** (Next 16.3.4). The bundled docs list both names, but only for a *static* manifest file. `PRECACHE_URLS` in `sw.js` must name the right one — `cache.addAll()` is atomic, so one 404 in that list rejects the whole install and the service worker never activates.
- **`proxy.ts`'s matcher auth-gates any path without a file extension**, which includes `/icon` (the generated tab icon). Extension-less public assets have to be excluded by name or the login page can't load its own icon.

Both are written up in [docs/settings-accounts.md](docs/settings-accounts.md) under Branding.

# Dates are counted on the shop's clock, never the server's or the browser's

`SHOP_UTC_OFFSET_MINUTES` in [lib/utils.ts](lib/utils.ts) is **Pakistan, UTC+5**
(no DST, so a fixed offset is exact, not an approximation). Every date window in
the app is anchored to it.

Use these and nothing else:

- `shopDayWindow(from, to)` → `{ gte, lte }` for a Prisma `date` filter,
  inclusive whole shop days from `YYYY-MM-DD`.
- `getDateRangeForPreset(preset)` → the `from`/`to` strings for "today",
  "last7days" and friends.
- `shopStartOfToday()` → midnight at the top of the shop's day.
- `shopDateKey(d)` / `shopMonthKey(d)` → the `YYYY-MM-DD` / `YYYY-MM` an
  instant falls in, for **grouping by day or month** and for a date input's
  `value`.
- `shopToday()` / `shopMonthStart()` → default `from`/`to` strings for a date
  box.
- `formatDate` / `formatTime` print on the shop clock too, so they are safe in
  server components.

**Never write `d.toISOString().slice(0, 10)` (the UTC day) or
`new Date(y, m, 1).toISOString()` (local midnight printed in UTC).** The first
filed every sale before 05:00 under the previous day in the Cash report and the
Dashboard chart; the second started every "this month" filter on the last day
of the previous month. Calendar arithmetic (installment due dates) likewise
runs on the shop clock via `getUTC*`/`setUTC*` on a shifted copy — see
`lib/installments.ts`.

**Never write `new Date(from)` or `d.setHours(0, 0, 0, 0)` for a business day.**
That pair is what these replace, and it was wrong twice over: `new Date("2026-09-15")`
parses as UTC midnight while `setHours` writes *local* hours onto it, so the two
ends of a window came off different clocks. On a UTC server the result was
`00:00Z .. 18:59Z` — which missed the shop's first five hours and leaked the
next day's first five in.

The symptom was a **five-hour blind spot every day**: a sale rung up at 02:00
appeared in no date range at all, in any report. It was fixed across all eleven
date-filtered routes plus the Dashboard tiles and installment overdue checks.
`tests/shop-dates.test.ts` pins the boundaries, including the month and year
rollovers that happen while UTC is still on the previous day.

# Migrations go to Supabase, not the database `prisma` defaults to

> **Current state (2026-09-29):** the Supabase lines in `.env.local` are
> commented out, so the app is running on **local Postgres** right now. Check
> which `DATABASE_URL` in `.env.local` is live before trusting the rest of this
> section.

`.env` holds a **local Postgres** URL; `.env.local` holds the **Supabase** one,
and Next reads `.env.local`, so Supabase is what the running app queries. The
Prisma CLI reads only `.env`. Plain `npx prisma migrate deploy` therefore
migrates the local database, prints a cheerful success, and leaves the app
untouched — the next request that selects a new column answers **500** with
`The column X does not exist in the current database`.

Use these, which read `.env.local` and pass its `DIRECT_URL` through explicitly
(port 5432 — migrations cannot run over pgbouncer on 6543):

```
npm run db:migrate:status     # read-only: what is pending on Supabase
npm run db:migrate:supabase   # apply it
```

`db:migrate:supabase` *was* a bare `prisma migrate deploy`, so its name was a
lie and it was the trap rather than the way out; it now runs
`scripts/migrate-supabase.mjs`. Both commands print the host they are talking to
before doing anything, so a run against the wrong database is visible in the
first line of output.

# Project reference docs

Before exploring the codebase from scratch, check these first — they map the areas below with concrete file paths and line numbers so re-discovery via search agents shouldn't be needed:

- [docs/dashboard.md](docs/dashboard.md) — Dashboard page: the Sales & Profit panel (date filter, totals API, hand-rolled SVG chart) and the profit-estimate caveat.
- [docs/sales-checkout.md](docs/sales-checkout.md) — Sales/checkout page: Party Option selector, payment fields, totals math, returns, customer balance/ledger.
- [docs/settings-accounts.md](docs/settings-accounts.md) — Settings page tabs and the site-wide feature-toggle pattern.
- [docs/backup.md](docs/backup.md) — Automatic backups: Windows Task Scheduler job, local folder + Google Drive upload, retention, the safe restore flow, and what `Setting` keys a restore preserves.
- [docs/accounts.md](docs/accounts.md) — Bank & Cash Accounts page: the Account/AccountEntry model, add/edit/delete rules, the per-account statement endpoint and its filters, and the six account permissions.
- [docs/expenses.md](docs/expenses.md) — Cost Management page: expenses/salaries, unpaid costs, owner profit withdrawals, the account postings behind them and the Dashboard's net-profit figures.
- [docs/ledger.md](docs/ledger.md) — Ledger page: Recovery/Payment collecting against specific invoices/GRNs (FIFO allocation + the over-collection cap), the Decimal-as-string totals bug, the Installments side filter, the party repayment strip.
- [docs/parties.md](docs/parties.md) — Parties page: the opening-vs-live balance distinction, the Dr/Cr sign convention and the receivable/payable totals.
- [docs/schema-permissions.md](docs/schema-permissions.md) — Prisma schema model map + the permission system (two unwired definitions, actual ad hoc enforcement).
- [docs/installments.md](docs/installments.md) — Installment plans: schedule generation, the cascade collection endpoint, the shared recovery/payment settlement ops, Ledger → Installments tab.
- [docs/testing.md](docs/testing.md) — Vitest setup, what the unit tests cover and deliberately do not, and the open defect recorded there.
- [docs/items.md](docs/items.md) — Items list/add/edit, the item write-payload whitelist, and the shared `NumberInput` control.
- [docs/units.md](docs/units.md) — Buying in one unit and selling in another (gaz/metre, bundle/piece): the conversion at the GRN, why stock is held in the sell unit, and the two calculations that depend on it.
- [docs/orders.md](docs/orders.md) — Order/sales list (lives in Reports → Sales tab), row actions, API handlers.
- [docs/purchases-grn.md](docs/purchases-grn.md) — Purchases/GRN page, vendor-as-Party model, the missing payment-capture-at-receipt gap, dead `promiseDays` field, `PURCHASE_RETURN` ledger type that's never actually written.

These are snapshots — verify a specific claim (a function/file still existing) before relying on it for anything the user will act on, per the "before recommending from memory" rule. If a doc goes stale, update it in place rather than letting it drift.
