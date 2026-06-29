-- ============================================================
-- AstonomiQ Procure-to-Pay · Intelezen Microfin Limited
-- 001_initial_schema.sql · database: intelezen_ap_discounting
-- ============================================================

-- ---------- Masters ----------

CREATE TABLE branches (
    id          TEXT PRIMARY KEY,              -- BR-JAL-001
    name        TEXT NOT NULL,
    state       TEXT NOT NULL,
    city        TEXT,
    is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE departments (
    id          TEXT PRIMARY KEY,              -- IT, ADMIN, OPS, MKT, STAT, HR, TRY
    name        TEXT NOT NULL,
    description TEXT
);

CREATE TABLE spend_categories (
    id            TEXT PRIMARY KEY,            -- IT-HW, ADMIN-FAC ...
    department_id TEXT NOT NULL REFERENCES departments(id),
    name          TEXT NOT NULL,
    default_tds_section TEXT,                  -- 194C / 194J / 194I / 194Q / NULL
    default_gl_code     TEXT,
    required_documents  JSONB NOT NULL DEFAULT '[]',
    statutory     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE gl_master (
    gl_code     TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    gl_type     TEXT NOT NULL,                 -- expense | liability | asset
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
    id            TEXT PRIMARY KEY,            -- U001
    username      TEXT UNIQUE NOT NULL,
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL,               -- requester | maker | checker | fc | cfo | procurement | finance | treasury | admin | auditor
    department_id TEXT REFERENCES departments(id),
    branch_id     TEXT REFERENCES branches(id),
    email         TEXT,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Configuration & rules engine ----------

CREATE TABLE configuration (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval_rules (
    id            SERIAL PRIMARY KEY,
    rule_name     TEXT NOT NULL,
    entity_type   TEXT NOT NULL,               -- requisition | invoice | po | payment | vendor
    department_id TEXT REFERENCES departments(id),     -- NULL = any
    category_id   TEXT REFERENCES spend_categories(id),-- NULL = any
    min_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    max_amount    NUMERIC(14,2),               -- NULL = no upper bound
    msme_priority BOOLEAN NOT NULL DEFAULT FALSE,
    stages        JSONB NOT NULL,              -- ["auto"] | ["maker","checker"] | ["maker","checker","fc"] | ...
    sla_hours     INTEGER,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE integrations (
    id          TEXT PRIMARY KEY,              -- gst_validation | pan_verify | udyam | penny_drop | esign_dsc | bank_payment_file | erp | irp | gstn_2b | treds
    name        TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'simulated',  -- simulated | live
    base_url    TEXT,
    api_key_ref TEXT,                          -- env var name holding the key (never the key itself)
    config      JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Vendors ----------

CREATE TABLE vendors (
    id            TEXT PRIMARY KEY,            -- V0512
    name          TEXT NOT NULL,
    vendor_type   TEXT NOT NULL DEFAULT 'domestic',   -- domestic | foreign
    gstin         TEXT,
    pan           TEXT,
    state         TEXT,
    country       TEXT NOT NULL DEFAULT 'India',
    is_msme       BOOLEAN NOT NULL DEFAULT FALSE,
    udyam_no      TEXT,
    msme_category TEXT,                        -- micro | small | medium
    tds_section   TEXT,
    tier          TEXT,                        -- strategic | preferred | transactional
    rating        NUMERIC(2,1),
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    bank_name     TEXT,
    bank_account  TEXT,
    bank_ifsc     TEXT,
    bank_verified BOOLEAN NOT NULL DEFAULT FALSE,
    gstin_verified BOOLEAN NOT NULL DEFAULT FALSE,
    pan_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    expense_gl    TEXT REFERENCES gl_master(gl_code),
    department_id TEXT REFERENCES departments(id),
    category_id   TEXT REFERENCES spend_categories(id),
    erp_vendor_id TEXT,
    status        TEXT NOT NULL DEFAULT 'active',     -- active | onboarding | blocked | inactive
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendor_onboarding (
    id           TEXT PRIMARY KEY,             -- ONB-2026-014
    entity_name  TEXT NOT NULL,
    business_type TEXT,
    vendor_type  TEXT NOT NULL DEFAULT 'domestic',
    pan          TEXT,
    gstin        TEXT,
    contact_name TEXT, contact_designation TEXT, contact_email TEXT, contact_phone TEXT,
    address      TEXT, state TEXT, pin_code TEXT,
    stage        INTEGER NOT NULL DEFAULT 1,   -- 1 initiate · 2 pan/gst verify · 3 udyam · 4 penny drop · 5 risk · 6 erp push
    pan_verified BOOLEAN, gstin_verified BOOLEAN, gst_filing_status TEXT,
    is_msme      BOOLEAN, udyam_no TEXT, msme_category TEXT,
    account_no   TEXT, ifsc TEXT, account_name TEXT,
    penny_drop_status TEXT, npci_name_match NUMERIC(5,2),
    risk_score   INTEGER, risk_tier TEXT, mca_status TEXT, itr_status TEXT,
    erp_status   TEXT, erp_vendor_id TEXT,
    foreign_docs JSONB NOT NULL DEFAULT '{}',  -- W-8/W-9, tax residency cert, SWIFT etc.
    risk_flag    TEXT NOT NULL DEFAULT 'normal',  -- normal | high
    status       TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | approved | rejected
    notes        TEXT,
    initiated_by TEXT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Procurement: PR → RFQ → PO → GRN ----------

CREATE TABLE requisitions (
    id            TEXT PRIMARY KEY,            -- PR/2026/06/0001
    title         TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id),
    category_id   TEXT NOT NULL REFERENCES spend_categories(id),
    branch_id     TEXT NOT NULL REFERENCES branches(id),
    cost_center   TEXT,
    requester_id  TEXT NOT NULL REFERENCES users(id),
    justification TEXT,
    statutory_flags JSONB NOT NULL DEFAULT '{}',   -- {msme_pref, capex, agreement_based, rcm_applicable}
    total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',   -- draft | pending_approval | approved | rejected | converted_rfq | converted_po | closed
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE requisition_lines (
    id             SERIAL PRIMARY KEY,
    requisition_id TEXT NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    description    TEXT NOT NULL,
    quantity       NUMERIC(12,2) NOT NULL DEFAULT 1,
    uom            TEXT NOT NULL DEFAULT 'NOS',
    est_unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    gl_code        TEXT REFERENCES gl_master(gl_code)
);

CREATE TABLE rfqs (
    id             TEXT PRIMARY KEY,           -- RFQ/2026/06/0001
    requisition_id TEXT REFERENCES requisitions(id),
    title          TEXT NOT NULL,
    due_date       DATE,
    status         TEXT NOT NULL DEFAULT 'open',  -- open | quoted | awarded | cancelled
    awarded_vendor_id TEXT REFERENCES vendors(id),
    award_override_reason TEXT,                -- set when award is not lowest quote (controlled override)
    created_by     TEXT REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quotations (
    id          SERIAL PRIMARY KEY,
    rfq_id      TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    vendor_id   TEXT NOT NULL REFERENCES vendors(id),
    amount      NUMERIC(14,2) NOT NULL,
    delivery_days INTEGER,
    validity_days INTEGER,
    payment_terms TEXT,
    notes       TEXT,
    score       NUMERIC(5,2),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rfq_id, vendor_id)
);

CREATE TABLE purchase_orders (
    id             TEXT PRIMARY KEY,           -- PO/2026/05/00045
    requisition_id TEXT REFERENCES requisitions(id),
    rfq_id         TEXT REFERENCES rfqs(id),
    vendor_id      TEXT NOT NULL REFERENCES vendors(id),
    department_id  TEXT REFERENCES departments(id),
    category_id    TEXT REFERENCES spend_categories(id),
    branch_id      TEXT REFERENCES branches(id),
    amount         NUMERIC(14,2) NOT NULL,
    gst_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    agreement_based BOOLEAN NOT NULL DEFAULT FALSE,
    esign_status   TEXT,                       -- pending | signed | not_required
    esign_ref      TEXT,
    status         TEXT NOT NULL DEFAULT 'open',  -- draft | pending_approval | open | partially_received | received | closed | cancelled
    erp_ref        TEXT,
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     TEXT REFERENCES users(id)
);

CREATE TABLE po_lines (
    id          SERIAL PRIMARY KEY,
    po_id       TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity    NUMERIC(12,2) NOT NULL,
    uom         TEXT NOT NULL DEFAULT 'NOS',
    unit_price  NUMERIC(14,2) NOT NULL,
    gst_rate    NUMERIC(5,2) NOT NULL DEFAULT 18.0
);

CREATE TABLE grns (
    id          TEXT PRIMARY KEY,              -- GRN/2026/05/0098
    po_id       TEXT NOT NULL REFERENCES purchase_orders(id),
    branch_id   TEXT REFERENCES branches(id),
    received_by TEXT REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    evidence    JSONB NOT NULL DEFAULT '[]',   -- [{filename, note}]
    status      TEXT NOT NULL DEFAULT 'recorded',  -- recorded | reconciled | disputed
    notes       TEXT
);

CREATE TABLE grn_lines (
    id           SERIAL PRIMARY KEY,
    grn_id       TEXT NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
    po_line_id   INTEGER REFERENCES po_lines(id),
    qty_received NUMERIC(12,2) NOT NULL,
    qty_accepted NUMERIC(12,2) NOT NULL,
    variance_note TEXT
);

-- ---------- Invoices ----------

CREATE TABLE invoices (
    id             TEXT PRIMARY KEY,           -- INV-2026-05-0412 (internal ref)
    vendor_invoice_no TEXT NOT NULL,
    vendor_id      TEXT NOT NULL REFERENCES vendors(id),
    po_id          TEXT REFERENCES purchase_orders(id),
    grn_id         TEXT REFERENCES grns(id),
    department_id  TEXT REFERENCES departments(id),
    category_id    TEXT REFERENCES spend_categories(id),
    branch_id      TEXT REFERENCES branches(id),
    invoice_date   DATE NOT NULL,
    due_date       DATE,
    source         TEXT NOT NULL DEFAULT 'email',   -- email | whatsapp | scan | vendor_portal | manual
    taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
    sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
    igst NUMERIC(14,2) NOT NULL DEFAULT 0,
    rcm_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    rcm_liability  NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    tds_section    TEXT,
    tds_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
    tds_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_payable    NUMERIC(14,2) NOT NULL DEFAULT 0,
    irn            TEXT,
    irn_status     TEXT,                       -- validated | not_applicable | failed | pending
    ocr_confidence NUMERIC(5,2),
    ocr_extract    JSONB,
    duplicate_of   TEXT REFERENCES invoices(id),
    stage          TEXT NOT NULL DEFAULT 'capture',  -- capture | match | gst2b | tds | approval | liability | payments | paid | rejected | on_hold
    match_status   TEXT,                       -- auto_matched | exception | manual_matched | pending
    match_detail   JSONB,
    gst2b_status   TEXT,                       -- matched | mismatch_tax | not_in_2b | pending
    msme_due_date  DATE,                       -- invoice_date + 45d when vendor is MSME
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_id, vendor_invoice_no)      -- duplicate prevention at source
);

CREATE TABLE invoice_lines (
    id          SERIAL PRIMARY KEY,
    invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity    NUMERIC(12,2) NOT NULL DEFAULT 1,
    uom         TEXT NOT NULL DEFAULT 'NOS',
    unit_price  NUMERIC(14,2) NOT NULL,
    gst_rate    NUMERIC(5,2) NOT NULL DEFAULT 18.0
);

CREATE TABLE invoice_stage_history (
    id         SERIAL PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage   TEXT NOT NULL,
    actor_id   TEXT REFERENCES users(id),
    note       TEXT,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gst_2b_records (
    id          SERIAL PRIMARY KEY,
    period      TEXT NOT NULL,                 -- 2026-05
    invoice_id  TEXT REFERENCES invoices(id),
    vendor_gstin TEXT,
    taxable     NUMERIC(14,2),
    gst_in_2b   NUMERIC(14,2),
    status      TEXT NOT NULL,                 -- matched | mismatch_tax | not_in_2b
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Approvals ----------

CREATE TABLE approvals (
    id           SERIAL PRIMARY KEY,
    entity_type  TEXT NOT NULL,                -- requisition | invoice | po | payment_batch | vendor_onboarding | advance
    entity_id    TEXT NOT NULL,
    rule_id      INTEGER REFERENCES approval_rules(id),
    stage_no     INTEGER NOT NULL,
    stage_role   TEXT NOT NULL,                -- auto | maker | checker | fc | cfo
    assigned_to  TEXT REFERENCES users(id),
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | skipped | auto_approved
    acted_by     TEXT REFERENCES users(id),
    acted_at     TIMESTAMPTZ,
    comments     TEXT,
    sla_due_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX idx_approvals_pending ON approvals(status, stage_role) WHERE status = 'pending';

-- ---------- Liability / JV / Payments ----------

CREATE TABLE journal_vouchers (
    id          TEXT PRIMARY KEY,              -- JV/2026/05/04412
    invoice_id  TEXT NOT NULL REFERENCES invoices(id),
    dr_gl       TEXT NOT NULL REFERENCES gl_master(gl_code),
    cr_gl       TEXT NOT NULL REFERENCES gl_master(gl_code),
    amount      NUMERIC(14,2) NOT NULL,
    status      TEXT NOT NULL DEFAULT 'ready', -- ready | pushed | failed
    erp_doc_no  TEXT,
    pushed_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_batches (
    id          TEXT PRIMARY KEY,              -- BATCH/2026/06/01A
    status      TEXT NOT NULL DEFAULT 'building',  -- building | pending_approval | approved | file_generated | released | reconciled
    channel     TEXT NOT NULL DEFAULT 'NEFT',  -- NEFT | RTGS | UPI
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    file_name   TEXT,
    created_by  TEXT REFERENCES users(id),
    released_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_items (
    id          SERIAL PRIMARY KEY,
    batch_id    TEXT NOT NULL REFERENCES payment_batches(id) ON DELETE CASCADE,
    invoice_id  TEXT NOT NULL REFERENCES invoices(id),
    vendor_id   TEXT NOT NULL REFERENCES vendors(id),
    net_amount  NUMERIC(14,2) NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'NEFT',
    msme_priority BOOLEAN NOT NULL DEFAULT FALSE,
    utr         TEXT,
    utr_captured_at TIMESTAMPTZ,
    remittance_sent BOOLEAN NOT NULL DEFAULT FALSE,
    status      TEXT NOT NULL DEFAULT 'queued' -- queued | paid | failed | returned
);

-- ---------- Advances & Imprest ----------

CREATE TABLE advances (
    id           TEXT PRIMARY KEY,             -- ADV/2026/06/0007
    advance_type TEXT NOT NULL DEFAULT 'vendor_advance',  -- vendor_advance | imprest
    vendor_id    TEXT REFERENCES vendors(id),
    holder_id    TEXT REFERENCES users(id),    -- imprest holder
    po_id        TEXT REFERENCES purchase_orders(id),
    department_id TEXT REFERENCES departments(id),
    branch_id    TEXT REFERENCES branches(id),
    amount       NUMERIC(14,2) NOT NULL,
    balance      NUMERIC(14,2) NOT NULL,
    purpose      TEXT,
    status       TEXT NOT NULL DEFAULT 'open', -- pending_approval | open | partially_settled | settled | written_off
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE advance_settlements (
    id          SERIAL PRIMARY KEY,
    advance_id  TEXT NOT NULL REFERENCES advances(id),
    invoice_id  TEXT REFERENCES invoices(id),
    amount      NUMERIC(14,2) NOT NULL,
    note        TEXT,
    settled_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Invoice Discounting ----------

CREATE TABLE discount_pools (
    id          TEXT PRIMARY KEY,              -- treasury | cc | treds
    name        TEXT NOT NULL,
    pool_type   TEXT NOT NULL,                 -- treasury | bank_cc | treds
    capacity    NUMERIC(16,2),
    deployed    NUMERIC(16,2) NOT NULL DEFAULT 0,
    cost_of_funds_pct NUMERIC(6,3),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    config      JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE cc_facilities (
    id          TEXT PRIMARY KEY,              -- CC-HDFC-001
    bank        TEXT NOT NULL,
    account_ref TEXT,
    sanction    NUMERIC(16,2) NOT NULL,
    drawn       NUMERIC(16,2) NOT NULL DEFAULT 0,
    rate_basis  TEXT,                          -- 'MCLR + 1.50%'
    rate_pct    NUMERIC(6,3) NOT NULL
);

CREATE TABLE discount_deals (
    id            TEXT PRIMARY KEY,            -- DD-2026-0142
    invoice_id    TEXT NOT NULL REFERENCES invoices(id),
    vendor_id     TEXT NOT NULL REFERENCES vendors(id),
    pool_id       TEXT NOT NULL REFERENCES discount_pools(id),
    cc_facility_id TEXT REFERENCES cc_facilities(id),
    advance_amount NUMERIC(14,2) NOT NULL,
    days_saved    INTEGER NOT NULL,
    vendor_rate_pct NUMERIC(6,3) NOT NULL,
    cof_pct       NUMERIC(6,3) NOT NULL DEFAULT 0,
    spread_pct    NUMERIC(6,3) NOT NULL DEFAULT 0,
    ebitda_gain   NUMERIC(14,2) NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active',  -- offered | active | settled | cancelled
    offered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at    TIMESTAMPTZ
);

CREATE TABLE early_pay_requests (
    id           TEXT PRIMARY KEY,             -- EPR-2026-0021
    vendor_id    TEXT NOT NULL REFERENCES vendors(id),
    invoice_id   TEXT NOT NULL REFERENCES invoices(id),
    amount       NUMERIC(14,2) NOT NULL,
    days_available INTEGER NOT NULL,
    requested_rate_pct NUMERIC(6,3) NOT NULL,
    suggested_pool_id  TEXT REFERENCES discount_pools(id),
    expected_gain NUMERIC(14,2),
    ai_rationale  TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | expired
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actioned_by  TEXT REFERENCES users(id),
    actioned_at  TIMESTAMPTZ
);

CREATE TABLE treds_platforms (
    id        TEXT PRIMARY KEY,                -- rxil | m1x | invoicemart
    name      TEXT NOT NULL,
    operator  TEXT,
    onboarded BOOLEAN NOT NULL DEFAULT TRUE,
    stats     JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE factoring_units (
    id          TEXT PRIMARY KEY,              -- FU-RXIL-9442
    platform_id TEXT NOT NULL REFERENCES treds_platforms(id),
    invoice_id  TEXT NOT NULL REFERENCES invoices(id),
    vendor_id   TEXT NOT NULL REFERENCES vendors(id),
    amount      NUMERIC(14,2) NOT NULL,
    status      TEXT NOT NULL DEFAULT 'listed',   -- listed | bidding | won | settled | expired
    best_bid_pct NUMERIC(6,3),
    best_bidder TEXT,
    listed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE factoring_bids (
    id          SERIAL PRIMARY KEY,
    fu_id       TEXT NOT NULL REFERENCES factoring_units(id) ON DELETE CASCADE,
    financier   TEXT NOT NULL,
    rate_pct    NUMERIC(6,3) NOT NULL,
    bid_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Platform: notifications, sync, AI, audit ----------

CREATE TABLE notifications (
    id         SERIAL PRIMARY KEY,
    user_id    TEXT REFERENCES users(id),
    channel    TEXT NOT NULL DEFAULT 'in_app', -- in_app | email
    title      TEXT NOT NULL,
    body       TEXT,
    entity_type TEXT, entity_id TEXT,
    kind       TEXT NOT NULL DEFAULT 'info',   -- info | approval_pending | sla_breach | escalation | reminder
    read       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_log (
    id          SERIAL PRIMARY KEY,
    integration_id TEXT NOT NULL REFERENCES integrations(id),
    direction   TEXT NOT NULL,                 -- push | pull
    object_type TEXT NOT NULL,
    reference   TEXT,
    request     JSONB,
    response    JSONB,
    result      TEXT NOT NULL,                 -- success | failed | retried
    simulated   BOOLEAN NOT NULL DEFAULT TRUE,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_invocations (
    id          SERIAL PRIMARY KEY,
    agent       TEXT NOT NULL,                 -- invoice_ocr | pool_recommender | match_analyst | duplicate_detector
    entity_type TEXT, entity_id TEXT,
    model       TEXT NOT NULL,
    input       JSONB,
    output      JSONB,
    confidence  NUMERIC(5,2),
    accepted    BOOLEAN,                       -- human-in-the-loop outcome
    acted_by    TEXT REFERENCES users(id),
    latency_ms  INTEGER,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     TEXT,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    before_state JSONB,
    after_state  JSONB,
    detail       TEXT,
    ip           TEXT,
    prev_hash    TEXT,
    row_hash     TEXT NOT NULL,                -- sha256(prev_hash || payload) → tamper-evident chain
    at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ---------- Helpful indexes ----------
CREATE INDEX idx_invoices_stage  ON invoices(stage);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoices_msme_due ON invoices(msme_due_date) WHERE msme_due_date IS NOT NULL;
CREATE INDEX idx_req_status ON requisitions(status);
CREATE INDEX idx_po_status  ON purchase_orders(status);
CREATE INDEX idx_deals_pool ON discount_deals(pool_id, status);
