from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, execute
from app.core.security import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def my_notifications(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT * FROM notifications WHERE user_id = :u ORDER BY created_at DESC LIMIT 50
    """, {"u": user["sub"]})


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    await execute(db, "UPDATE notifications SET read = TRUE WHERE id = :id AND user_id = :u",
                  {"id": notification_id, "u": user["sub"]})
    return {"read": notification_id}
