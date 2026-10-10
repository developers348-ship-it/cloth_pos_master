# Settings Page

Main file: `app/dashboard/settings/page.tsx` (~1190 lines). Sub-page: `app/dashboard/settings/roles/page.tsx` (permission matrix editor, see `schema-permissions.md`).

## Tabs

`store | receipt | language | pwa | backup | clearData | users`. `backup` is gated on `DATABASE_BACKUP` and `users` on `VIEW_USERS`, both via the permission matrix rather than an inline role array. The restore half of the backup tab is gated separately on `DATABASE_RESTORE`. `clearData` needs both the `CLEAR_TEST_DATA` permission **and** `ENABLE_TEST_DATA_TOOLS=true` in the environment — see below.

Above the tab strip sits one full-width shortcut card, to **Roles & Permissions** (`/dashboard/settings/roles`) — the one sub-feature that outgrew a tab and has no sidebar entry of its own.

**No "branches" management tab exists** — despite the `Branch` model supporting multiple branches, Settings only edits per-branch config for the session's current branch. There's no UI to create/list/switch branches.

## Users tab

`page.tsx` — list + inline editor. `GET /api/settings/users` returns every user (active first) plus `currentUserId`, which the UI uses to grey out the actions that would lock the signed-in admin out.

| Action | Route | Permission |
| --- | --- | --- |
| Add | `POST /api/settings/users` | `CREATE_USER` |
| Edit name / email / role / password | `PATCH /api/settings/users/[id]` | `EDIT_USER` |
| Activate / deactivate | `PATCH /api/settings/users/[id]` `{ isActive }` | `EDIT_USER` |
| Delete | `DELETE /api/settings/users/[id]` | `DELETE_USER` |
| Sign in as | `POST /api/impersonate` | `IMPERSONATE_USER` |

PATCH used to accept only `role`, `isActive` and `password`, which is why the tab had no way to fix a name or an email — there was nothing behind such a form. It takes `name` and `email` too now (email normalised to lower case and checked for a clash), and `lib/users.ts` holds the field rules both verbs validate against, so create and edit can't drift apart. An empty `password` means "leave it alone".

Three lock-outs are refused with a 409 explaining why (`assertNotLockingOurselvesOut` in `app/api/settings/users/[id]/route.ts`): changing your own role, deactivating or deleting yourself, and removing the last **active** SUPER_ADMIN.

`DELETE` is a real delete now — it was a soft delete, identical to the deactivate toggle, so "Delete" and "Deactivate" were two buttons for one action. `SaleInvoice.userId`, `GRN.userId` and `AuditLog.userId` are required relations, so an account that has recorded anything can't be removed without breaking the books: the route counts those rows first and returns 409 with `canDeactivate: true`, and the UI offers the deactivate instead of a dead end. `?soft=1` deactivates directly.

The role column in the list is a **badge, not a select** — role changes moved into the edit form so a stray scroll over the list can't reassign one.

### "Sign in as this user"

The person icon on a row swaps the admin's session for that user's, so they see the menu that user sees and can ring up a sale under their name — the point being that the invoice, the audit row and everything else lands on the *user*, not on the admin borrowing the account.

- **The swap is the token.** `POST /api/impersonate` validates and writes an `AuditLog` row (`IMPERSONATE_START`, against the admin's id, naming the target), but sets no cookie. The client then calls next-auth's `update({ impersonateUserId })`, and the `jwt` callback in `auth.ts` re-runs the same check before rewriting the token: identity fields become the target's, and `token.actor` remembers the real admin. A client that skipped the route and called `update()` itself hits exactly the same wall.
- **Only downwards.** `impersonationBlockReason()` in `lib/impersonation.ts` (pure, so the button and the server share it) refuses an equal or higher `ROLE_RANK`, yourself, and a deactivated account. Without that rule an ADMIN could become another ADMIN and inherit whatever that account was granted, with the audit trail naming the wrong person. CASHIER and ACCOUNTANT rank equal, so neither can become the other.
- **No chaining.** One impersonation at a time; the route and the callback both refuse a second while `actor` is set.
- **Getting back.** `components/layout/ImpersonationBar.tsx` — the amber strip across the top of every dashboard page, rendering `null` on an ordinary session — calls `DELETE /api/impersonate` (audit `IMPERSONATE_END`) then `update({ stopImpersonating: true })`. The admin's row is re-read from the DB on the way back rather than restored from the token, so a role or branch edited while they were away comes back correct.
- Both directions finish with a hard `window.location` navigation, because the permission matrix is fetched once per page load and every server component already on screen was rendered for the other identity.

## Receipt tab

Two settings: the footer terms and the **receipt font size**.

`Branch.receiptFontSize` (Int, default 12, migration `20260916000000_receipt_font_size`)
is the base px of the 80mm thermal slip. Thermal printers differ enough in dot
pitch that a receipt legible on one is unreadable on the next, which is why it
is a setting rather than a constant.

**`lib/receipt-font.ts` is the single type scale.** `receiptFontScale(base)`
derives `xs`/`sm`/`base`/`lg`/`xl` by fixed offsets (−2, −1, 0, +2, +4), so the
whole slip scales together instead of only its body copy. The offsets are
absolute rather than multiplicative on purpose: at 20px a 1.33× header would
overrun the paper width. `clampReceiptFontSize()` pins anything odd to
8–28 px and is applied in three places — the field's `onBlur`, `handleSave`,
and `PUT /api/settings/store` (the last because the value arrives from a text
input and Prisma would happily store 400).

Two renderers consume it, all through the same helper:

| Where | What reads it |
| --- | --- |
| `components/sales/InvoiceReceipt.tsx` | the one 80mm slip — printed by the Sales page (`#receipt-print`, fed an `InvoiceDetail` built from the on-screen invoice), the invoice page and Reports → Sales |
| `components/sales/ReceiptPrintTrigger.tsx` `pageStyle` | the `body` rule, so the print stylesheet can't override the inline sizes |

The Settings preview is rendered at a fixed **80mm** width from the same
`receiptFontScale`, so raising the number shows the item line beginning to wrap
before a roll of paper is spent finding out.

Both receipts previously hard-coded their sizes and did not even agree — the
Sales page was based on 12px and `InvoiceReceipt` on 11px, so a re-print was
visibly smaller than the slip the customer was first handed. They now share one
base.

## Branding — favicon, logo and PWA icons

Engine: **`lib/branding.ts`** (+ `lib/branding-image.tsx` for the rendering). UI:
`components/settings/BrandingUpload.tsx`, mounted in the **store** tab (favicon
+ logo) and the **pwa** tab (the 192/512 icons).

### The images live in the database, not in `/public`

This is the whole design decision, and the reason the previous implementation
was replaced. `POST /api/settings/icon` used to `fs.writeFile` the two PWA icons
into `/public`. That cannot work on Vercel — the runtime filesystem is
read-only, so the upload throws `EROFS` — and anywhere it *does* succeed,
`/public` is rebuilt from the repo on the next deploy and the icon silently
reverts. The workaround is committing the file by hand, which is not a setting a
shopkeeper can change.

Bytes now go in a **`Setting` row** as a data URL, under
`branding:<branchId>:<asset>` (`asset` ∈ `favicon | logo | icon192 | icon512`).
Consequences, all wanted:

- Uploading works on Vercel and survives deploys.
- It needed **no migration** — `Setting` already existed for `role_permissions`.
- It is already in the backup, because `lib/backup.ts` introspects the live
  catalogue rather than a hand-written model list.

Capped at 512 KB per image (`MAX_BRANDING_BYTES`) and restricted to PNG / JPEG /
WebP / SVG / ICO, because the row is read on the way to rendering an icon and an
unknown type would come back with a `Content-Type` no browser renders.

### Routes

| Route | Does |
| --- | --- |
| `GET /api/branding/:asset` | Serves the image. **Unauthenticated on purpose** — the manifest's icons are fetched with no session, and there is none on the login screen. A shop's name and logo are on its shopfront. |
| `GET /api/settings/branding?branchId=` | Which assets are the store's own (type, size, date) — drives each tile's Remove link. |
| `POST /api/settings/branding` | Multipart `asset` + `branchId` + `file`. `EDIT_STORE_SETTINGS`. |
| `DELETE /api/settings/branding?branchId=&asset=` | Back to the generated disc. `EDIT_STORE_SETTINGS`. |

`GET /api/branding/:asset` hands SVG and ICO back untouched (rasterising an SVG
defeats the point, and satori cannot read an ICO) and re-draws every other
format onto a square canvas at the asset's size, `objectFit: contain` so a wide
logo is fitted rather than cropped.

### The fallback icon

No upload → a **white first character of the store name on a teal disc**
(`renderInitialIcon`). This is what most installs will actually carry, so it is
drawn as a deliberate mark: a disc inset 6% from a transparent square, which
keeps it inside the maskable safe zone so an Android launcher can crop it to any
shape without clipping the art.

`brandingInitial()` **prefers the first ASCII letter or digit** over a leading
non-Latin one — "دکان Sidhey" gives `S` — because `next/og`'s bundled font has no
Urdu glyphs and would draw a hollow box. A name with no Latin character at all
still gets its real first character, and the tab tells the shopkeeper to upload
a favicon in that case. (The 13 MB Nastaliq font in `public/fonts` was
considered and rejected: loading it per icon request is not worth it.)

### Which branch's branding?

`resolveBrandingBranch()` — the **oldest active branch**, because the tab icon
and the manifest are fetched with no session and no `branchId`. The app is
effectively single-branch (no UI to create, list or switch branches), and it
mirrors the fallback `GET /api/settings/store` already uses when called without
one. Real multi-branch support would have to teach this function to tell them
apart.

### `/manifest.json` → `/manifest.webmanifest`

`public/manifest.json` (hand-written, naming a hard-coded shop, pointing at two
`/icon-*.png` files that were never in the repo) was replaced by
**`app/manifest.ts`**, generated from the store's own name and city.

**A code-generated manifest is served at `/manifest.webmanifest` in Next 16.3.4,
not `/manifest.json`.** The bundled docs list both names, but only for a *static*
manifest file; `/manifest.json` 404s. Two things had to follow the rename and
both would have failed silently:

- the `<link rel="manifest">` — Next emits it automatically from the file
  convention and **overrides** a `manifest:` field in `layout.tsx`, so that
  field was removed rather than left being silently rewritten;
- `PRECACHE_URLS` in `public/sw.js` — `cache.addAll()` is atomic, so the stale
  `/manifest.json` entry would have rejected the whole install and the service
  worker would never have activated. Cache name bumped to `sscc-pos-v4` with it.

### `app/favicon.ico` was removed

`app/icon.tsx` generates the tab icon from the database. The static
`favicon.ico` had to go rather than stay as a fallback: both conventions emit an
icon `<link>` (the `.ico` with `sizes="any"`, the generated one with a real
size), and which one wins is a per-browser heuristic — so with both in place the
shop's icon would show in some browsers and the stock Next.js logo in others.
Next cannot generate a `favicon` either way; `icon` is the convention that can
read a database.

`proxy.ts`'s matcher gained an explicit `icon` exclusion for the same feature:
`/icon` has no file extension, so the auth check was answering 307 to /login for
the one asset the login page itself needs.

### The store name is branding too

`app/layout.tsx` uses `generateMetadata()` so the tab title, the description and
the iOS home-screen label come from the branch. They were hard-coded to one
shop, so renaming the store changed its receipts but left the browser tab naming
the previous owner. Costs one indexed query per render, and the login page gives
up static optimisation for it.

### Still open

- **Nothing renders the logo yet.** It uploads, it is stored, and it is served
  at `/api/branding/logo`, but no invoice, GRN or receipt puts it on the paper —
  which was already true of the `logoUrl` field before uploads existed. Putting
  it in the `InvoiceDocument` / `GRNDocument` headers is the obvious next step.
- `logoUrl` (the text field, now in the store tab beside the uploads rather than
  in the receipt tab) is only consulted by `GET /api/branding/logo` when no logo
  has been uploaded, and then as a 307 redirect.

## Backup tab

> Scheduled backups, Google Drive upload, the local backup folder and the restore-from-list flow are in **[backup.md](backup.md)**. This section describes the engine underneath.

Export is `GET /api/settings/backup?format=sql|json|csv` (`DATABASE_BACKUP`); `?summary=1` returns table and row counts for the header. Restore is `POST /api/settings/backup/restore` (`DATABASE_RESTORE`, SUPER_ADMIN only by default) — multipart with `confirm=RESTORE` and a backup from `file`, `name` (local folder) or `id` (Drive); `mode=inspect` previews without restoring.

The engine is **`lib/backup.ts`**, plus **`lib/zip.ts`** (a ~90-line stored-only ZIP writer, no new dependency). It introspects the live PostgreSQL catalog rather than walking a hand-written model list, so every table Prisma has migrated is covered automatically:

- `readSchema()` — columns with their `format_type`, primary keys, FK edges, serial sequences, and a topological table order (parents first, ties alphabetical). Self-referencing nullable FKs (`SaleInvoice.refundOfInvoiceId`) are recorded separately.
- `readDatabase()` — `SELECT *` per table, every value passed through `encodeValue()` to a **string or null**. One encoder feeds all three formats; each SQL literal is written with an explicit `::<format_type>` cast, which is what lets a `numeric` or a `timestamp` survive a JSON/CSV round-trip that `Number(...)` would corrupt.
- `buildStatements()` — `TRUNCATE ... RESTART IDENTITY CASCADE`, batched multi-row `INSERT`s in dependency order, `UPDATE`s for the deferred self-FK columns, then `setval` per sequence. **Used verbatim by both the `.sql` download and the in-app restore**, so there is one ordering implementation, not two.
- `restoreFromJson()` — validates `meta.kind`, drops columns/tables the schema no longer has (as warnings, not failures), re-sorts to the live order, and replays inside one `$transaction` (300 s timeout). All-or-nothing.

The old export was branch-scoped nested JSON covering seven models; it left out users, accounts, expenses, installments, settings and stock adjustments, and nothing could read it back. It has been replaced rather than kept alongside — two similar JSON downloads where only one restores is a footgun.

**Why JSON and not CSV** (the `settings_whichFormatBody` string answers this in the UI): JSON records the table structure and each value's column type, so a restore is exact. CSV flattens each table into a separate file with no dependency order and no way to distinguish an empty cell from NULL, so the CSV bundle is read-only by design and the Restore box accepts JSON only. SQL is the one to hand to `psql -f` against a database that already has the schema.

## Clear Data tab

For wiping transactional data to start a fresh round of local testing, with an automatic one-click-restorable backup first. Reachable only when **both** are true:

- **`ENABLE_TEST_DATA_TOOLS=true`** in the environment — the kill switch. Checked server-side only (`lib/test-data-tools.ts`'s `testDataToolsEnabled()`), inside every route under `app/api/settings/clear-test-data/**`, which all `404` (not `403`) when it's off — the point is that a client install with the var unset or `"false"` can't discover the tool exists at all, not just that it's blocked. There is deliberately no `NEXT_PUBLIC_*` equivalent: this codebase has no precedent for a client-visible feature flag, and one here would ship "this tool exists" in the JS bundle of every install regardless of the var. `.env.example` documents it, defaulting to `"false"`.
- The **`CLEAR_TEST_DATA`** permission (`lib/permissions.ts`), SUPER_ADMIN only by default. Gates the tab's entry in `tabs` (`page.tsx`) and every route except the backup-restore one, which reuses `DATABASE_RESTORE` (see below).

The engine is **`lib/clear-data.ts`** — the single source of truth for both this tab and `prisma/reset-data.ts` (the pre-existing CLI script, refactored to import from here instead of carrying its own copy of the table list). It declares ten **groups** (Sales & Invoices, Purchases & GRNs, Ledger/Recoveries/Payments & Installments, Expenses, Items & Catalog, Cash & Bank Accounts, Parties, Stock Adjustments, Day Book, Audit Log), each naming its tables and which other groups it `requires` — read off the actual foreign keys in `prisma/schema.prisma`, not guessed. `resolveGroupSelection()` expands a UI selection to its transitive closure and returns it in the one order that's always safe to delete in; `clearData()` runs that order inside a single `$transaction`, so a selection that's missing a dependency either gets the dependency pulled in automatically, or — if the closure map is ever wrong — trips a Postgres FK constraint and rolls back untouched rather than partially deleting. `tests/clear-data.test.ts` pins the closure logic (the part worth unit-testing per `testing.md`'s convention; the delete transaction itself isn't).

Kept, same as `reset-data.ts` always kept: `User`, `UserBranch`, `Organization`, `Branch`, `Setting`, `Session`, and the Walking Customer `Party` (balance zeroed, `accountId` sequence fixed up).

Routes, all under `app/api/settings/clear-test-data/`:

- `GET /?status=1` — `{ enabled }` only, cheap, fetched once on Settings mount (only when `can("CLEAR_TEST_DATA")`) to decide whether the tab renders at all.
- `GET /` — `{ enabled, groups, backups }` with live row counts per group; fetched lazily when the tab opens, like the Backup tab's summary.
- `POST /` — body `{ groupIds, confirm: "CLEAR" }`. Always snapshots the **whole** database first via `lib/backup.ts`'s `readDatabase()`/`toJsonBackup()` (not just the selected tables — restoring a partial backup would be its own can of worms) before deleting, unlike the CLI script's `--no-backup` escape hatch, which the UI doesn't offer.
- `GET/DELETE /backups/[file]` — download or remove one saved backup.
- `POST /restore` — body `{ file, confirm: "RESTORE" }`. One-click restore of a backup already on disk (no re-upload), by filename only — `lib/test-data-tools.ts`'s `resolveBackupPath()` rejects anything but a bare filename this app generated itself, so path traversal isn't reachable. Gated on `DATABASE_RESTORE`, not `CLEAR_TEST_DATA`, since it's the exact same "replace every table" operation `POST /api/settings/backup/restore` already performs — just sourced from disk instead of an upload — and both default to SUPER_ADMIN anyway.

Backups live at `data/test-data-backups/<clear-ISO-timestamp>.json` (gitignored — these are full-database dumps). No retention policy: they accumulate until deleted from the tab.

## Site-wide feature toggles (in-progress pattern to follow)

Just added, backed by new columns on `Branch`: `pwaOfflineEnabled`, `languageSwitcherEnabled` (migration `20260908094010_branch_feature_toggles`).

```
page.tsx:142    const pwaEnabled = store?.pwaOfflineEnabled !== false;
page.tsx:143    const languageSwitcherEnabled = store?.languageSwitcherEnabled !== false;
page.tsx:145-158  toggleSiteSetting(field, next) → PUT /api/settings/store { branchId, [field]: next }
```

Toggle UI lives inline in the relevant tab (`language` tab: ~690-700, `pwa` tab: ~773-783) using `ToggleLeft/ToggleRight` icon buttons. **This is the established pattern for adding new site-wide toggles** (e.g. a future "bank payments enabled" toggle).

## Bank / cash accounts — moved out

There **was** an `accounts` tab here. It now lives at `/dashboard/accounts` with its own page, statement view and permission set — see **`accounts.md`**. Settings kept a shortcut card to it for a while; that was removed too once Accounts had a sidebar entry, since two links to one page is one too many.

The `Account` model has existed since Phase 1; earlier revisions of this doc claiming it was greenfield were stale.

## Roles & Permissions shortcut

`page.tsx:~503-518` links to `/dashboard/settings/roles`, a full permission-matrix editor backed by `GET/PUT /api/settings/permissions`, storing an override JSON in the generic `Setting` table under key `"role_permissions"`. The matrix **is** enforced — server-side by `requirePermission()` and client-side by `usePermissions()`; see `schema-permissions.md` for the route-by-route table.

## Units tab

Two numbers — **inches per gaz** (36) and **inches per metre** (40) — with the
resulting `1 GAZ = 0.9000 MTR` / `1 MTR = 1.1111 GAZ` shown read-only beneath
them. `PUT` is gated on `EDIT_STORE_SETTINGS`; `GET` is open to any signed-in
user, because every stock display converts through these and gating the read
would blank the sales screen for a cashier.

The two *factors* are deliberately not editable in their own right: they could
be set to disagree with each other, and then a quantity converted out and back
would not come home. One pair of lengths makes that unrepresentable.

Stored as `units.inchesPerGaz` / `units.inchesPerMtr` in the generic `Setting`
key/value table — the same table branding and role permissions use, so this
needed no model of its own and is already inside backup/restore. Cached 60s
server-side (`lib/unit-settings.ts`) and once per page load client-side
(`lib/use-unit-config.ts`); saving invalidates both.

Changing them affects **future receipts only** — `GRNItem.stockQty` is stored,
not recomputed, so past conversions stand. See `units.md`.
