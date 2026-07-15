-- 009_capture_status.sql · Capture Inbox lifecycle status (additive only)
-- Tracks where an invoice sits within the Capture Inbox flow, independent of
-- the pipeline `stage` column: captured (OCR-confirmed) | draft | match_pending
-- (about to leave / left the capture list for the 3-Way Match queue).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS capture_status TEXT NOT NULL DEFAULT 'captured';
