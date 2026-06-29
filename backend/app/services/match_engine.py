"""Three-Way Match — Invoice ↔ PO ↔ GRN with configurable tolerance bands,
plus duplicate prevention. Tolerances live in configuration.match_tolerance."""
import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import fetch_one, fetch_all


async def get_tolerance(db: AsyncSession) -> dict:
    row = await fetch_one(db, "SELECT value FROM configuration WHERE key = 'match_tolerance'")
    v = row["value"] if row else {"price_pct": 2.0, "qty_pct": 0.0, "gst": "exact"}
    return v if isinstance(v, dict) else json.loads(v)


async def auto_approve_threshold(db: AsyncSession) -> float:
    row = await fetch_one(db, "SELECT value FROM configuration WHERE key = 'auto_approve_match_pct'")
    return float(row["value"]) if row else 95.0


async def check_duplicate(db: AsyncSession, vendor_id: str, vendor_invoice_no: str,
                          exclude_id: str | None = None) -> dict | None:
    return await fetch_one(db, """
        SELECT id, stage, total_amount FROM invoices
        WHERE vendor_id = :v AND vendor_invoice_no = :n AND (CAST(:x AS TEXT) IS NULL OR id != :x)
    """, {"v": vendor_id, "n": vendor_invoice_no, "x": exclude_id})


async def run_match(db: AsyncSession, invoice_id: str) -> dict:
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        return {"error": "Invoice not found"}
    if not inv["po_id"]:
        return {"status": "no_po", "score": None,
                "flags": ["Non-PO invoice — routed to approval matrix directly"]}

    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": inv["po_id"]})
    tol = await get_tolerance(db)
    flags, score = [], 100.0

    po_amount = float(po["amount"])
    inv_amount = float(inv["total_amount"])
    if po_amount > 0:
        price_var = abs(inv_amount - po_amount) / po_amount * 100
        if price_var > float(tol["price_pct"]):
            over = inv_amount - po_amount
            flags.append(f"price variance {price_var:.1f}% (₹{abs(over):,.0f} {'over' if over > 0 else 'under'} PO)")
            score -= min(price_var * 2, 30)

    if inv["grn_id"]:
        grn_lines = await fetch_all(db, """
            SELECT gl.qty_received, gl.qty_accepted, pl.quantity AS po_qty
            FROM grn_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
            WHERE gl.grn_id = :g
        """, {"g": inv["grn_id"]})
        for line in grn_lines:
            if line["po_qty"] and float(line["po_qty"]) > 0:
                qty_var = abs(float(line["qty_accepted"]) - float(line["po_qty"])) / float(line["po_qty"]) * 100
                if qty_var > float(tol["qty_pct"]):
                    flags.append(f"qty variance {qty_var:.1f}%")
                    score -= min(qty_var * 2, 20)
    else:
        flags.append("GRN missing — service confirmation required")
        score -= 10

    po_gst = float(po["gst_amount"])
    inv_gst = float(inv["cgst"]) + float(inv["sgst"]) + float(inv["igst"])
    if tol.get("gst") == "exact" and po_gst > 0 and abs(inv_gst - po_gst) > 1:
        flags.append(f"GST mismatch: invoice ₹{inv_gst:,.0f} vs PO ₹{po_gst:,.0f}")
        score -= 15

    score = max(round(score, 1), 0)
    threshold = await auto_approve_threshold(db)
    status = "auto_matched" if score >= threshold and not flags else "exception"
    return {"status": status, "score": score, "flags": flags,
            "po_id": inv["po_id"], "grn_id": inv["grn_id"]}
