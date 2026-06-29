"""Vendor master, 360 view, and the 6-step onboarding pipeline."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import integration_service
from app.utils.audit import log_action

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("")
async def list_vendors(msme_only: bool = False, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT v.*, c.name AS category_name, d.name AS department_name,
               (SELECT COUNT(*) FROM invoices i WHERE i.vendor_id = v.id AND i.stage NOT IN ('paid','rejected')) AS open_invoices,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i WHERE i.vendor_id = v.id) AS spend_ytd,
               (SELECT COALESCE(SUM(i.net_payable), 0) FROM invoices i WHERE i.vendor_id = v.id AND i.stage NOT IN ('paid','rejected')) AS open_dues
        FROM vendors v
        LEFT JOIN spend_categories c ON c.id = v.category_id
        LEFT JOIN departments d ON d.id = v.department_id
        WHERE v.status = 'active' AND (NOT :msme OR v.is_msme)
        ORDER BY spend_ytd DESC
    """, {"msme": msme_only})


@router.get("/{vendor_id}/v360")
async def vendor_360(vendor_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    vendor = await fetch_one(db, """
        SELECT v.*, c.name AS category_name, d.name AS department_name
        FROM vendors v
        LEFT JOIN spend_categories c ON c.id = v.category_id
        LEFT JOIN departments d ON d.id = v.department_id
        WHERE v.id = :id
    """, {"id": vendor_id})
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    invoices = await fetch_all(db, """
        SELECT id, vendor_invoice_no, total_amount, net_payable, stage, captured_at, due_date
        FROM invoices WHERE vendor_id = :id ORDER BY captured_at DESC LIMIT 20
    """, {"id": vendor_id})
    deals = await fetch_all(db, """
        SELECT d.*, p.name AS pool_name FROM discount_deals d
        JOIN discount_pools p ON p.id = d.pool_id
        WHERE d.vendor_id = :id ORDER BY d.offered_at DESC
    """, {"id": vendor_id})
    ledger = await fetch_all(db, """
        SELECT i.id, i.invoice_date, i.total_amount, i.tds_amount, i.net_payable, i.stage,
               pi.utr, pi.utr_captured_at
        FROM invoices i
        LEFT JOIN payment_items pi ON pi.invoice_id = i.id
        WHERE i.vendor_id = :id AND i.invoice_date >= CURRENT_DATE - INTERVAL '6 months'
        ORDER BY i.invoice_date DESC
    """, {"id": vendor_id})
    totals = await fetch_one(db, """
        SELECT COALESCE(SUM(total_amount), 0) AS spend_ytd, COUNT(*) AS invoice_count,
               COALESCE(SUM(net_payable) FILTER (WHERE stage NOT IN ('paid','rejected')), 0) AS open_dues
        FROM invoices WHERE vendor_id = :id
    """, {"id": vendor_id})
    discount_earnings = await fetch_one(db, """
        SELECT COALESCE(SUM(ebitda_gain), 0) AS total, COUNT(*) AS deals FROM discount_deals
        WHERE vendor_id = :id AND status != 'cancelled'
    """, {"id": vendor_id})
    return {**vendor, "recent_invoices": invoices, "discounting_history": deals,
            "six_month_ledger": ledger, "totals": totals, "discount_earnings": discount_earnings}


# ---------- Onboarding ----------

@router.get("/onboarding/list")
async def list_onboarding(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT o.*, u.full_name AS initiated_by_name FROM vendor_onboarding o
        LEFT JOIN users u ON u.id = o.initiated_by
        ORDER BY o.created_at DESC
    """)


class OnboardingCreate(BaseModel):
    entity_name: str
    business_type: str = "pvt_ltd"
    vendor_type: str = "domestic"
    pan: str | None = None
    gstin: str | None = None
    contact_name: str | None = None
    contact_designation: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    state: str | None = None
    pin_code: str | None = None
    foreign_docs: dict = {}


@router.post("/onboarding")
async def start_onboarding(body: OnboardingCreate, db: AsyncSession = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 13 AS n FROM vendor_onboarding")
    onb_id = f"ONB-{date.today():%Y}-{seq['n']:02d}"
    import json
    await execute(db, """
        INSERT INTO vendor_onboarding (id, entity_name, business_type, vendor_type, pan, gstin,
            contact_name, contact_designation, contact_email, contact_phone, address, state, pin_code,
            foreign_docs, initiated_by)
        VALUES (:id, :en, :bt, :vt, :pan, :gstin, :cn, :cd, :ce, :cp, :addr, :st, :pin,
                CAST(:fd AS jsonb), :u)
    """, {"id": onb_id, "en": body.entity_name, "bt": body.business_type, "vt": body.vendor_type,
          "pan": body.pan, "gstin": body.gstin, "cn": body.contact_name, "cd": body.contact_designation,
          "ce": body.contact_email, "cp": body.contact_phone, "addr": body.address,
          "st": body.state, "pin": body.pin_code, "fd": json.dumps(body.foreign_docs), "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Initiated onboarding", "vendor_onboarding", onb_id,
                     f"{body.entity_name} · {body.vendor_type}")
    return {"id": onb_id, "stage": 1}


class StepBody(BaseModel):
    account_no: str | None = None
    ifsc: str | None = None
    account_name: str | None = None


@router.post("/onboarding/{onb_id}/advance")
async def advance_onboarding(onb_id: str, body: StepBody | None = None,
                             db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Run the next wizard step: 2 PAN+GSTIN · 3 Udyam · 4 penny drop · 5 risk · 6 ERP push."""
    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE id = :id", {"id": onb_id})
    if not onb:
        raise HTTPException(404, "Onboarding record not found")
    stage, detail = onb["stage"], {}

    if stage == 1:  # → verify PAN + GSTIN
        pan_res = await integration_service.verify_pan(db, onb["pan"] or "", onb["entity_name"])
        gst_res = await integration_service.verify_gstin(db, onb["gstin"] or "", onb["entity_name"])
        await execute(db, """
            UPDATE vendor_onboarding SET stage = 2, pan_verified = :p, gstin_verified = :g,
                gst_filing_status = :f, updated_at = now(),
                risk_flag = CASE WHEN NOT :p OR NOT :g THEN 'high' ELSE risk_flag END
            WHERE id = :id
        """, {"p": pan_res["valid"], "g": gst_res["valid"], "f": gst_res.get("filing_status"), "id": onb_id})
        detail = {"pan": pan_res, "gstin": gst_res}

    elif stage == 2:  # → Udyam MSME lookup
        res = await integration_service.check_udyam(db, onb["pan"] or "")
        await execute(db, """
            UPDATE vendor_onboarding SET stage = 3, is_msme = :m, udyam_no = :u, msme_category = :c,
                updated_at = now() WHERE id = :id
        """, {"m": res["is_msme"], "u": res.get("udyam_no"), "c": res.get("category"), "id": onb_id})
        detail = res

    elif stage == 3:  # → penny drop
        if not body or not body.account_no:
            raise HTTPException(400, "Bank account details required for penny drop")
        res = await integration_service.penny_drop(db, body.account_no, body.ifsc or "",
                                                   body.account_name or onb["entity_name"])
        await execute(db, """
            UPDATE vendor_onboarding SET stage = 4, account_no = :a, ifsc = :i, account_name = :n,
                penny_drop_status = :s, npci_name_match = :m, updated_at = now() WHERE id = :id
        """, {"a": body.account_no, "i": body.ifsc, "n": body.account_name,
              "s": res["status"], "m": res["npci_name_match_pct"], "id": onb_id})
        detail = res

    elif stage == 4:  # → risk scoring
        import hashlib
        score = 60 + int(hashlib.sha256(onb_id.encode()).hexdigest()[:2], 16) % 35
        tier = "low" if score >= 70 else ("medium" if score >= 55 else "high")
        await execute(db, """
            UPDATE vendor_onboarding SET stage = 5, risk_score = :s, risk_tier = :t,
                mca_status = 'Active', itr_status = 'Filed FY25', updated_at = now() WHERE id = :id
        """, {"s": score, "t": tier, "id": onb_id})
        detail = {"risk_score": score, "risk_tier": tier, "mca": "Active", "itr": "Filed FY25"}

    elif stage == 5:  # → ERP vendor create + master record
        res = await integration_service.erp_push(db, "vendor_create", onb_id,
                                                 {"name": onb["entity_name"], "pan": onb["pan"]})
        seq = await fetch_one(db, "SELECT COUNT(*) + 1000 AS n FROM vendors")
        vendor_id = f"V{seq['n']:04d}"
        await execute(db, """
            INSERT INTO vendors (id, name, vendor_type, gstin, pan, state, is_msme, udyam_no, msme_category,
                                 tier, payment_terms_days, bank_name, bank_account, bank_ifsc,
                                 bank_verified, gstin_verified, pan_verified, erp_vendor_id, status)
            VALUES (:id, :n, :vt, :g, :p, :st, COALESCE(:m, FALSE), :u, :mc, 'Bronze', 45, '—',
                    :acct, :ifsc, TRUE, TRUE, TRUE, :erp, 'active')
        """, {"id": vendor_id, "n": onb["entity_name"], "vt": onb["vendor_type"], "g": onb["gstin"],
              "p": onb["pan"], "st": onb["state"], "m": onb["is_msme"], "u": onb["udyam_no"],
              "mc": onb["msme_category"], "acct": onb["account_no"], "ifsc": onb["ifsc"],
              "erp": res.get("erp_doc_no")})
        await execute(db, """
            UPDATE vendor_onboarding SET stage = 6, erp_status = 'pushed', erp_vendor_id = :v,
                status = 'approved', updated_at = now() WHERE id = :id
        """, {"v": vendor_id, "id": onb_id})
        detail = {"vendor_id": vendor_id, "erp": res}
    else:
        raise HTTPException(400, "Onboarding already complete")

    await log_action(db, user["sub"], user["name"], f"Onboarding step {stage} → {stage + 1}",
                     "vendor_onboarding", onb_id, str(detail)[:400])
    return {"id": onb_id, "stage": stage + 1, "detail": detail}


@router.get("/masters/reference")
async def reference_masters(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return {
        "departments": await fetch_all(db, "SELECT * FROM departments ORDER BY id"),
        "categories": await fetch_all(db, "SELECT * FROM spend_categories ORDER BY department_id, id"),
        "branches": await fetch_all(db, "SELECT * FROM branches ORDER BY id"),
        "gl_master": await fetch_all(db, "SELECT * FROM gl_master WHERE active ORDER BY gl_code"),
    }
