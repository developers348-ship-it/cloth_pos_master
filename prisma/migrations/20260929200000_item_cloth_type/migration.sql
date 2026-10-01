-- Optional fabric kind on an item; sets the length of a "suit" at the till.
CREATE TYPE "ClothType" AS ENUM ('COTTON', 'WASH_WEAR');
ALTER TABLE "Item" ADD COLUMN "clothType" "ClothType";
