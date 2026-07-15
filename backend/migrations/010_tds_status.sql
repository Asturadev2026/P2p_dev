-- 010_tds_status.sql · TDS Engine lifecycle status (additive only)
-- Tracks an invoice's progress through the TDS Engine page, independent of the
-- pipeline `stage` column: tds_pending | tds_computed | tds_ready | pending_approval

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_status TEXT NOT NULL DEFAULT 'tds_pending';
