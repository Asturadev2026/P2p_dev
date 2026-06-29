import hashlib
import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_one, execute


async def log_action(
    db: AsyncSession,
    actor_id: str | None,
    actor_name: str,
    action: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    detail: str = "",
    before_state: dict | None = None,
    after_state: dict | None = None,
):
    """Append a tamper-evident row: row_hash = sha256(prev_hash || payload)."""
    last = await fetch_one(db, "SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1")
    prev_hash = last["row_hash"] if last else ""
    payload = json.dumps(
        {"actor": actor_name, "action": action, "entity": entity_id, "detail": detail,
         "before": before_state, "after": after_state},
        sort_keys=True, default=str,
    )
    row_hash = hashlib.sha256((prev_hash + payload).encode()).hexdigest()
    await execute(db, """
        INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id,
                               before_state, after_state, detail, prev_hash, row_hash)
        VALUES (:actor_id, :actor_name, :action, :entity_type, :entity_id,
                CAST(:before AS jsonb), CAST(:after AS jsonb), :detail, :prev_hash, :row_hash)
    """, {
        "actor_id": actor_id, "actor_name": actor_name, "action": action,
        "entity_type": entity_type, "entity_id": entity_id,
        "before": json.dumps(before_state, default=str) if before_state is not None else None,
        "after": json.dumps(after_state, default=str) if after_state is not None else None,
        "detail": detail, "prev_hash": prev_hash or None, "row_hash": row_hash,
    })
