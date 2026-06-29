from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import approval_engine
from app.utils.audit import log_action

router = APIRouter(prefix="/requisitions", tags=["requisitions"])


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


@router.get("")
async def list_requisitions(status: str | None = None,
                            db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    where = "WHERE (CAST(:status AS TEXT) IS NULL OR r.status = :status)"
    return await fetch_all(db, f"""
        SELECT r.*, d.name AS department_name, c.name AS category_name,
               b.name AS branch_name, u.full_name AS requester_name
        FROM requisitions r
        JOIN departments d ON d.id = r.department_id
        JOIN spend_categories c ON c.id = r.category_id
        JOIN branches b ON b.id = r.branch_id
        JOIN users u ON u.id = r.requester_id
        {where} ORDER BY r.created_at DESC
    """, {"status": status})


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
    lines = await fetch_all(db, "SELECT * FROM requisition_lines WHERE requisition_id = :id ORDER BY id", {"id": req_id})
    approvals = await fetch_all(db, """
        SELECT a.*, u.full_name AS assigned_name, au.full_name AS acted_name
        FROM approvals a
        LEFT JOIN users u ON u.id = a.assigned_to
        LEFT JOIN users au ON au.id = a.acted_by
        WHERE a.entity_type = 'requisition' AND a.entity_id = :id ORDER BY a.stage_no
    """, {"id": req_id})
    return {**req, "lines": lines, "approvals": approvals}


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
          "f": __import__("json").dumps(body.statutory_flags), "amt": total})
    for l in body.lines:
        await execute(db, """
            INSERT INTO requisition_lines (requisition_id, description, quantity, uom, est_unit_price, gl_code)
            VALUES (:r, :d, :q, :u, :p, :g)
        """, {"r": req_id, "d": l.description, "q": l.quantity, "u": l.uom,
              "p": l.est_unit_price, "g": l.gl_code})
    await log_action(db, user["sub"], user["name"], "Created requisition", "requisition", req_id,
                     f"{body.title} · ₹{total:,.0f} · {len(body.lines)} lines")
    return {"id": req_id, "total_amount": total, "status": "draft"}


@router.post("/{req_id:path}/submit")
async def submit_requisition(req_id: str, db: AsyncSession = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    req = await fetch_one(db, "SELECT * FROM requisitions WHERE id = :id", {"id": req_id})
    if not req:
        raise HTTPException(404, "Requisition not found")
    if req["status"] != "draft":
        raise HTTPException(400, f"Cannot submit from status '{req['status']}'")
    msme_pref = (req["statutory_flags"] or {}).get("msme_pref", False)
    result = await approval_engine.route(db, "requisition", req_id, float(req["total_amount"]),
                                         req["department_id"], req["category_id"], msme_pref, user)
    new_status = "approved" if result["auto_approved"] else "pending_approval"
    await execute(db, "UPDATE requisitions SET status = :s, updated_at = now() WHERE id = :id",
                  {"s": new_status, "id": req_id})
    return {"id": req_id, "status": new_status,
            "stages": result["stages"], "auto_approved": result["auto_approved"]}
