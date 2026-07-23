"""Invoice management — capture (OCR), pipeline, 3-way match, GST 2B, TDS, stage moves."""
import hashlib
import json
import random
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user, deny_roles, require_exact_roles
from app.services import match_engine, tax_engine, approval_engine, ai_agents, integration_service
from app.utils.audit import log_action

# Requesters raise PRs only — no access to the AP invoice pipeline (capture through approval).
router = APIRouter(prefix="/invoices", tags=["invoices"],
                   dependencies=[Depends(deny_roles("requester", message="Requesters have no access to invoices"))])

STAGE_ORDER = ["capture", "match", "gst2b", "tds", "approval", "liability", "payments", "paid"]

# Only AP Maker performs Capture Inbox write actions (upload/paste/OCR/draft/send-to-match) —
# view access for other internal roles is handled by the plain get_current_user reads.
_MAKER_ONLY = require_exact_roles("maker", message="Only AP Maker can perform Capture Inbox actions.")

# 3-Way Match write actions: Maker runs the match and forwards clean results; Checker
# reviews/clears exceptions and sends mismatches back. View access for other internal
# roles is handled by the plain get_current_user reads.
_MATCH_ACTION_MSG = "You do not have permission for this 3-Way Match action."
_MATCH_MAKER_ONLY = require_exact_roles("maker", message=_MATCH_ACTION_MSG)
_MATCH_CHECKER_ONLY = require_exact_roles("checker", message=_MATCH_ACTION_MSG)
_MATCH_MAKER_OR_CHECKER = require_exact_roles("maker", "checker", message=_MATCH_ACTION_MSG)

# GST 2B Recon write actions: Maker preps/syncs and forwards clean records; Compliance
# reviews mismatch/ITC issues and clears them. View access for other internal roles is
# handled by the plain get_current_user reads.
_GST2B_ACTION_MSG = "You do not have permission for this GST 2B action."
_GST2B_COMPLIANCE_ONLY = require_exact_roles("compliance", message=_GST2B_ACTION_MSG)
_GST2B_MAKER_OR_COMPLIANCE = require_exact_roles("maker", "compliance", message=_GST2B_ACTION_MSG)

# TDS Engine write actions: Maker computes/saves/sends clean TDS at the standard rate;
# Compliance only steps in to override a section/rate exception, then saves/sends after
# resolving it. View access for other internal roles is handled by the plain
# get_current_user reads.
_TDS_ACTION_MSG = "You do not have permission for this TDS Engine action."
_TDS_MAKER_ONLY = require_exact_roles("maker", message=_TDS_ACTION_MSG)
_TDS_COMPLIANCE_ONLY = require_exact_roles("compliance", message=_TDS_ACTION_MSG)
_TDS_MAKER_OR_COMPLIANCE = require_exact_roles("maker", "compliance", message=_TDS_ACTION_MSG)


_PAYMENTS_QUEUE_ROLES = ("treasury", "fc", "cfo", "auditor")


@router.get("")
async def list_invoices(stage: str | None = None, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    if stage == "payments" and user["role"] not in _PAYMENTS_QUEUE_ROLES:
        raise HTTPException(403, "You do not have permission to view Payment Batch.")
    return await fetch_all(db, """
        SELECT i.*, v.name AS vendor_name, v.is_msme, v.gstin AS vendor_gstin
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE (CAST(:stage AS TEXT) IS NULL OR i.stage = :stage)
        ORDER BY i.captured_at DESC
    """, {"stage": stage})


@router.get("/{invoice_id}/trace")
async def invoice_trace(invoice_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    inv = await fetch_one(db, """
        SELECT i.*, v.name AS vendor_name, v.is_msme, v.gstin AS vendor_gstin
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    history = await fetch_all(db, """
        SELECT h.*, u.full_name AS actor_name FROM invoice_stage_history h
        LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.invoice_id = :id ORDER BY h.at
    """, {"id": invoice_id})
    approvals = await fetch_all(db, """
        SELECT a.*, u.full_name AS assigned_name, au.full_name AS acted_name FROM approvals a
        LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN users au ON au.id = a.acted_by
        WHERE a.entity_type = 'invoice' AND a.entity_id = :id ORDER BY a.stage_no
    """, {"id": invoice_id})
    audit = await fetch_all(db, """
        SELECT actor_name, action, detail, at FROM audit_log
        WHERE entity_id = :id ORDER BY at DESC LIMIT 25
    """, {"id": invoice_id})
    lines = await fetch_all(db, "SELECT * FROM invoice_lines WHERE invoice_id = :id", {"id": invoice_id})
    return {**inv, "stage_history": history, "approvals": approvals, "audit": audit, "lines": lines}


class CaptureBody(BaseModel):
    raw_text: str
    source: str = "manual"
    vendor_id: str | None = None
    po_id: str | None = None
    preview: bool = False


async def _resolve_vendor(db: AsyncSession, extract: dict, vendor_id: str | None):
    if vendor_id:
        return await fetch_one(db, "SELECT * FROM vendors WHERE id = :id", {"id": vendor_id})
    if extract.get("vendor_gstin"):
        v = await fetch_one(db, "SELECT * FROM vendors WHERE gstin = :g", {"g": extract["vendor_gstin"]})
        if v:
            return v
    if extract.get("vendor_name"):
        return await fetch_one(db, "SELECT * FROM vendors WHERE name ILIKE :n",
                               {"n": f"%{extract['vendor_name'][:20]}%"})
    return None


def _validate_extract(extract: dict, vendor: dict | None) -> list[str]:
    """Mandatory-field gate: capture is blocked until each of these is readable."""
    missing = []
    if str(extract.get("note", "")).startswith("AI unavailable"):
        missing.append("OCR engine unavailable — nothing could be extracted")
        return missing
    if not vendor:
        missing.append("Vendor — GSTIN/name not recognised against the vendor master")
    if not extract.get("vendor_invoice_no"):
        missing.append("Vendor invoice number")
    inv_date = extract.get("invoice_date")
    if inv_date:
        try:
            date.fromisoformat(str(inv_date))
        except ValueError:
            inv_date = None
    if not inv_date:
        missing.append("Invoice date")
    taxable = float(extract.get("taxable_amount") or 0)
    total = float(extract.get("total_amount") or 0)
    if taxable <= 0 and total <= 0:
        missing.append("Taxable / total amount")
    return missing


async def _preview_capture(db: AsyncSession, extract: dict, vendor_id: str | None) -> dict:
    """OCR-only preview for the Capture Inbox review step: extract + best-guess
    vendor + a soft duplicate hint. Nothing is written to the database."""
    vendor = await _resolve_vendor(db, extract, vendor_id)
    duplicate = None
    if vendor and extract.get("vendor_invoice_no"):
        duplicate = await match_engine.check_duplicate(db, vendor["id"], extract["vendor_invoice_no"])
    if extract.get("irn"):
        irn_res = await integration_service.validate_irn(db, extract["irn"], "(preview)")
        extract = {**extract, "irn_status": "validated" if irn_res.get("valid") else "failed"}
    elif not extract.get("irn_status"):
        extract = {**extract, "irn_status": "not_applicable"}
    return {
        "status": "preview",
        "extract": extract,
        "vendor": {"id": vendor["id"], "name": vendor["name"], "gstin": vendor["gstin"]} if vendor else None,
        "duplicate": duplicate,
    }


async def _finalise_capture(db: AsyncSession, user: dict, extract: dict, source: str,
                            vendor: dict, po_id: str | None, filename: str | None = None) -> dict:
    """Duplicate-check, tax-compute, IRN-validate and create the invoice at 'capture'."""
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM invoices WHERE id LIKE :p",
                          {"p": f"INV-{date.today():%Y-%m}-%"})
    inv_id = f"INV-{date.today():%Y-%m}-{seq['n']:04d}"

    vendor_inv_no = extract["vendor_invoice_no"]
    dup = await match_engine.check_duplicate(db, vendor["id"], vendor_inv_no)
    if dup:
        await log_action(db, user["sub"], user["name"], "Duplicate invoice blocked", "invoice", dup["id"],
                         f"Vendor {vendor['id']} re-submitted {vendor_inv_no} — blocked at source")
        raise HTTPException(409, f"Duplicate blocked: {vendor_inv_no} already captured as {dup['id']} (stage: {dup['stage']})")

    gst_rate = float(extract.get("gst_rate") or 18)
    taxable = float(extract.get("taxable_amount") or 0)
    if taxable <= 0:
        taxable = round(float(extract.get("total_amount") or 0) / (1 + gst_rate / 100), 2)
    tax = await tax_engine.compute(db, taxable, gst_rate, vendor["state"], vendor["tds_section"])
    if filename:
        extract = {**extract, "source_file": filename}

    irn = extract.get("irn")
    irn_status = "pending"
    if irn:
        irn_res = await integration_service.validate_irn(db, irn, inv_id)
        irn_status = "validated" if irn_res.get("valid") else "failed"
    else:
        irn_status = "not_applicable"

    inv_date = date.fromisoformat(str(extract["invoice_date"]))
    msme_due = inv_date + timedelta(days=45) if vendor["is_msme"] else None

    await execute(db, """
        INSERT INTO invoices (id, vendor_invoice_no, vendor_id, po_id, department_id, category_id,
            invoice_date, due_date, source, taxable_amount, cgst, sgst, igst, rcm_applicable, rcm_liability,
            total_amount, tds_section, tds_rate, tds_amount, net_payable, irn, irn_status,
            ocr_confidence, ocr_extract, stage, msme_due_date)
        VALUES (:id, :vin, :v, :po, :dept, :cat, :idate, :ddate, :src, :taxable, :cgst, :sgst, :igst,
                :rcm, :rcml, :total, :tsec, :trate, :tamt, :net, :irn, :irns, :conf,
                CAST(:extract AS jsonb), 'capture', :msme_due)
    """, {"id": inv_id, "vin": vendor_inv_no, "v": vendor["id"], "po": po_id,
          "dept": vendor["department_id"], "cat": vendor["category_id"],
          "idate": inv_date, "ddate": inv_date + timedelta(days=vendor["payment_terms_days"]),
          "src": source, "taxable": taxable, "cgst": tax["cgst"], "sgst": tax["sgst"],
          "igst": tax["igst"], "rcm": tax["rcm_applicable"], "rcml": tax["rcm_liability"],
          "total": tax["total_amount"], "tsec": tax["tds_section"], "trate": tax["tds_rate"],
          "tamt": tax["tds_amount"], "net": tax["net_payable"], "irn": irn, "irns": irn_status,
          "conf": extract.get("confidence"), "extract": json.dumps(extract, default=str),
          "msme_due": msme_due})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, to_stage, actor_id, note)
        VALUES (:id, 'capture', :u, :n)
    """, {"id": inv_id, "u": user["sub"], "n": f"Captured via {source} · OCR {extract.get('confidence')}%"})
    await log_action(db, user["sub"], user["name"], "Captured invoice", "invoice", inv_id,
                     f"{vendor['name']} · ₹{tax['total_amount']:,.0f} · {source} · OCR {extract.get('confidence')}% · IRN {irn_status}")

    warnings = []
    qc = await fetch_one(db, "SELECT value FROM configuration WHERE key = 'ocr_qc_confidence_pct'")
    threshold = float(qc["value"]) if qc else 85.0
    if float(extract.get("confidence") or 0) < threshold:
        warnings.append(f"OCR confidence {extract.get('confidence')}% is below the {threshold:.0f}% QC threshold — manual QC required")

    return {"status": "captured", "id": inv_id, "extract": extract, "tax": tax,
            "irn_status": irn_status, "warnings": warnings,
            "vendor": {"id": vendor["id"], "name": vendor["name"]}}


async def _capture_pipeline(db: AsyncSession, user: dict, extract: dict, source: str,
                            vendor_id: str | None, po_id: str | None,
                            filename: str | None = None) -> dict:
    """Resolve vendor → validate mandatory fields → finalise, or reject with the missing list."""
    vendor = await _resolve_vendor(db, extract, vendor_id)
    missing = _validate_extract(extract, vendor)
    if missing:
        await log_action(db, user["sub"], user["name"], "Capture blocked — mandatory details missing",
                         "invoice", filename or "(text capture)",
                         f"Missing: {'; '.join(missing)} · OCR confidence {extract.get('confidence')}%")
        return {"status": "rejected", "missing": missing,
                "confidence": extract.get("confidence"), "extract": extract}
    return await _finalise_capture(db, user, extract, source, vendor, po_id, filename)


@router.post("/capture")
async def capture_invoice(body: CaptureBody, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(_MAKER_ONLY)):
    """Text capture: OCR-extract, validate mandatory fields, create at 'capture'.
    preview=True stops after extraction so the Capture Inbox review step can
    show editable fields before anything is written to the database."""
    extract = await ai_agents.extract_invoice(db, "(pending)", body.raw_text)
    if body.preview:
        return await _preview_capture(db, extract, body.vendor_id)
    return await _capture_pipeline(db, user, extract, body.source, body.vendor_id, body.po_id)


@router.post("/capture-file")
async def capture_invoice_file(file: UploadFile = File(...), source: str = Form("scan"),
                               vendor_id: str | None = Form(None), po_id: str | None = Form(None),
                               preview: bool = Form(False),
                               db: AsyncSession = Depends(get_db),
                               user: dict = Depends(_MAKER_ONLY)):
    """Upload capture: PDF (text layer), image (GPT-4o vision), or plain text."""
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "File exceeds the 10 MB upload limit")
    name = (file.filename or "upload").lower()
    ctype = file.content_type or ""

    if ctype.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        extract = await ai_agents.extract_invoice_image(db, name, data, ctype or "image/png")
    elif ctype == "application/pdf" or name.endswith(".pdf"):
        import io
        from pypdf import PdfReader
        try:
            text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
        except Exception:
            text = ""
        if len(text.strip()) < 40:
            await log_action(db, user["sub"], user["name"], "Capture blocked — unreadable PDF",
                             "invoice", file.filename, "No text layer found (scanned PDF?)")
            return {"status": "rejected", "confidence": 0,
                    "missing": ["Readable text — this PDF has no text layer (scanned copy?). "
                                "Upload it as an image (PNG/JPG) so vision OCR can read it."]}
        extract = await ai_agents.extract_invoice(db, name, text)
    else:
        try:
            extract = await ai_agents.extract_invoice(db, name, data.decode("utf-8", errors="ignore"))
        except Exception:
            return {"status": "rejected", "confidence": 0,
                    "missing": ["Unsupported file type — upload PDF, PNG, JPG, or a text file"]}

    if preview:
        return await _preview_capture(db, extract, vendor_id)
    return await _capture_pipeline(db, user, extract, source, vendor_id, po_id, file.filename)


class CaptureConfirmBody(BaseModel):
    vendor_id: str
    vendor_invoice_no: str
    invoice_date: str
    po_id: str | None = None
    taxable_amount: float = 0
    gst_amount: float = 0
    total_amount: float | None = None
    ocr_confidence: float | None = None
    irn_status: str = "not_applicable"
    irn: str | None = None
    remarks: str | None = None
    source: str = "manual"
    action: str  # save | draft | send_to_match
    force_duplicate: bool = False


@router.post("/capture-confirm")
async def capture_confirm(body: CaptureConfirmBody, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(_MAKER_ONLY)):
    """Persist an invoice from the Capture Inbox review step, once the user has
    verified/edited the OCR-extracted fields. `action` decides where it lands:
    save -> captured, draft -> draft, send_to_match -> straight into the
    3-Way Match queue (stage moves to 'match')."""
    if body.action not in ("save", "draft", "send_to_match"):
        raise HTTPException(400, "action must be one of: save, draft, send_to_match")
    if not body.vendor_invoice_no.strip():
        raise HTTPException(400, "Vendor invoice number is required")

    vendor = await fetch_one(db, "SELECT * FROM vendors WHERE id = :id", {"id": body.vendor_id})
    if not vendor:
        raise HTTPException(404, "Vendor not found")

    try:
        inv_date = date.fromisoformat(body.invoice_date)
    except ValueError:
        raise HTTPException(400, "Invoice date must be YYYY-MM-DD")

    if body.po_id:
        po = await fetch_one(db, "SELECT id FROM purchase_orders WHERE id = :id", {"id": body.po_id})
        if not po:
            raise HTTPException(400, f"PO {body.po_id} not found")

    dup = await match_engine.check_duplicate(db, body.vendor_id, body.vendor_invoice_no)
    if dup and not body.force_duplicate:
        return {"status": "duplicate_warning", "existing": dup}

    gst = tax_engine.split_gst_from_amount(body.gst_amount, vendor["state"])
    rates = await tax_engine.get_tds_rates(db)
    tds_rate = float(rates.get(vendor["tds_section"], 0)) if vendor["tds_section"] else 0.0
    tds_amount = round(float(body.taxable_amount) * tds_rate / 100, 2)
    total_amount = (body.total_amount if body.total_amount is not None
                    else round(float(body.taxable_amount) + gst["gst_total"], 2))
    net_payable = round(float(body.taxable_amount) + gst["gst_total"] - tds_amount, 2)

    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM invoices WHERE id LIKE :p",
                          {"p": f"INV-{date.today():%Y-%m}-%"})
    inv_id = f"INV-{date.today():%Y-%m}-{seq['n']:04d}"
    msme_due = inv_date + timedelta(days=45) if vendor["is_msme"] else None
    capture_status = {"save": "captured", "draft": "draft", "send_to_match": "match_pending"}[body.action]
    stage = "match" if body.action == "send_to_match" else "capture"

    extract_record = {
        "vendor_invoice_no": body.vendor_invoice_no, "invoice_date": body.invoice_date,
        "taxable_amount": body.taxable_amount, "gst_amount": body.gst_amount,
        "total_amount": total_amount, "confidence": body.ocr_confidence,
        "irn": body.irn, "remarks": body.remarks, "reviewed_by": user["name"],
    }

    await execute(db, """
        INSERT INTO invoices (id, vendor_invoice_no, vendor_id, po_id, department_id, category_id,
            invoice_date, due_date, source, taxable_amount, cgst, sgst, igst,
            total_amount, tds_section, tds_rate, tds_amount, net_payable, irn, irn_status,
            ocr_confidence, ocr_extract, stage, capture_status, msme_due_date)
        VALUES (:id, :vin, :v, :po, :dept, :cat, :idate, :ddate, :src, :taxable, :cgst, :sgst, :igst,
                :total, :tsec, :trate, :tamt, :net, :irn, :irns, :conf,
                CAST(:extract AS jsonb), :stage, :cstatus, :msme_due)
    """, {"id": inv_id, "vin": body.vendor_invoice_no, "v": vendor["id"], "po": body.po_id,
          "dept": vendor["department_id"], "cat": vendor["category_id"],
          "idate": inv_date, "ddate": inv_date + timedelta(days=vendor["payment_terms_days"]),
          "src": body.source, "taxable": body.taxable_amount, "cgst": gst["cgst"], "sgst": gst["sgst"],
          "igst": gst["igst"], "total": total_amount, "tsec": vendor["tds_section"], "trate": tds_rate,
          "tamt": tds_amount, "net": net_payable, "irn": body.irn, "irns": body.irn_status,
          "conf": body.ocr_confidence, "extract": json.dumps(extract_record, default=str),
          "stage": stage, "cstatus": capture_status, "msme_due": msme_due})

    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, to_stage, actor_id, note)
        VALUES (:id, 'capture', :u, :n)
    """, {"id": inv_id, "u": user["sub"], "n": f"Captured via {body.source} · reviewed in Capture Inbox"})
    if stage == "match":
        await execute(db, """
            INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
            VALUES (:id, 'capture', 'match', :u, 'Sent to 3-Way Match from Capture Inbox')
        """, {"id": inv_id, "u": user["sub"]})

    action_label = {"save": "Captured invoice", "draft": "Created invoice draft",
                    "send_to_match": "Sent invoice to 3-Way Match"}[body.action]
    await log_action(db, user["sub"], user["name"], action_label, "invoice", inv_id,
                     f"{vendor['name']} · {body.vendor_invoice_no} · ₹{total_amount:,.0f}"
                     + (f" · {body.remarks}" if body.remarks else ""))

    return {"status": capture_status, "id": inv_id, "stage": stage, "capture_status": capture_status,
            "vendor": {"id": vendor["id"], "name": vendor["name"]}}


@router.post("/{invoice_id}/create-draft")
async def create_draft(invoice_id: str, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(_MAKER_ONLY)):
    """Mark an already-captured invoice sitting in the Capture Inbox as a draft."""
    inv = await fetch_one(db, "SELECT id, stage, capture_status FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "capture":
        raise HTTPException(409, "Invoice has already left the Capture Inbox")
    await execute(db, "UPDATE invoices SET capture_status = 'draft', updated_at = now() WHERE id = :id",
                  {"id": invoice_id})
    await log_action(db, user["sub"], user["name"], "Marked invoice as draft", "invoice", invoice_id, "")
    return {"id": invoice_id, "capture_status": "draft"}


@router.post("/{invoice_id}/send-to-match")
async def send_to_match(invoice_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(_MAKER_ONLY)):
    """Move a Capture Inbox invoice straight into the 3-Way Match queue."""
    inv = await fetch_one(db, "SELECT id, stage FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "capture":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'capture'")
    await execute(db, """
        UPDATE invoices SET stage = 'match', capture_status = 'match_pending', updated_at = now()
        WHERE id = :id
    """, {"id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'capture', 'match', :u, 'Sent to 3-Way Match from Capture Inbox')
    """, {"id": invoice_id, "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Sent invoice to 3-Way Match", "invoice", invoice_id, "")
    return {"id": invoice_id, "stage": "match", "capture_status": "match_pending"}


@router.get("/{invoice_id}/match-detail")
async def match_detail(invoice_id: str, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """3-Way Match detail: invoice + linked PO + linked GRN + field-by-field comparison."""
    inv = await fetch_one(db, """
        SELECT i.*, v.name AS vendor_name, v.gstin AS vendor_gstin, v.is_msme
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")

    po, po_lines = None, []
    if inv["po_id"]:
        po = await fetch_one(db, """
            SELECT p.*, v.name AS vendor_name FROM purchase_orders p
            JOIN vendors v ON v.id = p.vendor_id WHERE p.id = :id
        """, {"id": inv["po_id"]})
        if po:
            po_lines = await fetch_all(db, "SELECT * FROM po_lines WHERE po_id = :id ORDER BY id", {"id": po["id"]})

    grn = await match_engine.resolve_grn(db, inv)
    grn_lines = []
    if grn:
        grn_lines = await fetch_all(db, """
            SELECT gl.*, pl.description, pl.quantity AS ordered_qty
            FROM grn_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
            WHERE gl.grn_id = :id ORDER BY gl.id
        """, {"id": grn["id"]})

    tol = await match_engine.get_tolerance(db)
    comparison = match_engine.build_comparison(inv, po, po_lines, grn, grn_lines, tol)

    return {
        "invoice": inv,
        "po": {**po, "lines": po_lines} if po else None,
        "grn": {**grn, "lines": grn_lines} if grn else None,
        "comparison": comparison,
    }


@router.post("/{invoice_id}/run-match")
async def run_match(invoice_id: str, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(_MATCH_MAKER_ONLY)):
    result = await match_engine.run_match(db, invoice_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    status = result["status"] if result["status"] != "no_po" else None
    await execute(db, """
        UPDATE invoices SET match_status = :s, match_detail = CAST(:d AS jsonb),
            grn_id = COALESCE(grn_id, :g), updated_at = now()
        WHERE id = :id
    """, {"s": status, "d": json.dumps({"score": result["score"], "flags": result["flags"]}),
          "g": result.get("grn_id"), "id": invoice_id})
    actor = "Match Engine"
    await log_action(db, None, actor,
                     {"auto_matched": "Auto-matched 3-way", "exception": "Match exception flagged",
                      "failed": "Match failed"}.get(status, "Match run"),
                     "invoice", invoice_id,
                     f"Score {result['score']}% · flags: {result['flags'] or 'none'}")
    ai_analysis = None
    if status in ("exception", "failed"):
        ai_analysis = await ai_agents.analyse_exception(db, invoice_id, result)
    return {**result, "ai_analysis": ai_analysis}


@router.post("/{invoice_id}/send-to-gst2b")
async def send_to_gst2b(invoice_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(_MATCH_MAKER_OR_CHECKER)):
    """3-Way Match -> GST 2B Recon. Requires PO + GRN linked and a match result of
    auto_matched or exception — a 'failed' match must be sent back to Capture instead."""
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "match":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'match'")
    if not inv["po_id"]:
        raise HTTPException(400, "Cannot send to GST 2B — PO is missing")
    grn = await match_engine.resolve_grn(db, inv)
    if not grn:
        raise HTTPException(400, "Cannot send to GST 2B — GRN is missing")
    if inv["match_status"] not in ("auto_matched", "exception"):
        raise HTTPException(409, "Run 3-Way Match first — only auto_matched or exception invoices can proceed to GST 2B")
    if user["role"] == "maker" and inv["match_status"] != "auto_matched":
        raise HTTPException(403, "Maker can only send clean auto-matched invoices — exceptions need Checker review")

    await execute(db, """
        UPDATE invoices SET stage = 'gst2b', gst2b_status = 'pending_sync',
            grn_id = COALESCE(grn_id, :g), updated_at = now() WHERE id = :id
    """, {"g": grn["id"], "id": invoice_id})
    # Surface it in the GST 2B Recon queue immediately, awaiting the next sync.
    period = f"{date.today():%Y-%m}"
    vendor = await fetch_one(db, "SELECT gstin FROM vendors WHERE id = :id", {"id": inv["vendor_id"]})
    existing_record = await fetch_one(db, "SELECT id FROM gst_2b_records WHERE invoice_id = :id AND period = :p",
                                      {"id": invoice_id, "p": period})
    if not existing_record:
        await execute(db, """
            INSERT INTO gst_2b_records (period, invoice_id, vendor_gstin, taxable, gst_in_2b, status)
            VALUES (:p, :id, :g, :t, NULL, 'pending_sync')
        """, {"p": period, "id": invoice_id, "g": vendor["gstin"] if vendor else None, "t": inv["taxable_amount"]})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'match', 'gst2b', :u, 'Sent to GST 2B Recon from 3-Way Match')
    """, {"id": invoice_id, "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Sent invoice to GST 2B Recon", "invoice", invoice_id, "")
    return {"id": invoice_id, "stage": "gst2b"}


class MatchExceptionBody(BaseModel):
    reason: str | None = None


@router.post("/{invoice_id}/mark-exception")
async def mark_exception(invoice_id: str, body: MatchExceptionBody, db: AsyncSession = Depends(get_db),
                         user: dict = Depends(_MATCH_CHECKER_ONLY)):
    """Manual override: flag an invoice as a match exception regardless of its
    current score (e.g. a reviewer disagrees with an auto_matched result)."""
    inv = await fetch_one(db, "SELECT id, stage, match_detail FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "match":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'match'")
    detail = inv["match_detail"] if isinstance(inv["match_detail"], dict) else (
        json.loads(inv["match_detail"]) if inv["match_detail"] else {})
    detail["manual_override"] = True
    if body.reason:
        detail["override_reason"] = body.reason
    await execute(db, """
        UPDATE invoices SET match_status = 'exception', match_detail = CAST(:d AS jsonb), updated_at = now()
        WHERE id = :id
    """, {"d": json.dumps(detail, default=str), "id": invoice_id})
    await log_action(db, user["sub"], user["name"], "Marked invoice as match exception", "invoice", invoice_id,
                     body.reason or "")
    return {"id": invoice_id, "match_status": "exception"}


class StageMove(BaseModel):
    note: str | None = None


@router.post("/{invoice_id}/send-back-capture")
async def send_back_capture(invoice_id: str, body: StageMove, db: AsyncSession = Depends(get_db),
                            user: dict = Depends(_MATCH_CHECKER_ONLY)):
    """3-Way Match failure -> back to Capture Inbox for correction and re-review."""
    if not body.note or not body.note.strip():
        raise HTTPException(400, "A remark is required to send an invoice back to Capture")
    inv = await fetch_one(db, "SELECT id, stage FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "match":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'match'")
    await execute(db, """
        UPDATE invoices SET stage = 'capture', capture_status = 'captured',
            match_status = NULL, match_detail = NULL, updated_at = now()
        WHERE id = :id
    """, {"id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'match', 'capture', :u, :n)
    """, {"id": invoice_id, "u": user["sub"], "n": body.note or "Sent back to Capture Inbox from 3-Way Match"})
    await log_action(db, user["sub"], user["name"], "Sent invoice back to Capture Inbox", "invoice", invoice_id,
                     body.note or "")
    return {"id": invoice_id, "stage": "capture", "capture_status": "captured"}


@router.post("/{invoice_id}/advance")
async def advance_stage(invoice_id: str, body: StageMove, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    """Move an invoice to its next pipeline stage, enforcing gate conditions."""
    inv = await fetch_one(db, """
        SELECT i.*, v.is_msme FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    cur = inv["stage"]
    if cur not in STAGE_ORDER or cur == "paid":
        raise HTTPException(400, f"Cannot advance from stage '{cur}'")
    if cur in ("tds", "approval"):
        raise HTTPException(403, "Use the TDS Engine / Approval Workflow actions to move this stage — "
                                  "this generic endpoint cannot bypass approval routing")
    nxt = STAGE_ORDER[STAGE_ORDER.index(cur) + 1]

    if cur == "match" and inv["match_status"] == "exception":
        raise HTTPException(409, "Match exception unresolved — resolve or override before advancing")
    if cur == "gst2b" and inv["gst2b_status"] == "mismatch_tax":
        raise HTTPException(409, "GST 2B tax mismatch — payment hold recommended; resolve before advancing")

    if nxt == "approval":
        result = await approval_engine.route(db, "invoice", invoice_id, float(inv["total_amount"]),
                                             inv["department_id"], inv["category_id"],
                                             bool(inv["is_msme"]), user)
        if result["auto_approved"]:
            nxt = "liability"
    if cur == "approval":
        status = await approval_engine.chain_status(db, "invoice", invoice_id)
        if status == "in_progress":
            raise HTTPException(409, "Approval chain still in progress")
        if status == "rejected":
            raise HTTPException(409, "Invoice was rejected in approval")

    await execute(db, "UPDATE invoices SET stage = :s, updated_at = now() WHERE id = :id",
                  {"s": nxt, "id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, :f, :t, :u, :n)
    """, {"id": invoice_id, "f": cur, "t": nxt, "u": user["sub"], "n": body.note})
    await log_action(db, user["sub"], user["name"], f"Advanced invoice {cur} → {nxt}",
                     "invoice", invoice_id, body.note or "")
    return {"id": invoice_id, "from": cur, "to": nxt}


def _simulate_2b(invoice_id: str, gst_in_book: float) -> tuple[float | None, str]:
    """Deterministic stand-in for a real GSTN GSTR-2B feed: same invoice always
    resolves to the same simulated outcome (no real 2B integration exists yet).
    ~15% not_in_2b, ~25% mismatch_tax, ~60% matched."""
    rng = random.Random(int(hashlib.sha256(invoice_id.encode()).hexdigest()[:8], 16))
    bucket = rng.random()
    if bucket < 0.15 or gst_in_book <= 0:
        return None, "not_in_2b"
    if bucket < 0.40:
        variance_pct = rng.uniform(1.5, 8.0) * rng.choice([1, -1])
        return round(gst_in_book * (1 + variance_pct / 100), 2), "mismatch_tax"
    return round(gst_in_book, 2), "matched"


@router.post("/gst2b/sync")
async def sync_gst2b(db: AsyncSession = Depends(get_db), user: dict = Depends(_GST2B_MAKER_OR_COMPLIANCE)):
    """Simulated GSTR-2B pull: reconciles every invoice currently at the gst2b
    stage for the current period. Re-running sync recomputes (idempotently,
    per-invoice) rather than skipping already-synced rows, so a correction to
    the underlying invoice or a fresh GSTN pull is always reflected."""
    invoices = await fetch_all(db, """
        SELECT i.id, i.igst + i.cgst + i.sgst AS gst_in_book, i.taxable_amount, v.gstin
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.stage = 'gst2b'
    """)
    period = f"{date.today():%Y-%m}"
    synced = 0
    for inv in invoices:
        gst_in_2b, status = _simulate_2b(inv["id"], float(inv["gst_in_book"] or 0))
        existing = await fetch_one(db, "SELECT id FROM gst_2b_records WHERE invoice_id = :id AND period = :p",
                                   {"id": inv["id"], "p": period})
        if existing:
            await execute(db, """
                UPDATE gst_2b_records SET gst_in_2b = :gst, status = :s, taxable = :t, synced_at = now()
                WHERE id = :rid
            """, {"gst": gst_in_2b, "s": status, "t": inv["taxable_amount"], "rid": existing["id"]})
        else:
            await execute(db, """
                INSERT INTO gst_2b_records (period, invoice_id, vendor_gstin, taxable, gst_in_2b, status)
                VALUES (:p, :id, :g, :t, :gst, :s)
            """, {"p": period, "id": inv["id"], "g": inv["gstin"], "t": inv["taxable_amount"],
                  "gst": gst_in_2b, "s": status})
        await execute(db, "UPDATE invoices SET gst2b_status = :s WHERE id = :id", {"s": status, "id": inv["id"]})
        synced += 1
    await log_action(db, None, "GSTN Sync", "GSTR-2B fetched", "gst2b", period,
                     f"{len(invoices)} invoice(s) reconciled this cycle")
    return {"period": period, "synced": synced}


@router.get("/gst2b/records")
async def gst2b_records(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT r.*, i.vendor_id, v.name AS vendor_name, i.igst + i.cgst + i.sgst AS gst_in_book
        FROM gst_2b_records r
        JOIN invoices i ON i.id = r.invoice_id AND i.stage = 'gst2b'
        LEFT JOIN vendors v ON v.id = i.vendor_id
        ORDER BY r.synced_at DESC
    """)


class Gst2bRemarkBody(BaseModel):
    remark: str


@router.post("/{invoice_id}/gst2b/mark-itc-eligible")
async def gst2b_mark_itc_eligible(invoice_id: str, db: AsyncSession = Depends(get_db),
                                  user: dict = Depends(_GST2B_COMPLIANCE_ONLY)):
    inv = await fetch_one(db, "SELECT id, stage FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "gst2b":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'gst2b'")
    await execute(db, "UPDATE invoices SET gst2b_status = 'matched', updated_at = now() WHERE id = :id",
                  {"id": invoice_id})
    await execute(db, "UPDATE gst_2b_records SET status = 'matched' WHERE invoice_id = :id AND period = :p",
                 {"id": invoice_id, "p": f"{date.today():%Y-%m}"})
    await log_action(db, user["sub"], user["name"], "Marked ITC eligible (manual override)", "invoice", invoice_id, "")
    return {"id": invoice_id, "gst2b_status": "matched"}


@router.post("/{invoice_id}/gst2b/mark-payment-hold")
async def gst2b_mark_payment_hold(invoice_id: str, db: AsyncSession = Depends(get_db),
                                  user: dict = Depends(_GST2B_COMPLIANCE_ONLY)):
    inv = await fetch_one(db, "SELECT id, stage FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "gst2b":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'gst2b'")
    await execute(db, "UPDATE invoices SET gst2b_status = 'mismatch_tax', updated_at = now() WHERE id = :id",
                  {"id": invoice_id})
    await execute(db, "UPDATE gst_2b_records SET status = 'mismatch_tax' WHERE invoice_id = :id AND period = :p",
                 {"id": invoice_id, "p": f"{date.today():%Y-%m}"})
    await log_action(db, user["sub"], user["name"], "Marked payment hold (manual override)", "invoice", invoice_id, "")
    return {"id": invoice_id, "gst2b_status": "mismatch_tax"}


@router.post("/{invoice_id}/gst2b/remark")
async def gst2b_remark(invoice_id: str, body: Gst2bRemarkBody, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(_GST2B_MAKER_OR_COMPLIANCE)):
    inv = await fetch_one(db, "SELECT id FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    await log_action(db, user["sub"], user["name"], "GST 2B remark added", "invoice", invoice_id, body.remark)
    return {"id": invoice_id, "remark": body.remark}


@router.post("/{invoice_id}/gst2b/move-to-tds")
async def gst2b_move_to_tds(invoice_id: str, db: AsyncSession = Depends(get_db),
                            user: dict = Depends(_GST2B_MAKER_OR_COMPLIANCE)):
    inv = await fetch_one(db, "SELECT id, stage, gst2b_status FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "gst2b":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'gst2b'")
    if inv["gst2b_status"] == "mismatch_tax":
        raise HTTPException(409, "GST 2B tax mismatch — resolve or mark ITC eligible before moving to TDS")
    if user["role"] == "maker" and inv["gst2b_status"] != "matched":
        raise HTTPException(403, "Maker can only move clean/matched GST records — issues need Compliance review")
    await execute(db, """
        UPDATE invoices SET stage = 'tds', gst2b_status = 'tds_pending', tds_status = 'tds_pending',
            updated_at = now() WHERE id = :id
    """, {"id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'gst2b', 'tds', :u, 'Moved to TDS Engine from GST 2B Recon')
    """, {"id": invoice_id, "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Moved invoice to TDS Engine", "invoice", invoice_id, "")
    return {"id": invoice_id, "stage": "tds", "gst2b_status": "tds_pending"}


@router.get("/{invoice_id}/tds-detail")
async def tds_detail(invoice_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    """TDS Engine detail modal: invoice + vendor PAN + GST 2B status for the warning banner."""
    inv = await fetch_one(db, """
        SELECT i.*, v.name AS vendor_name, v.pan FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    rates = await tax_engine.get_tds_rates(db)
    return {"invoice": inv, "tds_rates": rates}


@router.post("/{invoice_id}/tds/compute")
async def tds_compute(invoice_id: str, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(_TDS_MAKER_ONLY)):
    """Auto-compute TDS at the section's standard rate: TDS = taxable × rate/100,
    Net Pay = invoice total − TDS."""
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "tds":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'tds'")
    rates = await tax_engine.get_tds_rates(db)
    section = inv["tds_section"]
    rate = float(rates.get(section, inv["tds_rate"] or 0))
    tds_amount = round(float(inv["taxable_amount"]) * rate / 100, 2)
    net_payable = round(float(inv["total_amount"]) - tds_amount, 2)
    await execute(db, """
        UPDATE invoices SET tds_rate = :rate, tds_amount = :amt, net_payable = :net,
            tds_status = 'tds_computed', updated_at = now() WHERE id = :id
    """, {"rate": rate, "amt": tds_amount, "net": net_payable, "id": invoice_id})
    await log_action(db, user["sub"], user["name"], "Auto-computed TDS", "invoice", invoice_id,
                     f"{section} · {rate:g}% · ₹{tds_amount:,.0f}")
    return {"id": invoice_id, "tds_section": section, "tds_rate": rate,
            "tds_amount": tds_amount, "net_payable": net_payable, "tds_status": "tds_computed"}


class TdsOverrideBody(BaseModel):
    tds_section: str
    tds_rate: float
    reason: str | None = None


@router.post("/{invoice_id}/tds/override")
async def tds_override(invoice_id: str, body: TdsOverrideBody, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(_TDS_COMPLIANCE_ONLY)):
    """Manual override of the TDS section/rate. A reason is mandatory whenever the
    section or rate actually changes from what's currently stored."""
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "tds":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'tds'")
    changed = (body.tds_section != inv["tds_section"]) or (abs(float(body.tds_rate) - float(inv["tds_rate"])) > 0.001)
    if changed and not (body.reason or "").strip():
        raise HTTPException(400, "An override reason is required when changing the TDS section or rate")

    tds_amount = round(float(inv["taxable_amount"]) * float(body.tds_rate) / 100, 2)
    net_payable = round(float(inv["total_amount"]) - tds_amount, 2)
    await execute(db, """
        UPDATE invoices SET tds_section = :sec, tds_rate = :rate, tds_amount = :amt, net_payable = :net,
            tds_status = 'tds_computed', updated_at = now() WHERE id = :id
    """, {"sec": body.tds_section, "rate": body.tds_rate, "amt": tds_amount, "net": net_payable, "id": invoice_id})

    note = f"TDS override: {inv['tds_section']} {inv['tds_rate']:g}% → {body.tds_section} {body.tds_rate:g}%"
    if body.reason:
        note += f" · reason: {body.reason}"
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, to_stage, actor_id, note) VALUES (:id, 'tds', :u, :n)
    """, {"id": invoice_id, "u": user["sub"], "n": note})
    await log_action(db, user["sub"], user["name"], "TDS section/rate overridden", "invoice", invoice_id, note)
    return {"id": invoice_id, "tds_section": body.tds_section, "tds_rate": body.tds_rate,
            "tds_amount": tds_amount, "net_payable": net_payable, "tds_status": "tds_computed"}


@router.post("/{invoice_id}/tds/save")
async def tds_save(invoice_id: str, db: AsyncSession = Depends(get_db),
                   user: dict = Depends(_TDS_MAKER_OR_COMPLIANCE)):
    """Lock in the current TDS computation — required before it can be sent onward."""
    inv = await fetch_one(db, "SELECT id, stage FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "tds":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'tds'")
    await execute(db, "UPDATE invoices SET tds_status = 'tds_ready', updated_at = now() WHERE id = :id",
                  {"id": invoice_id})
    await log_action(db, user["sub"], user["name"], "Saved TDS computation", "invoice", invoice_id, "")
    return {"id": invoice_id, "tds_status": "tds_ready"}


@router.post("/{invoice_id}/tds/send-to-approval")
async def tds_send_to_approval(invoice_id: str, db: AsyncSession = Depends(get_db),
                               user: dict = Depends(_TDS_MAKER_OR_COMPLIANCE)):
    """TDS Engine -> Approval Workflow handoff. Moves the invoice to stage='approval'
    and creates its approval chain via the existing approval_engine (the same
    routing engine the Approval Workflow page already reads from) — the approval
    matrix/UI itself is untouched here."""
    inv = await fetch_one(db, """
        SELECT i.*, v.is_msme FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["stage"] != "tds":
        raise HTTPException(409, f"Invoice is at stage '{inv['stage']}', not 'tds'")
    if inv["tds_status"] != "tds_ready":
        raise HTTPException(409, "Save TDS before sending to Approval Workflow")

    result = await approval_engine.route(db, "invoice", invoice_id, float(inv["total_amount"]),
                                         inv["department_id"], inv["category_id"], bool(inv["is_msme"]), user)
    if not result["auto_approved"] and result["stages"][:1] == ["maker"]:
        # The maker's sign-off already happened by sending it here from TDS Engine —
        # don't make them approve their own submission a second time.
        await approval_engine.auto_complete_maker_stage(db, "invoice", invoice_id, user)
    next_stage = "liability" if result["auto_approved"] else "approval"
    next_tds_status = "approved" if result["auto_approved"] else "pending_approval"
    await execute(db, """
        UPDATE invoices SET stage = :s, tds_status = :ts, updated_at = now() WHERE id = :id
    """, {"s": next_stage, "ts": next_tds_status, "id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'tds', :s, :u, 'Sent to Approval Workflow from TDS Engine')
    """, {"id": invoice_id, "s": next_stage, "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Sent invoice to Approval Workflow", "invoice", invoice_id, "")
    return {"id": invoice_id, "stage": next_stage, "tds_status": next_tds_status}


@router.get("/tds/queue")
async def tds_queue(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    rows = await fetch_all(db, """
        SELECT i.id, i.vendor_id, v.name AS vendor_name, v.pan, i.taxable_amount,
               i.tds_section, i.tds_rate, i.tds_amount, i.net_payable, i.stage
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE i.tds_amount > 0 AND i.stage NOT IN ('rejected')
        ORDER BY i.captured_at DESC
    """)
    summary = await fetch_all(db, """
        SELECT tds_section, COUNT(*) AS invoices, SUM(tds_amount) AS total
        FROM invoices WHERE tds_amount > 0 AND stage NOT IN ('rejected')
        GROUP BY tds_section ORDER BY total DESC
    """)
    return {"queue": rows, "summary": summary}
