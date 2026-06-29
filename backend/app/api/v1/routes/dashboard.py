from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one
from app.core.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    pipeline = await fetch_all(db, """
        SELECT stage, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS value
        FROM invoices WHERE stage NOT IN ('rejected') GROUP BY stage
    """)
    exceptions = await fetch_one(db, """
        SELECT COUNT(*) AS n FROM invoices WHERE match_status = 'exception' AND stage NOT IN ('paid','rejected')
    """)
    msme_risk = await fetch_one(db, """
        SELECT COUNT(*) AS n, COALESCE(SUM(net_payable), 0) AS value
        FROM invoices
        WHERE msme_due_date IS NOT NULL AND stage NOT IN ('paid','rejected')
          AND msme_due_date <= CURRENT_DATE + 7
    """)
    ebitda = await fetch_one(db, """
        SELECT COALESCE(SUM(ebitda_gain) FILTER (WHERE date_trunc('month', offered_at) = date_trunc('month', now())), 0) AS mtd,
               COALESCE(SUM(ebitda_gain), 0) AS ytd
        FROM discount_deals WHERE status != 'cancelled'
    """)
    tds = await fetch_one(db, """
        SELECT COALESCE(SUM(tds_amount), 0) AS liability, COUNT(*) FILTER (WHERE tds_amount > 0) AS deductees
        FROM invoices WHERE stage NOT IN ('rejected')
    """)
    sources = await fetch_all(db, """
        SELECT source, COUNT(*) AS count FROM invoices GROUP BY source ORDER BY count DESC
    """)
    top_open = await fetch_all(db, """
        SELECT i.id, i.vendor_id, v.name AS vendor_name, i.total_amount, i.stage, i.due_date,
               i.msme_due_date IS NOT NULL AS is_msme
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE i.stage NOT IN ('paid','rejected')
        ORDER BY i.total_amount DESC LIMIT 8
    """)
    gst2b = await fetch_one(db, """
        SELECT COUNT(*) FILTER (WHERE status = 'matched') AS matched,
               COUNT(*) FILTER (WHERE status = 'mismatch_tax') AS mismatched,
               COUNT(*) FILTER (WHERE status = 'not_in_2b') AS not_in_2b
        FROM gst_2b_records
    """)
    approvals = await fetch_one(db, """
        SELECT COUNT(*) FILTER (WHERE stage_role = 'maker') AS maker,
               COUNT(*) FILTER (WHERE stage_role = 'checker') AS checker,
               COUNT(*) FILTER (WHERE stage_role IN ('fc','cfo')) AS fc_cfo
        FROM approvals WHERE status = 'pending'
    """)
    vendors = await fetch_one(db, """
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_msme) AS msme FROM vendors WHERE status = 'active'
    """)
    return {"pipeline": pipeline, "match_exceptions": exceptions["n"],
            "msme_risk": msme_risk, "ebitda": ebitda, "tds": tds,
            "capture_sources": sources, "top_open_invoices": top_open,
            "gst2b": gst2b, "pending_approvals": approvals, "vendors": vendors}
