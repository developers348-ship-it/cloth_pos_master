-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('SALE_RECEIPT', 'SALE_REFUND', 'PURCHASE_PAYMENT', 'PURCHASE_REFUND', 'RECOVERY', 'PAYMENT', 'INSTALLMENT_COLLECTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InstallmentPlanKind" AS ENUM ('PROMISE_DAY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "GRN" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "bankAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cashAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "installmentPeriods" INTEGER,
ADD COLUMN     "paymentMethod" TEXT NOT NULL DEFAULT 'LEND',
ADD COLUMN     "promiseDays" INTEGER,
ADD COLUMN     "repaymentType" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "Recovery" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "bankAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditApplied" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "installmentPeriods" INTEGER,
ADD COLUMN     "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
ADD COLUMN     "repaymentType" TEXT NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isDefaultCash" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountEntry" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AccountEntryType" NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "partyId" TEXT,
    "invoiceId" TEXT,
    "grnId" TEXT,
    "recoveryId" TEXT,
    "paymentId" TEXT,
    "installmentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "kind" "InstallmentPlanKind" NOT NULL,
    "invoiceId" TEXT,
    "grnId" TEXT,
    "principal" DECIMAL(12,2) NOT NULL,
    "periods" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "recoveryId" TEXT,
    "paymentId" TEXT,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_branchId_idx" ON "Account"("branchId");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX "AccountEntry_branchId_idx" ON "AccountEntry"("branchId");

-- CreateIndex
CREATE INDEX "AccountEntry_accountId_idx" ON "AccountEntry"("accountId");

-- CreateIndex
CREATE INDEX "AccountEntry_date_idx" ON "AccountEntry"("date");

-- CreateIndex
CREATE INDEX "AccountEntry_type_idx" ON "AccountEntry"("type");

-- CreateIndex
CREATE INDEX "AccountEntry_partyId_idx" ON "AccountEntry"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_invoiceId_key" ON "InstallmentPlan"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_grnId_key" ON "InstallmentPlan"("grnId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_branchId_idx" ON "InstallmentPlan"("branchId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_partyId_idx" ON "InstallmentPlan"("partyId");

-- CreateIndex
CREATE INDEX "Installment_planId_idx" ON "Installment"("planId");

-- CreateIndex
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");

-- CreateIndex
CREATE INDEX "Installment_status_idx" ON "Installment"("status");

-- CreateIndex
CREATE INDEX "GRN_bankAccountId_idx" ON "GRN"("bankAccountId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Recovery_accountId_idx" ON "Recovery"("accountId");

-- CreateIndex
CREATE INDEX "SaleInvoice_bankAccountId_idx" ON "SaleInvoice"("bankAccountId");

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRN" ADD CONSTRAINT "GRN_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_recoveryId_fkey" FOREIGN KEY ("recoveryId") REFERENCES "Recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntry" ADD CONSTRAINT "AccountEntry_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_recoveryId_fkey" FOREIGN KEY ("recoveryId") REFERENCES "Recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
