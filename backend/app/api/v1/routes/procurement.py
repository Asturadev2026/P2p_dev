"""RFQ & quotation comparison, purchase orders, GRNs — full PR -> RFQ -> PO -> GRN cycle."""
import json
import random
import secrets
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user, require_roles
from app.services import integration_service, email_service
from app.utils.audit import log_action

router = APIRouter(prefix="/procurement", tags=["procurement"])

# Procurement (RFQ/PO/GRN) is worked only by the procurement role in this demo (+ admin bypass).
PROCUREMENT_ROLE = ("procurement",)


async def _require_active_vendor(db: AsyncSession, vendor_id: str):
    """Business rule: only ACTIVE vendors may be used in RFQ award / PO. A vendor that
    is pending_compliance, rejected, suspended, etc. must be blocked server-side —
    never rely on the UI hiding it."""
    v = await fetch_one(db, "SELECT id, name, status FROM vendors WHERE id = :id", {"id": vendor_id})
    if not v:
        raise HTTPException(404, f"Vendor {vendor_id} not found")
    if v["status"] != "active":
        raise HTTPException(409, f"Vendor {v['name']} is '{v['status']}' — only ACTIVE vendors can be used.")
    return v


# ---------- Vendor matching (category / product name, from vendor_products) ----------

@router.get("/vendors-for-requisition/{req_id:path}")
async def vendors_for_requisition(req_id: str, db: AsyncSession = Depends(get_db),
                                  user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    """Active vendors whose product catalog (from onboarding) matches the PR's category
    or any line-item description. Used to auto-suggest vendors when creating an RFQ."""
    req = await fetch_one(db, """
        SELECT r.*, c.name AS category_name FROM requisitions r
        JOIN spend_categories c ON c.id = r.category_id WHERE r.id = :id
    """, {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    lines = await fetch_all(db, "SELECT description FROM requisition_lines WHERE requisition_id = :id", {"id": req_id})

    conditions = ["vp.category = :cat"]
    params = {"cat": req["category_name"]}
    for i, l in enumerate(lines):
        key = f"item{i}"
        conditions.append(f"vp.product_name ILIKE :{key}")
        params[key] = f"%{l['description']}%"

    rows = await fetch_all(db, f"""
        SELECT DISTINCT v.id AS vendor_id, v.name AS vendor_name, v.is_msme, v.rating, v.tier,
               v.msme_category, o.contact_email,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i WHERE i.vendor_id = v.id) AS spend_ytd,
               vp.category, vp.product_name, vp.sub_category, vp.uom
        FROM vendor_products vp
        JOIN vendors v ON v.id = vp.vendor_id
        LEFT JOIN vendor_onboarding o ON o.id = v.onboarding_id
        WHERE v.status = 'active' AND vp.status = 'active' AND ({" OR ".join(conditions)})
        ORDER BY v.name
    """, params)
    return {"category": req["category_name"], "vendors": rows,
            "no_match": len(rows) == 0}


# ---------- RFQ ----------

@router.get("/rfqs")
async def list_rfqs(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT r.*, req.title AS requisition_title, req.status AS requisition_status,
               c.name AS category_name, v.name AS awarded_vendor_name,
               (SELECT COUNT(*) FROM rfq_vendors rv WHERE rv.rfq_id = r.id) AS vendors_invited,
               (SELECT COUNT(*) FROM quotations q WHERE q.rfq_id = r.id) AS quote_count,
               (SELECT COUNT(*) FROM purchase_orders p WHERE p.rfq_id = r.id) AS po_count
        FROM rfqs r
        LEFT JOIN requisitions req ON req.id = r.requisition_id
        LEFT JOIN spend_categories c ON c.id = r.category_id
        LEFT JOIN vendors v ON v.id = r.awarded_vendor_id
        ORDER BY r.created_at DESC
    """)


@router.get("/rfqs/{rfq_id:path}/detail")
async def rfq_detail(rfq_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    rfq = await fetch_one(db, """
        SELECT r.*, req.title AS requisition_title, req.total_amount AS requisition_amount,
               c.name AS category_name
        FROM rfqs r
        LEFT JOIN requisitions req ON req.id = r.requisition_id
        LEFT JOIN spend_categories c ON c.id = r.category_id
        WHERE r.id = :id
    """, {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    lines = await fetch_all(db, "SELECT * FROM requisition_lines WHERE requisition_id = :id ORDER BY id",
                            {"id": rfq["requisition_id"]})
    invited = await fetch_all(db, """
        SELECT rv.*, v.name AS vendor_name, v.is_msme, v.rating, v.tier
        FROM rfq_vendors rv LEFT JOIN vendors v ON v.id = rv.vendor_id
        WHERE rv.rfq_id = :id ORDER BY rv.invited_at
    """, {"id": rfq_id})
    quotes = await fetch_all(db, """
        SELECT q.*, v.name AS vendor_name, v.is_msme, v.rating, v.tier, v.msme_category
        FROM quotations q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.rfq_id = :id ORDER BY q.amount
    """, {"id": rfq_id})
    pos = await fetch_all(db, "SELECT id, status FROM purchase_orders WHERE rfq_id = :id", {"id": rfq_id})

    total_qty = sum(float(l["quantity"]) for l in lines) or 1
    lowest = min((float(q["amount"]) for q in quotes), default=None)
    for q in quotes:
        gst = float(q.get("gst_rate") or 18.0)
        q["quote_code"] = f"QT-{q['received_at'].year}-{q['id']:04d}"
        q["unit_price"] = round(float(q["amount"]) / (1 + gst / 100) / total_qty, 2)
        q["diff_from_lowest"] = round(float(q["amount"]) - lowest, 2) if lowest is not None else None
        q["recommended"] = lowest is not None and float(q["amount"]) == lowest
        q["documents"] = await fetch_all(db, "SELECT id, filename FROM quotation_documents WHERE quotation_id = :id",
                                         {"id": q["id"]})

    # Best-effort "last purchase" reference: most recent PO in the same category,
    # excluding any PO already raised from this RFQ, for a quick rate sanity check.
    last_purchase = None
    if rfq.get("category_id"):
        lp = await fetch_one(db, """
            SELECT p.issued_at, v.name AS vendor_name, pl.unit_price
            FROM purchase_orders p
            JOIN vendors v ON v.id = p.vendor_id
            LEFT JOIN po_lines pl ON pl.po_id = p.id
            WHERE p.category_id = :cat AND p.rfq_id IS DISTINCT FROM :rfq
            ORDER BY p.issued_at DESC LIMIT 1
        """, {"cat": rfq["category_id"], "rfq": rfq_id})
        if lp and lp.get("unit_price"):
            last_rate = float(lp["unit_price"])
            best_unit = min((q["unit_price"] for q in quotes), default=None)
            last_purchase = {"vendor_name": lp["vendor_name"], "rate": last_rate, "procured_at": lp["issued_at"],
                             "best_vs_last_pct": round((best_unit - last_rate) / last_rate * 100, 1) if best_unit else None}

    return {**rfq, "lines": lines, "invited_vendors": invited, "quotations": quotes,
            "last_purchase": last_purchase, "pos": pos}


class OffSystemVendor(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None


class RfqCreate(BaseModel):
    requisition_id: str
    vendor_ids: list[str] = []
    off_system_vendors: list[OffSystemVendor] = []
    due_date: date | None = None
    cutoff_time: str | None = None
    terms: str | None = None
    message: str | None = None
    title: str | None = None


@router.post("/rfqs")
async def create_rfq(body: RfqCreate, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": body.requisition_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] != "approved":
        raise HTTPException(409, f"Only an approved PR can move to RFQ (PR is '{req['status']}')")

    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM rfqs WHERE id LIKE :p",
                          {"p": f"RFQ/{date.today():%Y/%m}/%"})
    rfq_id = f"RFQ/{date.today():%Y/%m}/{seq['n']:04d}"
    title = body.title or req["title"]
    await execute(db, """
        INSERT INTO rfqs (id, requisition_id, title, due_date, cutoff_time, status, category_id, terms, message, created_by)
        VALUES (:id, :req, :t, :dd, :ct, 'draft', :cat, :terms, :msg, :u)
    """, {"id": rfq_id, "req": body.requisition_id, "t": title, "dd": body.due_date, "ct": body.cutoff_time,
          "cat": req["category_id"], "terms": body.terms, "msg": body.message, "u": user["sub"]})

    for vid in dict.fromkeys(body.vendor_ids):  # de-dupe, preserve order
        await execute(db, """
            INSERT INTO rfq_vendors (rfq_id, vendor_id, is_off_system) VALUES (:r, :v, FALSE)
            ON CONFLICT (rfq_id, vendor_id) DO NOTHING
        """, {"r": rfq_id, "v": vid})
    for ov in body.off_system_vendors:
        await execute(db, """
            INSERT INTO rfq_vendors (rfq_id, vendor_id, is_off_system, off_system_name, off_system_email, off_system_phone)
            VALUES (:r, NULL, TRUE, :n, :e, :p)
        """, {"r": rfq_id, "n": ov.name, "e": ov.email, "p": ov.phone})

    await log_action(db, user["sub"], user["name"], "Created RFQ", "rfq", rfq_id,
                     f"From {body.requisition_id} · {len(body.vendor_ids)} vendor(s) + {len(body.off_system_vendors)} off-system")
    return {"id": rfq_id, "status": "draft"}


async def _email_invited_vendors(db: AsyncSession, rfq_id: str, vendor_ids: list[str],
                                 off_system: list[dict], title: str, deadline: str,
                                 message: str | None, sent_by_name: str):
    """Best-effort RFQ invite email — mirrors the vendor-onboarding send-link flow.
    Never raises: a missing RESEND_API_KEY or bad address must not block sending the RFQ."""
    recipients = []
    for vid in dict.fromkeys(vendor_ids):
        row = await fetch_one(db, """
            SELECT v.name, o.contact_email FROM vendors v
            LEFT JOIN vendor_onboarding o ON o.id = v.onboarding_id WHERE v.id = :id
        """, {"id": vid})
        if row and row.get("contact_email"):
            recipients.append((row["name"], row["contact_email"]))
    recipients += [(ov.get("name"), ov.get("email")) for ov in off_system if ov.get("email")]

    for name, email in recipients:
        try:
            await email_service.send_rfq_email(
                to_email=email, vendor_name=name, rfq_id=rfq_id, title=title, deadline=deadline,
                message=message or "Please submit your quotation before the deadline.",
                sent_by_name=sent_by_name)
        except Exception:
            pass  # RESEND_API_KEY optional; RFQ still sent


@router.post("/rfqs/{rfq_id:path}/send")
async def send_rfq(rfq_id: str, db: AsyncSession = Depends(get_db),
                   user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if rfq["status"] != "draft":
        raise HTTPException(409, f"RFQ is '{rfq['status']}', not draft")
    invited_rows = await fetch_all(db, "SELECT * FROM rfq_vendors WHERE rfq_id = :id", {"id": rfq_id})
    if not invited_rows:
        raise HTTPException(400, "Invite at least one vendor before sending the RFQ")
    await execute(db, "UPDATE rfqs SET status = 'sent' WHERE id = :id", {"id": rfq_id})
    if rfq["requisition_id"]:
        await execute(db, "UPDATE requisitions SET status = 'rfq_issued', updated_at = now() WHERE id = :id",
                      {"id": rfq["requisition_id"]})

    vendor_ids = [r["vendor_id"] for r in invited_rows if not r["is_off_system"]]
    off_system = [{"name": r["off_system_name"], "email": r["off_system_email"]}
                 for r in invited_rows if r["is_off_system"]]
    deadline_str = rfq["due_date"].strftime("%d %b %Y") if rfq["due_date"] else "not specified"
    await _email_invited_vendors(db, rfq_id, vendor_ids, off_system, rfq["title"], deadline_str,
                                 rfq.get("message"), user.get("name", "Procurement Team"))

    await log_action(db, user["sub"], user["name"], "Sent RFQ", "rfq", rfq_id, f"{len(invited_rows)} vendor(s) invited")
    return {"id": rfq_id, "status": "sent"}


class QuotationBody(BaseModel):
    vendor_id: str
    amount: float
    gst_rate: float = 18.0
    delivery_days: int | None = None
    validity_days: int | None = None
    payment_terms: str | None = None
    notes: str | None = None


@router.post("/rfqs/{rfq_id:path}/quotations")
async def add_quotation(rfq_id: str, body: QuotationBody, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if rfq["status"] not in ("sent", "quotations_received"):
        raise HTTPException(409, f"RFQ must be sent before quotations can be added (is '{rfq['status']}')")
    invited = await fetch_one(db, """
        SELECT 1 FROM rfq_vendors WHERE rfq_id = :r AND vendor_id = :v AND is_off_system = FALSE
    """, {"r": rfq_id, "v": body.vendor_id})
    if not invited:
        raise HTTPException(400, "This vendor was not invited to the RFQ")
    await _require_active_vendor(db, body.vendor_id)

    await execute(db, """
        INSERT INTO quotations (rfq_id, vendor_id, amount, gst_rate, delivery_days, validity_days, payment_terms, notes)
        VALUES (:r, :v, :amt, :gst, :dd, :vd, :pt, :n)
        ON CONFLICT (rfq_id, vendor_id) DO UPDATE SET
            amount = :amt, gst_rate = :gst, delivery_days = :dd, validity_days = :vd,
            payment_terms = :pt, notes = :n, received_at = now()
    """, {"r": rfq_id, "v": body.vendor_id, "amt": body.amount, "gst": body.gst_rate, "dd": body.delivery_days,
          "vd": body.validity_days, "pt": body.payment_terms, "n": body.notes})

    await execute(db, "UPDATE rfqs SET status = 'quotations_received' WHERE id = :id AND status = 'sent'",
                  {"id": rfq_id})
    if rfq["requisition_id"]:
        await execute(db, """
            UPDATE requisitions SET status = 'quotation_comparison', updated_at = now()
            WHERE id = :id AND status = 'rfq_issued'
        """, {"id": rfq["requisition_id"]})
    await log_action(db, user["sub"], user["name"], "Added quotation", "rfq", rfq_id,
                     f"Vendor {body.vendor_id} · ₹{body.amount:,.0f}")
    return {"rfq_id": rfq_id, "vendor_id": body.vendor_id, "amount": body.amount}


@router.post("/rfqs/{rfq_id:path}/simulate-quotations")
async def simulate_quotations(rfq_id: str, db: AsyncSession = Depends(get_db),
                              user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    """DEMO ONLY: generates a plausible quotation for every invited on-system vendor that
    hasn't quoted yet, so the comparison/finalize flow can be exercised without waiting on
    real vendor responses. Never used once real vendor replies are wired up."""
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if rfq["status"] not in ("sent", "quotations_received"):
        raise HTTPException(409, f"RFQ must be sent before simulating replies (is '{rfq['status']}')")
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": rfq["requisition_id"]})
    base_amount = float(req["total_amount"]) if req and req["total_amount"] else 10000.0

    pending = await fetch_all(db, """
        SELECT rv.vendor_id FROM rfq_vendors rv
        WHERE rv.rfq_id = :id AND rv.is_off_system = FALSE
          AND NOT EXISTS (SELECT 1 FROM quotations q WHERE q.rfq_id = rv.rfq_id AND q.vendor_id = rv.vendor_id)
    """, {"id": rfq_id})
    if not pending:
        raise HTTPException(400, "No pending vendors to simulate — all invited vendors already have a quotation")

    payment_terms_options = ["30 days credit", "45 days credit", "Net 60 days", "Advance"]
    simulated = []
    for row in pending:
        amount = round(base_amount * random.uniform(0.92, 1.15), 2)
        await execute(db, """
            INSERT INTO quotations (rfq_id, vendor_id, amount, gst_rate, delivery_days, payment_terms, notes)
            VALUES (:r, :v, :amt, 18.0, :dd, :pt, 'Simulated vendor reply (demo)')
            ON CONFLICT (rfq_id, vendor_id) DO NOTHING
        """, {"r": rfq_id, "v": row["vendor_id"], "amt": amount,
              "dd": random.randint(5, 20), "pt": random.choice(payment_terms_options)})
        simulated.append(row["vendor_id"])

    await execute(db, "UPDATE rfqs SET status = 'quotations_received' WHERE id = :id AND status = 'sent'",
                  {"id": rfq_id})
    if rfq["requisition_id"]:
        await execute(db, """
            UPDATE requisitions SET status = 'quotation_comparison', updated_at = now()
            WHERE id = :id AND status = 'rfq_issued'
        """, {"id": rfq["requisition_id"]})
    await log_action(db, user["sub"], user["name"], "Simulated vendor quotations (demo)", "rfq", rfq_id,
                     f"{len(simulated)} vendor(s)")
    return {"id": rfq_id, "simulated_vendor_ids": simulated}


@router.post("/rfqs/{rfq_id:path}/quotations/{vendor_id}/document")
async def upload_quotation_document(rfq_id: str, vendor_id: str, file: UploadFile = File(...),
                                    db: AsyncSession = Depends(get_db),
                                    user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    """Attach the vendor's signed quotation (PDF/scan) to a recorded quotation."""
    q = await fetch_one(db, "SELECT id FROM quotations WHERE rfq_id = :r AND vendor_id = :v", {"r": rfq_id, "v": vendor_id})
    if not q:
        raise HTTPException(404, "Quotation not found — add the quotation before attaching a document")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large — maximum 10 MB")
    doc_id = f"QDOC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"
    await execute(db, """
        INSERT INTO quotation_documents (id, quotation_id, filename, mime_type, file_size, file_data)
        VALUES (:id, :qid, :fn, :mt, :fs, :fd)
    """, {"id": doc_id, "qid": q["id"], "fn": file.filename, "mt": file.content_type,
          "fs": len(contents), "fd": contents})
    return {"doc_id": doc_id, "filename": file.filename}


@router.get("/quotations/documents/{doc_id}")
async def get_quotation_document(doc_id: str, db: AsyncSession = Depends(get_db),
                                 _: dict = Depends(get_current_user)):
    doc = await fetch_one(db, "SELECT * FROM quotation_documents WHERE id = :id", {"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    return Response(content=bytes(doc["file_data"]), media_type=doc["mime_type"] or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{doc["filename"]}"'})


class FinalizeBody(BaseModel):
    vendor_id: str
    override_reason: str | None = None


@router.post("/rfqs/{rfq_id:path}/finalize")
async def finalize_rfq(rfq_id: str, body: FinalizeBody, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if rfq["status"] != "quotations_received":
        raise HTTPException(409, f"RFQ must have quotations to compare (is '{rfq['status']}')")
    quotes = await fetch_all(db, "SELECT * FROM quotations WHERE rfq_id = :id ORDER BY amount", {"id": rfq_id})
    if not quotes:
        raise HTTPException(400, "No quotations to select a winner from")
    if body.vendor_id not in {q["vendor_id"] for q in quotes}:
        raise HTTPException(400, "Selected vendor has not quoted for this RFQ")
    await _require_active_vendor(db, body.vendor_id)
    lowest = quotes[0]["vendor_id"]
    if body.vendor_id != lowest and not body.override_reason:
        raise HTTPException(400, "Selecting a non-lowest quote requires an override reason (controlled override)")
    await execute(db, """
        UPDATE rfqs SET status = 'finalized', awarded_vendor_id = :v, award_override_reason = :r WHERE id = :id
    """, {"v": body.vendor_id, "r": body.override_reason, "id": rfq_id})
    await log_action(db, user["sub"], user["name"], "Finalized RFQ winner", "rfq", rfq_id,
                     f"Vendor {body.vendor_id}" + (f" · OVERRIDE: {body.override_reason}" if body.override_reason else " · lowest quote"))
    return {"id": rfq_id, "awarded_vendor_id": body.vendor_id, "override": bool(body.override_reason)}


class CancelBody(BaseModel):
    reason: str = ""


@router.post("/rfqs/{rfq_id:path}/cancel")
async def cancel_rfq(rfq_id: str, body: CancelBody, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if rfq["status"] in ("finalized", "cancelled"):
        raise HTTPException(409, f"RFQ is already '{rfq['status']}'")
    await execute(db, "UPDATE rfqs SET status = 'cancelled' WHERE id = :id", {"id": rfq_id})
    await log_action(db, user["sub"], user["name"], "Cancelled RFQ", "rfq", rfq_id, body.reason)
    return {"id": rfq_id, "status": "cancelled"}


# ---------- Purchase Orders ----------

@router.get("/pos")
async def list_pos(status: str | None = None, db: AsyncSession = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT p.*, v.name AS vendor_name, v.is_msme, d.name AS department_name, b.name AS branch_name,
               req.title AS requisition_title,
               (SELECT COUNT(*) FROM grns g WHERE g.po_id = p.id) AS grn_count
        FROM purchase_orders p
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN departments d ON d.id = p.department_id
        LEFT JOIN branches b ON b.id = p.branch_id
        LEFT JOIN requisitions req ON req.id = p.requisition_id
        WHERE (CAST(:status AS TEXT) IS NULL OR p.status = :status)
        ORDER BY p.issued_at DESC
    """, {"status": status})


@router.get("/pos/{po_id:path}/detail")
async def po_detail(po_id: str, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    po = await fetch_one(db, """
        SELECT p.*, v.name AS vendor_name, req.title AS requisition_title
        FROM purchase_orders p
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN requisitions req ON req.id = p.requisition_id
        WHERE p.id = :id
    """, {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    lines = await fetch_all(db, "SELECT * FROM po_lines WHERE po_id = :id ORDER BY id", {"id": po_id})
    grns = await fetch_all(db, "SELECT * FROM grns WHERE po_id = :id ORDER BY received_at DESC", {"id": po_id})
    invoices = await fetch_all(db, "SELECT id, stage, total_amount FROM invoices WHERE po_id = :id", {"id": po_id})

    # "Procurement Intel": last time this category was paid, for a quick rate sanity check
    # on the review page — same idea as the RFQ comparison's Last Purchase Reference.
    last_purchase = None
    if po.get("category_id"):
        lp = await fetch_one(db, """
            SELECT p.issued_at, v.name AS vendor_name, pl.description, pl.unit_price
            FROM purchase_orders p JOIN vendors v ON v.id = p.vendor_id
            LEFT JOIN po_lines pl ON pl.po_id = p.id
            WHERE p.category_id = :cat AND p.id != :self
            ORDER BY p.issued_at DESC LIMIT 1
        """, {"cat": po["category_id"], "self": po_id})
        if lp and lp.get("unit_price"):
            last_purchase = {"vendor_name": lp["vendor_name"], "description": lp["description"],
                             "rate": float(lp["unit_price"]), "procured_at": lp["issued_at"]}

    return {**po, "lines": lines, "grns": grns, "invoices": invoices, "last_purchase": last_purchase}


class POLine(BaseModel):
    description: str
    quantity: float
    uom: str = "NOS"
    unit_price: float
    gst_rate: float = 18.0


class POCreate(BaseModel):
    vendor_id: str | None = None
    requisition_id: str | None = None
    rfq_id: str | None = None
    department_id: str | None = None
    category_id: str | None = None
    branch_id: str | None = None
    agreement_based: bool = False
    payment_terms: str | None = None
    delivery_terms: str | None = None
    notes: str | None = None
    lines: list[POLine] = []


@router.post("/pos")
async def create_po(body: POCreate, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    requisition_id = body.requisition_id
    department_id, category_id, branch_id = body.department_id, body.category_id, body.branch_id
    payment_terms, delivery_terms, notes = body.payment_terms, body.delivery_terms, body.notes
    vendor_id, lines = body.vendor_id, body.lines

    if body.rfq_id:
        # ---- Create from a finalized RFQ: auto-fill vendor / lines / terms ----
        rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": body.rfq_id})
        if not rfq:
            raise HTTPException(404, "RFQ not found")
        if rfq["status"] != "finalized" or not rfq["awarded_vendor_id"]:
            raise HTTPException(409, "PO can only be created from a finalized RFQ with a selected winner")
        req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": rfq["requisition_id"]})
        if not req:
            raise HTTPException(404, "Source requisition not found")
        quote = await fetch_one(db, "SELECT * FROM quotations WHERE rfq_id = :r AND vendor_id = :v",
                                {"r": body.rfq_id, "v": rfq["awarded_vendor_id"]})
        req_lines = await fetch_all(db, "SELECT * FROM requisition_lines WHERE requisition_id = :id ORDER BY id",
                                    {"id": req["id"]})
        total_est = float(req["total_amount"]) or sum(float(l["quantity"]) * float(l["est_unit_price"]) for l in req_lines)
        # quotations.amount is GST-INCLUSIVE (matches the "Total incl. GST" comparison column) —
        # back the tax out here so create_po's own taxable+GST math doesn't double-tax the PO.
        quote_gst_rate = float(quote["gst_rate"]) if quote and quote.get("gst_rate") is not None else 18.0
        quote_amount = float(quote["amount"]) if quote else total_est
        quote_amount_pretax = quote_amount / (1 + quote_gst_rate / 100) if quote else quote_amount
        built_lines = []
        for rl in req_lines:
            est_line_total = float(rl["quantity"]) * float(rl["est_unit_price"])
            share = (est_line_total / total_est) if total_est else (1 / len(req_lines) if req_lines else 0)
            line_total = quote_amount_pretax * share
            qty = float(rl["quantity"]) or 1
            built_lines.append(POLine(description=rl["description"], quantity=qty, uom=rl["uom"],
                                      unit_price=round(line_total / qty, 2), gst_rate=quote_gst_rate))
        vendor_id = rfq["awarded_vendor_id"]
        requisition_id = req["id"]
        department_id, category_id, branch_id = req["department_id"], req["category_id"], req["branch_id"]
        lines = built_lines
        payment_terms = payment_terms or (quote["payment_terms"] if quote else None)
        delivery_terms = delivery_terms or (f"Delivery within {quote['delivery_days']} days"
                                            if quote and quote.get("delivery_days") else None)
    else:
        if not vendor_id or not lines:
            raise HTTPException(400, "vendor_id and lines are required for an independent PO")

    await _require_active_vendor(db, vendor_id)
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM purchase_orders WHERE id LIKE :p",
                          {"p": f"PO/{date.today():%Y/%m}/%"})
    po_id = f"PO/{date.today():%Y/%m}/{seq['n']:05d}"
    taxable = sum(l.quantity * l.unit_price for l in lines)
    gst = sum(l.quantity * l.unit_price * l.gst_rate / 100 for l in lines)
    await execute(db, """
        INSERT INTO purchase_orders (id, requisition_id, rfq_id, vendor_id, department_id, category_id,
                                     branch_id, amount, gst_amount, agreement_based, payment_terms, delivery_terms,
                                     notes, esign_status, status, created_by)
        VALUES (:id, :req, :rfq, :v, :d, :c, :b, :amt, :gst, :ab, :pt, :dt, :n, :es, 'draft', :u)
    """, {"id": po_id, "req": requisition_id, "rfq": body.rfq_id, "v": vendor_id,
          "d": department_id, "c": category_id, "b": branch_id,
          "amt": round(taxable + gst, 2), "gst": round(gst, 2), "ab": body.agreement_based,
          "pt": payment_terms, "dt": delivery_terms, "n": notes,
          "es": "pending" if body.agreement_based else "not_required", "u": user["sub"]})
    for l in lines:
        await execute(db, """
            INSERT INTO po_lines (po_id, description, quantity, uom, unit_price, gst_rate)
            VALUES (:p, :d, :q, :u, :pr, :g)
        """, {"p": po_id, "d": l.description, "q": l.quantity, "u": l.uom, "pr": l.unit_price, "g": l.gst_rate})
    if requisition_id:
        await execute(db, "UPDATE requisitions SET status = 'po_created', updated_at = now() WHERE id = :id",
                      {"id": requisition_id})
    await log_action(db, user["sub"], user["name"], "Issued purchase order", "po", po_id,
                     f"Vendor {vendor_id} · ₹{taxable + gst:,.0f}" +
                     (" · from RFQ" if body.rfq_id else " · independent path"))
    return {"id": po_id, "amount": round(taxable + gst, 2),
            "esign_required": body.agreement_based}


class POLineEdit(BaseModel):
    id: int
    quantity: float


class POEdit(BaseModel):
    lines: list[POLineEdit] | None = None
    payment_terms: str | None = None
    delivery_terms: str | None = None
    notes: str | None = None
    branch_id: str | None = None


@router.put("/pos/{po_id:path}")
async def update_po(po_id: str, body: POEdit, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    """Edit a draft PO before issue: quantities may only be decreased from the
    quoted amount (never increased without a fresh quotation), plus terms/notes/branch."""
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "draft":
        raise HTTPException(409, f"PO is '{po['status']}', can only be edited while draft")

    if body.lines:
        existing = await fetch_all(db, "SELECT * FROM po_lines WHERE po_id = :id", {"id": po_id})
        by_id = {l["id"]: l for l in existing}
        for le in body.lines:
            orig = by_id.get(le.id)
            if not orig:
                raise HTTPException(400, f"Line {le.id} not found on this PO")
            if le.quantity <= 0:
                raise HTTPException(400, "Quantity must be greater than zero")
            if le.quantity > float(orig["quantity"]) + 0.001:
                raise HTTPException(400, f"{orig['description']}: quantity can only be decreased from the quoted amount")
            await execute(db, "UPDATE po_lines SET quantity = :q WHERE id = :id", {"q": le.quantity, "id": le.id})
        refreshed = await fetch_all(db, "SELECT * FROM po_lines WHERE po_id = :id", {"id": po_id})
        taxable = sum(float(l["quantity"]) * float(l["unit_price"]) for l in refreshed)
        gst = sum(float(l["quantity"]) * float(l["unit_price"]) * float(l["gst_rate"]) / 100 for l in refreshed)
        await execute(db, "UPDATE purchase_orders SET amount = :amt, gst_amount = :gst WHERE id = :id",
                      {"amt": round(taxable + gst, 2), "gst": round(gst, 2), "id": po_id})

    await execute(db, """
        UPDATE purchase_orders SET
            payment_terms = COALESCE(:pt, payment_terms),
            delivery_terms = COALESCE(:dt, delivery_terms),
            notes = COALESCE(:n, notes),
            branch_id = COALESCE(:b, branch_id)
        WHERE id = :id
    """, {"pt": body.payment_terms, "dt": body.delivery_terms, "n": body.notes, "b": body.branch_id, "id": po_id})
    await log_action(db, user["sub"], user["name"], "Edited draft PO", "po", po_id, "")
    return {"id": po_id, "status": "draft"}


@router.post("/pos/{po_id:path}/approve")
async def approve_po(po_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] not in ("draft", "pending_approval"):
        raise HTTPException(409, f"PO is '{po['status']}', cannot submit/approve")
    await execute(db, "UPDATE purchase_orders SET status = 'active' WHERE id = :id", {"id": po_id})
    await log_action(db, user["sub"], user["name"], "Approved/activated PO", "po", po_id, "")
    return {"id": po_id, "status": "active"}


@router.post("/pos/{po_id:path}/mark-awaiting-delivery")
async def mark_awaiting_delivery(po_id: str, db: AsyncSession = Depends(get_db),
                                 user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "active":
        raise HTTPException(409, f"PO is '{po['status']}', not active")
    await execute(db, "UPDATE purchase_orders SET status = 'awaiting_delivery' WHERE id = :id", {"id": po_id})
    await log_action(db, user["sub"], user["name"], "Marked PO awaiting delivery", "po", po_id, "")
    return {"id": po_id, "status": "awaiting_delivery"}


@router.post("/pos/{po_id:path}/esign")
async def esign_po(po_id: str, db: AsyncSession = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    result = await integration_service.esign_po(db, po_id, user["name"])
    await execute(db, "UPDATE purchase_orders SET esign_status = 'signed', esign_ref = :r WHERE id = :id",
                  {"r": result.get("reference"), "id": po_id})
    await log_action(db, user["sub"], user["name"], "e-Signed PO", "po", po_id,
                     f"Class-3 DSC · ref {result.get('reference')}")
    return result


# ---------- GRN ----------

@router.get("/grns")
async def list_grns(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT g.*, p.vendor_id, v.name AS vendor_name, b.name AS branch_name, u.full_name AS received_by_name,
               (SELECT COALESCE(SUM(qty_accepted), 0) FROM grn_lines WHERE grn_id = g.id) AS total_accepted,
               (SELECT COALESCE(SUM(qty_rejected), 0) FROM grn_lines WHERE grn_id = g.id) AS total_rejected
        FROM grns g
        JOIN purchase_orders p ON p.id = g.po_id
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN branches b ON b.id = g.branch_id
        LEFT JOIN users u ON u.id = g.received_by
        ORDER BY g.received_at DESC
    """)


@router.get("/grns/{grn_id:path}/detail")
async def grn_detail(grn_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    grn = await fetch_one(db, """
        SELECT g.*, p.vendor_id, v.name AS vendor_name FROM grns g
        JOIN purchase_orders p ON p.id = g.po_id JOIN vendors v ON v.id = p.vendor_id
        WHERE g.id = :id
    """, {"id": grn_id})
    if not grn:
        raise HTTPException(404, "GRN not found")
    lines = await fetch_all(db, """
        SELECT gl.*, pl.description, pl.quantity AS ordered_qty, pl.uom
        FROM grn_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
        WHERE gl.grn_id = :id ORDER BY gl.id
    """, {"id": grn_id})
    documents = await fetch_all(db, "SELECT id, filename FROM grn_documents WHERE grn_id = :id ORDER BY uploaded_at",
                                {"id": grn_id})
    return {**grn, "lines": lines, "documents": documents}


@router.post("/grns/{grn_id:path}/documents")
async def upload_grn_document(grn_id: str, file: UploadFile = File(...),
                              db: AsyncSession = Depends(get_db),
                              user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    """Attach photo evidence (or any supporting doc) to a GRN."""
    grn = await fetch_one(db, "SELECT id FROM grns WHERE id = :id", {"id": grn_id})
    if not grn:
        raise HTTPException(404, "GRN not found")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large — maximum 10 MB")
    doc_id = f"GDOC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"
    await execute(db, """
        INSERT INTO grn_documents (id, grn_id, filename, mime_type, file_size, file_data)
        VALUES (:id, :g, :fn, :mt, :fs, :fd)
    """, {"id": doc_id, "g": grn_id, "fn": file.filename, "mt": file.content_type,
          "fs": len(contents), "fd": contents})
    return {"doc_id": doc_id, "filename": file.filename}


@router.get("/grns/documents/{doc_id}")
async def get_grn_document(doc_id: str, db: AsyncSession = Depends(get_db),
                           _: dict = Depends(get_current_user)):
    doc = await fetch_one(db, "SELECT * FROM grn_documents WHERE id = :id", {"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    return Response(content=bytes(doc["file_data"]), media_type=doc["mime_type"] or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{doc["filename"]}"'})


class GRNLineIn(BaseModel):
    po_line_id: int
    qty_received: float = 0
    qty_accepted: float = 0
    qty_rejected: float = 0
    rejection_reason: str | None = None


class GRNCreate(BaseModel):
    po_id: str
    branch_id: str | None = None
    notes: str | None = None
    evidence: list[dict] = []
    lines: list[GRNLineIn] = []


@router.post("/grns")
async def create_grn(body: GRNCreate, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": body.po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] not in ("active", "awaiting_delivery"):
        raise HTTPException(409, f"GRN can only be created against an active or awaiting-delivery PO (is '{po['status']}')")

    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM grns WHERE id LIKE :p",
                          {"p": f"GRN/{date.today():%Y/%m}/%"})
    grn_id = f"GRN/{date.today():%Y/%m}/{seq['n']:04d}"
    await execute(db, """
        INSERT INTO grns (id, po_id, branch_id, received_by, evidence, notes, status)
        VALUES (:id, :po, :b, :u, CAST(:e AS jsonb), :n, 'draft')
    """, {"id": grn_id, "po": body.po_id, "b": body.branch_id, "u": user["sub"],
          "e": json.dumps(body.evidence), "n": body.notes})
    for l in body.lines:
        await execute(db, """
            INSERT INTO grn_lines (grn_id, po_line_id, qty_received, qty_accepted, qty_rejected, rejection_reason)
            VALUES (:g, :pl, :qr, :qa, :qj, :rr)
        """, {"g": grn_id, "pl": l.po_line_id, "qr": l.qty_received, "qa": l.qty_accepted,
              "qj": l.qty_rejected, "rr": l.rejection_reason})
    await log_action(db, user["sub"], user["name"], "Created GRN (draft)", "grn", grn_id,
                     f"PO {body.po_id} · {len(body.lines)} lines")
    return {"id": grn_id, "status": "draft"}


@router.post("/grns/{grn_id:path}/submit")
async def submit_grn(grn_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(require_roles(*PROCUREMENT_ROLE))):
    grn = await fetch_one(db, "SELECT * FROM grns WHERE id = :id", {"id": grn_id})
    if not grn:
        raise HTTPException(404, "GRN not found")
    if grn["status"] != "draft":
        raise HTTPException(409, f"GRN is '{grn['status']}', not draft")

    lines = await fetch_all(db, """
        SELECT gl.*, pl.quantity AS ordered_qty, pl.description
        FROM grn_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
        WHERE gl.grn_id = :id
    """, {"id": grn_id})
    if not lines:
        raise HTTPException(400, "GRN has no lines to submit")

    for l in lines:
        ordered = float(l["ordered_qty"] or 0)
        received, accepted, rejected = float(l["qty_received"]), float(l["qty_accepted"]), float(l["qty_rejected"])
        if received > ordered + 0.001:
            raise HTTPException(400, f"{l['description']}: received qty ({received}) exceeds ordered qty ({ordered})")
        if abs(accepted + rejected - received) > 0.001:
            raise HTTPException(400, f"{l['description']}: accepted + rejected must equal received qty")
        if rejected > 0 and not (l["rejection_reason"] or "").strip():
            raise HTTPException(400, f"{l['description']}: rejection reason is required when rejecting quantity")

    any_rejected = any(float(l["qty_rejected"]) > 0 for l in lines)
    fully_received = all(float(l["qty_received"]) >= float(l["ordered_qty"] or 0) - 0.001
                         and float(l["qty_accepted"]) >= float(l["ordered_qty"] or 0) - 0.001 for l in lines)
    if any_rejected:
        new_status = "received_with_rejection"
    elif fully_received:
        new_status = "fully_received"
    else:
        new_status = "partial"

    await execute(db, "UPDATE grns SET status = :s WHERE id = :id", {"s": new_status, "id": grn_id})

    # PO-level completion is cumulative across all GRNs against it (a PO can be
    # fulfilled via several partial deliveries), even though this GRN's own
    # status above reflects only what happened in this receipt event.
    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": grn["po_id"]})
    cumulative = await fetch_all(db, """
        SELECT pl.id, pl.quantity AS ordered_qty, COALESCE(SUM(gl.qty_accepted), 0) AS accepted_so_far
        FROM po_lines pl
        LEFT JOIN grn_lines gl ON gl.po_line_id = pl.id
        LEFT JOIN grns g ON g.id = gl.grn_id AND g.status != 'draft'
        WHERE pl.po_id = :po
        GROUP BY pl.id, pl.quantity
    """, {"po": grn["po_id"]})
    po_fully_received = bool(cumulative) and all(
        float(r["accepted_so_far"]) >= float(r["ordered_qty"] or 0) - 0.001 for r in cumulative)
    if po_fully_received:
        await execute(db, "UPDATE purchase_orders SET status = 'goods_received' WHERE id = :id", {"id": grn["po_id"]})
        if po and po["requisition_id"]:
            await execute(db, "UPDATE requisitions SET status = 'closed', updated_at = now() WHERE id = :id",
                          {"id": po["requisition_id"]})
    elif po and po["status"] == "active":
        await execute(db, "UPDATE purchase_orders SET status = 'awaiting_delivery' WHERE id = :id", {"id": grn["po_id"]})

    await log_action(db, user["sub"], user["name"], "Submitted GRN", "grn", grn_id,
                     f"PO {grn['po_id']} · result: {new_status}")
    return {"id": grn_id, "status": new_status}
