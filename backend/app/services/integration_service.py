"""External service adapters — GST, PAN, Udyam, penny-drop, e-Sign/DSC,
bank payment file, ERP hand-off, IRP, GSTR-2B, TReDS.

Every adapter checks integrations.mode:
  simulated → deterministic realistic response (testing / demo)
  live      → calls the Intelezen-provided API at base_url (production)
Every call is written to sync_log either way.
"""
import json
import random
import hashlib
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_one, execute


async def _mode(db: AsyncSession, integration_id: str) -> dict:
    row = await fetch_one(db, "SELECT * FROM integrations WHERE id = :id", {"id": integration_id})
    return row or {"id": integration_id, "mode": "simulated", "base_url": None}


async def _log(db: AsyncSession, integration_id: str, direction: str, object_type: str,
               reference: str, request: dict, response: dict, result: str, simulated: bool):
    await execute(db, """
        INSERT INTO sync_log (integration_id, direction, object_type, reference, request, response, result, simulated)
        VALUES (:i, :d, :o, :r, CAST(:req AS jsonb), CAST(:res AS jsonb), :result, :sim)
    """, {"i": integration_id, "d": direction, "o": object_type, "r": reference,
          "req": json.dumps(request, default=str), "res": json.dumps(response, default=str),
          "result": result, "sim": simulated})


async def _call(db: AsyncSession, integration_id: str, object_type: str, reference: str,
                payload: dict, simulate_fn) -> dict:
    cfg = await _mode(db, integration_id)
    if cfg["mode"] == "live" and cfg.get("base_url"):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(f"{cfg['base_url'].rstrip('/')}/{object_type}", json=payload)
                response = r.json()
                result = "success" if r.status_code < 400 else "failed"
        except Exception as e:
            response, result = {"error": str(e)}, "failed"
        await _log(db, integration_id, "push", object_type, reference, payload, response, result, False)
        return response
    response = simulate_fn(payload)
    await _log(db, integration_id, "push", object_type, reference, payload, response, "success", True)
    return response


def _seed_from(value: str) -> random.Random:
    return random.Random(int(hashlib.sha256(value.encode()).hexdigest()[:8], 16))


# ---------- Verification adapters ----------

async def verify_gstin(db: AsyncSession, gstin: str, name: str = "") -> dict:
    def sim(p):
        ok = len(p["gstin"]) == 15
        return {"gstin": p["gstin"], "valid": ok, "status": "Active" if ok else "Invalid",
                "legal_name": p.get("name") or "—", "filing_status": "Regular · GSTR-3B filed",
                "last_filed_period": "2026-05"}
    return await _call(db, "gst_validation", "gstin_verify", gstin, {"gstin": gstin, "name": name}, sim)


async def verify_pan(db: AsyncSession, pan: str, name: str = "") -> dict:
    def sim(p):
        ok = len(p["pan"]) == 10
        return {"pan": p["pan"], "valid": ok, "name_on_pan": p.get("name") or "—",
                "status": "VALID" if ok else "INVALID", "aadhaar_seeded": ok}
    return await _call(db, "pan_verify", "pan_verify", pan, {"pan": pan, "name": name}, sim)


async def check_udyam(db: AsyncSession, pan: str) -> dict:
    def sim(p):
        rng = _seed_from(p["pan"])
        is_msme = rng.random() < 0.45
        return {"pan": p["pan"], "is_msme": is_msme,
                "udyam_no": f"UDYAM-PB-{rng.randint(1, 20):02d}-{rng.randint(1000000, 9999999):07d}" if is_msme else None,
                "category": rng.choice(["micro", "small"]) if is_msme else None}
    return await _call(db, "udyam", "udyam_lookup", pan, {"pan": pan}, sim)


async def penny_drop(db: AsyncSession, account_no: str, ifsc: str, expected_name: str) -> dict:
    def sim(p):
        return {"account_no": p["account_no"], "ifsc": p["ifsc"], "status": "verified",
                "amount": 1.00, "name_at_bank": p["expected_name"], "npci_name_match_pct": 100.0}
    return await _call(db, "penny_drop", "penny_drop", account_no,
                       {"account_no": account_no, "ifsc": ifsc, "expected_name": expected_name}, sim)


async def verify_dtaa(db: AsyncSession, country: str, trc_ref: str, form_10f_ref: str,
                      no_pe: bool, valid_till: str | None) -> dict:
    """Foreign-vendor DTAA document check. Returns status verified|pending|failed and a
    reference id. valid_till is an ISO date string; an expired or missing date fails."""
    def sim(p):
        from datetime import date as _date
        has_docs = bool(p["trc_ref"]) and bool(p["form_10f_ref"]) and bool(p["no_pe"])
        expired = False
        if p.get("valid_till"):
            try:
                expired = _date.fromisoformat(p["valid_till"][:10]) < _date.today()
            except ValueError:
                expired = True
        else:
            expired = True  # missing validity == not valid
        ok = has_docs and not expired
        return {"country": p["country"], "valid": ok,
                "status": "verified" if ok else ("failed" if not has_docs else "expired"),
                "trc_ref": p["trc_ref"], "form_10f_ref": p["form_10f_ref"],
                "no_pe": p["no_pe"], "valid_till": p.get("valid_till"), "expired": expired}
    return await _call(db, "dtaa", "dtaa_validate", country,
                       {"country": country, "trc_ref": trc_ref, "form_10f_ref": form_10f_ref,
                        "no_pe": no_pe, "valid_till": valid_till}, sim)


async def validate_irn(db: AsyncSession, irn: str, invoice_ref: str) -> dict:
    def sim(p):
        return {"irn": p["irn"], "status": "ACT", "valid": bool(p["irn"]),
                "qr_verified": bool(p["irn"])}
    return await _call(db, "irp", "irn_validate", invoice_ref, {"irn": irn}, sim)


async def esign_po(db: AsyncSession, po_id: str, signer: str) -> dict:
    def sim(p):
        return {"reference": f"ESIGN-{hashlib.sha256(p['po_id'].encode()).hexdigest()[:10].upper()}",
                "status": "signed", "method": "Class-3 DSC", "signer": p["signer"]}
    return await _call(db, "esign_dsc", "esign", po_id, {"po_id": po_id, "signer": signer}, sim)


# ---------- ERP & bank ----------

async def erp_push(db: AsyncSession, object_type: str, reference: str, payload: dict) -> dict:
    def sim(p):
        rng = _seed_from(reference)
        return {"status": "posted", "erp_doc_no": f"54{rng.randint(10000000, 99999999)}"}
    return await _call(db, "erp", object_type, reference, payload, sim)


async def capture_utr(db: AsyncSession, batch_id: str, items: list[dict]) -> list[dict]:
    """Simulated bank UTR feed: returns UTRs for each payout item."""
    def sim(p):
        out = []
        for it in p["items"]:
            rng = _seed_from(f"{p['batch_id']}{it['invoice_id']}")
            prefix = "R" if it.get("mode") == "RTGS" else "N"
            out.append({"invoice_id": it["invoice_id"],
                        "utr": f"{prefix}{rng.randint(10**14, 10**15 - 1)}", "status": "paid"})
        return {"items": out}
    res = await _call(db, "bank_payment_file", "utr_feed", batch_id,
                      {"batch_id": batch_id, "items": items}, sim)
    return res.get("items", [])
