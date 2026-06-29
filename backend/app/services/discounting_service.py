"""Invoice discounting — pool stats, EBITDA math, deal creation, early-pay routing."""
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_all, fetch_one, execute
from app.utils.audit import log_action


def ebitda_gain(amount: float, vendor_rate: float, cof: float, days: int) -> float:
    return round(amount * (vendor_rate - cof) / 100 * days / 365, 2)


async def pool_overview(db: AsyncSession) -> list[dict]:
    return await fetch_all(db, """
        SELECT p.*, COALESCE(d.active_deals, 0) AS active_deals,
               COALESCE(d.volume, 0) AS volume, COALESCE(d.gain_mtd, 0) AS gain_mtd
        FROM discount_pools p
        LEFT JOIN (
            SELECT pool_id, COUNT(*) FILTER (WHERE status IN ('active','offered')) AS active_deals,
                   SUM(advance_amount) FILTER (WHERE status IN ('active','offered')) AS volume,
                   SUM(ebitda_gain) FILTER (WHERE date_trunc('month', offered_at) = date_trunc('month', now())) AS gain_mtd
            FROM discount_deals GROUP BY pool_id
        ) d ON d.pool_id = p.id
        ORDER BY p.id
    """)


async def compare_pools(db: AsyncSession, amount: float, vendor_rate: float, days: int,
                        is_msme: bool) -> dict:
    pools = await fetch_all(db, "SELECT * FROM discount_pools WHERE active")
    rows = []
    for p in pools:
        cof = float(p["cost_of_funds_pct"] or 0)
        if p["pool_type"] == "treds":
            if not is_msme:
                rows.append({"pool": p["id"], "eligible": False,
                             "note": "TReDS requires MSME vendor", "gain": 0})
                continue
            rows.append({"pool": p["id"], "eligible": True, "cof": 0,
                         "spread": vendor_rate, "gain": 0,
                         "note": "Off-balance-sheet · no P&L gain, liquidity benefit to vendor"})
            continue
        spread = vendor_rate - cof
        gain = ebitda_gain(amount, vendor_rate, cof, days)
        rows.append({"pool": p["id"], "eligible": True, "cof": cof,
                     "spread": round(spread, 2), "gain": gain,
                     "note": "cost > spread · skip pool" if spread <= 0 else None})
    eligible = [r for r in rows if r["eligible"] and r["gain"] > 0]
    best = max(eligible, key=lambda r: r["gain"])["pool"] if eligible else ("treds" if is_msme else None)
    return {"pools": rows, "recommended": best}


async def create_deal(db: AsyncSession, invoice_id: str, pool_id: str, vendor_rate: float,
                      days_saved: int, user: dict, cc_facility_id: str | None = None) -> dict:
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        return {"error": "Invoice not found"}
    pool = await fetch_one(db, "SELECT * FROM discount_pools WHERE id = :id", {"id": pool_id})
    cof = float(pool["cost_of_funds_pct"] or 0)
    amount = float(inv["net_payable"])
    discount = round(amount * vendor_rate / 100 * days_saved / 365, 2)
    advance = round(amount - discount, 2)
    gain = ebitda_gain(amount, vendor_rate, cof, days_saved) if pool["pool_type"] != "treds" else 0

    seq = await fetch_one(db, "SELECT COUNT(*) + 43 AS n FROM discount_deals")
    deal_id = f"DD-{date.today():%Y-%m}-{seq['n']:04d}"
    await execute(db, """
        INSERT INTO discount_deals (id, invoice_id, vendor_id, pool_id, cc_facility_id,
                                    advance_amount, days_saved, vendor_rate_pct, cof_pct, spread_pct, ebitda_gain, status)
        VALUES (:id, :inv, :v, :p, :cc, :adv, :days, :vr, :cof, :spread, :gain, 'active')
    """, {"id": deal_id, "inv": invoice_id, "v": inv["vendor_id"], "p": pool_id,
          "cc": cc_facility_id, "adv": advance, "days": days_saved, "vr": vendor_rate,
          "cof": cof, "spread": round(vendor_rate - cof, 3), "gain": gain})
    await execute(db, "UPDATE discount_pools SET deployed = deployed + :a WHERE id = :p",
                  {"a": advance, "p": pool_id})
    if cc_facility_id:
        await execute(db, "UPDATE cc_facilities SET drawn = drawn + :a WHERE id = :c",
                      {"a": advance, "c": cc_facility_id})
    await log_action(db, user["sub"], user["name"], "Created discount deal", "discount_deal", deal_id,
                     f"{pool['name']} · advance ₹{advance:,.0f} · {days_saved}d · spread {vendor_rate - cof:.2f}% · gain ₹{gain:,.0f}")
    return {"deal_id": deal_id, "advance": advance, "ebitda_gain": gain}
