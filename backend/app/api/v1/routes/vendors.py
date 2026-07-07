"""Vendor master, 360 view, and the 6-step onboarding pipeline."""
from datetime import date, datetime, timedelta, timezone
import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user, require_exact_roles, require_roles, deny_roles
from app.services import integration_service, vendor_service, notification_service, email_service
from app.utils.audit import log_action

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("")
async def list_vendors(msme_only: bool = False, include_inactive: bool = False,
                       db: AsyncSession = Depends(get_db),
                       user: dict = Depends(deny_roles("requester"))):
    # Default: active vendors only (used by pickers elsewhere). Vendor Master
    # passes include_inactive=true so its Active/Inactive/Foreign tabs work.
    where = "(NOT :msme OR v.is_msme)"
    if not include_inactive:
        where = "v.status = 'active' AND " + where
    return await fetch_all(db, f"""
        SELECT v.*, c.name AS category_name, d.name AS department_name,
               (SELECT COUNT(*) FROM invoices i WHERE i.vendor_id = v.id AND i.stage NOT IN ('paid','rejected')) AS open_invoices,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i WHERE i.vendor_id = v.id) AS spend_ytd,
               (SELECT COALESCE(SUM(i.net_payable), 0) FROM invoices i WHERE i.vendor_id = v.id AND i.stage NOT IN ('paid','rejected')) AS open_dues
        FROM vendors v
        LEFT JOIN spend_categories c ON c.id = v.category_id
        LEFT JOIN departments d ON d.id = v.department_id
        WHERE {where}
        ORDER BY spend_ytd DESC
    """, {"msme": msme_only})


@router.get("/{vendor_id}/v360")
async def vendor_360(vendor_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(deny_roles("requester"))):
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
async def list_onboarding(db: AsyncSession = Depends(get_db), user: dict = Depends(deny_roles("requester"))):
    return await fetch_all(db, """
        SELECT o.*, u.full_name AS initiated_by_name, sb.full_name AS sent_by_name
        FROM vendor_onboarding o
        LEFT JOIN users u ON u.id = o.initiated_by
        LEFT JOIN users sb ON sb.id = o.sent_by
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
                           user: dict = Depends(require_roles("procurement"))):
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


class SendLinkBody(BaseModel):
    entity_name: str
    trade_name: str | None = None
    vendor_type: str = "domestic"
    constitution: str | None = "Private Limited"
    category: str | None = None
    contact_email: str
    contact_phone: str | None = None
    contact_name: str | None = None
    link_validity_days: int = 7
    email_subject: str = "Vendor Onboarding Invitation"
    email_message: str | None = None


@router.post("/onboarding/send-link")
async def send_onboarding_link(body: SendLinkBody, db: AsyncSession = Depends(get_db),
                               user: dict = Depends(require_roles("procurement"))):
    from app.services import email_service
    from app.core.config import get_settings

    seq = await fetch_one(db, "SELECT COUNT(*) + 13 AS n FROM vendor_onboarding")
    onb_id = f"ONB-{date.today():%Y}-{seq['n']:02d}"
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.link_validity_days)

    import json
    await execute(db, """
        INSERT INTO vendor_onboarding (id, entity_name, trade_name, business_type, vendor_type,
            constitution, category, contact_name, contact_email, contact_phone,
            onb_token, link_expires_at, link_sent_at, sent_by, link_validity_days,
            status, initiated_by, foreign_docs)
        VALUES (:id, :en, :tn, 'pvt_ltd', :vt, :const, :cat, :cn, :ce, :cp,
                :tok, :exp, now(), :u, :vdays, 'link_sent', :u, CAST(:fd AS jsonb))
    """, {"id": onb_id, "en": body.entity_name, "tn": body.trade_name, "vt": body.vendor_type,
          "const": body.constitution, "cat": body.category, "cn": body.contact_name,
          "ce": body.contact_email, "cp": body.contact_phone, "tok": token,
          "exp": expires_at, "u": user["sub"], "vdays": body.link_validity_days, "fd": json.dumps({})})

    settings = get_settings()
    kyc_url = f"{settings.frontend_url}/kyc/{token}"
    msg = body.email_message or (
        f"Dear Partner,\n\nGreetings! Please complete the vendor onboarding process by clicking "
        f"the secure link below. The form takes around 8 minutes and you will need: GST certificate, "
        f"PAN, bank details (cancelled cheque), and MSME certificate (if applicable).\n\n"
        f"Warm regards,\n{user.get('name', 'Procurement Team')}"
    )
    await email_service.send_onboarding_email(
        to_email=body.contact_email,
        vendor_name=body.entity_name,
        kyc_url=kyc_url,
        subject=body.email_subject,
        personal_message=msg,
        sent_by_name=user.get("name", "Procurement Team"),
        link_validity_days=body.link_validity_days,
    )
    await log_action(db, user["sub"], user["name"], "Sent onboarding link",
                     "vendor_onboarding", onb_id, f"{body.entity_name} · {body.contact_email}")
    return {"id": onb_id, "kyc_url": kyc_url, "expires_at": expires_at.isoformat()}


@router.post("/onboarding/{onb_id}/resend-link")
async def resend_onboarding_link(onb_id: str, db: AsyncSession = Depends(get_db),
                                  user: dict = Depends(require_roles("procurement"))):
    from app.services import email_service
    from app.core.config import get_settings

    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE id = :id", {"id": onb_id})
    if not onb:
        raise HTTPException(404, "Onboarding record not found")
    if not onb.get("onb_token") or not onb.get("contact_email"):
        raise HTTPException(400, "No token or email on this record — use Send Link instead")

    new_expiry = datetime.now(timezone.utc) + timedelta(days=int(onb.get("link_validity_days") or 7))
    await execute(db, """
        UPDATE vendor_onboarding SET link_expires_at = :exp, link_sent_at = now(),
            status = 'link_sent', updated_at = now() WHERE id = :id
    """, {"exp": new_expiry, "id": onb_id})

    settings = get_settings()
    kyc_url = f"{settings.frontend_url}/kyc/{onb['onb_token']}"
    await email_service.send_onboarding_email(
        to_email=onb["contact_email"],
        vendor_name=onb["entity_name"],
        kyc_url=kyc_url,
        subject="Vendor Onboarding Invitation (Reminder)",
        personal_message="Please complete your vendor onboarding by clicking the secure link below.",
        sent_by_name=user.get("name", "Procurement Team"),
        link_validity_days=int(onb.get("link_validity_days") or 7),
    )
    await log_action(db, user["sub"], user["name"], "Resent onboarding link",
                     "vendor_onboarding", onb_id, onb["contact_email"])
    return {"id": onb_id, "resent": True}


# ---------- Public KYC endpoints (no auth — accessed by the vendor) ----------

@router.get("/kyc/{token}")
async def get_kyc_form(token: str, db: AsyncSession = Depends(get_db)):
    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE onb_token = :tok", {"tok": token})
    if not onb:
        raise HTTPException(404, "Invalid or expired link")
    if onb.get("link_expires_at") and onb["link_expires_at"] < datetime.now(timezone.utc):
        await execute(db, "UPDATE vendor_onboarding SET status = 'link_expired', updated_at = now() WHERE id = :id",
                      {"id": onb["id"]})
        raise HTTPException(410, "This onboarding link has expired. Please request a new one.")
    if onb["status"] == "link_sent":
        await execute(db, "UPDATE vendor_onboarding SET status = 'kyc_in_progress', updated_at = now() WHERE id = :id",
                      {"id": onb["id"]})
    return {
        "id": onb["id"],
        "entity_name": onb["entity_name"],
        "trade_name": onb.get("trade_name"),
        "vendor_type": onb["vendor_type"],
        "constitution": onb.get("constitution"),
        "contact_name": onb.get("contact_name"),
        "contact_email": onb.get("contact_email"),
        "contact_phone": onb.get("contact_phone"),
    }


class KycSubmitBody(BaseModel):
    pan: str | None = None
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    state: str | None = None


@router.post("/kyc/{token}/submit")
async def submit_kyc_form(token: str, body: KycSubmitBody, db: AsyncSession = Depends(get_db)):
    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE onb_token = :tok", {"tok": token})
    if not onb:
        raise HTTPException(404, "Invalid or expired link")
    if onb["status"] in ("submitted_for_review", "approved"):
        raise HTTPException(400, "KYC already submitted")
    await execute(db, """
        UPDATE vendor_onboarding SET
            pan = COALESCE(:pan, pan), gstin = COALESCE(:gstin, gstin),
            contact_name = COALESCE(:cn, contact_name), contact_phone = COALESCE(:cp, contact_phone),
            address = COALESCE(:addr, address), state = COALESCE(:st, state),
            status = 'submitted_for_review', updated_at = now()
        WHERE id = :id
    """, {"pan": body.pan, "gstin": body.gstin, "cn": body.contact_name,
          "cp": body.contact_phone, "addr": body.address, "st": body.state, "id": onb["id"]})
    return {"success": True, "message": "KYC submitted successfully. You will be contacted once reviewed."}


class StepBody(BaseModel):
    account_no: str | None = None
    ifsc: str | None = None
    account_name: str | None = None


@router.post("/onboarding/{onb_id}/advance")
async def advance_onboarding(onb_id: str, body: StepBody | None = None,
                             db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("procurement"))):
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


# ---------- Compliance decisions (Compliance Reviewer only) & dashboard ----------

class ReasonBody(BaseModel):
    reason: str = ""


async def _load_vendor(db: AsyncSession, vendor_id: str) -> dict:
    v = await fetch_one(db, "SELECT * FROM vendors WHERE id = :id", {"id": vendor_id})
    if not v:
        raise HTTPException(404, "Vendor not found")
    return v


async def _email_vendor_decision(db: AsyncSession, vendor: dict, decision: str, actor: str, reason: str = ""):
    """Best-effort approval/rejection email to the vendor contact. No-op (logged) if
    RESEND_API_KEY is not configured yet."""
    if not vendor.get("onboarding_id"):
        return
    onb = await fetch_one(db, "SELECT contact_email FROM vendor_onboarding WHERE id = :id",
                          {"id": vendor["onboarding_id"]})
    if onb and onb.get("contact_email"):
        try:
            await email_service.send_decision_email(onb["contact_email"], vendor["name"], decision, reason, actor)
        except Exception:
            pass  # email optional until RESEND_API_KEY is set; in-app notification already recorded


@router.get("/compliance/queue")
async def compliance_queue(db: AsyncSession = Depends(get_db),
                           user: dict = Depends(require_roles("compliance"))):
    """Vendors awaiting a compliance decision, with verification summary + submission date."""
    return await fetch_all(db, """
        SELECT v.id, v.name, v.vendor_type, v.gstin, v.pan, v.state, v.status,
               v.gst_status, v.pan_status, v.msme_status, v.bank_status, v.dtaa_status,
               v.bank_override_reason, v.dtaa_valid_till, v.onboarding_id,
               o.submitted_at, o.contact_email
        FROM vendors v
        LEFT JOIN vendor_onboarding o ON o.id = v.onboarding_id
        WHERE v.status = 'pending_compliance'
        ORDER BY o.submitted_at NULLS LAST, v.created_at
    """)


@router.get("/compliance/stats")
async def compliance_stats(db: AsyncSession = Depends(get_db),
                           user: dict = Depends(require_roles("compliance"))):
    return await fetch_one(db, """
        SELECT
          (SELECT COUNT(*) FROM vendors WHERE status = 'pending_compliance') AS pending,
          (SELECT COUNT(*) FROM vendors WHERE status = 'active'   AND approved_at::date = CURRENT_DATE) AS approved_today,
          (SELECT COUNT(*) FROM vendors WHERE status = 'rejected' AND rejected_at::date = CURRENT_DATE) AS rejected_today,
          (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (v.approved_at - o.submitted_at)) / 3600.0)::numeric, 1)
             FROM vendors v JOIN vendor_onboarding o ON o.id = v.onboarding_id
             WHERE v.approved_at IS NOT NULL AND o.submitted_at IS NOT NULL) AS avg_hours
    """)


@router.get("/{vendor_id}/verifications")
async def get_vendor_verifications(vendor_id: str, db: AsyncSession = Depends(get_db),
                                   user: dict = Depends(deny_roles("requester"))):
    return await fetch_all(db, """
        SELECT kind, status, reference_id, detail, checked_at
        FROM vendor_verifications WHERE vendor_id = :id ORDER BY checked_at
    """, {"id": vendor_id})


@router.get("/{vendor_id}/detail")
async def vendor_detail(vendor_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(deny_roles("requester"))):
    """Full vendor record for the detail page: profile, onboarding KYC payload
    (addresses/contacts/sub-vendors/foreign/agreement), verifications, and audit trail."""
    vendor = await fetch_one(db, """
        SELECT v.*, c.name AS category_name, d.name AS department_name
        FROM vendors v
        LEFT JOIN spend_categories c ON c.id = v.category_id
        LEFT JOIN departments d ON d.id = v.department_id
        WHERE v.id = :id
    """, {"id": vendor_id})
    if not vendor:
        raise HTTPException(404, "Vendor not found")

    onboarding = None
    if vendor.get("onboarding_id"):
        onboarding = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE id = :id",
                                     {"id": vendor["onboarding_id"]})
        if onboarding and isinstance(onboarding.get("kyc_payload"), str):
            import json as _json
            try:
                onboarding["kyc_payload"] = _json.loads(onboarding["kyc_payload"] or "{}")
            except ValueError:
                onboarding["kyc_payload"] = {}

    verifications = await fetch_all(db, """
        SELECT kind, status, reference_id, detail, checked_at
        FROM vendor_verifications WHERE vendor_id = :id ORDER BY checked_at
    """, {"id": vendor_id})

    if vendor.get("onboarding_id"):
        audit = await fetch_all(db, """
            SELECT actor_name, action, detail, before_state, after_state, at
            FROM audit_log WHERE entity_id IN (:vid, :oid) ORDER BY at DESC LIMIT 100
        """, {"vid": vendor_id, "oid": vendor["onboarding_id"]})
    else:
        audit = await fetch_all(db, """
            SELECT actor_name, action, detail, before_state, after_state, at
            FROM audit_log WHERE entity_id = :vid ORDER BY at DESC LIMIT 100
        """, {"vid": vendor_id})

    return {"vendor": vendor, "onboarding": onboarding,
            "verifications": verifications, "audit": audit}


@router.post("/{vendor_id}/approve")
async def approve_vendor(vendor_id: str, db: AsyncSession = Depends(get_db),
                         user: dict = Depends(require_exact_roles("compliance"))):
    v = await _load_vendor(db, vendor_id)
    if v["status"] != "pending_compliance":
        raise HTTPException(409, f"Vendor is '{v['status']}', not pending_compliance")
    blockers = vendor_service.activation_blockers(v)
    if blockers:
        raise HTTPException(409, "; ".join(blockers))
    await execute(db, "UPDATE vendors SET status = 'active', approved_by = :u, approved_at = now() WHERE id = :id",
                  {"u": user["sub"], "id": vendor_id})
    if v.get("onboarding_id"):
        await execute(db, """
            UPDATE vendor_onboarding SET status = 'approved', approved_by = :u, approved_at = now(),
                updated_at = now() WHERE id = :oid
        """, {"u": user["sub"], "oid": v["onboarding_id"]})
    await log_action(db, user["sub"], user["name"], "Approved vendor", "vendors", vendor_id,
                     "Compliance activation", {"status": v["status"]}, {"status": "active"})
    await notification_service.notify_role(db, "procurement", "Vendor activated",
        f"{v['name']} ({vendor_id}) approved by compliance and is now active.", "vendors", vendor_id, "info")
    await _email_vendor_decision(db, v, "approved", user["name"])
    return {"id": vendor_id, "status": "active"}


@router.post("/{vendor_id}/reject")
async def reject_vendor(vendor_id: str, body: ReasonBody, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(require_exact_roles("compliance"))):
    if not body.reason.strip():
        raise HTTPException(400, "Rejection reason is mandatory")
    v = await _load_vendor(db, vendor_id)
    if v["status"] not in ("pending_compliance", "draft"):
        raise HTTPException(409, f"Vendor is '{v['status']}' and cannot be rejected")
    await execute(db, """
        UPDATE vendors SET status = 'rejected', rejected_by = :u, rejected_reason = :r, rejected_at = now()
        WHERE id = :id
    """, {"u": user["sub"], "r": body.reason.strip(), "id": vendor_id})
    if v.get("onboarding_id"):
        await execute(db, """
            UPDATE vendor_onboarding SET status = 'rejected', rejected_by = :u, rejected_reason = :r,
                rejected_at = now(), updated_at = now() WHERE id = :oid
        """, {"u": user["sub"], "r": body.reason.strip(), "oid": v["onboarding_id"]})
    await log_action(db, user["sub"], user["name"], "Rejected vendor", "vendors", vendor_id,
                     body.reason.strip(), {"status": v["status"]}, {"status": "rejected"})
    await notification_service.notify_role(db, "procurement", "Vendor rejected",
        f"{v['name']} ({vendor_id}) rejected by compliance: {body.reason.strip()}", "vendors", vendor_id, "escalation")
    await _email_vendor_decision(db, v, "rejected", user["name"], body.reason.strip())
    return {"id": vendor_id, "status": "rejected"}


@router.post("/{vendor_id}/suspend")
async def suspend_vendor(vendor_id: str, body: ReasonBody, db: AsyncSession = Depends(get_db),
                         user: dict = Depends(require_exact_roles("compliance"))):
    if not body.reason.strip():
        raise HTTPException(400, "Suspension reason is mandatory")
    v = await _load_vendor(db, vendor_id)
    if v["status"] != "active":
        raise HTTPException(409, f"Only active vendors can be suspended (is '{v['status']}')")
    await execute(db, """
        UPDATE vendors SET status = 'suspended', suspended_by = :u, suspended_reason = :r, suspended_at = now()
        WHERE id = :id
    """, {"u": user["sub"], "r": body.reason.strip(), "id": vendor_id})
    await log_action(db, user["sub"], user["name"], "Suspended vendor", "vendors", vendor_id,
                     body.reason.strip(), {"status": "active"}, {"status": "suspended"})
    await notification_service.notify_role(db, "procurement", "Vendor suspended",
        f"{v['name']} ({vendor_id}) suspended: {body.reason.strip()}. Cannot receive new POs.", "vendors", vendor_id, "escalation")
    return {"id": vendor_id, "status": "suspended"}


@router.post("/{vendor_id}/resume")
async def resume_vendor(vendor_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(require_exact_roles("compliance"))):
    v = await _load_vendor(db, vendor_id)
    if v["status"] != "suspended":
        raise HTTPException(409, f"Only suspended vendors can be resumed (is '{v['status']}')")
    await execute(db, """
        UPDATE vendors SET status = 'active', suspended_by = NULL, suspended_reason = NULL, suspended_at = NULL
        WHERE id = :id
    """, {"id": vendor_id})
    await log_action(db, user["sub"], user["name"], "Resumed vendor", "vendors", vendor_id,
                     "Suspension lifted", {"status": "suspended"}, {"status": "active"})
    return {"id": vendor_id, "status": "active"}


@router.post("/{vendor_id}/bank-override")
async def bank_override(vendor_id: str, body: ReasonBody, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(require_exact_roles("admin"))):
    """Admin override for a failed penny-drop (reason mandatory). Does not activate —
    Compliance still approves."""
    if not body.reason.strip():
        raise HTTPException(400, "Override reason is mandatory")
    v = await _load_vendor(db, vendor_id)
    await execute(db, "UPDATE vendors SET bank_override_reason = :r, bank_override_by = :u WHERE id = :id",
                  {"r": body.reason.strip(), "u": user["sub"], "id": vendor_id})
    await log_action(db, user["sub"], user["name"], "Bank verification override", "vendors", vendor_id,
                     body.reason.strip(), {"bank_status": v.get("bank_status")}, {"bank_override": True})
    return {"id": vendor_id, "bank_override_reason": body.reason.strip()}


@router.post("/compliance/dtaa-expiry-scan")
async def dtaa_expiry_scan(db: AsyncSession = Depends(get_db),
                           user: dict = Depends(require_roles("compliance"))):
    """Flag active foreign vendors whose DTAA docs are missing, expired, or expiring within
    30 days, and raise a compliance reminder for each. Intended to be run daily by a
    scheduler. TODO: wire to a cron/scheduler once one is available."""
    rows = await fetch_all(db, """
        SELECT id, name, dtaa_valid_till FROM vendors
        WHERE vendor_type = 'foreign' AND status = 'active'
          AND (dtaa_valid_till IS NULL OR dtaa_valid_till <= CURRENT_DATE + INTERVAL '30 days')
        ORDER BY dtaa_valid_till NULLS FIRST
    """)
    today = date.today()
    for r in rows:
        till = r["dtaa_valid_till"]
        if not till:
            msg = f"DTAA validity missing for {r['name']} ({r['id']})."
        elif till < today:
            msg = f"DTAA for {r['name']} ({r['id']}) expired on {till}."
        else:
            msg = f"DTAA for {r['name']} ({r['id']}) expires on {till}."
        await notification_service.notify_role(db, "compliance", "DTAA expiry reminder",
                                               msg, "vendors", r["id"], "reminder")
    await log_action(db, user["sub"], user["name"], "DTAA expiry scan", "vendors", None,
                     f"{len(rows)} vendor(s) flagged")
    return {"flagged": len(rows), "vendors": rows}
