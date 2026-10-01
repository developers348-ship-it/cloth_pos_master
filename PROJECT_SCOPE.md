# Cloth POS — Project Scope

## What it is
A multi-branch Point of Sale system for cloth/fabric retail stores. Next.js 16 (App Router) + TypeScript, PostgreSQL via Prisma, NextAuth v5 (credentials/JWT), Tailwind v4 + Radix UI. Offline-first groundwork via Dexie.js (IndexedDB) is a dependency but not yet wired into any page.

## Tech stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **DB/ORM**: PostgreSQL, Prisma 5.22 (`prisma/schema.prisma`)
- **Auth**: next-auth v5 beta, JWT sessions (30 min default, 30 days with "remember me"), credentials provider with bcrypt
- **UI**: Tailwind CSS v4, Radix UI primitives, lucide-react icons, react-hot-toast
- **Other**: jsbarcode + react-to-print (barcode/invoice printing), date-fns, dexie (offline, unused so far)

## Domain model (`prisma/schema.prisma`)
- **Organization → Branch** (multi-branch under one org)
- **User / UserBranch** — role-based (SUPER_ADMIN, ADMIN, MANAGER, CASHIER, ACCOUNTANT), users can belong to multiple branches
- **Party** — customers/vendors (CASH, CREDIT, VENDOR), with balance, credit limit, promise days
- **Item / ItemCategory / ItemBrand / ItemGroup / ItemStock** — catalog + per-branch stock levels, units PCS/GAZ/MTR
- **SaleInvoice / SaleInvoiceItem** — full invoice model with discounts, returns, adjustments, courier charges, card/cash split, hold/void status, offline sync status fields
- **GRN / GRNItem** — purchase & purchase-return goods receipt notes
- **LedgerEntry, Recovery, Payment, DayBook** — accounting/ledger side (sale, purchase, payment, receipt, adjustment, opening balance entry types)
- **StockAdjustment** — manual stock add/subtract
- **AuditLog**, **Setting** — audit trail and key/value store config

## Current implementation status
| Area | Status | Notes |
|---|---|---|
| Auth (login, JWT, branch-switch) | ✅ Done | `auth.ts`, `middleware.ts`, `app/login/` |
| Permissions (`lib/permissions.ts`) | ✅ Defined | Central `PERMISSIONS` map per role, not yet enforced everywhere |
| Dashboard home | ✅ Done | `app/dashboard/page.tsx` |
| Catalog (categories/brands/groups) | ✅ Done | CRUD UI + API routes under `app/api/catalog/` |
| Items | ✅ Done | `app/dashboard/items/page.tsx` (426 lines) + `app/api/items/` |
| Parties | ✅ Done | `app/dashboard/parties/page.tsx` + `app/api/parties/` |
| Sales / Invoicing | ✅ Done (largest module) | `app/dashboard/sales/page.tsx` (822 lines) + `app/api/sales/` (create invoice, next-invoice-no) |
| Settings (store/branch config) | ✅ Done | `app/dashboard/settings/page.tsx` + `app/api/settings/store/` |
| **Purchases (GRN)** | 🚧 Stub only | Page shows "Coming in Phase 2" — no API routes exist yet |
| **Ledger & Accounts** | 🚧 Stub only | Page shows "Coming in Phase 3" — no API routes yet |
| **Reports** | 🚧 Stub only | Page shows "Coming in Phase 3" — no API routes yet |
| Offline sync (Dexie) | ❌ Not started | Dependency installed, schema has `syncStatus`/`localId` fields, no client code yet |
| Audit logging | ❌ Not wired | Model exists, nothing writes to it yet |

## Known phased roadmap (per stub page copy)
- **Phase 2**: GRN / Purchases
- **Phase 3**: Ledger & Accounts, Reports

## Notable conventions / gotchas
- `AGENTS.md` warns this is a customized Next.js — check `node_modules/next/dist/docs/` before relying on training-data assumptions about Next.js APIs.
- Money fields use `Decimal(12,2)`; quantities use `Decimal(12,3)` (fractional GAZ/MTR units).
- Invoice numbers (`invoiceNo`) and GRN numbers (`grnNo`) are unique per branch, not globally.
- Party `isDefault` marks the built-in "Walking Customer" (cash sale) record.
- Session/JWT carries `role`, `branchId`, `branchName`; branch switching updates the token via NextAuth's `trigger: "update"`.

## Open questions for scoping new work
- Which phase (Purchases/GRN, Ledger, or Reports) is the next priority?
- Should permission checks in `lib/permissions.ts` be enforced in API routes now, or is that deferred?
- Is offline sync (Dexie) in scope soon, or purely future-proofing in the schema?
