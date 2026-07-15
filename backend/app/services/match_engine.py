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


def _as_dict(value) -> dict:
    if not value:
        return {}
    return value if isinstance(value, dict) else json.loads(value)


def invoice_line_summary(invoice: dict) -> tuple[float | None, float | None]:
    """Best-effort invoice-side (qty, unit_price) from OCR-captured line items.
    Returns (None, None) when the invoice has no structured line-item data —
    Capture Inbox only asks for aggregate amounts today, so this is often unavailable."""
    extract = _as_dict(invoice.get("ocr_extract"))
    qty, have_qty = 0.0, False
    for item in extract.get("line_items") or []:
        q = item.get("quantity")
        if q is not None:
            try:
                qty += float(q)
                have_qty = True
            except (TypeError, ValueError):
                pass
    if not have_qty or qty <= 0:
        return None, None
    taxable = float(invoice.get("taxable_amount") or 0)
    return qty, (round(taxable / qty, 2) if taxable > 0 else None)


async def resolve_grn(db: AsyncSession, invoice: dict) -> dict | None:
    """An invoice's GRN may already be linked (invoice.grn_id); otherwise fall back to
    the most recent non-draft GRN raised against the same PO."""
    if invoice.get("grn_id"):
        return await fetch_one(db, "SELECT * FROM grns WHERE id = :id", {"id": invoice["grn_id"]})
    if invoice.get("po_id"):
        return await fetch_one(db, """
            SELECT * FROM grns WHERE po_id = :po AND status != 'draft'
            ORDER BY received_at DESC LIMIT 1
        """, {"po": invoice["po_id"]})
    return None


async def run_match(db: AsyncSession, invoice_id: str) -> dict:
    inv = await fetch_one(db, "SELECT * FROM invoices WHERE id = :id", {"id": invoice_id})
    if not inv:
        return {"error": "Invoice not found"}
    if not inv["po_id"]:
        return {"status": "no_po", "score": None,
                "flags": ["Non-PO invoice — routed to approval matrix directly"]}

    po = await fetch_one(db, "SELECT * FROM purchase_orders WHERE id = :id", {"id": inv["po_id"]})
    grn = await resolve_grn(db, inv)
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

    if grn:
        grn_lines = await fetch_all(db, """
            SELECT gl.qty_received, gl.qty_accepted, pl.quantity AS po_qty
            FROM grn_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
            WHERE gl.grn_id = :g
        """, {"g": grn["id"]})
        inv_qty, _ = invoice_line_summary(inv)
        if grn_lines:
            grn_accepted_total = sum(float(l["qty_accepted"]) for l in grn_lines)
            if inv_qty is not None:
                # Demo rule: invoice quantity must match GRN accepted quantity exactly.
                if abs(inv_qty - grn_accepted_total) > 0.001:
                    flags.append(f"qty mismatch: invoice {inv_qty:g} vs GRN accepted {grn_accepted_total:g}")
                    score -= 20
            else:
                # No structured invoice qty captured — fall back to PO-ordered vs GRN-accepted.
                for line in grn_lines:
                    if line["po_qty"] and float(line["po_qty"]) > 0:
                        qty_var = abs(float(line["qty_accepted"]) - float(line["po_qty"])) / float(line["po_qty"]) * 100
                        if qty_var > float(tol["qty_pct"]):
                            flags.append(f"qty variance {qty_var:.1f}% (GRN accepted vs PO ordered)")
                            score -= min(qty_var * 2, 20)
        # grn exists but has no recorded lines (service-type receipt) — nothing to check.
    else:
        flags.append("GRN missing — service confirmation required")
        score -= 10

    po_gst = float(po["gst_amount"])
    inv_gst = float(inv["cgst"]) + float(inv["sgst"]) + float(inv["igst"])
    if tol.get("gst") == "exact" and po_gst > 0 and abs(inv_gst - po_gst) > 1:
        flags.append(f"GST mismatch: invoice ₹{inv_gst:,.0f} vs PO ₹{po_gst:,.0f}")
        score -= 15

    score = max(round(score, 1), 0)
    auto_threshold = await auto_approve_threshold(db)
    if score >= auto_threshold:
        status = "auto_matched"
    elif score >= 80:
        status = "exception"
    else:
        status = "failed"
    return {"status": status, "score": score, "flags": flags,
            "po_id": inv["po_id"], "grn_id": grn["id"] if grn else None}


def build_comparison(invoice: dict, po: dict | None, po_lines: list[dict],
                     grn: dict | None, grn_lines: list[dict], tol: dict) -> list[dict]:
    """Field-by-field Invoice vs PO vs GRN comparison for the 3-Way Match detail
    view — independent of the scored run_match() result, so it's meaningful even
    before 'Run 3-Way Match' has been clicked."""
    price_tol = float(tol.get("price_pct", 2.0))

    def cell(field, inv_v, po_v, grn_v, result, remark=""):
        return {"field": field, "invoice": inv_v, "po": po_v, "grn": grn_v,
                "result": result, "remark": remark}

    rows = []

    inv_vendor = invoice.get("vendor_name")
    po_vendor = po.get("vendor_name") if po else None
    rows.append(cell("Vendor", inv_vendor or "—", po_vendor or "—", po_vendor or "—",
                     "na" if not po else ("match" if inv_vendor == po_vendor else "mismatch"),
                     "PO not linked" if not po else
                     ("" if inv_vendor == po_vendor else "PO belongs to a different vendor")))

    rows.append(cell("PO number", invoice.get("po_id") or "—", po["id"] if po else "—",
                     grn["po_id"] if grn else "—", "na" if not po else "match"))

    po_desc = "; ".join(l["description"] for l in po_lines) if po_lines else None
    extract = _as_dict(invoice.get("ocr_extract"))
    inv_desc = "; ".join(li.get("description", "") for li in (extract.get("line_items") or [])
                         if li.get("description")) or None
    if inv_desc and po_desc:
        overlap = any(w.lower() in po_desc.lower() for w in inv_desc.split() if len(w) > 3)
        desc_result, desc_remark = ("match" if overlap else "mismatch"), "descriptive only — not scored"
    else:
        desc_result, desc_remark = "na", "invoice line items not captured at OCR time"
    rows.append(cell("Item / description", inv_desc or "—", po_desc or "—", po_desc or "—",
                     desc_result, desc_remark))

    inv_qty, inv_unit_price = invoice_line_summary(invoice)
    po_qty = sum(float(l["quantity"]) for l in po_lines) if po_lines else None
    po_unit_price = (round(sum(float(l["quantity"]) * float(l["unit_price"]) for l in po_lines) / po_qty, 2)
                     if po_qty else None)
    grn_qty = sum(float(l["qty_accepted"]) for l in grn_lines) if grn_lines else None

    if inv_qty is not None and grn_qty is not None:
        qty_ok = abs(inv_qty - grn_qty) < 0.001
        rows.append(cell("Quantity", inv_qty, po_qty if po_qty is not None else "—", grn_qty,
                        "match" if qty_ok else "mismatch",
                        "" if qty_ok else f"invoice qty {inv_qty:g} vs GRN accepted {grn_qty:g}"))
    elif po_qty is not None and grn_qty is not None:
        qty_ok = abs(po_qty - grn_qty) < 0.001
        rows.append(cell("Quantity", "—", po_qty, grn_qty, "match" if qty_ok else "mismatch",
                        "invoice line qty not captured — showing PO ordered vs GRN accepted" +
                        ("" if qty_ok else f" ({po_qty:g} vs {grn_qty:g})")))
    else:
        rows.append(cell("Quantity", inv_qty if inv_qty is not None else "—",
                        po_qty if po_qty is not None else "—", grn_qty if grn_qty is not None else "—",
                        "na", "GRN has no recorded line items" if grn else "GRN not linked"))

    if inv_unit_price is not None and po_unit_price:
        price_var = abs(inv_unit_price - po_unit_price) / po_unit_price * 100
        price_ok = price_var <= price_tol
        rows.append(cell("Unit price", inv_unit_price, po_unit_price, "—",
                        "match" if price_ok else "mismatch",
                        ("" if price_ok else f"{price_var:.1f}% variance (tolerance ±{price_tol:g}%)")
                        + " · GRN does not record price"))
    else:
        rows.append(cell("Unit price", inv_unit_price if inv_unit_price is not None else "—",
                        po_unit_price if po_unit_price is not None else "—", "—", "na",
                        "invoice line qty/price not captured" if po_unit_price else "no PO line data"))

    inv_taxable = float(invoice.get("taxable_amount") or 0)
    po_taxable = round(float(po["amount"]) - float(po["gst_amount"]), 2) if po else None
    if po_taxable is not None and po_taxable > 0:
        var = abs(inv_taxable - po_taxable) / po_taxable * 100
        ok = var <= price_tol
        rows.append(cell("Taxable amount", inv_taxable, po_taxable, "—", "match" if ok else "mismatch",
                        ("" if ok else f"{var:.1f}% variance (tolerance ±{price_tol:g}%)") + " · GRN does not record amounts"))
    else:
        rows.append(cell("Taxable amount", inv_taxable, "—", "—", "na", "PO not linked"))

    inv_gst = float(invoice.get("cgst") or 0) + float(invoice.get("sgst") or 0) + float(invoice.get("igst") or 0)
    po_gst = float(po["gst_amount"]) if po else None
    if po_gst is not None:
        ok = abs(inv_gst - po_gst) <= 1
        rows.append(cell("GST amount", inv_gst, po_gst, "—", "match" if ok else "mismatch",
                        ("" if ok else f"₹{abs(inv_gst - po_gst):,.0f} difference — must match exactly")
                        + " · GRN does not record amounts"))
    else:
        rows.append(cell("GST amount", inv_gst, "—", "—", "na", "PO not linked"))

    inv_total = float(invoice.get("total_amount") or 0)
    po_total = float(po["amount"]) if po else None
    if po_total is not None and po_total > 0:
        var = abs(inv_total - po_total) / po_total * 100
        ok = var <= price_tol
        rows.append(cell("Total amount", inv_total, po_total, "—", "match" if ok else "mismatch",
                        ("" if ok else f"{var:.1f}% variance (tolerance ±{price_tol:g}%)") + " · GRN does not record amounts"))
    else:
        rows.append(cell("Total amount", inv_total, "—", "—", "na", "PO not linked"))

    return rows
