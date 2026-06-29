"""Invoice discounting — desk, pools, TReDS, EBITDA comparison, early-pay requests."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one, execute
from app.core.security import get_current_user
from app.services import discounting_service, ai_agents
from app.utils.audit import log_action

router = APIRouter(prefix="/discounting", tags=["discounting"])


@router.get("/pools")
async def pools(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    overview = await discounting_service.pool_overview(db)
    cc = await fetch_all(db, "SELECT * FROM cc_facilities ORDER BY id")
    return {"pools": overview, "cc_facilities": cc}


@router.get("/deals")
async def deals(pool: str | None = None, db: AsyncSession = Depends(get_db),
                user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT d.*, v.name AS vendor_name, p.name AS pool_name, p.pool_type
        FROM discount_deals d
        JOIN vendors v ON v.id = d.vendor_id
        JOIN discount_pools p ON p.id = d.pool_id
        WHERE (CAST(:pool AS TEXT) IS NULL OR d.pool_id = :pool)
        ORDER BY d.offered_at DESC
    """, {"pool": pool})


class CompareBody(BaseModel):
    amount: float
    vendor_rate_pct: float
    days: int
    is_msme: bool = False


@router.post("/compare")
async def compare(body: CompareBody, db: AsyncSession = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    return await discounting_service.compare_pools(db, body.amount, body.vendor_rate_pct,
                                                   body.days, body.is_msme)


@router.get("/ebitda")
async def ebitda_summary(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    by_pool = await fetch_all(db, """
        SELECT p.id AS pool, p.name,
               COUNT(d.id) FILTER (WHERE d.status IN ('active','offered')) AS active_deals,
               COALESCE(SUM(d.advance_amount), 0) AS volume,
               COALESCE(AVG(d.vendor_rate_pct), 0) AS avg_vendor_rate,
               COALESCE(AVG(d.cof_pct), 0) AS avg_cof,
               COALESCE(SUM(d.ebitda_gain), 0) AS gain_total,
               COALESCE(SUM(d.ebitda_gain) FILTER (WHERE date_trunc('month', d.offered_at) = date_trunc('month', now())), 0) AS gain_mtd
        FROM discount_pools p LEFT JOIN discount_deals d ON d.pool_id = p.id AND d.status != 'cancelled'
        GROUP BY p.id, p.name ORDER BY p.id
    """)
    totals = await fetch_one(db, """
        SELECT COALESCE(SUM(ebitda_gain), 0) AS ytd,
               COALESCE(SUM(ebitda_gain) FILTER (WHERE date_trunc('month', offered_at) = date_trunc('month', now())), 0) AS mtd,
               COALESCE(AVG(spread_pct), 0) AS avg_spread
        FROM discount_deals WHERE status != 'cancelled'
    """)
    return {"by_pool": by_pool, "totals": totals}


class DealCreate(BaseModel):
    invoice_id: str
    pool_id: str
    vendor_rate_pct: float
    days_saved: int
    cc_facility_id: str | None = None


@router.post("/deals")
async def create_deal(body: DealCreate, db: AsyncSession = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    result = await discounting_service.create_deal(db, body.invoice_id, body.pool_id,
                                                   body.vendor_rate_pct, body.days_saved,
                                                   user, body.cc_facility_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


# ---------- Early-pay requests ----------

@router.get("/early-pay")
async def early_pay_requests(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT e.*, v.name AS vendor_name, v.is_msme, i.due_date, p.name AS suggested_pool_name
        FROM early_pay_requests e
        JOIN vendors v ON v.id = e.vendor_id
        JOIN invoices i ON i.id = e.invoice_id
        LEFT JOIN discount_pools p ON p.id = e.suggested_pool_id
        ORDER BY (e.status = 'pending') DESC, e.requested_at DESC
    """)


@router.post("/early-pay/{epr_id}/recommend")
async def recommend(epr_id: str, db: AsyncSession = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    """Re-run the AI pool recommendation for a pending request (human-in-the-loop)."""
    epr = await fetch_one(db, """
        SELECT e.*, v.is_msme FROM early_pay_requests e
        JOIN vendors v ON v.id = e.vendor_id WHERE e.id = :id
    """, {"id": epr_id})
    if not epr:
        raise HTTPException(404, "Request not found")
    pools = await fetch_all(db, "SELECT id, cost_of_funds_pct FROM discount_pools")
    cof = {p["id"]: float(p["cost_of_funds_pct"] or 0) for p in pools}
    rec = await ai_agents.recommend_pool(db, epr_id, {
        "amount": float(epr["amount"]), "days_available": epr["days_available"],
        "requested_rate_pct": float(epr["requested_rate_pct"]), "is_msme": epr["is_msme"],
        "treasury_cof": cof.get("treasury", 6.5), "cc_cof": cof.get("cc", 10.4),
    })
    await execute(db, """
        UPDATE early_pay_requests SET suggested_pool_id = :p, expected_gain = :g, ai_rationale = :r
        WHERE id = :id
    """, {"p": rec.get("pool"), "g": rec.get("expected_gain"), "r": rec.get("rationale"), "id": epr_id})
    return rec


class ActionBody(BaseModel):
    pool_id: str | None = None
    reason: str | None = None


@router.post("/early-pay/{epr_id}/accept")
async def accept_early_pay(epr_id: str, body: ActionBody, db: AsyncSession = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    epr = await fetch_one(db, "SELECT * FROM early_pay_requests WHERE id = :id", {"id": epr_id})
    if not epr or epr["status"] != "pending":
        raise HTTPException(409, "Request not found or already actioned")
    pool_id = body.pool_id or epr["suggested_pool_id"] or "treasury"
    deal = await discounting_service.create_deal(db, epr["invoice_id"], pool_id,
                                                 float(epr["requested_rate_pct"]),
                                                 epr["days_available"], user)
    await execute(db, """
        UPDATE early_pay_requests SET status = 'accepted', actioned_by = :u, actioned_at = now()
        WHERE id = :id
    """, {"u": user["sub"], "id": epr_id})
    await log_action(db, user["sub"], user["name"], "Approved early-pay request", "early_pay", epr_id,
                     f"Routed to {pool_id} pool · ₹{float(epr['amount']):,.0f} · {epr['days_available']} days")
    return {"id": epr_id, "status": "accepted", "deal": deal}


@router.post("/early-pay/{epr_id}/decline")
async def decline_early_pay(epr_id: str, body: ActionBody, db: AsyncSession = Depends(get_db),
                            user: dict = Depends(get_current_user)):
    await execute(db, """
        UPDATE early_pay_requests SET status = 'declined', actioned_by = :u, actioned_at = now()
        WHERE id = :id AND status = 'pending'
    """, {"u": user["sub"], "id": epr_id})
    await log_action(db, user["sub"], user["name"], "Declined early-pay request", "early_pay", epr_id,
                     body.reason or "")
    return {"id": epr_id, "status": "declined"}


# ---------- TReDS ----------

@router.get("/treds")
async def treds(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    platforms = await fetch_all(db, "SELECT * FROM treds_platforms ORDER BY id")
    units = await fetch_all(db, """
        SELECT f.*, v.name AS vendor_name, t.name AS platform_name,
               (SELECT COUNT(*) FROM factoring_bids b WHERE b.fu_id = f.id) AS bid_count
        FROM factoring_units f
        JOIN vendors v ON v.id = f.vendor_id
        JOIN treds_platforms t ON t.id = f.platform_id
        ORDER BY f.listed_at DESC
    """)
    return {"platforms": platforms, "factoring_units": units}


@router.get("/treds/{fu_id}/bids")
async def fu_bids(fu_id: str, db: AsyncSession = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    return await fetch_all(db, "SELECT * FROM factoring_bids WHERE fu_id = :id ORDER BY rate_pct", {"id": fu_id})
