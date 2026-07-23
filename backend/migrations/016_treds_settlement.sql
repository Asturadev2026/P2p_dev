-- 016_treds_settlement.sql · TReDS "Mark Settled" action (additive only)
-- settled_at / settlement_ref / settlement_remarks capture the settlement modal fields.

ALTER TABLE factoring_units ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE factoring_units ADD COLUMN IF NOT EXISTS settlement_ref TEXT;
ALTER TABLE factoring_units ADD COLUMN IF NOT EXISTS settlement_remarks TEXT;
