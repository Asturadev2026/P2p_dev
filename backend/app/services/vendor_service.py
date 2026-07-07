"""Vendor Management domain service: server-side verification orchestration and
the lifecycle state machine helpers. Verification is ALWAYS run server-side; the
public wizard never decides pass/fail. Results and integration reference ids are
persisted to vendor_verifications and summarised on the vendor row.
"""
import hashlib
import json
from datetime import date as _date
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_one, fetch_all, execute
from app.services import integration_service

# Documented vendor lifecycle
VENDOR_STATES = ("draft", "pending_compliance", "active", "rejected", "suspended")


def _ref(kind: str, detail: dict) -> str:
    """Deterministic stand-in for the reference id an integration returns.
    TODO: replace with the real provider reference id once integrations.mode = live."""
    seed = json.dumps(detail, sort_keys=True, default=str)
    return f"{kind.upper()}-{hashlib.sha256((kind + seed).encode()).hexdigest()[:10].upper()}"


async def _store(db: AsyncSession, onb_id: str, vendor_id: str, kind: str,
                 status: str, detail: dict):
    await execute(db, """
        INSERT INTO vendor_verifications (onb_id, vendor_id, kind, status, reference_id, detail)
        VALUES (:onb, :vid, :kind, :status, :ref, CAST(:detail AS jsonb))
    """, {"onb": onb_id, "vid": vendor_id, "kind": kind, "status": status,
          "ref": _ref(kind, detail), "detail": json.dumps(detail, default=str)})


async def run_verifications(db: AsyncSession, onb: dict, vendor_id: str) -> dict:
    """Run all applicable server-side checks for an onboarding record and persist them.
    Returns {gst, pan, msme, bank, dtaa} statuses (verified|pending|mismatch|failed|None).
    Business rules applied later at approval time — this only records outcomes."""
    payload = onb.get("kyc_payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload or "{}")
    bank = payload.get("bank") or {}
    results = {}
    udyam = {}

    # GST — mismatch is a WARNING, never an auto-fail
    if onb.get("gstin"):
        r = await integration_service.verify_gstin(db, onb["gstin"], onb["entity_name"])
        status = "verified" if r.get("valid") else "mismatch"
    else:
        r, status = {}, "pending"
    await _store(db, onb["id"], vendor_id, "gst", status, r)
    results["gst"] = status

    # PAN — mismatch is a WARNING
    if onb.get("pan"):
        r = await integration_service.verify_pan(db, onb["pan"], onb["entity_name"])
        status = "verified" if r.get("valid") else "mismatch"
    else:
        r, status = {}, "pending"
    await _store(db, onb["id"], vendor_id, "pan", status, r)
    results["pan"] = status

    # MSME (Udyam lookup) — informational
    if onb.get("pan"):
        r = await integration_service.check_udyam(db, onb["pan"])
        udyam = r
        status = "verified"
    else:
        r, status = {}, "pending"
    await _store(db, onb["id"], vendor_id, "msme", status, r)
    results["msme"] = status

    # Bank penny-drop — failure AUTO-BLOCKS activation (enforced at approve)
    acct = onb.get("account_no") or bank.get("account_no") or bank.get("acct_number")
    ifsc = onb.get("ifsc") or bank.get("ifsc")
    name = bank.get("account_name") or bank.get("acct_holder") or onb["entity_name"]
    if acct:
        r = await integration_service.penny_drop(db, acct, ifsc or "", name)
        status = "verified" if r.get("status") == "verified" else "failed"
    else:
        r, status = {}, "pending"
    await _store(db, onb["id"], vendor_id, "bank", status, r)
    results["bank"] = status

    # DTAA — foreign vendors only; missing/expired blocks activation (enforced at approve)
    dtaa_valid_till = None
    if onb.get("vendor_type") == "foreign":
        f = payload.get("foreign") or {}
        dtaa_valid_till = f.get("dtaa_valid_till") or f.get("valid_till")
        r = await integration_service.verify_dtaa(
            db, f.get("country", ""), f.get("trc_ref") or f.get("trc", ""),
            f.get("form_10f_ref") or f.get("form_10f", ""), bool(f.get("no_pe")), dtaa_valid_till)
        status = "verified" if r.get("valid") else "failed"
        await _store(db, onb["id"], vendor_id, "dtaa", status, r)
        results["dtaa"] = status
    else:
        results["dtaa"] = None

    # Parse DTAA validity into a real date (asyncpg needs a date object, not a str)
    dvt_val = None
    if dtaa_valid_till:
        try:
            dvt_val = _date.fromisoformat(str(dtaa_valid_till)[:10])
        except ValueError:
            dvt_val = None

    # Summarise on the vendor row + keep legacy *_verified booleans consistent
    await execute(db, """
        UPDATE vendors SET
            gst_status = :g, pan_status = :p, msme_status = :m, bank_status = :b, dtaa_status = :d,
            gstin_verified = (:g = 'verified'),
            pan_verified   = (:p = 'verified'),
            bank_verified  = (:b = 'verified'),
            is_msme       = COALESCE(:ismsme, is_msme),
            udyam_no      = COALESCE(:udyam_no, udyam_no),
            msme_category = COALESCE(:msme_cat, msme_category),
            dtaa_valid_till = COALESCE(:dvt, dtaa_valid_till)
        WHERE id = :vid
    """, {"g": results["gst"], "p": results["pan"], "m": results["msme"], "b": results["bank"],
          "d": results["dtaa"], "ismsme": udyam.get("is_msme"), "udyam_no": udyam.get("udyam_no"),
          "msme_cat": udyam.get("category"), "dvt": dvt_val, "vid": vendor_id})
    return results


def activation_blockers(vendor: dict) -> list[str]:
    """Business rules that BLOCK activation. GST/PAN mismatch are intentionally NOT
    here — Compliance decides on those. Returns a list of human-readable blockers."""
    blockers = []
    if vendor.get("bank_status") == "failed" and not vendor.get("bank_override_reason"):
        blockers.append("Bank penny-drop failed — admin override with reason required before activation.")
    if vendor.get("vendor_type") == "foreign" and vendor.get("dtaa_status") != "verified":
        blockers.append("DTAA documents missing or expired — foreign vendor cannot be activated.")
    return blockers
