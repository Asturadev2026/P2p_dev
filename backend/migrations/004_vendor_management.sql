-- 004_vendor_management.sql
-- Vendor Management module: lifecycle state machine, compliance decision trail,
-- server-side verification results, onboarding tracker, KYC persistence, foreign/DTAA.
-- Additive + idempotent — safe to run once against an already-seeded database.

-- ---------- Vendors: lifecycle + compliance decision + verification summary ----------
-- status now spans the documented machine:
--   draft | pending_compliance | active | rejected | suspended
--   (legacy values active|onboarding|blocked|inactive remain valid for existing rows)
ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS onboarding_id        TEXT,
    ADD COLUMN IF NOT EXISTS products             TEXT,           -- free text for now; TODO: normalise to product/category link if the business requires it
    ADD COLUMN IF NOT EXISTS approved_by          TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by          TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_reason      TEXT,
    ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_by         TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS suspended_reason     TEXT,
    ADD COLUMN IF NOT EXISTS suspended_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bank_override_reason TEXT,           -- admin override when penny-drop failed
    ADD COLUMN IF NOT EXISTS bank_override_by     TEXT REFERENCES users(id),
    -- foreign / DTAA
    ADD COLUMN IF NOT EXISTS dtaa_valid_till      DATE,
    -- per-check verification status: verified | pending | mismatch | failed
    ADD COLUMN IF NOT EXISTS gst_status           TEXT,
    ADD COLUMN IF NOT EXISTS pan_status           TEXT,
    ADD COLUMN IF NOT EXISTS msme_status          TEXT,
    ADD COLUMN IF NOT EXISTS bank_status          TEXT,
    ADD COLUMN IF NOT EXISTS dtaa_status          TEXT;

-- ---------- Onboarding tracker + KYC persistence + decision trail ----------
-- tracker status: sent | opened | in_progress | submitted | approved | rejected
--   (legacy link_sent | kyc_in_progress | submitted_for_review | in_progress | approved remain valid)
ALTER TABLE vendor_onboarding
    ADD COLUMN IF NOT EXISTS category_id     TEXT,
    ADD COLUMN IF NOT EXISTS sub_category_id TEXT,
    ADD COLUMN IF NOT EXISTS opened_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by     TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by     TEXT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
    ADD COLUMN IF NOT EXISTS rejected_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS vendor_id       TEXT,   -- vendors.id created at submission
    -- full wizard payload: addresses, contacts, sub-vendors, agreement, foreign block
    ADD COLUMN IF NOT EXISTS kyc_payload     JSONB NOT NULL DEFAULT '{}';

-- ---------- Server-side verification results (GST / PAN / MSME / Bank / DTAA) ----------
CREATE TABLE IF NOT EXISTS vendor_verifications (
    id           SERIAL PRIMARY KEY,
    onb_id       TEXT,                                   -- vendor_onboarding.id
    vendor_id    TEXT,                                   -- vendors.id (post-submission)
    kind         TEXT NOT NULL,                          -- gst | pan | msme | bank | dtaa
    status       TEXT NOT NULL,                          -- verified | pending | mismatch | failed
    reference_id TEXT,                                   -- id returned by the integration adapter
    detail       JSONB NOT NULL DEFAULT '{}',
    checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_verif_onb    ON vendor_verifications(onb_id);
CREATE INDEX IF NOT EXISTS idx_vendor_verif_vendor ON vendor_verifications(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status      ON vendors(status);

-- ---------- DTAA integration adapter (sync_log has a FK to integrations) ----------
INSERT INTO integrations (id, name, mode, api_key_ref)
SELECT 'dtaa', 'DTAA / Tax Treaty Validation', 'simulated', 'INTELEZEN_DTAA_API_KEY'
WHERE NOT EXISTS (SELECT 1 FROM integrations WHERE id = 'dtaa');

-- ---------- Compliance Reviewer role user (password = same as the demo users) ----------
INSERT INTO users (id, username, full_name, password_hash, role, department_id, branch_id, email, active)
SELECT 'U010', 'amardeep', 'Amardeep Singh',
       (SELECT password_hash FROM users WHERE username = 'pradip'),
       'compliance', NULL, NULL, 'amardeep@intelezen.example', TRUE
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'amardeep');
