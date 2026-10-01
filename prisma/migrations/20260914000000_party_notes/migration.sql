-- Free-text remarks staff keep against a customer/vendor, entered from the
-- Add/Edit Party dialog.
--
-- Nullable with no default: every existing party has no note, and a blank box
-- is stored as NULL rather than an empty string so "has a note" is a single
-- IS NOT NULL check.

ALTER TABLE "Party" ADD COLUMN "notes" TEXT;
