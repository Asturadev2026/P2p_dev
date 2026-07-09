"""Onboarding initiation (Procurement) and the public token-based KYC endpoints
(no auth — the vendor uses a secure link).

Paths follow the business spec suffixes under the app's /api/v1 prefix:
  POST /api/v1/vendor-onboard/links          (Procurement initiates)
  GET  /api/v1/public/onboard/{token}        (vendor opens the form)
  POST /api/v1/public/onboard/{token}/submit (vendor submits KYC)
"""
import json
import secrets
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_one, execute
from app.core.security import require_roles
from app.core.config import get_settings
from app.services import integration_service, vendor_service, notification_service, email_service
from app.utils.audit import log_action

vendor_onboard = APIRouter(prefix="/vendor-onboard", tags=["vendor-onboarding"])
public = APIRouter(prefix="/public", tags=["public-onboarding"])


class LinkBody(BaseModel):
    email: str
    category_id: str | None = None
    sub_category_id: str | None = None
    vendor_type: str = "domestic"          # domestic | foreign
    entity_name: str | None = None          # optional at invite time; captured in the wizard
    link_validity_days: int = 7


async def _next_onb_id(db: AsyncSession) -> str:
    row = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM vendor_onboarding")
    return f"ONB-{date.today():%Y}-{row['n']:03d}"


@vendor_onboard.post("/links")
async def create_link(body: LinkBody, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(require_roles("procurement"))):
    """Procurement initiates onboarding: create tracker (status 'sent') + email a secure link."""
    onb_id = await _next_onb_id(db)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.link_validity_days)
    entity_name = body.entity_name or body.email.split("@")[0]

    await execute(db, """
        INSERT INTO vendor_onboarding (id, entity_name, vendor_type, contact_email,
            category_id, sub_category_id, onb_token, link_expires_at, link_sent_at, sent_by,
            link_validity_days, status, initiated_by, foreign_docs, kyc_payload)
        VALUES (:id, :en, :vt, :email, :cat, :sub, :tok, :exp, now(), :u, :vdays,
                'sent', :u, CAST('{}' AS jsonb), CAST('{}' AS jsonb))
    """, {"id": onb_id, "en": entity_name, "vt": body.vendor_type, "email": body.email,
          "cat": body.category_id, "sub": body.sub_category_id, "tok": token, "exp": expires_at,
          "u": user["sub"], "vdays": body.link_validity_days})

    settings = get_settings()
    kyc_url = f"{settings.frontend_url}/onboard/{token}"
    try:
        await email_service.send_onboarding_email(
            to_email=body.email, vendor_name=entity_name, kyc_url=kyc_url,
            subject="Vendor Onboarding Invitation", personal_message=(
                "Please complete your vendor onboarding (GST, PAN, bank, MSME "
                "and — for foreign vendors — DTAA documents) using the secure link below."),
            sent_by_name=user.get("name", "Procurement Team"), link_validity_days=body.link_validity_days)
        email_sent = True
    except Exception:
        # RESEND_API_KEY not configured yet — link still created; surface for manual sharing.
        email_sent = False

    await log_action(db, user["sub"], user["name"], "Sent onboarding link", "vendor_onboarding",
                     onb_id, f"{entity_name} · {body.email}")
    return {"id": onb_id, "status": "sent", "kyc_url": kyc_url,
            "expires_at": expires_at.isoformat(), "email_sent": email_sent}


def _public_context(onb: dict) -> dict:
    return {
        "id": onb["id"], "entity_name": onb["entity_name"], "trade_name": onb.get("trade_name"),
        "vendor_type": onb["vendor_type"], "constitution": onb.get("constitution"),
        "contact_name": onb.get("contact_name"), "contact_email": onb.get("contact_email"),
        "contact_phone": onb.get("contact_phone"), "category_id": onb.get("category_id"),
        "sub_category_id": onb.get("sub_category_id"), "status": onb["status"],
        "kyc_payload": onb.get("kyc_payload"),
    }


@public.get("/onboard/{token}")
async def open_onboard(token: str, db: AsyncSession = Depends(get_db)):
    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE onb_token = :t", {"t": token})
    if not onb:
        raise HTTPException(404, "Invalid or expired link")
    if onb.get("link_expires_at") and onb["link_expires_at"] < datetime.now(timezone.utc):
        await execute(db, "UPDATE vendor_onboarding SET status = 'link_expired', updated_at = now() WHERE id = :id",
                      {"id": onb["id"]})
        raise HTTPException(410, "This onboarding link has expired. Please request a new one.")
    if onb["status"] in ("sent", "link_sent"):
        await execute(db, "UPDATE vendor_onboarding SET status = 'opened', opened_at = now(), updated_at = now() WHERE id = :id",
                      {"id": onb["id"]})
        onb = {**onb, "status": "opened"}
    return _public_context(onb)


@public.post("/onboard/{token}/submit")
async def submit_onboard(token: str, payload: dict = Body(default={}), db: AsyncSession = Depends(get_db)):
    onb = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE onb_token = :t", {"t": token})
    if not onb:
        raise HTTPException(404, "Invalid or expired link")
    if onb["status"] in ("submitted", "submitted_for_review", "approved", "rejected"):
        raise HTTPException(400, "KYC already submitted for this link")

    p = payload or {}
    legal = p.get("legal_name") or p.get("entity_name") or onb["entity_name"]
    trade = p.get("trade_name") or onb.get("trade_name")
    pan = p.get("pan") or onb.get("pan")
    gstin = p.get("gstin") or onb.get("gstin")
    addresses = p.get("addresses") or []
    state = (addresses[0].get("state") if addresses and isinstance(addresses[0], dict) else None) \
        or p.get("state") or onb.get("state")
    foreign = p.get("foreign") or {}
    is_foreign = onb["vendor_type"] == "foreign"
    country = foreign.get("country") if is_foreign else "India"

    # Persist full KYC payload + core fields; advance tracker to 'submitted'
    await execute(db, """
        UPDATE vendor_onboarding SET entity_name = :en, trade_name = :tn, pan = :pan, gstin = :gstin,
            state = :state, kyc_payload = CAST(:kp AS jsonb), status = 'submitted',
            submitted_at = now(), updated_at = now()
        WHERE id = :id
    """, {"en": legal, "tn": trade, "pan": pan, "gstin": gstin, "state": state,
          "kp": json.dumps(p, default=str), "id": onb["id"]})

    # Create the vendor in pending_compliance (Draft -> Pending Compliance on submit)
    seq = await fetch_one(db, "SELECT COUNT(*) + 1000 AS n FROM vendors")
    vendor_id = f"V{seq['n']:04d}"
    await execute(db, """
        INSERT INTO vendors (id, name, vendor_type, gstin, pan, state, country, status, onboarding_id)
        VALUES (:id, :n, :vt, :g, :p, :st, :country, 'pending_compliance', :oid)
    """, {"id": vendor_id, "n": legal, "vt": onb["vendor_type"], "g": gstin, "p": pan,
          "st": state, "country": country or "India", "oid": onb["id"]})
    await execute(db, "UPDATE vendor_onboarding SET vendor_id = :v WHERE id = :id",
                  {"v": vendor_id, "id": onb["id"]})

    # Product catalog -> vendor_products, so Procurement's RFQ vendor matching can query
    # it directly instead of parsing kyc_payload JSON. Demo-safe: skips malformed rows.
    for item in (p.get("products_data") or []):
        if not isinstance(item, dict) or not item.get("name") or not item.get("category"):
            continue
        try:
            gst_rate = float(item["gst_rate"]) if item.get("gst_rate") not in (None, "") else None
        except (TypeError, ValueError):
            gst_rate = None
        try:
            basic_rate = float(item["basic_rate"]) if item.get("basic_rate") not in (None, "") else None
        except (TypeError, ValueError):
            basic_rate = None
        await execute(db, """
            INSERT INTO vendor_products (vendor_id, product_name, product_code, category, sub_category,
                                         uom, hsn_sac_code, gst_rate, basic_rate, payment_terms, status)
            VALUES (:v, :name, :code, :cat, :sub, :uom, :hsn, :gst, :rate, :terms, 'active')
        """, {"v": vendor_id, "name": item.get("name"), "code": item.get("sku"),
              "cat": item.get("category"), "sub": item.get("sub_category"), "uom": item.get("uom"),
              "hsn": item.get("hsn_sac"), "gst": gst_rate, "rate": basic_rate,
              "terms": item.get("payment_terms")})

    # Server-side verifications (GST/PAN/MSME/Bank/DTAA) — always run here
    fresh = await fetch_one(db, "SELECT * FROM vendor_onboarding WHERE id = :id", {"id": onb["id"]})
    results = await vendor_service.run_verifications(db, fresh, vendor_id)

    await log_action(db, None, legal, "Submitted KYC", "vendor_onboarding", onb["id"],
                     f"Vendor {vendor_id} -> pending_compliance", None, {"verifications": results})
    await notification_service.notify_role(db, "compliance", "Vendor pending compliance",
        f"{legal} ({vendor_id}) submitted KYC and awaits compliance review.", "vendors", vendor_id, "approval_pending")
    return {"success": True, "onboarding_id": onb["id"], "vendor_id": vendor_id, "verifications": results}
