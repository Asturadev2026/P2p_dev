-- 015_treds_bidding.sql · TReDS "Start Bidding" demo bids (additive only)
-- advance_amount / settlement_days / status capture the extra demo bid fields.

ALTER TABLE factoring_bids ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(14,2);
ALTER TABLE factoring_bids ADD COLUMN IF NOT EXISTS settlement_days INTEGER;
ALTER TABLE factoring_bids ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted';
