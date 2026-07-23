-- 012_payment_status.sql · Payment Batch page lifecycle status (additive only)
-- Tracks an invoice's progress through the Payment Batch page, independent of the
-- pipeline `stage` column: payment_ready | payment_released | paid
-- Also adds an optional remarks field captured alongside a batch's UTR.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'payment_ready';
ALTER TABLE payment_items ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Backfill: invoices already paid/released before this column existed.
UPDATE invoices SET payment_status = 'paid' WHERE stage = 'paid';
UPDATE invoices i SET payment_status = 'payment_released'
FROM payment_items pi JOIN payment_batches b ON b.id = pi.batch_id
WHERE pi.invoice_id = i.id AND b.status = 'released' AND i.stage = 'payments';
