-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "recoveryId" TEXT;

-- AlterTable
ALTER TABLE "Recovery" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_recoveryId_idx" ON "LedgerEntry"("recoveryId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "Recovery_invoiceId_idx" ON "Recovery"("invoiceId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_recoveryId_fkey" FOREIGN KEY ("recoveryId") REFERENCES "Recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
