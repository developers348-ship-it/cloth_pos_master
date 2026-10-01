-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CASH', 'CREDIT', 'VENDOR');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('PCS', 'GAZ', 'MTR');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('SAVED', 'HELD', 'VOIDED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "GRNType" AS ENUM ('PURCHASE', 'RETURN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_RETURN', 'PAYMENT', 'RECEIPT', 'ADJUSTMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "StockAdjustmentType" AS ENUM ('ADD', 'SUBTRACT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "footerTerms" TEXT DEFAULT '* ALL PRICES ARE FIXED
* NO CLAIM ON STICH SUIT
* SUIT EXCHANGED WITHIN SAME BRANDS ONLY
* BRING INVOICE FOR EXCHANGE/CLAIM/RETURN WITHIN 7 DAYS',
    "orgId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "accountId" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "type" "PartyType" NOT NULL DEFAULT 'CASH',
    "previousBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "promiseDays" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "unit" "Unit" NOT NULL DEFAULT 'PCS',
    "purchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "altSalePrice" DECIMAL(12,2),
    "discountRS" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "openingStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minLevel" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemStock" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partyOption" TEXT NOT NULL DEFAULT 'CASH',
    "printUrdu" BOOLEAN NOT NULL DEFAULT false,
    "promiseDays" INTEGER,
    "grossSale" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "packageDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saleAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustType" TEXT NOT NULL DEFAULT 'sub',
    "slipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "courierCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netBill" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cardAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashReceived" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "change" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "soldPcs" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "soldGaz" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "soldMtr" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returnPcs" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returnGaz" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returnMtr" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "chooseBank" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'SAVED',
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "localId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "qty" DECIMAL(12,3) NOT NULL,
    "pcs" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "gaz" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "mtr" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2) NOT NULL,
    "disRS" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "disPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRN" (
    "id" TEXT NOT NULL,
    "grnNo" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billNo" TEXT,
    "remarks" TEXT,
    "saleAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netBill" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPurchaseQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "totalReturnQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "localId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GRN_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GRNItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "GRNType" NOT NULL DEFAULT 'PURCHASE',
    "qty" DECIMAL(12,3) NOT NULL,
    "costRate" DECIMAL(12,2) NOT NULL,
    "saleRate" DECIMAL(12,2) NOT NULL,
    "disPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "GRNItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "LedgerEntryType" NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "invoiceId" TEXT,
    "grnId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recovery" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "bankName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "bankName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayBook" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cashIn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashOut" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "StockAdjustmentType" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Branch_orgId_idx" ON "Branch"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserBranch_userId_idx" ON "UserBranch"("userId");

-- CreateIndex
CREATE INDEX "UserBranch_branchId_idx" ON "UserBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranch_userId_branchId_key" ON "UserBranch"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Party_accountId_key" ON "Party"("accountId");

-- CreateIndex
CREATE INDEX "Party_type_idx" ON "Party"("type");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_barcode_idx" ON "Item"("barcode");

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- CreateIndex
CREATE INDEX "Item_brand_idx" ON "Item"("brand");

-- CreateIndex
CREATE INDEX "ItemStock_itemId_idx" ON "ItemStock"("itemId");

-- CreateIndex
CREATE INDEX "ItemStock_branchId_idx" ON "ItemStock"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStock_itemId_branchId_key" ON "ItemStock"("itemId", "branchId");

-- CreateIndex
CREATE INDEX "SaleInvoice_branchId_idx" ON "SaleInvoice"("branchId");

-- CreateIndex
CREATE INDEX "SaleInvoice_partyId_idx" ON "SaleInvoice"("partyId");

-- CreateIndex
CREATE INDEX "SaleInvoice_date_idx" ON "SaleInvoice"("date");

-- CreateIndex
CREATE INDEX "SaleInvoice_status_idx" ON "SaleInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SaleInvoice_invoiceNo_branchId_key" ON "SaleInvoice"("invoiceNo", "branchId");

-- CreateIndex
CREATE INDEX "SaleInvoiceItem_invoiceId_idx" ON "SaleInvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "SaleInvoiceItem_itemId_idx" ON "SaleInvoiceItem"("itemId");

-- CreateIndex
CREATE INDEX "GRN_branchId_idx" ON "GRN"("branchId");

-- CreateIndex
CREATE INDEX "GRN_partyId_idx" ON "GRN"("partyId");

-- CreateIndex
CREATE INDEX "GRN_date_idx" ON "GRN"("date");

-- CreateIndex
CREATE UNIQUE INDEX "GRN_grnNo_branchId_key" ON "GRN"("grnNo", "branchId");

-- CreateIndex
CREATE INDEX "GRNItem_grnId_idx" ON "GRNItem"("grnId");

-- CreateIndex
CREATE INDEX "GRNItem_itemId_idx" ON "GRNItem"("itemId");

-- CreateIndex
CREATE INDEX "LedgerEntry_branchId_idx" ON "LedgerEntry"("branchId");

-- CreateIndex
CREATE INDEX "LedgerEntry_partyId_idx" ON "LedgerEntry"("partyId");

-- CreateIndex
CREATE INDEX "LedgerEntry_date_idx" ON "LedgerEntry"("date");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_idx" ON "LedgerEntry"("type");

-- CreateIndex
CREATE INDEX "Recovery_branchId_idx" ON "Recovery"("branchId");

-- CreateIndex
CREATE INDEX "Recovery_partyId_idx" ON "Recovery"("partyId");

-- CreateIndex
CREATE INDEX "Payment_branchId_idx" ON "Payment"("branchId");

-- CreateIndex
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");

-- CreateIndex
CREATE INDEX "DayBook_branchId_idx" ON "DayBook"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DayBook_branchId_date_key" ON "DayBook"("branchId", "date");

-- CreateIndex
CREATE INDEX "StockAdjustment_branchId_idx" ON "StockAdjustment"("branchId");

-- CreateIndex
CREATE INDEX "StockAdjustment_itemId_idx" ON "StockAdjustment"("itemId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStock" ADD CONSTRAINT "ItemStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStock" ADD CONSTRAINT "ItemStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoiceItem" ADD CONSTRAINT "SaleInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleInvoiceItem" ADD CONSTRAINT "SaleInvoiceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRN" ADD CONSTRAINT "GRN_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRN" ADD CONSTRAINT "GRN_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRN" ADD CONSTRAINT "GRN_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRNItem" ADD CONSTRAINT "GRNItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GRNItem" ADD CONSTRAINT "GRNItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayBook" ADD CONSTRAINT "DayBook_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
