-- Links an ad-hoc vendor Payment to one specific purchase bill — the
-- vendor-side mirror of `Recovery.invoiceId`.
--
-- Nullable on purpose: existing payments were made against the vendor's
-- balance as a whole and stay that way, and a payment recorded without a
-- per-GRN split still legitimately leaves this null.

ALTER TABLE "Payment" ADD COLUMN "grnId" TEXT;

CREATE INDEX "Payment_grnId_idx" ON "Payment"("grnId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_grnId_fkey"
  FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE SET NULL ON UPDATE CASCADE;
