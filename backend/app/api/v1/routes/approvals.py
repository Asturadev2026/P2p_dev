from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all
from app.core.security import get_current_user, deny_roles, require_exact_roles
from app.services import approval_engine

# Requesters have no stake in AP/advance approvals at all.
router = APIRouter(prefix="/approvals", tags=["approvals"],
                   dependencies=[Depends(deny_roles("requester", message="Requesters have no access to Approval Workflow"))])

# Only Checker/FC/CFO ever act on an approval stage — Maker (segregation of duties),
# Compliance (no live approval stage assigned yet), Auditor, Treasury, Procurement, and
# Admin (config-only, no transaction bypass) are all view/review-only here.
_APPROVAL_ACTION_MSG = "You do not have permission for this approval action."
_APPROVAL_ACTORS = require_exact_roles("checker", "fc", "cfo", message=_APPROVAL_ACTION_MSG)


@router.get("/queue")
async def my_queue(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Pending approvals actionable by the caller's role (admin sees all)."""
    role_filter = "" if user["role"] == "admin" else "AND a.stage_role = :role"
    # Checker/Pradip's Approval Workflow shows invoice + advance approvals — requisition
    # and payment batch approvals stay in the approvals table untouched, just filtered here.
    entity_filter = "AND a.entity_type IN ('invoice', 'advance')" if user["role"] == "checker" else ""
    return await fetch_all(db, f"""
        SELECT a.*, u.full_name AS assigned_name,
               CASE a.entity_type
                 WHEN 'invoice' THEN (SELECT v.name || ' · ₹' || TO_CHAR(i.total_amount, 'FM99,99,99,999')
                                      FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = a.entity_id)
                 WHEN 'requisition' THEN (SELECT r.title || ' · ₹' || TO_CHAR(r.total_amount, 'FM99,99,99,999')
                                          FROM requisitions r WHERE r.id = a.entity_id)
                 WHEN 'advance' THEN (SELECT COALESCE(v.name, u2.full_name) || ' · ₹' || TO_CHAR(av.amount, 'FM99,99,99,999')
                                      FROM advances av LEFT JOIN vendors v ON v.id = av.vendor_id
                                      LEFT JOIN users u2 ON u2.id = av.holder_id WHERE av.id = a.entity_id)
                 ELSE a.entity_id
               END AS entity_summary,
               NOT EXISTS (SELECT 1 FROM approvals p WHERE p.entity_type = a.entity_type
                           AND p.entity_id = a.entity_id AND p.stage_no < a.stage_no
                           AND p.status = 'pending') AS actionable
        FROM approvals a
        LEFT JOIN users u ON u.id = a.assigned_to
        WHERE a.status = 'pending' {role_filter} {entity_filter}
        ORDER BY a.sla_due_at NULLS LAST, a.created_at
    """, {"role": user["role"]})


@router.get("/matrix")
async def approval_matrix(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, "SELECT * FROM approval_rules WHERE active ORDER BY entity_type, min_amount")


class ActBody(BaseModel):
    decision: str  # approve | reject | send_back
    comments: str = ""


@router.post("/{approval_id}/act")
async def act_on_approval(approval_id: int, body: ActBody, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(_APPROVAL_ACTORS)):
    if body.decision not in ("approve", "reject", "send_back"):
        raise HTTPException(400, "decision must be 'approve', 'reject', or 'send_back'")
    if body.decision in ("reject", "send_back") and not body.comments.strip():
        raise HTTPException(400, "A remark is required when rejecting or sending back")
    result = await approval_engine.act(db, approval_id, body.decision, user, body.comments)
    if "error" in result:
        raise HTTPException(409, result["error"])
    return result
