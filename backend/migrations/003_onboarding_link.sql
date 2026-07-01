-- Add columns required for the Send Onboarding Link flow.
-- Run this once against your database before starting the backend.

ALTER TABLE vendor_onboarding
    ADD COLUMN IF NOT EXISTS trade_name        TEXT,
    ADD COLUMN IF NOT EXISTS constitution      TEXT,
    ADD COLUMN IF NOT EXISTS category          TEXT,
    ADD COLUMN IF NOT EXISTS onb_token         TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS link_expires_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS link_sent_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sent_by           TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS link_validity_days INTEGER DEFAULT 7;
