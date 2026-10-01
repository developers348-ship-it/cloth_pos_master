-- Purchase Return GRNs. An existing GRN made of nothing but return lines was
-- one in all but name.
ALTER TABLE "GRN" ADD COLUMN "isReturn" BOOLEAN NOT NULL DEFAULT false;
UPDATE "GRN" g SET "isReturn" = true
WHERE EXISTS (SELECT 1 FROM "GRNItem" i WHERE i."grnId" = g.id)
  AND NOT EXISTS (SELECT 1 FROM "GRNItem" i WHERE i."grnId" = g.id AND i."type" <> 'RETURN');
