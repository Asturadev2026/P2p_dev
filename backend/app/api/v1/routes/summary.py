"""Drill-down + summary feature (AstonomiQ standard pattern, adapted for Intelezen AP).

POST /api/v1/ai/summary  →  { summary, highlights, count, items, source }

Rule-based (no LLM) so it always works. Every call is audited to agent_invocations.
AP data is org-wide finance, so fetchers apply request filters; the 'requester' role is
lightly scoped to its own department for requisitions.
"""
import json
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, fetch_all, execute
from app.core.security import get_current_user

router = APIRouter(prefix="/ai", tags=["summary"])


class SummaryIn(BaseModel):
    entity: str
    filters: dict = {}


# ============================================================
# Data fetchers — one per entity, apply request filters, LIMIT 50
# ============================================================

async def _invoice_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT i.id, v.name AS vendor_name, i.total_amount, i.net_payable, i.stage,
               i.source, i.match_status, i.gst2b_status, i.tds_amount, i.due_date,
               i.msme_due_date IS NOT NULL AS is_msme, d.name AS department_name
        FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id
        LEFT JOIN departments d ON d.id = i.department_id
        WHERE (CAST(:stage AS TEXT) IS NULL OR i.stage = :stage)
          AND (CAST(:source AS TEXT) IS NULL OR i.source = :source)
          AND (CAST(:match_status AS TEXT) IS NULL OR i.match_status = :match_status)
          AND (CAST(:gst2b_status AS TEXT) IS NULL OR i.gst2b_status = :gst2b_status)
          AND (CAST(:department_id AS TEXT) IS NULL OR i.department_id = :department_id)
          AND (CAST(:vendor_id AS TEXT) IS NULL OR i.vendor_id = :vendor_id)
          AND (NOT :msme OR i.msme_due_date IS NOT NULL)
          AND (NOT :open_only OR i.stage NOT IN ('paid', 'rejected'))
          AND (NOT :has_tds OR i.tds_amount > 0)
        ORDER BY i.total_amount DESC LIMIT 50
    """, {"stage": filters.get("stage"), "source": filters.get("source"),
          "match_status": filters.get("match_status"), "gst2b_status": filters.get("gst2b_status"),
          "department_id": filters.get("department_id"), "vendor_id": filters.get("vendor_id"),
          "msme": bool(filters.get("msme")), "open_only": bool(filters.get("open_only")),
          "has_tds": bool(filters.get("has_tds"))})


async def _vendor_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT v.id, v.name, v.gstin, v.state, v.tier, v.is_msme, v.tds_section, v.status,
               d.name AS department_name,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i WHERE i.vendor_id = v.id) AS spend_ytd
        FROM vendors v
        LEFT JOIN departments d ON d.id = v.department_id
        WHERE (NOT :msme OR v.is_msme)
          AND (CAST(:tier AS TEXT) IS NULL OR v.tier = :tier)
          AND (CAST(:status AS TEXT) IS NULL OR v.status = :status)
          AND (CAST(:department_id AS TEXT) IS NULL OR v.department_id = :department_id)
        ORDER BY spend_ytd DESC LIMIT 50
    """, {"msme": bool(filters.get("msme")), "tier": filters.get("tier"),
          "status": filters.get("status", "active"), "department_id": filters.get("department_id")})


async def _requisition_items(db, user, filters) -> list[dict]:
    # Requester sees only their own; everyone else sees all.
    own_only = user["role"] == "requester"
    return await fetch_all(db, """
        SELECT r.id, r.title, d.name AS department_name, b.name AS branch_name,
               u.full_name AS requester_name, r.total_amount, r.status
        FROM requisitions r
        JOIN departments d ON d.id = r.department_id
        JOIN branches b ON b.id = r.branch_id
        JOIN users u ON u.id = r.requester_id
        WHERE (CAST(:status AS TEXT) IS NULL OR r.status = :status)
          AND (CAST(:department_id AS TEXT) IS NULL OR r.department_id = :department_id)
          AND (NOT :own OR r.requester_id = :uid)
        ORDER BY r.created_at DESC LIMIT 50
    """, {"status": filters.get("status"), "department_id": filters.get("department_id"),
          "own": own_only, "uid": user["sub"]})


async def _po_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT p.id, v.name AS vendor_name, d.name AS department_name,
               p.amount, p.esign_status, p.status
        FROM purchase_orders p
        JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN departments d ON d.id = p.department_id
        WHERE (CAST(:status AS TEXT) IS NULL OR p.status = :status)
          AND (CAST(:department_id AS TEXT) IS NULL OR p.department_id = :department_id)
        ORDER BY p.issued_at DESC LIMIT 50
    """, {"status": filters.get("status"), "department_id": filters.get("department_id")})


async def _deal_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT dd.id, v.name AS vendor_name, p.name AS pool_name, p.pool_type,
               dd.advance_amount, dd.days_saved, dd.vendor_rate_pct, dd.spread_pct,
               dd.ebitda_gain, dd.status
        FROM discount_deals dd
        JOIN vendors v ON v.id = dd.vendor_id
        JOIN discount_pools p ON p.id = dd.pool_id
        WHERE (CAST(:pool_id AS TEXT) IS NULL OR dd.pool_id = :pool_id)
          AND (CAST(:status AS TEXT) IS NULL OR dd.status = :status)
        ORDER BY dd.offered_at DESC LIMIT 50
    """, {"pool_id": filters.get("pool_id"), "status": filters.get("status")})


async def _early_pay_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT e.id, v.name AS vendor_name, e.invoice_id, e.amount, e.days_available,
               e.requested_rate_pct, e.expected_gain, e.status
        FROM early_pay_requests e
        JOIN vendors v ON v.id = e.vendor_id
        WHERE (CAST(:status AS TEXT) IS NULL OR e.status = :status)
        ORDER BY (e.status = 'pending') DESC, e.requested_at DESC LIMIT 50
    """, {"status": filters.get("status")})


async def _advance_items(db, user, filters) -> list[dict]:
    return await fetch_all(db, """
        SELECT a.id, a.advance_type, COALESCE(v.name, u.full_name) AS party,
               b.name AS branch_name, a.amount, a.balance, a.status, a.purpose
        FROM advances a
        LEFT JOIN vendors v ON v.id = a.vendor_id
        LEFT JOIN users u ON u.id = a.holder_id
        LEFT JOIN branches b ON b.id = a.branch_id
        WHERE (CAST(:status AS TEXT) IS NULL OR a.status = :status)
          AND (CAST(:advance_type AS TEXT) IS NULL OR a.advance_type = :advance_type)
        ORDER BY a.created_at DESC LIMIT 50
    """, {"status": filters.get("status"), "advance_type": filters.get("advance_type")})


FETCHERS = {
    "invoices": _invoice_items,
    "vendors": _vendor_items,
    "requisitions": _requisition_items,
    "purchase_orders": _po_items,
    "deals": _deal_items,
    "early_pay": _early_pay_items,
    "advances": _advance_items,
}


# ============================================================
# Rule-based summarizer
# ============================================================

def _summarize(entity: str, items: list[dict], filters: dict) -> dict:
    scope = ", ".join(f"{k}={v}" for k, v in filters.items() if v) or "all records"

    def mix(key):
        out = {}
        for i in items:
            val = i.get(key)
            val = "—" if val is None or val == "" else str(val).replace("_", " ")
            out[val] = out.get(val, 0) + 1
        return ", ".join(f"{k} {v}" for k, v in sorted(out.items(), key=lambda x: -x[1]))

    def inr(n):
        n = float(n or 0)
        if abs(n) >= 1e7:
            return f"₹{n / 1e7:.2f} Cr"
        if abs(n) >= 1e5:
            return f"₹{n / 1e5:.2f} L"
        return f"₹{n:,.0f}"

    if entity == "invoices":
        total = sum(float(i["total_amount"]) for i in items)
        tds = sum(float(i["tds_amount"]) for i in items)
        msme = sum(1 for i in items if i["is_msme"])
        summary = (f"{len(items)} invoice(s) in scope ({scope}), gross {inr(total)}, "
                   f"TDS {inr(tds)}. {msme} MSME-flagged. Stage mix: {mix('stage')}.")
        highlights = [f"{i['id']}: {i['vendor_name']} — {inr(i['total_amount'])} "
                      f"({str(i['stage']).replace('_', ' ')})"
                      for i in items[:3]]

    elif entity == "vendors":
        spend = sum(float(i["spend_ytd"]) for i in items)
        msme = sum(1 for i in items if i["is_msme"])
        summary = (f"{len(items)} vendor(s) in scope ({scope}), combined spend {inr(spend)}. "
                   f"{msme} MSME. Tier mix: {mix('tier')}.")
        highlights = [f"{i['id']}: {i['name']} — {inr(i['spend_ytd'])} spend"
                      for i in items[:3]]

    elif entity == "requisitions":
        total = sum(float(i["total_amount"]) for i in items)
        summary = (f"{len(items)} requisition(s) in scope ({scope}), value {inr(total)}. "
                   f"Status: {mix('status')}. Departments: {mix('department_name')}.")
        highlights = [f"{i['id']}: {i['title']} — {inr(i['total_amount'])} ({str(i['status']).replace('_', ' ')})"
                      for i in sorted(items, key=lambda x: -float(x["total_amount"]))[:3]]

    elif entity == "purchase_orders":
        total = sum(float(i["amount"]) for i in items)
        summary = (f"{len(items)} PO(s) in scope ({scope}), value {inr(total)}. "
                   f"Status: {mix('status')}. e-Sign: {mix('esign_status')}.")
        highlights = [f"{i['id']}: {i['vendor_name']} — {inr(i['amount'])}"
                      for i in sorted(items, key=lambda x: -float(x["amount"]))[:3]]

    elif entity == "deals":
        vol = sum(float(i["advance_amount"]) for i in items)
        gain = sum(float(i["ebitda_gain"]) for i in items)
        summary = (f"{len(items)} discount deal(s) in scope ({scope}), advanced {inr(vol)}, "
                   f"EBITDA gain {inr(gain)}. Pool mix: {mix('pool_name')}.")
        highlights = [f"{i['id']}: {i['vendor_name']} — {inr(i['advance_amount'])} via {i['pool_name']} "
                      f"(gain {inr(i['ebitda_gain'])})"
                      for i in sorted(items, key=lambda x: -float(x["ebitda_gain"]))[:3]]

    elif entity == "early_pay":
        amt = sum(float(i["amount"]) for i in items)
        gain = sum(float(i["expected_gain"] or 0) for i in items)
        summary = (f"{len(items)} early-pay request(s) in scope ({scope}), {inr(amt)} requested, "
                   f"expected EBITDA {inr(gain)}. Status: {mix('status')}.")
        highlights = [f"{i['id']}: {i['vendor_name']} — {inr(i['amount'])} ({i['days_available']}d)"
                      for i in sorted(items, key=lambda x: -float(x["amount"]))[:3]]

    elif entity == "advances":
        bal = sum(float(i["balance"]) for i in items)
        summary = (f"{len(items)} advance(s) in scope ({scope}), open balance {inr(bal)}. "
                   f"Type: {mix('advance_type')}. Status: {mix('status')}.")
        highlights = [f"{i['id']}: {i['party']} — balance {inr(i['balance'])}"
                      for i in sorted(items, key=lambda x: -float(x["balance"]))[:3]]

    else:
        summary = f"{len(items)} item(s) in scope ({scope})."
        highlights = []

    return {"summary": summary, "highlights": highlights}


# ============================================================
# Endpoint
# ============================================================

@router.post("/summary")
async def summarize(body: SummaryIn, user: dict = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    fetcher = FETCHERS.get(body.entity)
    if not fetcher:
        raise HTTPException(422, f"entity '{body.entity}' unknown. Must be one of: {sorted(FETCHERS)}")

    t0 = time.monotonic()
    items = await fetcher(db, user, body.filters)
    result = _summarize(body.entity, items, body.filters)
    latency = int((time.monotonic() - t0) * 1000)

    try:
        await execute(db, """
            INSERT INTO agent_invocations (agent, entity_type, entity_id, model, output, latency_ms)
            VALUES ('list_summarizer', :et, :ei, 'rule_based', CAST(:out AS jsonb), :lat)
        """, {"et": body.entity, "ei": json.dumps(body.filters),
              "out": json.dumps(result), "lat": latency})
    except Exception as e:  # never fail the response on audit-log error
        print(f"Warning: failed to log summary call: {e}")

    return {**result, "source": "rule_based", "count": len(items),
            "items": items, "latency_ms": latency}
