-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "refundOfInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "SaleInvoice_refundOfInvoiceId_idx" ON "SaleInvoice"("refundOfInvoiceId");

-- AddForeignKey
ALTER TABLE "SaleInvoice" ADD CONSTRAINT "SaleInvoice_refundOfInvoiceId_fkey" FOREIGN KEY ("refundOfInvoiceId") REFERENCES "SaleInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
