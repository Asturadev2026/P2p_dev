"""Tax Engine — CGST/SGST/IGST split, TDS at source, RCM flagging.

Rates come from the configuration table; place-of-supply logic uses the vendor's
state vs Intelezen's registration state (Punjab). All computed at capture, before
approval — reviewers see the tax position up front.
"""
import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_one

INTELEZEN_STATE = "Punjab"


async def get_tds_rates(db: AsyncSession) -> dict:
    row = await fetch_one(db, "SELECT value FROM configuration WHERE key = 'tds_rates'")
    if not row:
        return {"194C": 2.0, "194J": 10.0, "194I": 10.0, "194D": 5.0, "194Q": 0.1}
    v = row["value"]
    return v if isinstance(v, dict) else json.loads(v)


def split_gst(taxable: float, gst_rate: float, vendor_state: str | None) -> dict:
    """Intra-state (Punjab) → CGST+SGST halves; inter-state → IGST."""
    gst_total = round(taxable * gst_rate / 100, 2)
    if vendor_state == INTELEZEN_STATE:
        half = round(gst_total / 2, 2)
        return {"cgst": half, "sgst": gst_total - half, "igst": 0.0, "gst_total": gst_total}
    return {"cgst": 0.0, "sgst": 0.0, "igst": gst_total, "gst_total": gst_total}


async def compute(db: AsyncSession, taxable: float, gst_rate: float,
                  vendor_state: str | None, tds_section: str | None,
                  rcm_applicable: bool = False) -> dict:
    gst = split_gst(taxable, gst_rate, vendor_state)
    rates = await get_tds_rates(db)
    tds_rate = float(rates.get(tds_section, 0)) if tds_section else 0.0
    tds_amount = round(taxable * tds_rate / 100, 2)
    total = round(taxable + gst["gst_total"], 2)
    # Under RCM the recipient self-assesses GST: it is a liability, not vendor pay.
    rcm_liability = gst["gst_total"] if rcm_applicable else 0.0
    payable_gst = 0.0 if rcm_applicable else gst["gst_total"]
    net_payable = round(taxable + payable_gst - tds_amount, 2)
    return {
        **gst,
        "tds_section": tds_section, "tds_rate": tds_rate, "tds_amount": tds_amount,
        "rcm_applicable": rcm_applicable, "rcm_liability": rcm_liability,
        "total_amount": total, "net_payable": net_payable,
    }
