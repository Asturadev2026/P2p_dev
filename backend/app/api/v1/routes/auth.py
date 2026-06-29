from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_one, fetch_all
from app.core.security import hash_password, create_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await fetch_one(db, """
        SELECT u.*, d.name AS department_name, b.name AS branch_name
        FROM users u
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.username = :u AND u.active
    """, {"u": body.username})
    if not user or user["password_hash"] != hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token({"sub": user["id"], "name": user["full_name"], "role": user["role"],
                          "department_id": user["department_id"], "branch_id": user["branch_id"]})
    return {"token": token,
            "user": {"id": user["id"], "name": user["full_name"], "role": user["role"],
                     "department": user["department_name"], "branch": user["branch_name"],
                     "email": user["email"]}}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT u.id, u.username, u.full_name, u.role, u.email, u.active,
               d.name AS department, b.name AS branch
        FROM users u
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN branches b ON b.id = u.branch_id
        ORDER BY u.id
    """)
