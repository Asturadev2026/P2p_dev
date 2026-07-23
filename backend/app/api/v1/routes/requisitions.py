import json
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user, require_roles
from app.utils.audit import log_action

router = APIRouter(prefix="/requisitions", tags=["requisitions"])

# Only Compliance approves a PR in this demo flow. The requisition-specific approval_rules
# bands (checker/cfo at higher amounts) are config-only and not wired to a live routing path
# (no approval_engine.route call exists for entity_type='requisition'), so checker/fc/cfo do
# not get PR approve/send-back/decline access here.
# Procurement only works on already-approved PRs (RFQ/PO/GRN); it does not approve them.
APPROVER_ROLES = ("compliance",)


class ReqLine(BaseModel):
    description: str
    quantity: float = 1
    uom: str = "NOS"
    est_unit_price: float = 0
    gl_code: str | None = None


class ReqCreate(BaseModel):
    title: str
    department_id: str
    category_id: str
    branch_id: str
    cost_center: str | None = None
    justification: str | None = None
    statutory_flags: dict = {}
    lines: list[ReqLine]


async def _resolve_pending_approvals(db: AsyncSession, req_id: str, decision: str, user: dict, comments: str = ""):
    """Demo approval: resolve any open generic-approval-engine rows for this PR
    so the Approval Workflow queue doesn't show a stale pending item once the
    simple Approve/Send Back/Decline action has already decided the PR."""
    status = "approved" if decision == "approve" else "rejected"
    await execute(db, """
        UPDATE approvals SET status = :s, acted_by = :u, acted_at = now(), comments = :c
        WHERE entity_type = 'requisition' AND entity_id = :id AND status = 'pending'
    """, {"s": status, "u": user["sub"], "c": comments, "id": req_id})


@router.get("")
async def list_requisitions(status: str | None = None, category_id: str | None = None,
                            db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    own_only = user["role"] == "requester"
    compliance_queue = user["role"] == "compliance"
    procurement_queue = user["role"] == "procurement"
    where = """WHERE (CAST(:status AS TEXT) IS NULL OR r.status = :status)
               AND (CAST(:category_id AS TEXT) IS NULL OR r.category_id = :category_id)
               AND (CAST(:own AS BOOLEAN) IS NOT TRUE OR r.requester_id = :uid)
               AND (CAST(:queue AS BOOLEAN) IS NOT TRUE OR r.status = 'pending_approval')
               AND (CAST(:proc_queue AS BOOLEAN) IS NOT TRUE
                    OR r.status IN ('approved', 'rfq_issued', 'quotation_comparison', 'po_created', 'closed'))"""
    return await fetch_all(db, f"""
        SELECT r.*, d.name AS department_name, c.name AS category_name,
               b.name AS branch_name, u.full_name AS requester_name
        FROM requisitions r
        JOIN departments d ON d.id = r.department_id
        JOIN spend_categories c ON c.id = r.category_id
        JOIN branches b ON b.id = r.branch_id
        JOIN users u ON u.id = r.requester_id
        {where} ORDER BY r.created_at DESC
    """, {"status": status, "category_id": category_id, "own": own_only, "uid": user["sub"],
          "queue": compliance_queue, "proc_queue": procurement_queue})


@router.get("/{req_id:path}/detail")
async def get_requisition(req_id: str, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    req = await fetch_one(db, """
        SELECT r.*, d.name AS department_name, c.name AS category_name,
               b.name AS branch_name, u.full_name AS requester_name
        FROM requisitions r
        JOIN departments d ON d.id = r.department_id
        JOIN spend_categories c ON c.id = r.category_id
        JOIN branches b ON b.id = r.branch_id
        JOIN users u ON u.id = r.requester_id
        WHERE r.id = :id
    """, {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if user["role"] == "requester" and req["requester_id"] != user["sub"]:
        raise HTTPException(403, "You can only view your own requisitions")
    lines = await fetch_all(db, "SELECT * FROM requisition_lines WHERE requisition_id = :id ORDER BY id", {"id": req_id})
    approvals = await fetch_all(db, """
        SELECT a.*, u.full_name AS assigned_name, au.full_name AS acted_name
        FROM approvals a
        LEFT JOIN users u ON u.id = a.assigned_to
        LEFT JOIN users au ON au.id = a.acted_by
        WHERE a.entity_type = 'requisition' AND a.entity_id = :id ORDER BY a.stage_no
    """, {"id": req_id})
    rfqs = await fetch_all(db, "SELECT id, status FROM rfqs WHERE requisition_id = :id ORDER BY created_at DESC", {"id": req_id})
    pos = await fetch_all(db, "SELECT id, status FROM purchase_orders WHERE requisition_id = :id ORDER BY issued_at DESC", {"id": req_id})
    return {**req, "lines": lines, "approvals": approvals, "rfqs": rfqs, "purchase_orders": pos}


@router.post("")
async def create_requisition(body: ReqCreate, db: AsyncSession = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM requisitions WHERE id LIKE :p",
                          {"p": f"PR/{date.today():%Y/%m}/%"})
    req_id = f"PR/{date.today():%Y/%m}/{seq['n']:04d}"
    total = sum(l.quantity * l.est_unit_price for l in body.lines)
    await execute(db, """
        INSERT INTO requisitions (id, title, department_id, category_id, branch_id, cost_center,
                                  requester_id, justification, statutory_flags, total_amount, status)
        VALUES (:id, :t, :d, :c, :b, :cc, :u, :j, CAST(:f AS jsonb), :amt, 'draft')
    """, {"id": req_id, "t": body.title, "d": body.department_id, "c": body.category_id,
          "b": body.branch_id, "cc": body.cost_center, "u": user["sub"], "j": body.justification,
          "f": json.dumps(body.statutory_flags), "amt": total})
    for l in body.lines:
        await execute(db, """
            INSERT INTO requisition_lines (requisition_id, description, quantity, uom, est_unit_price, gl_code)
            VALUES (:r, :d, :q, :u, :p, :g)
        """, {"r": req_id, "d": l.description, "q": l.quantity, "u": l.uom,
              "p": l.est_unit_price, "g": l.gl_code})
    await log_action(db, user["sub"], user["name"], "Created requisition", "requisition", req_id,
                     f"{body.title} · ₹{total:,.0f} · {len(body.lines)} lines")
    return {"id": req_id, "total_amount": total, "status": "draft"}


@router.put("/{req_id:path}")
async def update_requisition(req_id: str, body: ReqCreate, db: AsyncSession = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Edit an own draft/sent_back PR (Requester), then resubmit."""
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] not in ("draft", "sent_back"):
        raise HTTPException(400, f"Cannot edit from status '{req['status']}'")
    if req["requester_id"] != user["sub"] and user["role"] != "admin":
        raise HTTPException(403, "Only the requester can edit this PR")
    total = sum(l.quantity * l.est_unit_price for l in body.lines)
    await execute(db, """
        UPDATE requisitions SET title = :t, department_id = :d, category_id = :c, branch_id = :b,
            cost_center = :cc, justification = :j, statutory_flags = CAST(:f AS jsonb),
            total_amount = :amt, updated_at = now()
        WHERE id = :id
    """, {"t": body.title, "d": body.department_id, "c": body.category_id, "b": body.branch_id,
          "cc": body.cost_center, "j": body.justification, "f": json.dumps(body.statutory_flags),
          "amt": total, "id": req_id})
    await execute(db, "DELETE FROM requisition_lines WHERE requisition_id = :id", {"id": req_id})
    for l in body.lines:
        await execute(db, """
            INSERT INTO requisition_lines (requisition_id, description, quantity, uom, est_unit_price, gl_code)
            VALUES (:r, :d, :q, :u, :p, :g)
        """, {"r": req_id, "d": l.description, "q": l.quantity, "u": l.uom,
              "p": l.est_unit_price, "g": l.gl_code})
    await log_action(db, user["sub"], user["name"], "Edited requisition", "requisition", req_id,
                     f"₹{total:,.0f} · {len(body.lines)} lines")
    return {"id": req_id, "total_amount": total, "status": req["status"]}


@router.post("/{req_id:path}/submit")
async def submit_requisition(req_id: str, db: AsyncSession = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] not in ("draft", "sent_back"):
        raise HTTPException(400, f"Cannot submit from status '{req['status']}'")
    await execute(db, "UPDATE requisitions SET status = 'pending_approval', updated_at = now() WHERE id = :id",
                  {"id": req_id})
    await log_action(db, user["sub"], user["name"], "Submitted requisition for approval", "requisition", req_id, "")
    return {"id": req_id, "status": "pending_approval"}


class DecisionBody(BaseModel):
    comments: str = ""


@router.post("/{req_id:path}/approve")
async def approve_requisition(req_id: str, body: DecisionBody, db: AsyncSession = Depends(get_db),
                              user: dict = Depends(require_roles(*APPROVER_ROLES))):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] != "pending_approval":
        raise HTTPException(409, f"PR is '{req['status']}', not pending_approval")
    await execute(db, "UPDATE requisitions SET status = 'approved', updated_at = now() WHERE id = :id", {"id": req_id})
    await _resolve_pending_approvals(db, req_id, "approve", user, body.comments)
    await log_action(db, user["sub"], user["name"], "Approved requisition", "requisition", req_id, body.comments)
    return {"id": req_id, "status": "approved"}


@router.post("/{req_id:path}/send-back")
async def send_back_requisition(req_id: str, body: DecisionBody, db: AsyncSession = Depends(get_db),
                                user: dict = Depends(require_roles(*APPROVER_ROLES))):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] != "pending_approval":
        raise HTTPException(409, f"PR is '{req['status']}', not pending_approval")
    if not body.comments.strip():
        raise HTTPException(400, "A reason is required when sending a PR back")
    await execute(db, "UPDATE requisitions SET status = 'sent_back', updated_at = now() WHERE id = :id", {"id": req_id})
    await _resolve_pending_approvals(db, req_id, "reject", user, body.comments)
    await log_action(db, user["sub"], user["name"], "Sent requisition back", "requisition", req_id, body.comments)
    return {"id": req_id, "status": "sent_back"}


@router.post("/{req_id:path}/decline")
async def decline_requisition(req_id: str, body: DecisionBody, db: AsyncSession = Depends(get_db),
                              user: dict = Depends(require_roles(*APPROVER_ROLES))):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] != "pending_approval":
        raise HTTPException(409, f"PR is '{req['status']}', not pending_approval")
    if not body.comments.strip():
        raise HTTPException(400, "A reason is required to decline a PR")
    await execute(db, "UPDATE requisitions SET status = 'declined', updated_at = now() WHERE id = :id", {"id": req_id})
    await _resolve_pending_approvals(db, req_id, "reject", user, body.comments)
    await log_action(db, user["sub"], user["name"], "Declined requisition", "requisition", req_id, body.comments)
    return {"id": req_id, "status": "declined"}
