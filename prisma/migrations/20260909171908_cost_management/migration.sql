-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('EXPENSE', 'PROFIT_WITHDRAWAL', 'CAPITAL_INJECTION');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PAID', 'UNPAID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountEntryType" ADD VALUE 'EXPENSE';
ALTER TYPE "AccountEntryType" ADD VALUE 'PROFIT_WITHDRAWAL';
ALTER TYPE "AccountEntryType" ADD VALUE 'CAPITAL_INJECTION';

-- AlterTable
ALTER TABLE "AccountEntry" ADD COLUMN     "expenseId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ExpenseKind" NOT NULL DEFAULT 'EXPENSE',
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethod" TEXT,
    "accountId" TEXT,
    "paidAt" TIMESTAMP(3),
    "payeeUserId" TEXT,
    "payeeName" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_branchId_idx" ON "ExpenseCategory"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_branchId_name_key" ON "ExpenseCategory"("branchId", "name");

-- CreateIndex
CREATE INDEX "Expense_branchId_idx" ON "Expense"("branchId");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_kind_idx" ON "Expense"("kind");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "Expense_accountId_idx" ON "Expense"("accountId");

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
