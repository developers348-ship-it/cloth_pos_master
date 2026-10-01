# 🧵 Cloth POS

A modern **Point of Sale (POS) system** built for cloth & fabric stores. Built with Next.js 16, Prisma ORM, PostgreSQL, and NextAuth.js — featuring multi-branch support, inventory management, sales/purchase tracking, ledger accounting, and barcode generation.

---

## ✨ Features

- 🏪 **Multi-Branch Support** — Manage multiple store branches under one organization
- 🔐 **Role-Based Access Control** — Super Admin, Admin, Manager, Cashier, Accountant roles
- 🛒 **Sales & Invoicing** — Create, hold, void, and print sales invoices with barcode support
- 📦 **Purchase Management** — GRN (Goods Received Notes) with vendor tracking
- 🏷️ **Catalog & Inventory** — Manage items by PCS, GAZ, or MTR units with stock tracking
- 👥 **Party Ledger** — Full ledger accounting for cash customers, credit customers, and vendors
- 📊 **Reports** — Sales, purchases, and stock reports
- ⚙️ **Settings** — Store configuration per branch
- 🔄 **Offline Sync** — Built with Dexie.js for local-first capabilities
- 🖨️ **Print Support** — Invoice and barcode printing via `react-to-print` and `JsBarcode`

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + Radix UI |
| Auth | [NextAuth.js v5](https://authjs.dev) + Prisma Adapter |
| ORM | [Prisma](https://www.prisma.io) |
| Database | PostgreSQL |
| Offline DB | [Dexie.js](https://dexie.org) (IndexedDB) |
| UI Components | Radix UI, Lucide Icons, shadcn/ui patterns |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/cloth-pos.git
cd cloth-pos
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your database URL and auth secret:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/clothPos"
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"
```

### 4. Set up the database

Run Prisma migrations to create the schema:

```bash
npm run db:migrate
```

Optionally seed the database with sample data:

```bash
npm run db:seed
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```
cloth-pos/
├── app/
│   ├── api/           # API routes (auth, items, sales, purchases, etc.)
│   ├── dashboard/     # Dashboard pages (sales, purchases, catalog, ledger, reports, settings)
│   ├── login/         # Authentication pages
│   └── layout.tsx     # Root layout
├── components/        # Reusable UI components
├── lib/               # Utility functions and shared logic
├── prisma/
│   ├── schema.prisma  # Database schema
│   ├── seed.ts        # Database seeder
│   └── migrations/    # Prisma migration files
├── auth.ts            # NextAuth configuration
└── middleware.ts      # Route protection middleware
```

---

## 🗄️ Database Scripts

| Command | Description |
|---|---|
| `npm run db:migrate` | Run pending migrations |
| `npm run db:seed` | Seed the database with initial data |
| `npm run db:studio` | Open Prisma Studio (GUI) |
| `npm run db:generate` | Regenerate Prisma Client |

---

## 🏗️ Build & Deploy

```bash
# Production build
npm run build

# Start production server
npm start
```

---

## 🔒 Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Secret key for NextAuth session encryption |
| `NEXTAUTH_URL` | Base URL of your application |

---

## 📄 License

This project is private and proprietary.
