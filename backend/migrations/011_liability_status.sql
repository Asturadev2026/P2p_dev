-- 011_liability_status.sql · Liability & JV page lifecycle status (additive only)
-- Tracks an invoice's progress through the Liability & JV page, independent of the
-- pipeline `stage` column: pending | liability_booked

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS liability_status TEXT NOT NULL DEFAULT 'pending';
