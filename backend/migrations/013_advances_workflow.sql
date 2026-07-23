-- 013_advances_workflow.sql · Advances & Imprest workflow (additive only)
-- disbursed_at tracks when an approved advance/imprest was actually paid out.
-- bill_file records the uploaded bill/receipt reference for a settlement (imprest).

ALTER TABLE advances ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;
ALTER TABLE advance_settlements ADD COLUMN IF NOT EXISTS bill_file TEXT;
