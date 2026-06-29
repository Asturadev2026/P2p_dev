"""RFQ & quotation comparison, purchase orders, GRNs."""
import json
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import integration_service
from app.utils.audit import log_action

router = APIRouter(prefix="/procurement", tags=["procurement"])


# ---------- RFQ ----------

@router.get("/rfqs")
async def list_rfqs(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT r.*, req.title AS requisition_title, v.name AS awarded_vendor_name,
               (SELECT COUNT(*) FROM quotations q WHERE q.rfq_id = r.id) AS quote_count
        FROM rfqs r
        LEFT JOIN requisitions req ON req.id = r.requisition_id
        LEFT JOIN vendors v ON v.id = r.awarded_vendor_id
        ORDER BY r.created_at DESC
    """)


@router.get("/rfqs/{rfq_id:path}/detail")
async def rfq_detail(rfq_id: str, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    rfq = await fetch_one(db, "SELECT * FROM rfqs WHERE id = :id", {"id": rfq_id})
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    quotes = await fetch_all(db, """
        SELECT q.*, v.name AS vendor_name, v.is_msme, v.rating, v.tier
        FROM quotations q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.rfq_id = :id ORDER BY q.amount
    """, {"id": rfq_id})
    return {**rfq, "quotations": quotes}


class AwardBody(BaseModel):
    vendor_id: str
    override_reason: str | None = None


@router.post("/rfqs/{rfq_id:path}/award")
async def award_rfq(rfq_id: str, body: AwardBody, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    quotes = await fetch_all(db, "SELECT * FROM quotations WHERE rfq_id = :id ORDER BY amount", {"id": rfq_id})
    if not quotes:
        raise HTTPException(400, "No quotations to award")
    lowest = quotes[0]["vendor_id"]
    if body.vendor_id != lowest and not body.override_reason:
        raise HTTPException(400, "Awarding a non-lowest quote requires an override reason (controlled override)")
    await execute(db, """
        UPDATE rfqs SET status = 'awarded', awarded_vendor_id = :v, award_override_reason = :r WHERE id = :id
    """, {"v": body.vendor_id, "r": body.override_reason, "id": rfq_id})
    await log_action(db, user["sub"], user["name"], "Awarded RFQ", "rfq", rfq_id,
                     f"Vendor {body.vendor_id}" + (f" · OVERRIDE: {body.override_reason}" if body.override_reason else " · lowest quote"))
    return {"id": rfq_id, "awarded_vendor_id": body.vendor_id, "override": bool(body.override_reason)}


# ---------- Purchase Orders ----------

@router.get("/pos")
async def list_pos(status: str | None = None, db: AsyncSession = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT p.*, v.name AS vendor_name, v.is_msme, d.name AS department_name, b.name AS branch_name,
               (SELECT COUNT(*) FROM grns g WHERE g.po_id = p.id) AS grn_count
        FROM purchase_orders p
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN departments d ON d.id = p.department_id
        LEFT JOIN branches b ON b.id = p.branch_id
        WHERE (CAST(:status AS TEXT) IS NULL OR p.status = :status)
        ORDER BY p.issued_at DESC
    """, {"status": status})


@router.get("/pos/{po_id:path}/detail")
async def po_detail(po_id: str, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    po = await fetch_one(db, """
        SELECT p.*, v.name AS vendor_name FROM purchase_orders p
        JOIN vendors v ON v.id = p.vendor_id WHERE p.id = :id
    """, {"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    lines = await fetch_all(db, "SELECT * FROM po_lines WHERE po_id = :id ORDER BY id", {"id": po_id})
    grns = await fetch_all(db, "SELECT * FROM grns WHERE po_id = :id", {"id": po_id})
    invoices = await fetch_all(db, "SELECT id, stage, total_amount FROM invoices WHERE po_id = :id", {"id": po_id})
    return {**po, "lines": lines, "grns": grns, "invoices": invoices}


class POLine(BaseModel):
    description: str
    quantity: float
    uom: str = "NOS"
    unit_price: float
    gst_rate: float = 18.0


class POCreate(BaseModel):
    vendor_id: str
    requisition_id: str | None = None
    rfq_id: str | None = None
    department_id: str | None = None
    category_id: str | None = None
    branch_id: str | None = None
    agreement_based: bool = False
    lines: list[POLine]


@router.post("/pos")
async def create_po(body: POCreate, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM purchase_orders WHERE id LIKE :p",
                          {"p": f"PO/{date.today():%Y/%m}/%"})
    po_id = f"PO/{date.today():%Y/%m}/{seq['n']:05d}"
    taxable = sum(l.quantity * l.unit_price for l in body.lines)
    gst = sum(l.quantity * l.unit_price * l.gst_rate / 100 for l in body.lines)
    await execute(db, """
        INSERT INTO purchase_orders (id, requisition_id, rfq_id, vendor_id, department_id, category_id,
                                     branch_id, amount, gst_amount, agreement_based, esign_status, status, created_by)
        VALUES (:id, :req, :rfq, :v, :d, :c, :b, :amt, :gst, :ab, :es, 'open', :u)
    """, {"id": po_id, "req": body.requisition_id, "rfq": body.rfq_id, "v": body.vendor_id,
          "d": body.department_id, "c": body.category_id, "b": body.branch_id,
          "amt": round(taxable + gst, 2), "gst": round(gst, 2), "ab": body.agreement_based,
          "es": "pending" if body.agreement_based else "not_required", "u": user["sub"]})
    for l in body.lines:
        await execute(db, """
            INSERT INTO po_lines (po_id, description, quantity, uom, unit_price, gst_rate)
            VALUES (:p, :d, :q, :u, :pr, :g)
        """, {"p": po_id, "d": l.description, "q": l.quantity, "u": l.uom, "pr": l.unit_price, "g": l.gst_rate})
    if body.requisition_id:
        await execute(db, "UPDATE requisitions SET status = 'converted_po' WHERE id = :id",
                      {"id": body.requisition_id})
    await log_action(db, user["sub"], user["name"], "Issued purchase order", "po", po_id,
                     f"Vendor {body.vendor_id} · ₹{taxable + gst:,.0f}" +
                     (" · from RFQ" if body.rfq_id else " · independent path"))
    return {"id": po_id, "amount": round(taxable + gst, 2),
            "esign_required": body.agreement_based}


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
        SELECT g.*, p.vendor_id, v.name AS vendor_name, b.name AS branch_name, u.full_name AS received_by_name
        FROM grns g
        JOIN purchase_orders p ON p.id = g.po_id
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN branches b ON b.id = g.branch_id
        LEFT JOIN users u ON u.id = g.received_by
        ORDER BY g.received_at DESC
    """)


class GRNLine(BaseModel):
    po_line_id: int | None = None
    qty_received: float
    qty_accepted: float
    variance_note: str | None = None


class GRNCreate(BaseModel):
    po_id: str
    branch_id: str | None = None
    evidence: list[dict] = []
    notes: str | None = None
    lines: list[GRNLine]


@router.post("/grns")
async def create_grn(body: GRNCreate, db: AsyncSession = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM grns WHERE id LIKE :p",
                          {"p": f"GRN/{date.today():%Y/%m}/%"})
    grn_id = f"GRN/{date.today():%Y/%m}/{seq['n']:04d}"
    await execute(db, """
        INSERT INTO grns (id, po_id, branch_id, received_by, evidence, notes)
        VALUES (:id, :po, :b, :u, CAST(:e AS jsonb), :n)
    """, {"id": grn_id, "po": body.po_id, "b": body.branch_id, "u": user["sub"],
          "e": json.dumps(body.evidence), "n": body.notes})
    for l in body.lines:
        await execute(db, """
            INSERT INTO grn_lines (grn_id, po_line_id, qty_received, qty_accepted, variance_note)
            VALUES (:g, :pl, :qr, :qa, :v)
        """, {"g": grn_id, "pl": l.po_line_id, "qr": l.qty_received, "qa": l.qty_accepted, "v": l.variance_note})
    await execute(db, """
        UPDATE purchase_orders SET status = 'partially_received'
        WHERE id = :po AND status = 'open'
    """, {"po": body.po_id})
    await log_action(db, user["sub"], user["name"], "Recorded GRN", "grn", grn_id,
                     f"PO {body.po_id} · {len(body.lines)} lines · {len(body.evidence)} evidence files")
    return {"id": grn_id}
