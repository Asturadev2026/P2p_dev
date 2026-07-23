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


async def _invoice_creator(db: AsyncSession, invoice_id: str) -> str | None:
    """Who originally captured this invoice — the earliest stage_history actor.
    Used for maker-checker segregation of duties (a capturer cannot also approve
    their own invoice)."""
    row = await fetch_one(db, """
        SELECT actor_id FROM invoice_stage_history WHERE invoice_id = :id ORDER BY at LIMIT 1
    """, {"id": invoice_id})
    return row["actor_id"] if row else None


async def _finalise_invoice_approval(db: AsyncSession, invoice_id: str, user: dict) -> None:
    """Approval chain complete -> move the invoice into Liability & JV and book
    a journal voucher (Dr expense/asset GL · Cr Sundry Creditors 2401001), if one
    doesn't already exist for it."""
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv or inv["stage"] != "approval":
        return
    await execute(db, """
        UPDATE invoices SET stage = 'liability', tds_status = 'approved', updated_at = now() WHERE id = :id
    """, {"id": invoice_id})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, 'approval', 'liability', :u, 'Approval chain complete')
    """, {"id": invoice_id, "u": user["sub"]})

    existing_jv = await fetch_one(db, "SELECT id FROM journal_vouchers WHERE invoice_id = :id", {"id": invoice_id})
    if not existing_jv:
        vendor = await fetch_one(db, "SELECT expense_gl FROM vendors WHERE id = :id", {"id": inv["vendor_id"]})
        category = await fetch_one(db, "SELECT default_gl_code FROM spend_categories WHERE id = :id",
                                   {"id": inv["category_id"]})
        dr_gl = (vendor and vendor["expense_gl"]) or (category and category["default_gl_code"])
        if dr_gl:
            seq = await fetch_one(db, "SELECT COUNT(*) + 1 AS n FROM journal_vouchers")
            jv_id = f"JV/{datetime.now(timezone.utc):%Y/%m}/{seq['n']:05d}"
            await execute(db, """
                INSERT INTO journal_vouchers (id, invoice_id, dr_gl, cr_gl, amount, status)
                VALUES (:id, :inv, :dr, '2401001', :amt, 'ready')
            """, {"id": jv_id, "inv": invoice_id, "dr": dr_gl, "amt": inv["total_amount"]})
            await log_action(db, None, "Approval Engine", "Created journal voucher", "invoice", invoice_id,
                             f"{jv_id} · Dr {dr_gl} · Cr 2401001 · ₹{float(inv['total_amount']):,.0f}")
    await log_action(db, None, "Approval Engine", "Approval chain complete — moved to Liability & JV",
                     "invoice", invoice_id, "")


async def auto_complete_maker_stage(db: AsyncSession, entity_type: str, entity_id: str, user: dict) -> None:
    """The maker who prepared this entity (e.g. via TDS Engine's send-to-approval)
    already performed the maker's sign-off in the act of submitting it — a separate
    stage-1 'maker' approval would just deadlock behind segregation-of-duties, since
    that preparer is blocked from approving their own work. Auto-complete stage 1
    here so the chain opens up at the checker stage instead."""
    stage1 = await fetch_one(db, """
        SELECT * FROM approvals WHERE entity_type = :et AND entity_id = :eid
          AND stage_no = 1 AND stage_role = 'maker' AND status = 'pending'
    """, {"et": entity_type, "eid": entity_id})
    if not stage1:
        return
    await execute(db, """
        UPDATE approvals SET status = 'approved', acted_by = :uid, acted_at = now(), comments = :c
        WHERE id = :id
    """, {"uid": user["sub"], "c": "Auto-completed — submitted by preparer via TDS Engine handoff", "id": stage1["id"]})
    await log_action(db, user["sub"], user["name"], "Maker stage auto-completed on submission",
                     entity_type, entity_id, "Sent to Approval Workflow from TDS Engine")

    nxt = await fetch_one(db, """
        SELECT * FROM approvals WHERE entity_type = :et AND entity_id = :eid AND status = 'pending'
        ORDER BY stage_no LIMIT 1
    """, {"et": entity_type, "eid": entity_id})
    if nxt:
        await notify_role(db, nxt["stage_role"],
                          f"Approval pending · {entity_id}",
                          f"Stage {nxt['stage_no']} ({nxt['stage_role']}) is now active.",
                          entity_type, entity_id)
    elif entity_type == "invoice":
        await _finalise_invoice_approval(db, entity_id, user)


async def act(db: AsyncSession, approval_id: int, decision: str, user: dict, comments: str = "") -> dict:
    """Approve/reject/send-back one stage; activates the next stage, completes the
    chain, or (send-back) returns the entity to the Maker for correction."""
    appr = await fetch_one(db, "SELECT * FROM approvals WHERE id = :id", {"id": approval_id})
    if not appr or appr["status"] != "pending":
        return {"error": "Approval not found or already actioned"}
    if user["role"] != appr["stage_role"]:
        return {"error": f"This stage requires role '{appr['stage_role']}'"}

    if appr["entity_type"] == "invoice":
        creator = await _invoice_creator(db, appr["entity_id"])
        if creator and creator == user["sub"]:
            return {"error": "Segregation of duties: you captured this invoice and cannot approve or reject it"}

    prior_pending = await fetch_one(db, """
        SELECT id FROM approvals WHERE entity_type = :et AND entity_id = :eid
          AND stage_no < :no AND status = 'pending'
    """, {"et": appr["entity_type"], "eid": appr["entity_id"], "no": appr["stage_no"]})
    if prior_pending:
        return {"error": "Earlier stages are still pending"}

    status = {"approve": "approved", "reject": "rejected", "send_back": "sent_back"}[decision]
    await execute(db, """
        UPDATE approvals SET status = :st, acted_by = :uid, acted_at = now(), comments = :c
        WHERE id = :id
    """, {"st": status, "uid": user["sub"], "c": comments, "id": approval_id})
    await log_action(db, user["sub"], user["name"],
                     f"{status.replace('_', ' ').title()} stage {appr['stage_no']} ({appr['stage_role']})",
                     appr["entity_type"], appr["entity_id"], comments or f"Decision: {decision}")

    if status in ("rejected", "sent_back"):
        await execute(db, """
            UPDATE approvals SET status = 'skipped'
            WHERE entity_type = :et AND entity_id = :eid AND status = 'pending'
        """, {"et": appr["entity_type"], "eid": appr["entity_id"]})

    if status == "rejected":
        if appr["entity_type"] == "invoice":
            await execute(db, """
                UPDATE invoices SET stage = 'rejected', tds_status = 'rejected', updated_at = now() WHERE id = :id
            """, {"id": appr["entity_id"]})
            await execute(db, """
                INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
                VALUES (:id, 'approval', 'rejected', :u, :n)
            """, {"id": appr["entity_id"], "u": user["sub"], "n": comments or "Rejected in approval workflow"})
        elif appr["entity_type"] == "advance":
            await execute(db, "UPDATE advances SET status = 'rejected' WHERE id = :id", {"id": appr["entity_id"]})
        return {"chain_status": "rejected"}

    if status == "sent_back":
        # Not a final rejection — the invoice goes back to the Maker's TDS Engine
        # queue for correction and can be resubmitted through the normal flow.
        if appr["entity_type"] == "invoice":
            await execute(db, """
                UPDATE invoices SET stage = 'tds', tds_status = 'sent_back', updated_at = now() WHERE id = :id
            """, {"id": appr["entity_id"]})
            await execute(db, """
                INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
                VALUES (:id, 'approval', 'tds', :u, :n)
            """, {"id": appr["entity_id"], "u": user["sub"], "n": comments or "Sent back to Maker from Approval Workflow"})
        return {"chain_status": "sent_back"}

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

    if appr["entity_type"] == "invoice":
        await _finalise_invoice_approval(db, appr["entity_id"], user)
    elif appr["entity_type"] == "advance":
        # Approved, not yet paid out — Advances & Imprest page disburses it from here.
        await execute(db, "UPDATE advances SET status = 'approved' WHERE id = :id", {"id": appr["entity_id"]})
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
    if "sent_back" in statuses:
        return "sent_back"
    return "approved"
