"""AI agents (pi-wc pattern): GPT-4o recommendations, human-in-the-loop only.
Every invocation is logged to agent_invocations. If the OpenAI call fails or no
key is configured, a deterministic simulated response keeps the demo flowing.

The API key is read once, directly from the OPENAI_API_KEY environment variable
(never hardcoded, never logged) — it is only ever passed to the OpenAI client
constructor, never printed or persisted anywhere.
"""
import json
import os
import time
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.database import execute

settings = get_settings()
_api_key = os.getenv("OPENAI_API_KEY")
_client = AsyncOpenAI(api_key=_api_key) if _api_key else None


async def _record(db: AsyncSession, agent: str, entity_type: str, entity_id: str,
                  output: dict, confidence: float | None, latency_ms: int):
    await execute(db, """
        INSERT INTO agent_invocations (agent, entity_type, entity_id, model, output, confidence, latency_ms)
        VALUES (:a, :et, :eid, :m, CAST(:o AS jsonb), :c, :l)
    """, {"a": agent, "et": entity_type, "eid": entity_id, "m": settings.openai_model,
          "o": json.dumps(output, default=str), "c": confidence, "l": latency_ms})


async def _chat_json(system: str, user: str) -> dict | None:
    if not _client:
        return None
    try:
        resp = await _client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            temperature=0.2,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception:
        return None


def _fallback_extract(note: str) -> dict:
    """Safe, deterministic stand-in when the OpenAI call didn't happen or failed
    for any reason (no key, invalid key, quota/billing, network, model access) —
    every field comes back null so the review form is simply blank, not broken."""
    return {"vendor_name": None, "vendor_invoice_no": None, "invoice_date": None,
            "po_number": None, "taxable_amount": None, "gst_rate": 18.0, "gst_amount": None,
            "total_amount": None, "irn": None, "irn_status": "not_applicable",
            "line_items": [], "confidence": 0, "note": note}


async def extract_invoice(db: AsyncSession, invoice_ref: str, raw_text: str) -> dict:
    """Invoice OCR/extraction agent: raw captured text → structured fields."""
    t0 = time.monotonic()
    out = await _chat_json(
        "You are an India-tuned invoice extraction agent for an NBFC's AP system. "
        "Extract from the invoice text and return JSON with keys: vendor_name, vendor_gstin, "
        "vendor_invoice_no, invoice_date (YYYY-MM-DD), po_number (or null if not referenced), "
        "taxable_amount, gst_rate, gst_amount, total_amount, irn (or null), "
        "line_items (array of {description, quantity, unit_price}), confidence (0-100).",
        raw_text[:6000],
    )
    if out is None:
        out = _fallback_extract("AI OCR unavailable, please review manually")
    latency = int((time.monotonic() - t0) * 1000)
    await _record(db, "invoice_ocr", "invoice", invoice_ref, out, out.get("confidence"), latency)
    return out


async def extract_invoice_image(db: AsyncSession, invoice_ref: str, image_bytes: bytes,
                                mime: str) -> dict:
    """Vision OCR: invoice image → structured fields (GPT-4o multimodal)."""
    import base64
    t0 = time.monotonic()
    out = None
    if _client:
        try:
            b64 = base64.b64encode(image_bytes).decode()
            resp = await _client.chat.completions.create(
                model=settings.openai_model,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content":
                     "You are an India-tuned invoice OCR agent for an NBFC's AP system. "
                     "Read the invoice image and return JSON with keys: vendor_name, vendor_gstin, "
                     "vendor_invoice_no, invoice_date (YYYY-MM-DD), po_number (or null if not referenced), "
                     "taxable_amount, gst_rate, gst_amount, total_amount, irn (or null), "
                     "line_items (array of {description, quantity, unit_price}), "
                     "confidence (0-100). Use null for anything you cannot read."},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    ]},
                ],
                temperature=0.1,
            )
            out = json.loads(resp.choices[0].message.content)
        except Exception:
            out = None
    if out is None:
        out = _fallback_extract("AI OCR unavailable, please review manually")
    latency = int((time.monotonic() - t0) * 1000)
    await _record(db, "invoice_ocr", "invoice", invoice_ref, out, out.get("confidence"), latency)
    return out


async def recommend_pool(db: AsyncSession, request_id: str, context: dict) -> dict:
    """Pool recommendation agent: route an early-pay/discount opportunity to
    treasury, cc, or treds and estimate the EBITDA gain. Recommendation only."""
    t0 = time.monotonic()
    out = await _chat_json(
        "You are a treasury routing agent for invoice discounting at an NBFC. Pools: "
        "'treasury' (cost of funds = FD opportunity cost), 'cc' (bank cash-credit drawdown rate), "
        "'treds' (off-balance-sheet, zero cost, MSME vendors only). Pick the pool that maximises "
        "EBITDA gain = amount × (vendor_rate − cost_of_funds)/100 × days/365, respecting MSME "
        "45-day priority. Return JSON: {pool, expected_gain, rationale, confidence}.",
        json.dumps(context, default=str),
    )
    if out is None:
        amt, days = float(context.get("amount", 0)), int(context.get("days_available", 0))
        v_rate = float(context.get("requested_rate_pct", 9.0))
        t_cof, c_cof = float(context.get("treasury_cof", 6.5)), float(context.get("cc_cof", 10.4))
        gains = {
            "treasury": amt * (v_rate - t_cof) / 100 * days / 365,
            "cc": amt * (v_rate - c_cof) / 100 * days / 365,
        }
        if context.get("is_msme"):
            gains["treds"] = amt * v_rate / 100 * days / 365 * 0.4
        pool = max(gains, key=gains.get)
        out = {"pool": pool, "expected_gain": round(max(gains[pool], 0), 0),
               "rationale": f"Deterministic fallback: best spread of {len(gains)} pools over {days} days.",
               "confidence": 75}
    latency = int((time.monotonic() - t0) * 1000)
    await _record(db, "pool_recommender", "early_pay", request_id, out, out.get("confidence"), latency)
    return out


async def analyse_exception(db: AsyncSession, invoice_id: str, context: dict) -> dict:
    """Match-exception analyst: explains a 3-way match failure and recommends an action."""
    t0 = time.monotonic()
    out = await _chat_json(
        "You are an AP match-exception analyst. Given a 3-way match result with flags, "
        "explain the likely cause and recommend ONE action from: 'hold_for_buyer', "
        "'request_credit_note', 'tolerance_release', 'escalate_procurement'. "
        "Return JSON: {cause, recommendation, rationale, confidence}.",
        json.dumps(context, default=str),
    )
    if out is None:
        out = {"cause": "Variance beyond tolerance", "recommendation": "hold_for_buyer",
               "rationale": "AI unavailable — defaulting to safe hold.", "confidence": 50}
    latency = int((time.monotonic() - t0) * 1000)
    await _record(db, "match_analyst", "invoice", invoice_id, out, out.get("confidence"), latency)
    return out
