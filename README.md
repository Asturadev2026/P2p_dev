# AstonomiQ Procure-to-Pay — Intelezen Microfin Limited

End-to-end P2P platform with invoice discounting for Intelezen Microfin Limited (NBFC-MFI, Jalandhar, Punjab).
Part of the **AstonomiQ** product suite.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 · Vite 5 · React Router 6 |
| Backend | FastAPI · Python 3.12 · SQLAlchemy async + asyncpg |
| Database | Neon (PostgreSQL serverless) · database `intelezen_ap_discounting` |
| AI | OpenAI GPT-4o (recommendations only, human-in-the-loop) |

## Quick start

### macOS / Linux

```bash
./start.sh
# Backend  → http://localhost:8002  (Swagger at /docs)
# Frontend → http://localhost:5175
```

Manual (macOS / Linux):

```bash
# Backend
cd backend
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env            # set DATABASE_URL + OPENAI_API_KEY
psql $DATABASE_URL -f migrations/001_initial_schema.sql
psql $DATABASE_URL -f migrations/002_seed_data.sql
./.venv/bin/uvicorn main:app --port 8002 --reload

# Frontend
cd frontend
npm install && npm run dev      # http://localhost:5175
```

### Windows

**Prerequisites:** Python 3.12, Node.js 18+

**First-time setup — run once:**

```powershell
# 1. Backend — create venv and install dependencies
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# 2. Copy and edit the env file
copy .env.example .env
# Open .env and set DATABASE_URL to your Neon connection string:
# postgresql+asyncpg://user:password@host/dbname?ssl=require
# Note: use ssl=require (not sslmode=require) for asyncpg

# 3. Run migrations using Python (no psql required)
.\.venv\Scripts\python -c "
import psycopg2, re, os
from dotenv import load_dotenv
load_dotenv()
url = os.environ['DATABASE_URL'].replace('postgresql+asyncpg://', 'postgresql://', 1).replace('ssl=require', 'sslmode=require')
conn = psycopg2.connect(url); conn.autocommit = True; cur = conn.cursor()
for f in ['migrations/001_initial_schema.sql', 'migrations/002_seed_data.sql']:
    cur.execute(open(f).read()); print('OK:', f)
conn.close()
"
```

**Start the app — open two terminals:**

```powershell
# Terminal 1 — Backend (from backend/)
cd backend
.\.venv\Scripts\uvicorn main:app --port 8002 --reload
# → http://localhost:8002   Swagger: http://localhost:8002/docs

# Terminal 2 — Frontend (from frontend/)
cd frontend
npm install
npm run dev
# → http://localhost:5175
```

## Demo logins (password `intelezen123`)

| Username | Role |
|---|---|
| pradip | Checker · AP Manager |
| nidhi | Maker · AP Executive |
| meera | Financial Controller (FC) |
| anish | CFO |
| vikram | Procurement |
| rahul | Requester (IT · Ludhiana branch) |
| tanvi | Treasury Desk |
| admin | Administrator |
| kavita | Auditor (read) |

## Modules

**Procurement** — Purchase Requisitions (multi-line, cost centre, statutory flags, live approver
panel) · RFQ & Quotation comparison (lowest highlighted, controlled override with audit) ·
Purchase Orders (from RFQ or independent, e-Sign/Class-3 DSC for agreement-based) · GRN
(branch evidence capture, qty reconciliation).

**AP Automation** — Capture Inbox (multi-channel, GPT-4o OCR extraction, IRN validation,
duplicate prevention at source) · 3-Way Match (configurable tolerance bands, auto-approve ≥95%,
AI exception analysis) · GST 2B reconciliation (ITC risk, payment hold) · TDS Engine (194C/J/I/D
at source, RCM) · Approval Orchestration (maker → checker → FC → CFO matrix, MSME fast-track,
SLA tracking) · Liability & JV (GL auto-coding, ERP push) · Payment Batches (bank-ready payout
CSV, UTR capture, branded remittance advice) · Advances & Imprest (auto-adjustment vs bills).

**Vendor 360** — Vendor Master (verified GSTIN/PAN/MSME/bank) · 6-step onboarding
(PAN+GSTIN verify → Udyam → penny-drop → risk scoring → ERP push; foreign-vendor path) ·
360 view with six-month ledger and discounting history.

**Invoice Discounting** — Discount Desk over three pools (Treasury-led, Bank CC-led, TReDS) ·
EBITDA calculator (same invoice routed three ways, engine recommendation) · Early-Pay requests
(AI pool routing, human approves) · TReDS marketplace (RXIL, M1xchange, Invoicemart auctions).

**Platform** — Reports (spend cube by dept/vendor/category/branch, ageing, approval SLA,
statutory exposure, CSV export) · ERP/Bank sync log · tamper-evident Audit Trail (sha-256 hash
chain, before/after state) · Admin Console (rules as configuration, integration mode switches).

## Key design points

- **Rules as configuration, not code** — approval matrix, tolerance bands, TDS rates, thresholds
  all live in the `configuration` / `approval_rules` tables; edit in the Admin Console.
- **Integrations are switchable** — every external call (GST, PAN, Udyam, penny-drop, e-Sign,
  bank file/UTR, ERP, IRP, GSTR-2B, TReDS) goes through an adapter that honours
  `integrations.mode` = `simulated` | `live`. All APIs are Intelezen-provided; flip to `live` with a
  base URL in the Admin Console once available. Every call is written to `sync_log`.
- **Human-in-the-loop AI** — GPT-4o agents (invoice OCR, pool recommender, match-exception
  analyst) only recommend; every invocation is logged to `agent_invocations` with the human
  outcome. Deterministic fallbacks keep the demo working without an API key.
- **Tamper-evident audit** — every action appends `sha256(prev_hash ‖ payload)`;
  `GET /api/v1/admin/audit/verify-chain` recomputes the chain.
- **Duplicate prevention at source** — DB unique constraint on (vendor, vendor invoice no)
  plus capture-time check; double payment blocked in batch builder.
- **MSME 45-day (Section 43B(h))** — due date computed at capture, priority routing,
  dashboard exposure, statutory report.

## Project layout (pi-wc standard)

```
backend/
  main.py
  app/api/v1/routes/   auth · dashboard · requisitions · procurement · vendors ·
                       invoices · approvals · payments · discounting · reports ·
                       admin · notifications
  app/core/            config · database · security (HMAC tokens, RBAC)
  app/services/        approval_engine · tax_engine · match_engine ·
                       discounting_service · integration_service · ai_agents ·
                       notification_service
  app/utils/audit.py   hash-chained audit writer
  migrations/          001_initial_schema.sql · 002_seed_data.sql
frontend/
  src/screens/         Login · CommandCentre · Procurement · ApInvoices ·
                       ApprovalsPayments · Vendors · Discounting · Platform
  src/components/      Layout · ui (Kpi, Card, DataTable, Chip, Modal…)
```
