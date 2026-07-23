-- 014_treds_listing.sql · TReDS "List on TReDS" action (additive only)
-- settlement_days / remarks capture the fields entered on the listing modal.

ALTER TABLE factoring_units ADD COLUMN IF NOT EXISTS settlement_days INTEGER;
ALTER TABLE factoring_units ADD COLUMN IF NOT EXISTS remarks TEXT;
