"""Reporting — spend cube (dept × vendor × category × branch), ageing, SLA, statutory exposure."""
import csv
import io
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, fetch_one
from app.core.security import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])

DIMENSIONS = {
    "department": ("departments d ON d.id = i.department_id", "d.name"),
    "category":   ("spend_categories c ON c.id = i.category_id", "c.name"),
    "branch":     ("branches b ON b.id = i.branch_id", "b.name"),
    "vendor":     ("vendors v2 ON v2.id = i.vendor_id", "v2.name"),
}


@router.get("/spend")
async def spend_by(dimension: str = "department", db: AsyncSession = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    join, label = DIMENSIONS.get(dimension, DIMENSIONS["department"])
    return await fetch_all(db, f"""
        SELECT COALESCE({label}, '— Unassigned') AS name,
               COUNT(*) AS invoices, SUM(i.total_amount) AS spend,
               SUM(i.tds_amount) AS tds, SUM(i.cgst + i.sgst + i.igst) AS gst
        FROM invoices i LEFT JOIN {join}
        WHERE i.stage != 'rejected'
        GROUP BY 1 ORDER BY spend DESC
    """)


@router.get("/ageing")
async def ageing(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT CASE
                 WHEN due_date >= CURRENT_DATE THEN 'Not due'
                 WHEN due_date >= CURRENT_DATE - 30 THEN '1-30 days'
                 WHEN due_date >= CURRENT_DATE - 60 THEN '31-60 days'
                 ELSE '60+ days'
               END AS bucket,
               COUNT(*) AS invoices, SUM(net_payable) AS amount
        FROM invoices WHERE stage NOT IN ('paid','rejected')
        GROUP BY 1 ORDER BY MIN(COALESCE(CURRENT_DATE - due_date, -999))
    """)


@router.get("/approval-sla")
async def approval_sla(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    return await fetch_all(db, """
        SELECT stage_role,
               COUNT(*) FILTER (WHERE status = 'pending') AS pending,
               COUNT(*) FILTER (WHERE status = 'pending' AND sla_due_at < now()) AS sla_breached,
               COUNT(*) FILTER (WHERE status IN ('approved','rejected')) AS actioned,
               ROUND(AVG(EXTRACT(EPOCH FROM (acted_at - created_at)) / 3600)
                     FILTER (WHERE acted_at IS NOT NULL), 1) AS avg_hours
        FROM approvals GROUP BY stage_role ORDER BY stage_role
    """)


@router.get("/statutory")
async def statutory_exposure(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    msme = await fetch_all(db, """
        SELECT i.id, v.name AS vendor_name, i.net_payable, i.msme_due_date,
               i.msme_due_date - CURRENT_DATE AS days_remaining
        FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE i.msme_due_date IS NOT NULL AND i.stage NOT IN ('paid','rejected')
        ORDER BY i.msme_due_date
    """)
    tds = await fetch_all(db, """
        SELECT tds_section, COUNT(*) AS deductees, SUM(tds_amount) AS liability
        FROM invoices WHERE tds_amount > 0 AND stage NOT IN ('rejected','paid')
        GROUP BY tds_section ORDER BY liability DESC
    """)
    gst_itc_risk = await fetch_one(db, """
        SELECT COUNT(*) AS invoices, COALESCE(SUM(i.cgst + i.sgst + i.igst), 0) AS itc_at_risk
        FROM invoices i WHERE i.gst2b_status IN ('mismatch_tax','not_in_2b')
          AND i.stage NOT IN ('paid','rejected')
    """)
    rcm = await fetch_one(db, """
        SELECT COUNT(*) AS invoices, COALESCE(SUM(rcm_liability), 0) AS liability
        FROM invoices WHERE rcm_applicable AND stage != 'rejected'
    """)
    return {"msme_45day": msme, "tds_by_section": tds, "gst_itc_risk": gst_itc_risk, "rcm": rcm}


@router.get("/export")
async def export_report(report: str = "spend", dimension: str = "department",
                        db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    if report == "ageing":
        rows = await ageing(db, user)
    elif report == "approval-sla":
        rows = await approval_sla(db, user)
    else:
        rows = await spend_by(dimension, db, user)
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=rows[0].keys())
        w.writeheader()
        for r in rows:
            w.writerow(r)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename=astonomiq_{report}.csv"})
