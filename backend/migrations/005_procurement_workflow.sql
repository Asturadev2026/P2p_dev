-- Migration 005: complete PR -> RFQ -> PO -> GRN workflow
-- Additive + idempotent — safe to run once against an already-seeded database.
-- Does not touch existing vendor onboarding tables/columns.

-- ---------- Procurement category source of truth ----------
-- Flags the 7 categories that must exactly match Vendor Onboarding's
-- "Add Products You Will Supply" category list (see frontend
-- constants/procurementCategories.js). Old spend_categories rows (used by
-- invoices / vendor master / TDS routing) are untouched.
ALTER TABLE spend_categories
    ADD COLUMN IF NOT EXISTS is_procurement_category BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO spend_categories (id, department_id, name, statutory, required_documents, is_procurement_category)
SELECT * FROM (VALUES
    ('PC-STY',  'ADMIN', 'Stationery & Office Supplies', FALSE, '[]'::jsonb, TRUE),
    ('PC-ITHW', 'ADMIN', 'IT Hardware',                   FALSE, '[]'::jsonb, TRUE),
    ('PC-FUR',  'ADMIN', 'Furniture',                     FALSE, '[]'::jsonb, TRUE),
    ('PC-ELEC', 'ADMIN', 'Electrical & Fixtures',         FALSE, '[]'::jsonb, TRUE),
    ('PC-HSK',  'ADMIN', 'Housekeeping & Consumables',    FALSE, '[]'::jsonb, TRUE),
    ('PC-PRN',  'ADMIN', 'Printing & Branding',           FALSE, '[]'::jsonb, TRUE),
    ('PC-SVC',  'ADMIN', 'Services',                       FALSE, '[]'::jsonb, TRUE)
) AS v(id, department_id, name, statutory, required_documents, is_procurement_category)
WHERE NOT EXISTS (SELECT 1 FROM spend_categories WHERE id = v.id);

-- ---------- Vendor product catalog (RFQ matching source of truth) ----------
CREATE TABLE IF NOT EXISTS vendor_products (
    id            SERIAL PRIMARY KEY,
    vendor_id     TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    product_name  TEXT NOT NULL,
    product_code  TEXT,
    category      TEXT NOT NULL,           -- one of PROCUREMENT_CATEGORIES
    sub_category  TEXT,
    uom           TEXT,
    hsn_sac_code  TEXT,
    gst_rate      NUMERIC(5,2),
    basic_rate    NUMERIC(14,2),
    payment_terms TEXT,
    status        TEXT NOT NULL DEFAULT 'active',   -- active | inactive
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor    ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_category  ON vendor_products(category);

-- ---------- RFQ: category + terms + invited vendors (incl. off-system) ----------
ALTER TABLE rfqs
    ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES spend_categories(id),
    ADD COLUMN IF NOT EXISTS terms       TEXT;

CREATE TABLE IF NOT EXISTS rfq_vendors (
    id              SERIAL PRIMARY KEY,
    rfq_id          TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    vendor_id       TEXT REFERENCES vendors(id),      -- NULL for off-system vendors
    is_off_system   BOOLEAN NOT NULL DEFAULT FALSE,
    off_system_name TEXT,
    off_system_email TEXT,
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rfq_id, vendor_id)
);

-- ---------- Purchase orders: payment / delivery terms (auto-filled from RFQ) ----------
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS payment_terms  TEXT,
    ADD COLUMN IF NOT EXISTS delivery_terms TEXT;

-- ---------- GRN lines: rejection tracking ----------
ALTER TABLE grn_lines
    ADD COLUMN IF NOT EXISTS qty_rejected     NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
