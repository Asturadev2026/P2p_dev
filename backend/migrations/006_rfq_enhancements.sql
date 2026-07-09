-- Migration 006: richer RFQ creation (schedule + message), off-system vendor phone,
-- quotation GST rate + quote code, and signed-quote document storage.
-- Additive + idempotent.

ALTER TABLE rfqs
    ADD COLUMN IF NOT EXISTS cutoff_time TEXT,     -- e.g. "17:00" — display only, paired with due_date
    ADD COLUMN IF NOT EXISTS message     TEXT;     -- custom note sent to invited vendors

ALTER TABLE rfq_vendors
    ADD COLUMN IF NOT EXISTS off_system_phone TEXT;

ALTER TABLE quotations
    ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.0;

CREATE TABLE IF NOT EXISTS quotation_documents (
    id           TEXT PRIMARY KEY,               -- QDOC-20260709-A1B2C3D4
    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    mime_type    TEXT,
    file_size    INTEGER,
    file_data    BYTEA NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_docs_quotation ON quotation_documents(quotation_id);
