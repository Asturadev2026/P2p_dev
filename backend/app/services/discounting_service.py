"""Invoice discounting — pool stats, EBITDA math, deal creation, early-pay routing."""
import random
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_all, fetch_one, execute
from app.utils.audit import log_action

DEMO_FINANCIERS = ["HDFC Bank", "ICICI Bank", "Kotak Mahindra Bank", "Yes Bank", "IndusInd Bank", "SBI"]


def ebitda_gain(amount: float, vendor_rate: float, cof: float, days: int) -> float:
    return round(amount * (vendor_rate - cof) / 100 * days / 365, 2)


async def eligible_invoices(db: AsyncSession) -> list[dict]:
    """Invoices a discount deal could be created against: approved-unpaid,
    payment_ready, or liability_booked, still unpaid, and not already tied to an
    active/settled deal."""
    return await fetch_all(db, """
        SELECT i.id, i.vendor_id, v.name AS vendor_name, v.is_msme, i.net_payable, i.due_date,
               i.stage, i.tds_status, i.payment_status, i.liability_status
        FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id
        WHERE (i.tds_status = 'approved'
               OR (i.payment_status = 'payment_ready' AND i.stage = 'payments')
               OR i.liability_status = 'liability_booked')
          AND i.stage NOT IN ('paid', 'rejected')
          AND i.net_payable > 0
          AND NOT EXISTS (SELECT 1 FROM discount_deals d
                          WHERE d.invoice_id = i.id AND d.status IN ('active', 'offered', 'settled'))
        ORDER BY i.due_date NULLS LAST
    """)


async def eligible_treds_invoices(db: AsyncSession) -> list[dict]:
    """MSME vendor invoices a factoring unit could be listed against: approved-unpaid,
    payment_ready, or liability_booked, still unpaid, and not already linked to a
    factoring_unit."""
    return await fetch_all(db, """
        SELECT i.id, i.vendor_id, v.name AS vendor_name, v.is_msme, i.net_payable, i.due_date,
               i.stage, i.tds_status, i.payment_status, i.liability_status
        FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id
        WHERE v.is_msme
          AND (i.tds_status = 'approved'
               OR (i.payment_status = 'payment_ready' AND i.stage = 'payments')
               OR i.liability_status = 'liability_booked')
          AND i.stage NOT IN ('paid', 'rejected')
          AND i.net_payable > 0
          AND NOT EXISTS (SELECT 1 FROM factoring_units f WHERE f.invoice_id = i.id)
        ORDER BY i.due_date NULLS LAST
    """)


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
    """Compares Bank CC-Led Pool and Treasury-Led Pool by EBITDA gain (spread = vendor
    rate - cost of funds; gain = amount * spread% * days/365). TReDS Marketplace is only
    compared when the vendor is MSME, and — being off-balance-sheet — is never ranked by
    gain, just shown as a liquidity-only alternative."""
    pools = await fetch_all(db, "SELECT * FROM discount_pools WHERE active")
    rows = []
    for p in pools:
        cof = float(p["cost_of_funds_pct"] or 0)
        if p["pool_type"] == "treds":
            if not is_msme:
                continue
            rows.append({"pool": p["id"], "eligible": True, "cof": 0,
                         "spread": vendor_rate, "gain": 0, "rank": None,
                         "note": "Off-balance-sheet · no P&L gain, liquidity benefit to vendor"})
            continue
        spread = vendor_rate - cof
        gain = ebitda_gain(amount, vendor_rate, cof, days)
        rows.append({"pool": p["id"], "eligible": True, "cof": cof,
                     "spread": round(spread, 2), "gain": gain, "rank": None,
                     "note": "cost > spread · skip pool" if spread <= 0 else None})

    ranked = sorted((r for r in rows if r["pool"] != "treds" and r["gain"] > 0),
                    key=lambda r: r["gain"], reverse=True)
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i

    best = ranked[0]["pool"] if ranked else ("treds" if is_msme else None)
    return {"pools": rows, "recommended": best}


async def create_deal(db: AsyncSession, invoice_id: str, pool_id: str, vendor_rate: float,
                      days_saved: int, user: dict, cc_facility_id: str | None = None) -> dict:
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        return {"error": "Invoice not found"}
    dup = await fetch_one(db, """
        SELECT id FROM discount_deals WHERE invoice_id = :id AND status IN ('active', 'offered', 'settled')
    """, {"id": invoice_id})
    if dup:
        return {"error": f"Invoice already has a {dup['id']} deal in progress or settled"}
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
        VALUES (:id, :inv, :v, :p, :cc, :adv, :days, :vr, :cof, :spread, :gain, 'offered')
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


_FU_PREFIX = {"rxil": "RXIL", "m1x": "M1X", "invoicemart": "INVMART"}


async def list_on_treds(db: AsyncSession, invoice_id: str, platform_id: str,
                        settlement_days: int | None, remarks: str | None, user: dict) -> dict:
    inv = await fetch_one(db, """
        SELECT i.*, v.is_msme FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = :id
    """, {"id": invoice_id})
    if not inv:
        return {"error": "Invoice not found"}
    if not inv["is_msme"]:
        return {"error": "Only MSME vendor invoices can be listed on TReDS"}
    dup = await fetch_one(db, "SELECT id FROM factoring_units WHERE invoice_id = :id", {"id": invoice_id})
    if dup:
        return {"error": f"Invoice already listed on TReDS as {dup['id']}"}
    platform = await fetch_one(db, "SELECT * FROM treds_platforms WHERE id = :id", {"id": platform_id})
    if not platform:
        return {"error": "Platform not found"}

    seq = await fetch_one(db, "SELECT COUNT(*) + 5001 AS n FROM factoring_units")
    fu_id = f"FU-{_FU_PREFIX.get(platform_id, platform_id.upper())}-{seq['n']:04d}"
    await execute(db, """
        INSERT INTO factoring_units (id, platform_id, invoice_id, vendor_id, amount,
                                     settlement_days, remarks, status)
        VALUES (:id, :p, :inv, :v, :amt, :days, :rem, 'listed')
    """, {"id": fu_id, "p": platform_id, "inv": invoice_id, "v": inv["vendor_id"],
          "amt": float(inv["net_payable"]), "days": settlement_days, "rem": remarks})
    await log_action(db, user["sub"], user["name"], "Listed invoice on TReDS", "factoring_unit", fu_id,
                     f"{platform['name']} · {invoice_id} · ₹{float(inv['net_payable']):,.0f}")
    return {"id": fu_id, "status": "listed"}


async def start_bidding(db: AsyncSession, fu_id: str, user: dict) -> dict:
    """Demo-generates 2-3 financier bids for a listed factoring unit and moves it to
    'bidding'. No real financier network is wired up — this simulates the auction."""
    fu = await fetch_one(db, "SELECT * FROM factoring_units WHERE id = :id", {"id": fu_id})
    if not fu:
        return {"error": "Factoring unit not found"}
    if fu["status"] != "listed":
        return {"error": f"Factoring unit is '{fu['status']}', not 'listed'"}

    amount = float(fu["amount"])
    base_days = fu["settlement_days"] or 30
    financiers = random.sample(DEMO_FINANCIERS, random.choice([2, 3]))
    bids = []
    for financier in financiers:
        rate = round(random.uniform(8.5, 13.5), 2)
        days = max(7, base_days + random.randint(-5, 5))
        advance = round(amount * (1 - rate / 100 * days / 365), 2)
        bids.append({"financier": financier, "rate_pct": rate, "advance_amount": advance, "days": days})
        await execute(db, """
            INSERT INTO factoring_bids (fu_id, financier, rate_pct, advance_amount, settlement_days, status)
            VALUES (:fu, :f, :r, :a, :d, 'submitted')
        """, {"fu": fu_id, "f": financier, "r": rate, "a": advance, "d": days})

    best = min(bids, key=lambda b: b["rate_pct"])
    await execute(db, """
        UPDATE factoring_units SET status = 'bidding', best_bid_pct = :r, best_bidder = :f WHERE id = :id
    """, {"r": best["rate_pct"], "f": best["financier"], "id": fu_id})
    await log_action(db, user["sub"], user["name"], "Started TReDS bidding", "factoring_unit", fu_id,
                     f"{len(bids)} bids · best {best['financier']} @ {best['rate_pct']}%")
    return {"id": fu_id, "status": "bidding", "bids": len(bids), "best_bid_pct": best["rate_pct"],
            "best_bidder": best["financier"]}


async def accept_best_bid(db: AsyncSession, fu_id: str, user: dict) -> dict:
    fu = await fetch_one(db, "SELECT * FROM factoring_units WHERE id = :id", {"id": fu_id})
    if not fu:
        return {"error": "Factoring unit not found"}
    if fu["status"] != "bidding":
        return {"error": f"Factoring unit is '{fu['status']}', not 'bidding'"}
    all_bids = await fetch_all(db, "SELECT * FROM factoring_bids WHERE fu_id = :id ORDER BY rate_pct", {"id": fu_id})
    if not all_bids:
        return {"error": "No bids to accept"}

    best = all_bids[0]
    await execute(db, "UPDATE factoring_bids SET status = 'accepted' WHERE id = :id", {"id": best["id"]})
    await execute(db, "UPDATE factoring_bids SET status = 'rejected' WHERE fu_id = :fu AND id != :id",
                  {"fu": fu_id, "id": best["id"]})
    await execute(db, """
        UPDATE factoring_units SET status = 'won', best_bid_pct = :r, best_bidder = :f WHERE id = :id
    """, {"r": best["rate_pct"], "f": best["financier"], "id": fu_id})
    await log_action(db, user["sub"], user["name"], "Accepted TReDS best bid", "factoring_unit", fu_id,
                     f"{best['financier']} @ {best['rate_pct']}%")
    return {"id": fu_id, "status": "won", "best_bid_pct": float(best["rate_pct"]), "best_bidder": best["financier"]}


async def settle_factoring_unit(db: AsyncSession, fu_id: str, settlement_date: date | None,
                                settlement_ref: str | None, remarks: str | None, user: dict) -> dict:
    fu = await fetch_one(db, "SELECT * FROM factoring_units WHERE id = :id", {"id": fu_id})
    if not fu:
        return {"error": "Factoring unit not found"}
    if fu["status"] != "won":
        return {"error": f"Factoring unit is '{fu['status']}', not 'won'"}
    inv = await fetch_one(db, "SELECT stage FROM invoices WHERE id = :id", {"id": fu["invoice_id"]})

    await execute(db, """
        UPDATE factoring_units SET status = 'settled', settled_at = COALESCE(:dt, now()),
               settlement_ref = :ref, settlement_remarks = :rem WHERE id = :id
    """, {"dt": settlement_date, "ref": settlement_ref, "rem": remarks, "id": fu_id})
    await execute(db, """
        UPDATE invoices SET stage = 'paid', payment_status = 'paid', updated_at = now() WHERE id = :id
    """, {"id": fu["invoice_id"]})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, :from_s, 'paid', :u, :n)
    """, {"id": fu["invoice_id"], "from_s": inv["stage"] if inv else None, "u": user["sub"],
          "n": f"TReDS factoring unit {fu_id} settled · {fu['best_bidder']} @ {fu['best_bid_pct']}%"})
    await log_action(db, user["sub"], user["name"], "Settled TReDS factoring unit", "factoring_unit", fu_id,
                     f"Ref {settlement_ref or '—'} · invoice {fu['invoice_id']} marked paid")
    return {"id": fu_id, "status": "settled"}


async def activate_deal(db: AsyncSession, deal_id: str, user: dict) -> dict:
    deal = await fetch_one(db, "SELECT * FROM discount_deals WHERE id = :id", {"id": deal_id})
    if not deal:
        return {"error": "Deal not found"}
    if deal["status"] != "offered":
        return {"error": f"Deal is '{deal['status']}', not 'offered'"}
    await execute(db, "UPDATE discount_deals SET status = 'active' WHERE id = :id", {"id": deal_id})
    await log_action(db, user["sub"], user["name"], "Activated discount deal", "discount_deal", deal_id, "")
    return {"id": deal_id, "status": "active"}


async def settle_deal(db: AsyncSession, deal_id: str, user: dict) -> dict:
    deal = await fetch_one(db, "SELECT * FROM discount_deals WHERE id = :id", {"id": deal_id})
    if not deal:
        return {"error": "Deal not found"}
    if deal["status"] != "active":
        return {"error": f"Deal is '{deal['status']}', not 'active'"}
    inv = await fetch_one(db, "SELECT stage FROM invoices WHERE id = :id", {"id": deal["invoice_id"]})
    await execute(db, "UPDATE discount_deals SET status = 'settled', settled_at = now() WHERE id = :id",
                  {"id": deal_id})
    await execute(db, """
        UPDATE invoices SET stage = 'paid', payment_status = 'paid', updated_at = now() WHERE id = :id
    """, {"id": deal["invoice_id"]})
    await execute(db, """
        INSERT INTO invoice_stage_history (invoice_id, from_stage, to_stage, actor_id, note)
        VALUES (:id, :from_s, 'paid', :u, :n)
    """, {"id": deal["invoice_id"], "from_s": inv["stage"] if inv else None, "u": user["sub"],
          "n": f"Discount deal {deal_id} settled — paid via early-pay pool"})
    await log_action(db, user["sub"], user["name"], "Settled discount deal", "discount_deal", deal_id,
                     f"Invoice {deal['invoice_id']} marked paid")
    return {"id": deal_id, "status": "settled"}
