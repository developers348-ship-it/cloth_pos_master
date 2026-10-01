-- Base font size (px) for the 80mm thermal receipt. Everything else on the
-- slip is derived from it (lib/receipt-font.ts); 12 is what the receipt was
-- hard-coded to before this column existed.
ALTER TABLE "Branch" ADD COLUMN "receiptFontSize" INTEGER NOT NULL DEFAULT 12;
