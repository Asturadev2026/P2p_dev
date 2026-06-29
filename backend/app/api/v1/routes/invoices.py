"""Invoice management — capture (OCR), pipeline, 3-way match, GST 2B, TDS, stage moves."""
import json
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import match_engine, tax_engine, approval_engine, ai_agents, integration_service
from app.utils.audit import log_action

router = APIRouter(prefix="/invoices", tags=["invoices"])

STAGE_ORDER = ["capture", "match", "gst2b", "tds", "approval", "liability", "payments", "paid"]


@router.get("")
async def list_invoices(stage: str | None = None, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(get_current_user)):
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
                          user: dict = Depends(get_current_user)):
    """Text capture: OCR-extract, validate mandatory fields, create at 'capture'."""
    extract = await ai_agents.extract_invoice(db, "(pending)", body.raw_text)
    return await _capture_pipeline(db, user, extract, body.source, body.vendor_id, body.po_id)


@router.post("/capture-file")
async def capture_invoice_file(file: UploadFile = File(...), source: str = Form("scan"),
                               vendor_id: str | None = Form(None), po_id: str | None = Form(None),
                               db: AsyncSession = Depends(get_db),
                               user: dict = Depends(get_current_user)):
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

    return await _capture_pipeline(db, user, extract, source, vendor_id, po_id, file.filename)


@router.post("/{invoice_id}/run-match")
async def run_match(invoice_id: str, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    result = await match_engine.run_match(db, invoice_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    status = result["status"] if result["status"] != "no_po" else None
    await execute(db, """
        UPDATE invoices SET match_status = :s, match_detail = CAST(:d AS jsonb), updated_at = now()
        WHERE id = :id
    """, {"s": status, "d": json.dumps({"score": result["score"], "flags": result["flags"]}),
          "id": invoice_id})
    actor = "Match Engine"
    await log_action(db, None, actor,
                     "Auto-matched 3-way" if status == "auto_matched" else "Match exception flagged",
                     "invoice", invoice_id,
                     f"Score {result['score']}% · flags: {result['flags'] or 'none'}")
    ai_analysis = None
    if status == "exception":
        ai_analysis = await ai_agents.analyse_exception(db, invoice_id, result)
    return {**result, "ai_analysis": ai_analysis}


class StageMove(BaseModel):
    note: str | None = None


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


@router.post("/gst2b/sync")
async def sync_gst2b(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Simulated GSTR-2B pull: reconciles invoices currently at the gst2b stage."""
    invoices = await fetch_all(db, """
        SELECT i.id, i.igst + i.cgst + i.sgst AS gst_in_book, i.taxable_amount, v.gstin
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.stage = 'gst2b'
    """)
    period = f"{date.today():%Y-%m}"
    synced = 0
    for inv in invoices:
        existing = await fetch_one(db, """
            SELECT id FROM gst_2b_records WHERE invoice_id = :id AND period = :p
        """, {"id": inv["id"], "p": period})
        if existing:
            continue
        await execute(db, """
            INSERT INTO gst_2b_records (period, invoice_id, vendor_gstin, taxable, gst_in_2b, status)
            VALUES (:p, :id, :g, :t, :gst, 'matched')
        """, {"p": period, "id": inv["id"], "g": inv["gstin"], "t": inv["taxable_amount"],
              "gst": inv["gst_in_book"]})
        await execute(db, "UPDATE invoices SET gst2b_status = 'matched' WHERE id = :id", {"id": inv["id"]})
        synced += 1
    await log_action(db, None, "GSTN Sync", "GSTR-2B fetched", "gst2b", period,
                     f"{len(invoices)} invoices in cycle · {synced} newly reconciled")
    return {"period": period, "synced": synced}


@router.get("/gst2b/records")
async def gst2b_records(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT r.*, i.vendor_id, v.name AS vendor_name, i.igst + i.cgst + i.sgst AS gst_in_book
        FROM gst_2b_records r
        LEFT JOIN invoices i ON i.id = r.invoice_id
        LEFT JOIN vendors v ON v.id = i.vendor_id
        ORDER BY r.synced_at DESC
    """)


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
