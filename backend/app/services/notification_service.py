from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_all, execute


async def notify_user(db: AsyncSession, user_id: str, title: str, body: str,
                      entity_type: str | None = None, entity_id: str | None = None,
                      kind: str = "info"):
    await execute(db, """
        INSERT INTO notifications (user_id, title, body, entity_type, entity_id, kind)
        VALUES (:uid, :title, :body, :et, :eid, :kind)
    """, {"uid": user_id, "title": title, "body": body, "et": entity_type, "eid": entity_id, "kind": kind})


async def notify_role(db: AsyncSession, role: str, title: str, body: str,
                      entity_type: str | None = None, entity_id: str | None = None,
                      kind: str = "approval_pending"):
    users = await fetch_all(db, "SELECT id FROM users WHERE role = :role AND active", {"role": role})
    for u in users:
        await notify_user(db, u["id"], title, body, entity_type, entity_id, kind)
