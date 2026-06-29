-- ============================================================
-- AstonomiQ P2P · Intelezen Microfin · 002_seed_data.sql
-- Demo dataset ported from the approved dashboard mockup
-- All users share password: intelezen123
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------- Branches ----------
INSERT INTO branches (id, name, state, city, is_head_office) VALUES
 ('BR-HO',      'Head Office · AXIS, BMC Chowk, GT Road', 'Punjab', 'Jalandhar', TRUE),
 ('BR-LDH-001', 'Ludhiana Branch',  'Punjab',        'Ludhiana',  FALSE),
 ('BR-AMR-002', 'Amritsar Branch',  'Punjab',        'Amritsar',  FALSE),
 ('BR-DEL-003', 'Delhi NCR Branch', 'Delhi',         'New Delhi', FALSE),
 ('BR-JPR-004', 'Jaipur Branch',    'Rajasthan',     'Jaipur',    FALSE),
 ('BR-LKO-005', 'Lucknow Branch',   'Uttar Pradesh', 'Lucknow',   FALSE);

-- ---------- Departments ----------
INSERT INTO departments (id, name, description) VALUES
 ('IT',    'Information Technology',      'Hardware, software, licenses, telecom, managed services'),
 ('ADMIN', 'Administration',              'Branch infrastructure, facilities, utilities, office support'),
 ('OPS',   'Operations',                  'Field operations, branch supplies, operational consumables'),
 ('MKT',   'Marketing',                   'Brand, customer outreach, print, digital campaigns'),
 ('STAT',  'Statutory Engagements',       'Audit, legal, regulatory, advisory partners'),
 ('HR',    'Human Resources',             'Hiring, training, employee programs'),
 ('TRY',   'Treasury & Finance Support',  'Banking partners, rating agencies, consultants');

-- ---------- GL master ----------
INSERT INTO gl_master (gl_code, description, gl_type) VALUES
 ('5101001','Telecom Expense','expense'),
 ('5102001','Power & Fuel','expense'),
 ('5201001','Professional Fees','expense'),
 ('5201002','Audit Fees','expense'),
 ('5301001','Rent Expense','expense'),
 ('5302001','Office Maintenance','expense'),
 ('5401001','Security & Housekeeping','expense'),
 ('5501001','IT Hardware - CapEx','asset'),
 ('5501002','Software Licenses','expense'),
 ('5601001','Insurance Premium','expense'),
 ('5701001','Marketing & Outreach','expense'),
 ('2401001','Sundry Creditors - Trade','liability'),
 ('2402001','TDS Payable - 194C','liability'),
 ('2402002','TDS Payable - 194J','liability'),
 ('2402003','TDS Payable - 194I','liability'),
 ('2403001','Input GST - IGST','asset'),
 ('2403002','Input GST - CGST','asset'),
 ('2403003','Input GST - SGST','asset');

-- ---------- Spend categories ----------
INSERT INTO spend_categories (id, department_id, name, default_tds_section, default_gl_code, statutory, required_documents) VALUES
 ('IT-HW',   'IT',    'IT Hardware & Branch Setup', '194C', '5501001', FALSE, '["quotation","po","grn","invoice"]'),
 ('IT-SW',   'IT',    'Software Licenses',          '194J', '5501002', FALSE, '["license_agreement","invoice"]'),
 ('IT-TEL',  'IT',    'Telecom & Connectivity',     '194J', '5101001', FALSE, '["agreement","invoice"]'),
 ('IT-TWR',  'IT',    'Telecom Tower Rentals',      '194I', '5301001', FALSE, '["lease_agreement","invoice"]'),
 ('OPS-BPO', 'OPS',   'BPO & Outsourcing',          '194J', '5201001', FALSE, '["msa","sow","invoice"]'),
 ('OPS-STN', 'OPS',   'Stationery & Forms',         '194C', '5302001', FALSE, '["po","grn","invoice"]'),
 ('OPS-GEN', 'OPS',   'Branch Genset & AMC',        '194C', '5302001', FALSE, '["amc_contract","service_report","invoice"]'),
 ('ADM-FAC', 'ADMIN', 'Office Lease & Coworking',   '194I', '5301001', FALSE, '["lease_agreement","invoice"]'),
 ('ADM-UTL', 'ADMIN', 'Utilities & Power',          NULL,   '5102001', FALSE, '["bill"]'),
 ('ADM-REN', 'ADMIN', 'Branch Renovation',          '194C', '5302001', FALSE, '["po","grn","completion_cert","invoice"]'),
 ('ADM-SEC', 'ADMIN', 'Security & Housekeeping',    '194C', '5401001', FALSE, '["contract","attendance","invoice"]'),
 ('MKT-PRN', 'MKT',   'Print & Campaigns',          '194C', '5701001', FALSE, '["artwork_approval","po","invoice"]'),
 ('STAT-AUD','STAT',  'Audit & Advisory',           '194J', '5201002', TRUE,  '["engagement_letter","invoice"]'),
 ('HR-INS',  'HR',    'Insurance Premiums',         '194D', '5601001', FALSE, '["policy","invoice"]'),
 ('TRY-CON', 'TRY',   'Rating Agencies & Consultants','194J','5201001', TRUE, '["engagement_letter","invoice"]');

-- ---------- Users (password: intelezen123) ----------
INSERT INTO users (id, username, full_name, password_hash, role, department_id, branch_id, email) VALUES
 ('U001','pradip',  'Pradip Sharma', encode(digest('intelezen123','sha256'),'hex'), 'checker',     'TRY',  'BR-HO',      'pradip.sharma@intelezenmicrofin.com'),
 ('U002','nidhi',   'Nidhi Kaur',    encode(digest('intelezen123','sha256'),'hex'), 'maker',       'TRY',  'BR-HO',      'nidhi.kaur@intelezenmicrofin.com'),
 ('U003','vikram',  'Vikram Joshi',  encode(digest('intelezen123','sha256'),'hex'), 'procurement', 'ADMIN','BR-HO',      'vikram.joshi@intelezenmicrofin.com'),
 ('U004','anish',   'Anish Rao',     encode(digest('intelezen123','sha256'),'hex'), 'cfo',         'TRY',  'BR-HO',      'anish.rao@intelezenmicrofin.com'),
 ('U005','meera',   'Meera Bansal',  encode(digest('intelezen123','sha256'),'hex'), 'fc',          'TRY',  'BR-HO',      'meera.bansal@intelezenmicrofin.com'),
 ('U006','rahul',   'Rahul Verma',   encode(digest('intelezen123','sha256'),'hex'), 'requester',   'IT',   'BR-LDH-001', 'rahul.verma@intelezenmicrofin.com'),
 ('U007','tanvi',   'Tanvi Desai',   encode(digest('intelezen123','sha256'),'hex'), 'treasury',    'TRY',  'BR-HO',      'tanvi.desai@intelezenmicrofin.com'),
 ('U008','admin',   'Suresh Iyer',   encode(digest('intelezen123','sha256'),'hex'), 'admin',       'IT',   'BR-HO',      'suresh.iyer@intelezenmicrofin.com'),
 ('U009','kavita',  'Kavita Menon',  encode(digest('intelezen123','sha256'),'hex'), 'auditor',     'STAT', 'BR-HO',      'kavita.menon@intelezenmicrofin.com');

-- ---------- Configuration (rules-as-config) ----------
INSERT INTO configuration (key, value, description) VALUES
 ('match_tolerance',            '{"price_pct": 2.0, "qty_pct": 0.0, "gst": "exact"}', '3-way match tolerance bands'),
 ('auto_approve_match_pct',     '95',     'Auto-approve invoices at or above this match score'),
 ('auto_approve_amount',        '50000',  'Invoices at or below this amount auto-approve'),
 ('msme_sla_days',              '45',     'MSME payment SLA per Section 43B(h)'),
 ('tds_rates',                  '{"194C": 2.0, "194J": 10.0, "194I": 10.0, "194D": 5.0, "194Q": 0.1}', 'TDS rates by section'),
 ('gst2b_sync_interval_hours',  '4',      'GSTR-2B sync cadence'),
 ('ocr_qc_confidence_pct',      '85',     'OCR confidence below which manual QC is required'),
 ('discount_min_gain',          '100',    'Reject early-pay requests with expected gain below this (₹)'),
 ('treasury_cof_pct',           '6.5',    'Treasury pool cost of funds (FD opportunity cost)'),
 ('payment_file_format',        '{"type": "csv", "columns": ["beneficiary_name","account_no","ifsc","amount","mode","narration"]}', 'Bank bulk payout file spec');

-- ---------- Approval matrix ----------
INSERT INTO approval_rules (rule_name, entity_type, min_amount, max_amount, msme_priority, stages, sla_hours) VALUES
 ('Auto-approve routine OpEx',  'invoice',      0,        50000,   FALSE, '["auto"]',                          0),
 ('Maker-Checker band',         'invoice',      50000.01, 200000,  FALSE, '["maker","checker"]',               24),
 ('FC sign-off band',           'invoice',      200000.01,1000000, FALSE, '["maker","checker","fc"]',          48),
 ('CFO band',                   'invoice',      1000000.01,NULL,   FALSE, '["maker","checker","fc","cfo"]',    72),
 ('MSME fast-track',            'invoice',      0,        NULL,    TRUE,  '["maker","fc"]',                    12),
 ('Requisition auto band',      'requisition',  0,        50000,   FALSE, '["auto"]',                          0),
 ('Requisition standard',       'requisition',  50000.01, 1000000, FALSE, '["maker","checker"]',               24),
 ('Requisition CFO band',       'requisition',  1000000.01,NULL,   FALSE, '["maker","checker","cfo"]',         72),
 ('Advance approval',           'advance',      0,        NULL,    FALSE, '["checker","fc"]',                  24),
 ('Payment batch release',      'payment_batch',0,        NULL,    FALSE, '["checker","fc"]',                  12);

-- ---------- Integrations (all simulated until Intelezen provides APIs) ----------
INSERT INTO integrations (id, name, mode, base_url, api_key_ref) VALUES
 ('gst_validation',   'GST / GSTIN Validation',        'simulated', NULL, 'INTELEZEN_GST_API_KEY'),
 ('gstn_2b',          'GSTR-2B Reconciliation Feed',   'simulated', NULL, 'INTELEZEN_GSTN_API_KEY'),
 ('irp',              'IRP e-Invoice IRN Validation',  'simulated', NULL, 'INTELEZEN_IRP_API_KEY'),
 ('pan_verify',       'PAN Verification (NSDL)',       'simulated', NULL, 'INTELEZEN_PAN_API_KEY'),
 ('udyam',            'MSME Udyam Classification',     'simulated', NULL, 'INTELEZEN_UDYAM_API_KEY'),
 ('penny_drop',       'Bank Penny-Drop Validation',    'simulated', NULL, 'INTELEZEN_PENNYDROP_API_KEY'),
 ('esign_dsc',        'e-Sign / Class-3 DSC',          'simulated', NULL, 'INTELEZEN_ESIGN_API_KEY'),
 ('bank_payment_file','Bank Bulk Payout File + UTR',   'simulated', NULL, 'INTELEZEN_BANK_API_KEY'),
 ('erp',              'Intelezen Accounting / ERP API',  'simulated', NULL, 'INTELEZEN_ERP_API_KEY'),
 ('treds',            'TReDS Platforms',               'simulated', NULL, 'INTELEZEN_TREDS_API_KEY');

-- ---------- Vendors ----------
INSERT INTO vendors (id, name, gstin, pan, state, is_msme, udyam_no, tier, rating, payment_terms_days,
                     bank_name, bank_account, bank_ifsc, bank_verified, gstin_verified, pan_verified,
                     tds_section, expense_gl, department_id, category_id, erp_vendor_id, status) VALUES
 ('V0142','Sharma Enterprises Pvt Ltd',        '09AABCS5610Q1ZP','AABCS5610Q','Uttar Pradesh', TRUE, 'UDYAM-UP-04-0089421','Gold',    4.8,45,'HDFC Bank','50100xxxxx7821','HDFC0001245',TRUE,TRUE,TRUE,'194C','5501001','IT','IT-HW','ERP-V0142','active'),
 ('V0089','Reliance Jio Infocomm Limited',     '27AAACR5055K1ZF','AAACR5055K','Maharashtra',  FALSE,NULL,'Platinum',4.9,30,'ICICI Bank','00440xxxxx9912','ICIC0000044',TRUE,TRUE,TRUE,'194J','5101001','IT','IT-TEL','ERP-V0089','active'),
 ('V0203','Bharti Airtel Limited',             '07AAACB2894G1ZK','AAACB2894G','Delhi',        FALSE,NULL,'Platinum',4.7,30,'Axis Bank','00910xxxxx4521','UTIB0000091',TRUE,TRUE,TRUE,'194J','5101001','IT','IT-TEL','ERP-V0203','active'),
 ('V0421','NDPC Power Distribution',           '05AAACN6694F1Z9','AAACN6694F','Uttarakhand',  FALSE,NULL,'Gold',    4.5,15,'SBI','30445xxxxx1029','SBIN0008412',TRUE,TRUE,TRUE,NULL,  '5102001','ADMIN','ADM-UTL','ERP-V0421','active'),
 ('V0512','TCS Business Process Services',     '33AABCT3518Q1ZW','AABCT3518Q','Tamil Nadu',   FALSE,NULL,'Platinum',4.6,60,'HDFC Bank','50200xxxxx3398','HDFC0000099',TRUE,TRUE,TRUE,'194J','5201001','OPS','OPS-BPO','ERP-V0512','active'),
 ('V0671','WeWork India Mgmt Pvt Ltd',         '29AAGCW1242N1Z2','AAGCW1242N','Karnataka',    FALSE,NULL,'Silver',  4.3,30,'Kotak Mahindra','69001xxxxx0044','KKBK0000694',TRUE,TRUE,TRUE,'194I','5301001','ADMIN','ADM-FAC','ERP-V0671','active'),
 ('V0394','Crowe Mak Ghosh & Co LLP',          '27AAACM4218R1ZK','AAACM4218R','Maharashtra',   TRUE,'UDYAM-MH-19-0001245','Gold',4.9,30,'HDFC Bank','50300xxxxx2278','HDFC0000003',TRUE,TRUE,TRUE,'194J','5201002','STAT','STAT-AUD','ERP-V0394','active'),
 ('V0258','Kotak Mahindra General Insurance',  '27AAACK4408F1ZS','AAACK4408F','Maharashtra',  FALSE,NULL,'Gold',    4.7,30,'Kotak Mahindra','30801xxxxx9921','KKBK0000308',TRUE,TRUE,TRUE,'194D','5601001','HR','HR-INS','ERP-V0258','active'),
 ('V0784','Quick Heal Technologies Ltd',       '27AABCQ4008J1Z4','AABCQ4008J','Maharashtra',  FALSE,NULL,'Silver',  4.5,45,'Axis Bank','90240xxxxx1180','UTIB0000924',TRUE,TRUE,TRUE,'194J','5501002','IT','IT-SW','ERP-V0784','active'),
 ('V0918','Akash Pumps & Generators',          '03AAJFA8902P1ZK','AAJFA8902P','Punjab',        TRUE,'UDYAM-PB-04-0021189','Silver',4.4,45,'PNB','04420xxxxx6611','PUNB0044200',TRUE,TRUE,TRUE,'194C','5302001','OPS','OPS-GEN','ERP-V0918','active'),
 ('V0044','Asian Paints Limited',              '27AAACA6666N1ZE','AAACA6666N','Maharashtra',  FALSE,NULL,'Silver',  4.6,45,'HDFC Bank','50100xxxxx0044','HDFC0000044',TRUE,TRUE,TRUE,'194C','5302001','ADMIN','ADM-REN','ERP-V0044','active'),
 ('V0833','Vijay Stationery & Print Solutions','03AAEFV6612J1ZP','AAEFV6612J','Punjab',        TRUE,'UDYAM-PB-03-0118934','Bronze',4.2,45,'IDBI Bank','04510xxxxx8801','IBKL0000451',TRUE,TRUE,TRUE,'194C','5302001','OPS','OPS-STN','ERP-V0833','active'),
 ('V0165','Manpower Solutions India Pvt Ltd',  '07AABCM5588Q1ZX','AABCM5588Q','Delhi',        FALSE,NULL,'Gold',    4.4,30,'ICICI Bank','02991xxxxx2210','ICIC0002991',TRUE,TRUE,TRUE,'194C','5401001','ADMIN','ADM-SEC','ERP-V0165','active'),
 ('V0721','Indus Towers Limited',              '07AACCH4612K1ZN','AACCH4612K','Delhi',        FALSE,NULL,'Gold',    4.6,30,'IndusInd Bank','25940xxxxx1145','INDB0000259',TRUE,TRUE,TRUE,'194I','5301001','IT','IT-TWR','ERP-V0721','active'),
 ('V0509','Punjab Stationery House',           '03AAFCP1844R1ZQ','AAFCP1844R','Punjab',        TRUE,'UDYAM-PB-03-0044211','Bronze',4.0,45,'PNB','04420xxxxx2298','PUNB0044100',TRUE,TRUE,TRUE,'194C','5302001','OPS','OPS-STN','ERP-V0509','active');

-- ---------- Purchase Orders ----------
INSERT INTO purchase_orders (id, vendor_id, department_id, category_id, branch_id, amount, gst_amount, agreement_based, esign_status, status, issued_at, created_by) VALUES
 ('PO/2026/03/00188','V0089','IT','IT-TEL','BR-HO',      412600, 62939, TRUE, 'signed','closed','2026-03-08+05:30','U003'),
 ('PO/2026/03/00214','V0512','OPS','OPS-BPO','BR-HO',    2840000,433220,TRUE, 'signed','closed','2026-03-12+05:30','U003'),
 ('PO/2026/04/00128','V0089','IT','IT-TEL','BR-HO',      412600, 62939, TRUE, 'signed','closed','2026-04-08+05:30','U003'),
 ('PO/2026/04/00194','V0512','OPS','OPS-BPO','BR-HO',    2840000,433220,TRUE, 'signed','closed','2026-04-12+05:30','U003'),
 ('PO/2026/04/00211','V0203','IT','IT-TEL','BR-HO',      892000, 136000,TRUE, 'signed','closed','2026-04-15+05:30','U003'),
 ('PO/2026/04/00244','V0394','STAT','STAT-AUD','BR-HO',  1850000,282203,TRUE, 'signed','closed','2026-04-20+05:30','U003'),
 ('PO/2026/04/00277','V0142','IT','IT-HW','BR-LDH-001',  840000, 128136,FALSE,'not_required','open','2026-04-22+05:30','U003'),
 ('PO/2026/04/00311','V0671','ADMIN','ADM-FAC','BR-HO',  780000, 118983,TRUE, 'signed','closed','2026-04-25+05:30','U003'),
 ('PO/2026/04/00345','V0421','ADMIN','ADM-UTL','BR-HO',  412000, 0,     FALSE,'not_required','closed','2026-04-27+05:30','U003'),
 ('PO/2026/04/00378','V0918','OPS','OPS-GEN','BR-AMR-002',298000,45458, TRUE, 'signed','closed','2026-04-29+05:30','U003'),
 ('PO/2026/04/00402','V0833','OPS','OPS-STN','BR-LDH-001',142000,21661, FALSE,'not_required','open','2026-04-30+05:30','U003'),
 ('PO/2026/05/00012','V0165','ADMIN','ADM-SEC','BR-HO',  1242000,189458,TRUE, 'signed','open','2026-05-02+05:30','U003'),
 ('PO/2026/05/00034','V0258','HR','HR-INS','BR-HO',      620000, 0,     TRUE, 'signed','closed','2026-05-03+05:30','U003'),
 ('PO/2026/05/00056','V0721','IT','IT-TWR','BR-DEL-003', 520000, 79322, TRUE, 'signed','open','2026-05-05+05:30','U003');

INSERT INTO po_lines (po_id, description, quantity, uom, unit_price, gst_rate) VALUES
 ('PO/2026/04/00128','Bandwidth · 100Mbps · 47 branches',47,'NOS',8000,18),
 ('PO/2026/04/00128','SIP trunk lines (PRI)',8,'NOS',6450,18),
 ('PO/2026/04/00194','BPO collections retainer · Apr',1,'JOB',2407000,18),
 ('PO/2026/04/00211','Mobile postpaid · 1,147 employees',1,'JOB',756000,18),
 ('PO/2026/04/00244','Q4 statutory audit fees',1,'JOB',1567800,18),
 ('PO/2026/04/00277','Branch laptops Dell Latitude 3540',21,'NOS',33898,18),
 ('PO/2026/04/00311','Office lease · Bengaluru HQ · May',1,'JOB',661000,18),
 ('PO/2026/04/00345','Power consumption · 31 branches Apr',1,'JOB',412000,0),
 ('PO/2026/04/00378','Genset AMC · Q1 FY26 · 18 branches',18,'NOS',14025,18),
 ('PO/2026/04/00402','Branch forms & stationery Q1',1,'JOB',120339,18),
 ('PO/2026/05/00012','Security guards · 47 branches · May',47,'NOS',22440,18),
 ('PO/2026/05/00034','Group health insurance Q1 premium',1,'JOB',620000,0),
 ('PO/2026/05/00056','Tower rental · 12 high-traffic sites',12,'NOS',36724,18),
 ('PO/2026/03/00188','Bandwidth · 100Mbps · 47 branches · Mar',47,'NOS',8000,18),
 ('PO/2026/03/00214','BPO collections retainer · Mar',1,'JOB',2407000,18);

-- ---------- GRNs ----------
INSERT INTO grns (id, po_id, branch_id, received_by, received_at, evidence, status) VALUES
 ('GRN/2026/04/0892','PO/2026/04/00128','BR-HO',      'U006','2026-04-30+05:30','[{"filename":"bandwidth_uptime_apr.pdf","note":"SLA report attached"}]','reconciled'),
 ('GRN/2026/04/1112','PO/2026/04/00194','BR-HO',      'U002','2026-04-30+05:30','[{"filename":"bpo_sla_apr.pdf","note":"Collections SLA met"}]','reconciled'),
 ('GRN/2026/04/1188','PO/2026/04/00211','BR-HO',      'U006','2026-04-30+05:30','[]','reconciled'),
 ('GRN/2026/04/1244','PO/2026/04/00244','BR-HO',      'U002','2026-04-28+05:30','[{"filename":"audit_completion_cert.pdf","note":"Q4 audit signed off"}]','reconciled'),
 ('GRN/2026/04/1289','PO/2026/04/00277','BR-LDH-001', 'U006','2026-05-02+05:30','[{"filename":"laptop_delivery_challan.pdf","note":"21 units received, serials logged"}]','recorded'),
 ('GRN/2026/04/1322','PO/2026/04/00311','BR-HO',      'U002','2026-04-30+05:30','[]','reconciled'),
 ('GRN/2026/04/1389','PO/2026/04/00345','BR-HO',      'U002','2026-04-30+05:30','[]','reconciled'),
 ('GRN/2026/04/1421','PO/2026/04/00378','BR-AMR-002', 'U006','2026-05-01+05:30','[{"filename":"amc_service_report_q1.pdf","note":"18 branches serviced"}]','reconciled'),
 ('GRN/2026/04/1444','PO/2026/04/00402','BR-LDH-001', 'U006','2026-05-03+05:30','[]','recorded'),
 ('GRN/2026/05/0021','PO/2026/05/00012','BR-HO',      'U002','2026-05-31+05:30','[{"filename":"guard_attendance_may.xlsx","note":"47 branches attendance"}]','recorded'),
 ('GRN/2026/05/0098','PO/2026/05/00056','BR-DEL-003', 'U006','2026-05-31+05:30','[]','recorded');

-- ---------- Invoices (full pipeline) ----------
INSERT INTO invoices (id, vendor_invoice_no, vendor_id, po_id, grn_id, department_id, category_id, branch_id,
                      invoice_date, due_date, source, taxable_amount, cgst, sgst, igst, total_amount,
                      tds_section, tds_rate, tds_amount, net_payable, irn, irn_status, ocr_confidence,
                      stage, match_status, match_detail, gst2b_status, msme_due_date, captured_at) VALUES
-- capture
 ('INV-2026-04-7821','SE/26/0412','V0142','PO/2026/04/00277','GRN/2026/04/1289','IT','IT-HW','BR-LDH-001','2026-05-04','2026-06-06','email',   711864,0,0,128136,840000,'194C',2,14237,825763,'76e3a4f8821','validated',96.4,'capture','pending',NULL,NULL,'2026-06-18','2026-05-06 14:38+05:30'),
 ('INV-2026-04-7822','VS/26/0288','V0833','PO/2026/04/00402','GRN/2026/04/1444','OPS','OPS-STN','BR-LDH-001','2026-05-04','2026-06-06','whatsapp',120339,0,0,21661,142000,'194C',2,2407,139593,'82c1b9d4412','validated',78.2,'capture','pending',NULL,NULL,'2026-06-18','2026-05-06 14:36+05:30'),
 ('INV-2026-05-0014','AP/26/0091','V0918','PO/2026/04/00378','GRN/2026/04/1421','OPS','OPS-GEN','BR-AMR-002','2026-05-05','2026-06-06','vendor_portal',252542,0,0,45458,298000,'194C',2,5051,292949,'a8d4e2c9933','validated',94.1,'capture','pending',NULL,NULL,'2026-06-19','2026-05-06 14:22+05:30'),
-- match
 ('INV-2026-04-7501','RJ/26/8841','V0089','PO/2026/04/00128','GRN/2026/04/0892','IT','IT-TEL','BR-HO','2026-04-30','2026-05-08','email',   349661,0,0,62939,412600,'194J',10,34966,377634,'4f8c2a17711','validated',97.8,'match','auto_matched','{"score": 97, "flags": []}',NULL,NULL,'2026-05-06 12:14+05:30'),
 ('INV-2026-04-7488','BA/26/4471','V0203','PO/2026/04/00211','GRN/2026/04/1188','IT','IT-TEL','BR-HO','2026-04-30','2026-05-15','email',   756000,0,0,136000,892000,'194J',10,75600,816400,'6b1a3c52244','validated',98.9,'match','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-05-06 11:48+05:30'),
 ('INV-2026-04-7644','WW/26/0512','V0671','PO/2026/04/00311','GRN/2026/04/1322','ADMIN','ADM-FAC','BR-HO','2026-04-29','2026-05-25','vendor_portal',661017,0,0,118983,780000,'194I',10,66102,713898,'9e2d4f18855','validated',95.5,'match','exception','{"score": 94, "flags": ["qty variance 2.4%"]}',NULL,NULL,'2026-05-06 11:22+05:30'),
 ('INV-2026-04-7702','SE/26/0429','V0142','PO/2026/04/00277','GRN/2026/04/1289','IT','IT-HW','BR-LDH-001','2026-05-02','2026-05-10','email', 745763,0,0,134237,880000,'194C',2,14915,865085,'2c4f6a81199','validated',88.7,'match','exception','{"score": 88, "flags": ["price ₹40K over PO"]}',NULL,'2026-06-16','2026-05-06 10:44+05:30'),
-- gst2b
 ('INV-2026-04-7322','TCS/26/1147','V0512','PO/2026/04/00194','GRN/2026/04/1112','OPS','OPS-BPO','BR-HO','2026-04-30','2026-05-12','email', 2406780,0,0,433220,2840000,'194J',10,240678,2599322,'8d3c1a45566','validated',98.2,'gst2b','auto_matched','{"score": 100, "flags": []}','matched',NULL,'2026-05-06 09:18+05:30'),
 ('INV-2026-04-7166','CM/26/0098','V0394','PO/2026/04/00244','GRN/2026/04/1244','STAT','STAT-AUD','BR-HO','2026-04-28','2026-05-20','email',1567797,0,0,282203,1850000,'194J',10,156780,1693220,'5a7c9e13344','validated',97.1,'gst2b','auto_matched','{"score": 100, "flags": []}','mismatch_tax','2026-06-12','2026-05-05 16:42+05:30'),
 ('INV-2026-04-7044','KM/26/0871','V0258','PO/2026/05/00034',NULL,'HR','HR-INS','BR-HO','2026-04-27','2026-06-03','email',                 620000,0,0,0,620000,'194D',5,31000,589000,NULL,'not_applicable',96.8,'gst2b','auto_matched','{"score": 100, "flags": []}','not_in_2b',NULL,'2026-05-05 14:08+05:30'),
-- tds / approval
 ('INV-2026-04-6988','IT/26/2241','V0721','PO/2026/05/00056','GRN/2026/05/0098','IT','IT-TWR','BR-DEL-003','2026-04-26','2026-06-05','email',440678,0,0,79322,520000,'194I',10,44068,475932,'3f1d9a77788','validated',97.4,'tds','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-05-05 11:21+05:30'),
 ('INV-2026-04-6845','AP/26/3318','V0044',NULL,NULL,'ADMIN','ADM-REN','BR-JPR-004','2026-04-25','2026-05-15','scan',                       120339,0,0,21661,142000,'194C',2,2407,139593,'7e2c5b84422','validated',95.9,'approval',NULL,NULL,NULL,NULL,'2026-05-05 09:58+05:30'),
 ('INV-2026-04-6712','QH/26/0667','V0784',NULL,NULL,'IT','IT-SW','BR-HO','2026-04-24','2026-05-18','email',                                155932,0,0,28068,184000,'194J',10,15593,168407,'1b9d4f63311','validated',96.2,'approval',NULL,NULL,NULL,NULL,'2026-05-04 17:14+05:30'),
-- liability / payments
 ('INV-2026-04-6588','NP/26/5521','V0421','PO/2026/04/00345','GRN/2026/04/1389','ADMIN','ADM-UTL','BR-HO','2026-04-23','2026-05-12','email',412000,0,0,0,412000,NULL,0,0,412000,NULL,'not_applicable',97.0,'liability','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-05-04 12:33+05:30'),
 ('INV-2026-04-6422','MS/26/1190','V0165','PO/2026/05/00012','GRN/2026/05/0021','ADMIN','ADM-SEC','BR-HO','2026-04-22','2026-06-02','email',1052542,0,0,189458,1242000,'194C',2,21051,1220949,'4d6a8c29988','validated',98.0,'payments','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-05-03 15:48+05:30'),
 ('INV-2026-04-6311','PS/26/0441','V0509',NULL,NULL,'OPS','OPS-STN','BR-LDH-001','2026-04-19','2026-05-03','whatsapp',                     81356,0,0,14644,96000,'194C',2,1627,94373,'2f8e1c35577','validated',93.3,'payments',NULL,NULL,NULL,'2026-06-03','2026-05-03 11:44+05:30'),
-- paid
 ('INV-2026-03-9844','RJ/26/8702','V0089','PO/2026/03/00188',NULL,'IT','IT-TEL','BR-HO','2026-03-30','2026-05-02','email',                 349661,0,0,62939,412600,'194J',10,34966,377634,'9c2a4d68811','validated',98.4,'paid','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-04-02 14:11+05:30'),
 ('INV-2026-03-9712','TCS/26/0988','V0512','PO/2026/03/00214',NULL,'OPS','OPS-BPO','BR-HO','2026-03-29','2026-04-30','email',              2406780,0,0,433220,2840000,'194J',10,240678,2599322,'5e7a9c14422','validated',98.8,'paid','auto_matched','{"score": 100, "flags": []}',NULL,NULL,'2026-04-01 09:32+05:30'),
 ('INV-2026-03-9612','CM/26/0072','V0394',NULL,NULL,'STAT','STAT-AUD','BR-HO','2026-03-25','2026-05-09','email',                           1567797,0,0,282203,1850000,'194J',10,156780,1693220,'8b4e6d29933','validated',97.6,'paid',NULL,NULL,NULL,'2026-05-09','2026-03-26 10:18+05:30');

-- ---------- GST 2B records ----------
INSERT INTO gst_2b_records (period, invoice_id, vendor_gstin, taxable, gst_in_2b, status) VALUES
 ('2026-05','INV-2026-04-7322','33AABCT3518Q1ZW',2406780,433220,'matched'),
 ('2026-05','INV-2026-04-7166','27AAACM4218R1ZK',1567797,272203,'mismatch_tax'),
 ('2026-05','INV-2026-04-7044','27AAACK4408F1ZS',NULL,NULL,'not_in_2b');

-- ---------- Approvals in flight ----------
INSERT INTO approvals (entity_type, entity_id, rule_id, stage_no, stage_role, assigned_to, status, acted_by, acted_at, sla_due_at) VALUES
 ('invoice','INV-2026-04-6845',2,1,'maker',  'U002','pending',NULL,NULL,'2026-06-12 10:00+05:30'),
 ('invoice','INV-2026-04-6712',3,1,'maker',  'U002','approved','U002','2026-05-05 10:14+05:30',NULL),
 ('invoice','INV-2026-04-6712',3,2,'checker','U001','approved','U001','2026-05-05 14:02+05:30',NULL),
 ('invoice','INV-2026-04-6712',3,3,'fc',     'U005','pending',NULL,NULL,'2026-06-12 18:00+05:30'),
 ('requisition','PR/2026/06/0001',8,1,'maker','U002','approved','U002','2026-06-09 11:30+05:30',NULL),
 ('requisition','PR/2026/06/0001',8,2,'checker','U001','pending',NULL,NULL,'2026-06-12 12:00+05:30');

-- ---------- Journal vouchers ----------
INSERT INTO journal_vouchers (id, invoice_id, dr_gl, cr_gl, amount, status, erp_doc_no, pushed_at) VALUES
 ('JV/2026/05/04412','INV-2026-04-6588','5102001','2401001',412000,'pushed','5400188421','2026-05-06 14:28+05:30'),
 ('JV/2026/05/04401','INV-2026-03-9844','5101001','2401001',412600,'pushed','5400188419','2026-04-28 10:12+05:30'),
 ('JV/2026/05/04388','INV-2026-03-9712','5201001','2401001',2840000,'pushed','5400188415','2026-04-25 16:40+05:30'),
 ('JV/2026/06/04501','INV-2026-04-6422','5401001','2401001',1242000,'ready',NULL,NULL),
 ('JV/2026/06/04502','INV-2026-04-6311','5302001','2401001',96000,'ready',NULL,NULL);

-- ---------- Payment batches ----------
INSERT INTO payment_batches (id, status, channel, total_amount, file_name, created_by, released_at) VALUES
 ('BATCH/2026/04/28A','reconciled','RTGS',2976956,'intelezen_payout_20260428.csv','U001','2026-04-28 15:00+05:30'),
 ('BATCH/2026/05/06A','released',  'NEFT',1315322,'intelezen_payout_20260506.csv','U001','2026-05-06 16:30+05:30');

INSERT INTO payment_items (batch_id, invoice_id, vendor_id, net_amount, mode, msme_priority, utr, utr_captured_at, remittance_sent, status) VALUES
 ('BATCH/2026/04/28A','INV-2026-03-9844','V0089',377634, 'NEFT',FALSE,'N123260428100442','2026-04-29 09:10+05:30',TRUE,'paid'),
 ('BATCH/2026/04/28A','INV-2026-03-9712','V0512',2599322,'RTGS',FALSE,'R456260426088121','2026-04-26 11:42+05:30',TRUE,'paid'),
 ('BATCH/2026/05/06A','INV-2026-04-6422','V0165',1220949,'NEFT',FALSE,NULL,NULL,FALSE,'queued'),
 ('BATCH/2026/05/06A','INV-2026-04-6311','V0509',94373,  'NEFT',TRUE, NULL,NULL,FALSE,'queued');

-- ---------- Advances & imprest ----------
INSERT INTO advances (id, advance_type, vendor_id, holder_id, po_id, department_id, branch_id, amount, balance, purpose, status) VALUES
 ('ADV/2026/05/0007','vendor_advance','V0142',NULL,'PO/2026/04/00277','IT','BR-LDH-001',250000,50000,'Mobilisation advance · branch laptop rollout','partially_settled'),
 ('ADV/2026/06/0011','imprest',NULL,'U006',NULL,'IT','BR-LDH-001',50000,50000,'Branch imprest · June 2026','open'),
 ('ADV/2026/06/0012','vendor_advance','V0044',NULL,NULL,'ADMIN','BR-JPR-004',75000,75000,'Advance · Jaipur branch renovation','pending_approval');

INSERT INTO advance_settlements (advance_id, invoice_id, amount, note) VALUES
 ('ADV/2026/05/0007','INV-2026-04-7821',200000,'Auto-adjusted against final laptop invoice');

-- ---------- Discounting ----------
INSERT INTO discount_pools (id, name, pool_type, capacity, deployed, cost_of_funds_pct, config) VALUES
 ('treasury','Treasury-Led Pool','treasury',424000000,1302168,6.500,'{"source": "idle FD surplus"}'),
 ('cc',      'Bank CC-Led Pool', 'bank_cc', 400000000,2981209,10.400,'{"note": "blended HDFC+ICICI"}'),
 ('treds',   'TReDS Marketplace','treds',   NULL,     0,      0.000,'{"off_balance_sheet": true}');

INSERT INTO cc_facilities (id, bank, account_ref, sanction, drawn, rate_basis, rate_pct) VALUES
 ('CC-HDFC-001','HDFC Bank','50100xxx0001',250000000,2573329,'MCLR + 1.50%',10.400),
 ('CC-ICICI-001','ICICI Bank','02991xxx0091',150000000,407880,'MCLR + 1.65%',10.550);

INSERT INTO discount_deals (id, invoice_id, vendor_id, pool_id, cc_facility_id, advance_amount, days_saved, vendor_rate_pct, cof_pct, spread_pct, ebitda_gain, status, offered_at, settled_at) VALUES
 ('DD-2026-05-0042','INV-2026-04-6422','V0165','treasury',NULL,        1208739,24,9.500,6.500,3.000,2384,'active','2026-05-05+05:30',NULL),
 ('DD-2026-05-0041','INV-2026-04-6588','V0421','cc','CC-ICICI-001',    407880, 6, 11.200,10.400,0.800,54,  'active','2026-05-04+05:30',NULL),
 ('DD-2026-05-0040','INV-2026-04-6311','V0509','treasury',NULL,        93429,  0, 9.000,6.500,2.500,0,   'active','2026-05-03+05:30',NULL),
 ('DD-2026-05-0039','INV-2026-04-7322','V0512','cc','CC-HDFC-001',     2573329,6, 11.500,10.400,1.100,4659,'offered','2026-05-06+05:30',NULL),
 ('DD-2026-04-0038','INV-2026-03-9712','V0512','treasury',NULL,        2573329,4, 9.500,6.500,3.000,8474,'settled','2026-04-22+05:30','2026-04-26+05:30'),
 ('DD-2026-04-0037','INV-2026-03-9844','V0089','treasury',NULL,        373858, 3, 9.500,6.500,3.000,923, 'settled','2026-04-26+05:30','2026-04-29+05:30'),
 ('DD-2026-04-0036','INV-2026-03-9612','V0394','treds',NULL,           1676288,18,8.400,0.000,8.400,6948,'settled','2026-04-08+05:30','2026-04-26+05:30');

INSERT INTO early_pay_requests (id, vendor_id, invoice_id, amount, days_available, requested_rate_pct, suggested_pool_id, expected_gain, ai_rationale, status, requested_at, actioned_by, actioned_at) VALUES
 ('EPR-2026-001','V0258','INV-2026-04-7044',589000, 28,9.200,'treasury',1268,'28 days at 2.7% spread beats CC drawdown; treasury surplus available.','pending','2026-05-06 14:12+05:30',NULL,NULL),
 ('EPR-2026-002','V0203','INV-2026-04-7488',816400, 9, 9.500,'cc',      191, 'Short tenor — CC drawdown avoids breaking FD; thin but positive spread.','pending','2026-05-06 13:48+05:30',NULL,NULL),
 ('EPR-2026-003','V0833','INV-2026-04-7822',139593, 31,8.800,'treasury',984, 'MSME under 45-day SLA; treasury routing protects Section 43B(h) position.','pending','2026-05-06 14:36+05:30',NULL,NULL),
 ('EPR-2026-004','V0784','INV-2026-04-6712',168407, 12,9.400,'cc',      165, 'Modest gain; CC tenor fit.','accepted','2026-05-05 11:22+05:30','U001','2026-05-05 12:01+05:30'),
 ('EPR-2026-005','V0089','INV-2026-04-7501',377634, 2, 9.500,'cc',      78,  'Gain below ₹100 floor — recommend decline.','declined','2026-05-05 09:14+05:30','U001','2026-05-05 09:40+05:30'),
 ('EPR-2026-006','V0142','INV-2026-04-7702',865085, 4, 9.300,'treasury',284, 'Short tenor but treasury spread still positive.','pending','2026-05-06 10:48+05:30',NULL,NULL);

INSERT INTO treds_platforms (id, name, operator, onboarded, stats) VALUES
 ('rxil',       'RXIL',       'SIDBI + NSE',       TRUE,'{"vendors": 12, "deals_mtd": 4}'),
 ('m1x',        'M1xchange',  'Mynd Solutions',    TRUE,'{"vendors": 8,  "deals_mtd": 7, "note": "best avg rate"}'),
 ('invoicemart','Invoicemart','Axis · mjunction',  TRUE,'{"vendors": 5,  "deals_mtd": 3}');

INSERT INTO factoring_units (id, platform_id, invoice_id, vendor_id, amount, status, best_bid_pct, best_bidder) VALUES
 ('FU-RXIL-9442',   'rxil',       'INV-2026-04-7166','V0394',1693220,'won',    8.400,'SBI'),
 ('FU-M1X-8821',    'm1x',        'INV-2026-05-0014','V0918',292949, 'bidding',8.650,'HDFC'),
 ('FU-INVMART-4412','invoicemart','INV-2026-04-7822','V0833',139593, 'listed', NULL,  NULL);

INSERT INTO factoring_bids (fu_id, financier, rate_pct) VALUES
 ('FU-RXIL-9442','SBI',8.400),('FU-RXIL-9442','Axis Bank',8.720),('FU-RXIL-9442','Kotak Mahindra',8.910),
 ('FU-M1X-8821','HDFC Bank',8.650),('FU-M1X-8821','ICICI Bank',8.880);

-- ---------- Requisitions / RFQ ----------
INSERT INTO requisitions (id, title, department_id, category_id, branch_id, cost_center, requester_id, justification, statutory_flags, total_amount, status, created_at) VALUES
 ('PR/2026/06/0001','Branch CCTV upgrade · 12 branches','IT','IT-HW','BR-LDH-001','CC-IT-204','U006','Existing DVRs end-of-life; RBI branch security circular compliance.','{"capex": true}',1140000,'pending_approval','2026-06-09 10:02+05:30'),
 ('PR/2026/06/0002','June stationery replenishment · Punjab cluster','OPS','OPS-STN','BR-AMR-002','CC-OPS-101','U006','Quarterly forms and stationery for 14 branches.','{"msme_pref": true}',164000,'converted_po','2026-06-02 09:40+05:30'),
 ('PR/2026/06/0003','Monsoon brand campaign · radio + print','MKT','MKT-PRN','BR-HO','CC-MKT-301','U006','Customer outreach ahead of monsoon disbursal season.','{}',680000,'draft','2026-06-10 17:25+05:30'),
 ('PR/2026/05/0004','Genset AMC renewal · 18 branches','OPS','OPS-GEN','BR-AMR-002','CC-OPS-102','U006','Q2 AMC renewal; current contract expires 30 Jun.','{"agreement_based": true, "msme_pref": true}',312000,'converted_rfq','2026-05-28 11:15+05:30');

INSERT INTO requisition_lines (requisition_id, description, quantity, uom, est_unit_price, gl_code) VALUES
 ('PR/2026/06/0001','4MP IP dome cameras',96,'NOS',6500,'5501001'),
 ('PR/2026/06/0001','16-ch NVR with 4TB storage',12,'NOS',24000,'5501001'),
 ('PR/2026/06/0001','Installation & cabling per branch',12,'JOB',19000,'5501001'),
 ('PR/2026/06/0002','Loan card printing · pre-printed forms',20000,'NOS',4.2,'5302001'),
 ('PR/2026/06/0002','Branch registers & misc stationery',14,'SET',5700,'5302001'),
 ('PR/2026/06/0003','FM radio spots · 4 stations · 6 weeks',1,'JOB',420000,'5701001'),
 ('PR/2026/06/0003','Branch posters & leaflets',45000,'NOS',5.8,'5701001'),
 ('PR/2026/05/0004','Genset AMC · annual · per branch',18,'NOS',17333,'5302001');

INSERT INTO rfqs (id, requisition_id, title, due_date, status, awarded_vendor_id, award_override_reason, created_by) VALUES
 ('RFQ/2026/06/0001','PR/2026/05/0004','Genset AMC FY27 · 18 Punjab branches','2026-06-15','quoted',NULL,NULL,'U003');

INSERT INTO quotations (rfq_id, vendor_id, amount, delivery_days, validity_days, payment_terms, notes, score) VALUES
 ('RFQ/2026/06/0001','V0918',312000,7, 60,'Net 45','Incumbent · includes 4 preventive visits/yr',88.5),
 ('RFQ/2026/06/0001','V0142',345000,14,45,'Net 30','Includes remote monitoring sensors',82.0),
 ('RFQ/2026/06/0001','V0509',298000,21,30,'Net 45','New entrant · no AMC track record',74.5);

-- ---------- Vendor onboarding pipeline ----------
INSERT INTO vendor_onboarding (id, entity_name, business_type, pan, gstin, stage, pan_verified, gstin_verified, is_msme, penny_drop_status, npci_name_match, risk_score, risk_tier, erp_status, risk_flag, status, notes, initiated_by, created_at) VALUES
 ('ONB-2026-08','Cygnet Infotech Pvt Ltd',  'pvt_ltd','AABCC8821Q','24AABCC8821Q1ZN',5,TRUE, TRUE, TRUE, 'verified',100.0,72,'low',   NULL,     'normal','in_progress','Software / SaaS · risk scoring complete, awaiting agreement','U002','2026-05-04+05:30'),
 ('ONB-2026-09','BluePine Tech Services',   'partnership','AAEFB4412P','03AAEFB4412P1ZC',3,TRUE, TRUE, FALSE,NULL,     NULL, NULL,NULL,    NULL,     'normal','in_progress','IT Hardware · Udyam reverse lookup in progress','U002','2026-05-05+05:30'),
 ('ONB-2026-10','Garg Furniture & Fittings','proprietorship','AAGPG9921R','03AAGPG9921R1ZD',4,TRUE, TRUE, TRUE, 'verified',100.0,NULL,NULL,  NULL,     'normal','in_progress','Branch Furniture · penny drop verified, risk scoring next','U003','2026-05-05+05:30'),
 ('ONB-2026-11','CityClean Facility Mgmt',  'pvt_ltd','AACCC1190K','03AACCC1190K1ZB',2,FALSE,TRUE, FALSE,NULL,     NULL, NULL,NULL,    NULL,     'high',  'in_progress','Housekeeping · GSTIN active but PAN verification failed once','U003','2026-05-06+05:30'),
 ('ONB-2026-12','Krishna Genset Sales',     'proprietorship','AAKPK6612M','03AAKPK6612M1ZA',6,TRUE, TRUE, TRUE, 'verified',100.0,81,'low',  'pushed','normal','approved','Branch Genset · live as vendor','U002','2026-05-02+05:30');

-- ---------- Notifications ----------
INSERT INTO notifications (user_id, channel, title, body, entity_type, entity_id, kind) VALUES
 ('U001','in_app','Approval pending · PR/2026/06/0001','Branch CCTV upgrade ₹11.40L awaiting checker approval. SLA due 12 Jun 12:00.','requisition','PR/2026/06/0001','approval_pending'),
 ('U005','in_app','FC approval pending · INV-2026-04-6712','Quick Heal ₹1.84L cleared maker and checker; FC sign-off due 12 Jun 18:00.','invoice','INV-2026-04-6712','approval_pending'),
 ('U001','in_app','MSME 45-day breach risk · INV-2026-04-6311','Punjab Stationery House — 0 days remaining. Section 43B(h) exposure. Auto-flagged to treasury pool.','invoice','INV-2026-04-6311','sla_breach'),
 ('U007','in_app','Early-pay queue · 4 pending requests','₹24.1L requested across 4 vendor-initiated requests. Expected EBITDA ₹2,727.','early_pay','EPR-2026-001','reminder'),
 ('U002','in_app','OCR QC needed · INV-2026-04-7822','WhatsApp capture at 78.2% confidence — below the 85% QC threshold.','invoice','INV-2026-04-7822','escalation');

-- ---------- Sync log ----------
INSERT INTO sync_log (integration_id, direction, object_type, reference, result, simulated, at) VALUES
 ('erp','push','journal_voucher','JV/2026/05/04412 · NDPC Power · ₹4.12L','success',TRUE,'2026-05-06 14:28+05:30'),
 ('erp','pull','purchase_order','PO/2026/05/00056 · Indus Towers','success',TRUE,'2026-05-06 13:55+05:30'),
 ('erp','push','vendor_master','V0918 · Akash Pumps · update bank a/c','success',TRUE,'2026-05-06 13:21+05:30'),
 ('erp','pull','payment_confirmation','JV/2026/05/04388 · TCS BPO · ₹25.99L','success',TRUE,'2026-05-06 12:44+05:30'),
 ('gstn_2b','pull','gstr2b_period','2026-05 · 247 invoices','success',TRUE,'2026-05-06 14:32+05:30'),
 ('penny_drop','push','bank_verification','ONB-2026-10 · Garg Furniture · ₹1','success',TRUE,'2026-05-06 14:18+05:30'),
 ('irp','pull','irn_validation','INV-2026-04-7821','success',TRUE,'2026-05-06 14:38+05:30');

-- ---------- Agent invocations (AI audit) ----------
INSERT INTO agent_invocations (agent, entity_type, entity_id, model, output, confidence, accepted, acted_by, latency_ms, at) VALUES
 ('invoice_ocr','invoice','INV-2026-04-7821','gpt-4o','{"vendor": "Sharma Enterprises", "amount": 840000, "irn_found": true}',96.4,TRUE,NULL,4210,'2026-05-06 14:38+05:30'),
 ('invoice_ocr','invoice','INV-2026-04-7822','gpt-4o','{"vendor": "Vijay Stationery", "amount": 142000, "note": "low image quality"}',78.2,NULL,NULL,5840,'2026-05-06 14:36+05:30'),
 ('pool_recommender','early_pay','EPR-2026-001','gpt-4o','{"pool": "treasury", "expected_gain": 1268}',91.0,NULL,NULL,2103,'2026-05-06 14:12+05:30'),
 ('pool_recommender','early_pay','EPR-2026-004','gpt-4o','{"pool": "cc", "expected_gain": 165}',88.5,TRUE,'U001',1987,'2026-05-05 11:22+05:30'),
 ('match_analyst','invoice','INV-2026-04-7702','gpt-4o','{"flag": "price ₹40K over PO", "recommendation": "hold for buyer confirmation"}',92.3,NULL,NULL,3320,'2026-05-06 10:45+05:30');

-- ---------- Audit log (hash-chained from seed) ----------
INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, detail, prev_hash, row_hash, at)
SELECT actor_id, actor_name, action, entity_type, entity_id, detail, NULL,
       encode(digest(actor_name || action || coalesce(entity_id,'') || detail, 'sha256'), 'hex'), at
FROM (VALUES
 ('U001','Pradip Sharma','Approved early-pay request','early_pay','EPR-2026-004','Routed to CC pool · ₹168K · 12 days · expected gain ₹165','2026-05-06 14:42+05:30'::timestamptz),
 (NULL,'System','Auto-matched 3-way','invoice','INV-2026-04-7501','PO/2026/04/00128 ↔ GRN/2026/04/0892 ↔ INV · 97% confidence','2026-05-06 14:40+05:30'),
 (NULL,'OCR Engine','Captured invoice','invoice','INV-2026-04-7821','Source: email · Sharma Enterprises · ₹8.40L · IRN verified','2026-05-06 14:38+05:30'),
 (NULL,'OCR Engine','Captured invoice','invoice','INV-2026-04-7822','Source: WhatsApp · Vijay Stationery · ₹1.42L · low conf · QC needed','2026-05-06 14:36+05:30'),
 (NULL,'GSTN Sync','GSTR-2B fetched','gst2b','2026-05','247 invoices fetched · 211 matched · 23 mismatches · 13 not in 2B','2026-05-06 14:32+05:30'),
 ('U001','Pradip Sharma','Pushed JV to ERP','journal_voucher','JV/2026/05/04412','NDPC Power · ₹4.12L · Doc 5400188421 · posted to GL 5102001','2026-05-06 14:28+05:30'),
 ('U002','Nidhi Kaur','Penny drop verified','vendor_onboarding','ONB-2026-10','₹1 sent to A/c 50100xxxx2278 · Name match: 100%','2026-05-06 14:18+05:30'),
 ('U004','Anish Rao','Approved invoice','invoice','INV-2026-04-6712','₹1.84L · routing rule matched · released to FC stage','2026-05-06 14:11+05:30'),
 (NULL,'TDS Engine','Computed TDS','invoice','INV-2026-04-6988','Section 194I · 10% · ₹44,068 deducted','2026-05-06 14:04+05:30'),
 (NULL,'System','MSME 45-day SLA breach alert','invoice','INV-2026-04-6311','0 days remaining · auto-flagged for treasury pool · Section 43B(h) risk','2026-05-06 13:58+05:30'),
 ('U003','Vikram Joshi','Initiated onboarding','vendor_onboarding','ONB-2026-11','Risk: High · GSTIN active but PAN verification pending','2026-05-06 13:42+05:30'),
 ('U007','Tanvi Desai','Approved discount deal','discount_deal','DD-2026-05-0040','MSME priority routing · ₹93K · spread 2.50%','2026-05-06 13:30+05:30')
) AS t(actor_id, actor_name, action, entity_type, entity_id, detail, at);

-- ---------- Invoice stage history (sample trace) ----------
INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note, at) VALUES
 ('INV-2026-04-6422',NULL,'capture','U002','OCR capture · email','2026-05-03 15:48+05:30'),
 ('INV-2026-04-6422','capture','match',NULL,'Auto-matched 100%','2026-05-03 16:02+05:30'),
 ('INV-2026-04-6422','match','gst2b',NULL,'2B matched','2026-05-03 18:00+05:30'),
 ('INV-2026-04-6422','gst2b','tds',NULL,'TDS 194C · 2% · ₹21,051','2026-05-03 18:01+05:30'),
 ('INV-2026-04-6422','tds','approval',NULL,'Routed: maker → checker → fc → cfo','2026-05-03 18:01+05:30'),
 ('INV-2026-04-6422','approval','liability','U004','CFO approved','2026-05-04 11:20+05:30'),
 ('INV-2026-04-6422','liability','payments','U001','JV ready · added to batch','2026-05-05 09:30+05:30');

COMMIT;
