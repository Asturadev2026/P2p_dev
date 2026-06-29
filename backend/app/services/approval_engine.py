"""Approval Engine — routes entities through Intelezen's configurable matrix.

Rules live in approval_rules (amount band × entity type × dept/category × MSME),
stages as JSON arrays. Nothing here is hard-coded: edit the table, not the code.
"""
import json
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_all, fetch_one, execute
from app.services.notification_service import notify_role
from app.utils.audit import log_action

ROLE_FOR_STAGE = {"maker": "maker", "checker": "checker", "fc": "fc", "cfo": "cfo"}


async def pick_rule(db: AsyncSession, entity_type: str, amount: float,
                    department_id: str | None = None, category_id: str | None = None,
                    is_msme: bool = False) -> dict | None:
    rules = await fetch_all(db, """
        SELECT * FROM approval_rules
        WHERE active AND entity_type = :et
          AND min_amount <= :amt AND (max_amount IS NULL OR max_amount >= :amt)
          AND (department_id IS NULL OR department_id = :dept)
          AND (category_id IS NULL OR category_id = :cat)
        ORDER BY msme_priority DESC, department_id NULLS LAST, category_id NULLS LAST, min_amount DESC
    """, {"et": entity_type, "amt": amount, "dept": department_id, "cat": category_id})
    if is_msme:
        msme = [r for r in rules if r["msme_priority"]]
        if msme:
            return msme[0]
    rules = [r for r in rules if not r["msme_priority"]]
    return rules[0] if rules else None


async def route(db: AsyncSession, entity_type: str, entity_id: str, amount: float,
                department_id: str | None = None, category_id: str | None = None,
                is_msme: bool = False, actor: dict | None = None) -> dict:
    """Create the approval chain for an entity. Returns {rule, stages, auto_approved}."""
    rule = await pick_rule(db, entity_type, amount, department_id, category_id, is_msme)
    if rule is None:
        return {"rule": None, "stages": [], "auto_approved": False}

    stages = rule["stages"] if isinstance(rule["stages"], list) else json.loads(rule["stages"])
    if stages == ["auto"]:
        await execute(db, """
            INSERT INTO approvals (entity_type, entity_id, rule_id, stage_no, stage_role, status, acted_at)
            VALUES (:et, :eid, :rid, 1, 'auto', 'auto_approved', now())
        """, {"et": entity_type, "eid": entity_id, "rid": rule["id"]})
        await log_action(db, None, "Approval Engine", "Auto-approved",
                         entity_type, entity_id,
                         f"Rule '{rule['rule_name']}' · amount ₹{amount:,.0f} below auto threshold")
        return {"rule": rule, "stages": stages, "auto_approved": True}

    sla_due = None
    if rule["sla_hours"]:
        sla_due = datetime.now(timezone.utc) + timedelta(hours=rule["sla_hours"])
    for i, stage in enumerate(stages, start=1):
        assignee = await fetch_one(db,
            "SELECT id FROM users WHERE role = :role AND active LIMIT 1", {"role": stage})
        await execute(db, """
            INSERT INTO approvals (entity_type, entity_id, rule_id, stage_no, stage_role, assigned_to, status, sla_due_at)
            VALUES (:et, :eid, :rid, :no, :role, :assignee, 'pending', :sla)
        """, {"et": entity_type, "eid": entity_id, "rid": rule["id"], "no": i,
              "role": stage, "assignee": assignee["id"] if assignee else None,
              "sla": sla_due if i == 1 else None})
    await notify_role(db, stages[0],
                      f"Approval pending · {entity_id}",
                      f"{entity_type.replace('_', ' ').title()} ₹{amount:,.0f} awaiting {stages[0]} approval.",
                      entity_type, entity_id)
    await log_action(db, actor.get("sub") if actor else None,
                     actor.get("name", "System") if actor else "Approval Engine",
                     "Routed for approval", entity_type, entity_id,
                     f"Rule '{rule['rule_name']}' · stages: {' → '.join(stages)}")
    return {"rule": rule, "stages": stages, "auto_approved": False}


async def act(db: AsyncSession, approval_id: int, decision: str, user: dict, comments: str = "") -> dict:
    """Approve/reject one stage; activates the next stage or completes the chain."""
    appr = await fetch_one(db, "SELECT * FROM approvals WHERE id = :id", {"id": approval_id})
    if not appr or appr["status"] != "pending":
        return {"error": "Approval not found or already actioned"}
    if user["role"] not in (appr["stage_role"], "admin"):
        return {"error": f"This stage requires role '{appr['stage_role']}'"}

    prior_pending = await fetch_one(db, """
        SELECT id FROM approvals WHERE entity_type = :et AND entity_id = :eid
          AND stage_no < :no AND status = 'pending'
    """, {"et": appr["entity_type"], "eid": appr["entity_id"], "no": appr["stage_no"]})
    if prior_pending:
        return {"error": "Earlier stages are still pending"}

    status = "approved" if decision == "approve" else "rejected"
    await execute(db, """
        UPDATE approvals SET status = :st, acted_by = :uid, acted_at = now(), comments = :c
        WHERE id = :id
    """, {"st": status, "uid": user["sub"], "c": comments, "id": approval_id})
    await log_action(db, user["sub"], user["name"], f"{status.title()} stage {appr['stage_no']} ({appr['stage_role']})",
                     appr["entity_type"], appr["entity_id"], comments or f"Decision: {decision}")

    if status == "rejected":
        await execute(db, """
            UPDATE approvals SET status = 'skipped'
            WHERE entity_type = :et AND entity_id = :eid AND status = 'pending'
        """, {"et": appr["entity_type"], "eid": appr["entity_id"]})
        return {"chain_status": "rejected"}

    nxt = await fetch_one(db, """
        SELECT * FROM approvals WHERE entity_type = :et AND entity_id = :eid AND status = 'pending'
        ORDER BY stage_no LIMIT 1
    """, {"et": appr["entity_type"], "eid": appr["entity_id"]})
    if nxt:
        await notify_role(db, nxt["stage_role"],
                          f"Approval pending · {appr['entity_id']}",
                          f"Stage {nxt['stage_no']} ({nxt['stage_role']}) is now active.",
                          appr["entity_type"], appr["entity_id"])
        return {"chain_status": "in_progress", "next_stage": nxt["stage_role"]}
    return {"chain_status": "approved"}


async def chain_status(db: AsyncSession, entity_type: str, entity_id: str) -> str | None:
    rows = await fetch_all(db, """
        SELECT status FROM approvals WHERE entity_type = :et AND entity_id = :eid
    """, {"et": entity_type, "eid": entity_id})
    if not rows:
        return None
    statuses = {r["status"] for r in rows}
    if "rejected" in statuses:
        return "rejected"
    if "pending" in statuses:
        return "in_progress"
    return "approved"
