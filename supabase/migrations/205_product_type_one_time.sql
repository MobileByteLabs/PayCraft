-- 205: product_type gains 'one_time' — the name the API has accepted all along.
--
-- dashboard/lib/product-write.ts (VALID_PRODUCT_TYPES) and the MCP tool paycraft_create_product both
-- offer `subscription | one_time | consumable`, and the comment there says that is the live enum. It was
-- not: 028 created ('subscription','trial','lifetime') and 157 added only 'consumable'. Every one_time
-- create therefore failed the enum cast and answered HTTP 500 query_failed (seen 2026-11-22 creating
-- Status Saver's `pro-lifetime`). Additive only — 'lifetime' stays for existing rows; every sync lane
-- already treats any non-'subscription' type as a one-time charge, so both names sell the same way.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'product_type' AND e.enumlabel = 'one_time'
  ) THEN
    ALTER TYPE product_type ADD VALUE 'one_time';
  END IF;
END $$;
