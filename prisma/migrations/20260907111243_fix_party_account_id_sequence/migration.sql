-- The Walking Customer is seeded with a hardcoded accountId of 1001, which
-- bypasses the "Party_accountId_seq" sequence entirely. Left alone, the
-- sequence still starts at 1, so the next party created via Prisma's
-- autoincrement would get accountId 1 (then 2, 3, ...) instead of continuing
-- on from 1001. Advance the sequence past the highest accountId currently in
-- use (or 1001 if none/lower) so newly created parties start at 1002.
SELECT setval(
  pg_get_serial_sequence('"Party"', 'accountId'),
  GREATEST(COALESCE((SELECT MAX("accountId") FROM "Party"), 0), 1001),
  true
);
