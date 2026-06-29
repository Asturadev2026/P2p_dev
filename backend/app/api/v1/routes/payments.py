"""Liability/JV, payment batches, bank payout file, UTR capture, remittance,
advances & imprest settlement."""
import csv
import io
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import integration_service, approval_engine
from app.utils.audit import log_action

router = APIRouter(prefix="/payments", tags=["payments"])


# ---------- Journal vouchers ----------

@router.get("/jvs")
async def list_jvs(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT j.*, i.vendor_id, v.name AS vendor_name
        FROM journal_vouchers j
        JOIN invoices i ON i.id = j.invoice_id
        JOIN vendors v ON v.id = i.vendor_id
        ORDER BY j.created_at DESC
    """)


@router.post("/jvs/{jv_id:path}/push")
async def push_jv(jv_id: str, db: AsyncSession = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    jv = await fetch_one(db, "SELECT * FROM journal_vouchers WHERE id = :id", {"id": jv_id})
    if not jv:
        raise HTTPException(404, "JV not found")
    if jv["status"] == "pushed":
        raise HTTPException(409, "JV already pushed")
    res = await integration_service.erp_push(db, "journal_voucher", jv_id,
                                             {"dr": jv["dr_gl"], "cr": jv["cr_gl"], "amount": float(jv["amount"])})
    await execute(db, """
        UPDATE journal_vouchers SET status = 'pushed', erp_doc_no = :doc, pushed_at = now() WHERE id = :id
    """, {"doc": res.get("erp_doc_no"), "id": jv_id})
    await log_action(db, user["sub"], user["name"], "Pushed JV to ERP", "journal_voucher", jv_id,
                     f"₹{float(jv['amount']):,.0f} · ERP doc {res.get('erp_doc_no')}")
    return {"id": jv_id, "erp_doc_no": res.get("erp_doc_no")}


# ---------- Payment batches ----------

@router.get("/batches")
async def list_batches(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    batches = await fetch_all(db, """
        SELECT b.*, u.full_name AS created_by_name,
               (SELECT COUNT(*) FROM payment_items pi WHERE pi.batch_id = b.id) AS item_count
        FROM payment_batches b LEFT JOIN users u ON u.id = b.created_by
        ORDER BY b.created_at DESC
    """)
    return batches


@router.get("/batches/{batch_id:path}/items")
async def batch_items(batch_id: str, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT pi.*, v.name AS vendor_name, v.bank_name, v.bank_account, v.bank_ifsc
        FROM payment_items pi JOIN vendors v ON v.id = pi.vendor_id
        WHERE pi.batch_id = :id ORDER BY pi.msme_priority DESC, pi.net_amount DESC
    """, {"id": batch_id})


class BatchCreate(BaseModel):
    invoice_ids: list[str]
    channel: str = "NEFT"


@router.post("/batches")
async def build_batch(body: BatchCreate, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM payment_batches WHERE id LIKE :p",
                          {"p": f"BATCH/{date.today():%Y/%m}/%"})
    batch_id = f"BATCH/{date.today():%Y/%m}/{seq['n']:02d}A"
    total = 0.0
    await execute(db, """
        INSERT INTO payment_batches (id, status, channel, created_by) VALUES (:id, 'building', :ch, :u)
    """, {"id": batch_id, "ch": body.channel, "u": user["sub"]})
    for inv_id in body.invoice_ids:
        inv = await fetch_one(db, """
            SELECT i.*, v.is_msme FROM invoices i JOIN vendors v ON v.id = i.vendor_id
            WHERE i.id = :id AND i.stage = 'payments'
        """, {"id": inv_id})
        if not inv:
            continue
        dup = await fetch_one(db, """
            SELECT pi.id FROM payment_items pi WHERE pi.invoice_id = :id AND pi.status != 'failed'
        """, {"id": inv_id})
        if dup:
            continue  # unauthorised double-payment blocked at source
        mode = "RTGS" if float(inv["net_payable"]) > 200000 and body.channel == "NEFT" else body.channel
        await execute(db, """
            INSERT INTO payment_items (batch_id, invoice_id, vendor_id, net_amount, mode, msme_priority)
            VALUES (:b, :i, :v, :amt, :m, :msme)
        """, {"b": batch_id, "i": inv_id, "v": inv["vendor_id"], "amt": inv["net_payable"],
              "m": mode, "msme": inv["is_msme"]})
        total += float(inv["net_payable"])
    await execute(db, "UPDATE payment_batches SET total_amount = :t WHERE id = :id",
                  {"t": total, "id": batch_id})
    await approval_engine.route(db, "payment_batch", batch_id, total, actor=user)
    await log_action(db, user["sub"], user["name"], "Built payment batch", "payment_batch", batch_id,
                     f"{len(body.invoice_ids)} invoices · ₹{total:,.0f} · {body.channel}")
    return {"id": batch_id, "total_amount": total}


@router.get("/batches/{batch_id:path}/file")
async def payout_file(batch_id: str, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    """Bank-ready bulk payout CSV."""
    items = await fetch_all(db, """
        SELECT pi.*, v.name AS vendor_name, v.bank_account, v.bank_ifsc
        FROM payment_items pi JOIN vendors v ON v.id = pi.vendor_id WHERE pi.batch_id = :id
    """, {"id": batch_id})
    if not items:
        raise HTTPException(404, "Batch empty or not found")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["beneficiary_name", "account_no", "ifsc", "amount", "mode", "narration"])
    for it in items:
        w.writerow([it["vendor_name"], it["bank_account"], it["bank_ifsc"],
                    f"{float(it['net_amount']):.2f}", it["mode"],
                    f"Intelezen Microfin · {it['invoice_id']}"])
    fname = f"intelezen_payout_{date.today():%Y%m%d}_{batch_id.split('/')[-1]}.csv"
    await execute(db, """
        UPDATE payment_batches SET file_name = :f,
            status = CASE WHEN status = 'building' THEN 'file_generated' ELSE status END
        WHERE id = :id
    """, {"f": fname, "id": batch_id})
    await log_action(db, user["sub"], user["name"], "Generated payout file", "payment_batch", batch_id,
                     f"{fname} · {len(items)} rows")
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={fname}"})


@router.post("/batches/{batch_id:path}/release")
async def release_batch(batch_id: str, db: AsyncSession = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    batch = await fetch_one(db, "SELECT * FROM payment_batches WHERE id = :id", {"id": batch_id})
    if not batch:
        raise HTTPException(404, "Batch not found")
    chain = await approval_engine.chain_status(db, "payment_batch", batch_id)
    if chain == "in_progress":
        raise HTTPException(409, "Batch approval chain still pending")
    if chain == "rejected":
        raise HTTPException(409, "Batch was rejected")
    await execute(db, "UPDATE payment_batches SET status = 'released', released_at = now() WHERE id = :id",
                  {"id": batch_id})
    await log_action(db, user["sub"], user["name"], "Released payment batch", "payment_batch", batch_id,
                     f"₹{float(batch['total_amount']):,.0f} handed to bank portal")
    return {"id": batch_id, "status": "released"}


@router.post("/batches/{batch_id:path}/capture-utr")
async def capture_utrs(batch_id: str, db: AsyncSession = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Pull the (simulated) bank UTR feed, mark items paid, advance invoices, send remittance."""
    items = await fetch_all(db, """
        SELECT pi.*, v.name AS vendor_name FROM payment_items pi
        JOIN vendors v ON v.id = pi.vendor_id
        WHERE pi.batch_id = :id AND pi.status = 'queued'
    """, {"id": batch_id})
    if not items:
        raise HTTPException(404, "No queued items in batch")
    utrs = await integration_service.capture_utr(
        db, batch_id, [{"invoice_id": i["invoice_id"], "mode": i["mode"]} for i in items])
    utr_map = {u["invoice_id"]: u for u in utrs}
    for it in items:
        u = utr_map.get(it["invoice_id"])
        if not u:
            continue
        await execute(db, """
            UPDATE payment_items SET utr = :utr, utr_captured_at = now(), status = 'paid',
                   remittance_sent = TRUE
            WHERE id = :id
        """, {"utr": u["utr"], "id": it["id"]})
        await execute(db, "UPDATE invoices SET stage = 'paid', updated_at = now() WHERE id = :id",
                      {"id": it["invoice_id"]})
        await execute(db, """
            INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
            VALUES (:id, 'payments', 'paid', :u, :n)
        """, {"id": it["invoice_id"], "u": user["sub"], "n": f"UTR {u['utr']} · remittance advice sent"})
        await execute(db, """
            UPDATE advances a SET balance = GREATEST(a.balance - s.amount, 0),
                status = CASE WHEN a.balance - s.amount <= 0 THEN 'settled' ELSE 'partially_settled' END
            FROM advance_settlements s
            WHERE s.advance_id = a.id AND s.invoice_id = :id AND a.status NOT IN ('settled')
        """, {"id": it["invoice_id"]})
    await execute(db, "UPDATE payment_batches SET status = 'reconciled' WHERE id = :id", {"id": batch_id})
    await log_action(db, user["sub"], user["name"], "Captured UTRs · sent remittance advices",
                     "payment_batch", batch_id, f"{len(utrs)} UTRs reconciled")
    return {"id": batch_id, "utrs": utrs}


@router.get("/items/{item_id}/remittance")
async def remittance_advice(item_id: int, db: AsyncSession = Depends(get_db),
                            user: dict = Depends(get_current_user)):
    """Branded remittance advice (text render; PDF in production)."""
    it = await fetch_one(db, """
        SELECT pi.*, v.name AS vendor_name, v.email, i.vendor_invoice_no, i.tds_amount, i.total_amount
        FROM payment_items pi
        JOIN vendors v ON v.id = pi.vendor_id
        JOIN invoices i ON i.id = pi.invoice_id
        WHERE pi.id = :id
    """, {"id": item_id})
    if not it:
        raise HTTPException(404, "Payment item not found")
    return {
        "letterhead": "Intelezen Microfin Limited · AXIS, BMC Chowk, GT Road, Jalandhar, Punjab",
        "product": "AstonomiQ Procure-to-Pay",
        "vendor": it["vendor_name"],
        "invoice_no": it["vendor_invoice_no"],
        "invoice_ref": it["invoice_id"],
        "gross_amount": float(it["total_amount"]),
        "tds_deducted": float(it["tds_amount"]),
        "net_paid": float(it["net_amount"]),
        "mode": it["mode"], "utr": it["utr"], "paid_at": it["utr_captured_at"],
    }


# ---------- Advances & imprest ----------

@router.get("/advances")
async def list_advances(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT a.*, v.name AS vendor_name, u.full_name AS holder_name,
               d.name AS department_name, b.name AS branch_name,
               (SELECT COALESCE(SUM(s.amount), 0) FROM advance_settlements s WHERE s.advance_id = a.id) AS settled_amount
        FROM advances a
        LEFT JOIN vendors v ON v.id = a.vendor_id
        LEFT JOIN users u ON u.id = a.holder_id
        LEFT JOIN departments d ON d.id = a.department_id
        LEFT JOIN branches b ON b.id = a.branch_id
        ORDER BY a.created_at DESC
    """)


class AdvanceCreate(BaseModel):
    advance_type: str = "vendor_advance"
    vendor_id: str | None = None
    holder_id: str | None = None
    po_id: str | None = None
    department_id: str | None = None
    branch_id: str | None = None
    amount: float
    purpose: str | None = None


@router.post("/advances")
async def create_advance(body: AdvanceCreate, db: AsyncSession = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM advances WHERE id LIKE :p",
                          {"p": f"ADV/{date.today():%Y/%m}/%"})
    adv_id = f"ADV/{date.today():%Y/%m}/{seq['n']:04d}"
    await execute(db, """
        INSERT INTO advances (id, advance_type, vendor_id, holder_id, po_id, department_id, branch_id,
                              amount, balance, purpose, status)
        VALUES (:id, :t, :v, :h, :po, :d, :b, :amt, :amt, :p, 'pending_approval')
    """, {"id": adv_id, "t": body.advance_type, "v": body.vendor_id, "h": body.holder_id,
          "po": body.po_id, "d": body.department_id, "b": body.branch_id,
          "amt": body.amount, "p": body.purpose})
    await approval_engine.route(db, "advance", adv_id, body.amount, body.department_id, actor=user)
    await log_action(db, user["sub"], user["name"], "Created advance", "advance", adv_id,
                     f"{body.advance_type} · ₹{body.amount:,.0f} · {body.purpose or ''}")
    return {"id": adv_id, "status": "pending_approval"}


class SettleBody(BaseModel):
    invoice_id: str
    amount: float
    note: str | None = None


@router.post("/advances/{adv_id:path}/settle")
async def settle_advance(adv_id: str, body: SettleBody, db: AsyncSession = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    adv = await fetch_one(db, "SELECT * FROM advances WHERE id = :id", {"id": adv_id})
    if not adv:
        raise HTTPException(404, "Advance not found")
    if body.amount > float(adv["balance"]):
        raise HTTPException(400, f"Settlement exceeds balance ₹{float(adv['balance']):,.0f}")
    await execute(db, """
        INSERT INTO advance_settlements (advance_id, invoice_id, amount, note)
        VALUES (:a, :i, :amt, :n)
    """, {"a": adv_id, "i": body.invoice_id, "amt": body.amount, "n": body.note})
    new_balance = float(adv["balance"]) - body.amount
    await execute(db, """
        UPDATE advances SET balance = :b,
            status = CASE WHEN :b <= 0 THEN 'settled' ELSE 'partially_settled' END
        WHERE id = :id
    """, {"b": new_balance, "id": adv_id})
    await log_action(db, user["sub"], user["name"], "Settled advance against bill", "advance", adv_id,
                     f"₹{body.amount:,.0f} adjusted vs {body.invoice_id} · balance ₹{new_balance:,.0f}")
    return {"id": adv_id, "balance": new_balance}
