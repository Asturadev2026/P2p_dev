from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all
from app.core.security import get_current_user
from app.services import approval_engine

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("/queue")
async def my_queue(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Pending approvals actionable by the caller's role (admin sees all)."""
    role_filter = "" if user["role"] == "admin" else "AND a.stage_role = :role"
    return await fetch_all(db, f"""
        SELECT a.*, u.full_name AS assigned_name,
               CASE a.entity_type
                 WHEN 'invoice' THEN (SELECT v.name || ' · ₹' || TO_CHAR(i.total_amount, 'FM99,99,99,999')
                                      FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = a.entity_id)
                 WHEN 'requisition' THEN (SELECT r.title || ' · ₹' || TO_CHAR(r.total_amount, 'FM99,99,99,999')
                                          FROM requisitions r WHERE r.id = a.entity_id)
                 ELSE a.entity_id
               END AS entity_summary,
               NOT EXISTS (SELECT 1 FROM approvals p WHERE p.entity_type = a.entity_type
                           AND p.entity_id = a.entity_id AND p.stage_no < a.stage_no
                           AND p.status = 'pending') AS actionable
        FROM approvals a
        LEFT JOIN users u ON u.id = a.assigned_to
        WHERE a.status = 'pending' {role_filter}
        ORDER BY a.sla_due_at NULLS LAST, a.created_at
    """, {"role": user["role"]})


@router.get("/matrix")
async def approval_matrix(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, "SELECT * FROM approval_rules WHERE active ORDER BY entity_type, min_amount")


class ActBody(BaseModel):
    decision: str  # approve | reject
    comments: str = ""


@router.post("/{approval_id}/act")
async def act_on_approval(approval_id: int, body: ActBody, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be 'approve' or 'reject'")
    result = await approval_engine.act(db, approval_id, body.decision, user, body.comments)
    if "error" in result:
        raise HTTPException(409, result["error"])
    return result
