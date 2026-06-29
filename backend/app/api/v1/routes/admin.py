"""Admin console — configuration, approval rules, integration mode switches, sync log, audit."""
import hashlib
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user, require_roles
from app.utils.audit import log_action

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/configuration")
async def get_configuration(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, "SELECT * FROM configuration ORDER BY key")


class ConfigBody(BaseModel):
    value: dict | list | str | int | float


@router.put("/configuration/{key}")
async def set_configuration(key: str, body: ConfigBody, db: AsyncSession = Depends(get_db),
                            user: dict = Depends(require_roles("admin"))):
    before = await fetch_one(db, "SELECT value FROM configuration WHERE key = :k", {"k": key})
    await execute(db, """
        INSERT INTO configuration (key, value, updated_by, updated_at)
        VALUES (:k, CAST(:v AS jsonb), :u, now())
        ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), updated_by = :u, updated_at = now()
    """, {"k": key, "v": json.dumps(body.value), "u": user["sub"]})
    await log_action(db, user["sub"], user["name"], "Updated configuration", "configuration", key,
                     f"{key} changed", before_state=before, after_state={"value": body.value})
    return {"key": key, "value": body.value}


class RuleBody(BaseModel):
    rule_name: str
    entity_type: str
    min_amount: float = 0
    max_amount: float | None = None
    department_id: str | None = None
    category_id: str | None = None
    msme_priority: bool = False
    stages: list[str]
    sla_hours: int | None = None


@router.post("/approval-rules")
async def create_rule(body: RuleBody, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(require_roles("admin"))):
    await execute(db, """
        INSERT INTO approval_rules (rule_name, entity_type, department_id, category_id,
            min_amount, max_amount, msme_priority, stages, sla_hours)
        VALUES (:n, :et, :d, :c, :min, :max, :m, CAST(:s AS jsonb), :sla)
    """, {"n": body.rule_name, "et": body.entity_type, "d": body.department_id,
          "c": body.category_id, "min": body.min_amount, "max": body.max_amount,
          "m": body.msme_priority, "s": json.dumps(body.stages), "sla": body.sla_hours})
    await log_action(db, user["sub"], user["name"], "Created approval rule", "approval_rule",
                     body.rule_name, f"{body.entity_type} · ₹{body.min_amount:,.0f}+ · {body.stages}")
    return {"created": body.rule_name}


@router.delete("/approval-rules/{rule_id}")
async def deactivate_rule(rule_id: int, db: AsyncSession = Depends(get_db),
                          user: dict = Depends(require_roles("admin"))):
    await execute(db, "UPDATE approval_rules SET active = FALSE WHERE id = :id", {"id": rule_id})
    await log_action(db, user["sub"], user["name"], "Deactivated approval rule", "approval_rule",
                     str(rule_id), "")
    return {"deactivated": rule_id}


# ---------- Integrations ----------

@router.get("/integrations")
async def list_integrations(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, "SELECT * FROM integrations ORDER BY id")


class IntegrationBody(BaseModel):
    mode: str  # simulated | live
    base_url: str | None = None


@router.put("/integrations/{integration_id}")
async def set_integration(integration_id: str, body: IntegrationBody,
                          db: AsyncSession = Depends(get_db),
                          user: dict = Depends(require_roles("admin"))):
    if body.mode not in ("simulated", "live"):
        raise HTTPException(400, "mode must be 'simulated' or 'live'")
    if body.mode == "live" and not body.base_url:
        raise HTTPException(400, "live mode requires base_url (Intelezen-provided API endpoint)")
    before = await fetch_one(db, "SELECT mode, base_url FROM integrations WHERE id = :id",
                             {"id": integration_id})
    await execute(db, """
        UPDATE integrations SET mode = :m, base_url = COALESCE(:b, base_url), updated_at = now()
        WHERE id = :id
    """, {"m": body.mode, "b": body.base_url, "id": integration_id})
    await log_action(db, user["sub"], user["name"], "Switched integration mode", "integration",
                     integration_id, f"→ {body.mode}", before_state=before,
                     after_state={"mode": body.mode, "base_url": body.base_url})
    return {"id": integration_id, "mode": body.mode}


@router.get("/sync-log")
async def sync_log(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT s.*, i.name AS integration_name FROM sync_log s
        JOIN integrations i ON i.id = s.integration_id
        ORDER BY s.at DESC LIMIT 100
    """)


# ---------- Audit ----------

@router.get("/audit")
async def audit_trail(entity_id: str | None = None, limit: int = 100,
                      db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT * FROM audit_log
        WHERE (CAST(:eid AS TEXT) IS NULL OR entity_id = :eid)
        ORDER BY at DESC, id DESC LIMIT :lim
    """, {"eid": entity_id, "lim": min(limit, 500)})


@router.get("/audit/verify-chain")
async def verify_chain(db: AsyncSession = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Recompute the hash chain over app-written rows to prove tamper-evidence."""
    rows = await fetch_all(db, """
        SELECT id, actor_name, action, entity_id, detail, before_state, after_state, prev_hash, row_hash
        FROM audit_log WHERE prev_hash IS NOT NULL OR before_state IS NOT NULL ORDER BY id
    """)
    breaks = []
    for r in rows:
        if r["prev_hash"] is None:
            continue
        payload = json.dumps(
            {"actor": r["actor_name"], "action": r["action"], "entity": r["entity_id"],
             "detail": r["detail"], "before": r["before_state"], "after": r["after_state"]},
            sort_keys=True, default=str)
        expected = hashlib.sha256((r["prev_hash"] + payload).encode()).hexdigest()
        if expected != r["row_hash"]:
            breaks.append(r["id"])
    return {"rows_checked": len(rows), "chain_intact": len(breaks) == 0, "breaks": breaks}


# ---------- AI agent log ----------

@router.get("/agent-invocations")
async def agent_invocations(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT a.*, u.full_name AS acted_by_name FROM agent_invocations a
        LEFT JOIN users u ON u.id = a.acted_by
        ORDER BY a.at DESC LIMIT 100
    """)
