-- Migration 007: PO review page (special instructions) + GRN photo evidence storage.
-- Additive + idempotent.

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS notes TEXT;   -- special instructions to vendor, editable pre-issue

CREATE TABLE IF NOT EXISTS grn_documents (
    id          TEXT PRIMARY KEY,          -- GDOC-20260709-A1B2C3D4
    grn_id      TEXT NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT,
    file_size   INTEGER,
    file_data   BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grn_docs_grn ON grn_documents(grn_id);
