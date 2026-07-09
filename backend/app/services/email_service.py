"""Email sending via Resend API."""
import httpx
from app.core.config import get_settings

RESEND_URL = "https://api.resend.com/emails"


async def send_onboarding_email(
    to_email: str,
    vendor_name: str,
    kyc_url: str,
    subject: str,
    personal_message: str,
    sent_by_name: str = "Procurement Team",
    link_validity_days: int = 7,
):
    settings = get_settings()
    api_key = settings.resend_api_key
    if not api_key:
        raise Exception("RESEND_API_KEY not configured in .env")

    safe_message = personal_message.replace("\n", "<br>")

    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f4f5f7;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
    <div style="background:#1a1a2e;padding:24px 32px;display:flex;align-items:center;gap:12px;">
      <div>
        <h1 style="color:#fff;margin:0;font-size:18px;">Vendor Onboarding</h1>
        <p style="color:#8888aa;margin:2px 0 0;font-size:13px;">AstonomiQ Finance Suite</p>
      </div>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;line-height:1.7;font-size:15px;">{safe_message}</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{kyc_url}"
           style="display:inline-block;background:#dc2626;color:#fff;padding:14px 36px;border-radius:6px;
                  text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.3px;">
          → Complete KYC
        </a>
      </div>
      <div style="background:#f8f8fb;border-radius:8px;padding:18px 20px;margin-top:24px;">
        <p style="color:#444;font-size:13px;font-weight:700;margin:0 0 10px;">You will need:</p>
        <ul style="color:#555;font-size:13px;margin:0;padding-left:20px;line-height:2;">
          <li>GST certificate (auto-fetched via GSTIN)</li>
          <li>PAN card</li>
          <li>Cancelled cheque or bank statement</li>
          <li>MSME / Udyam certificate (if applicable)</li>
          <li>Signed agreement template</li>
        </ul>
      </div>
      <p style="color:#aaa;font-size:12px;margin-top:28px;line-height:1.6;">
        This secure link is valid for <strong>{link_validity_days} days</strong>.
        The form takes approximately 8 minutes to complete.<br>
        Sent by: {sent_by_name}
      </p>
    </div>
  </div>
</body>
</html>
"""

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": "Vendor Onboarding <onboarding@astura.ai>",
                "to": [to_email],
                "subject": subject,
                "html": html,
            },
        )

    if resp.status_code not in (200, 201):
        raise Exception(f"Email send failed ({resp.status_code}): {resp.text}")

    return resp.json()


async def send_rfq_email(to_email: str, vendor_name: str, rfq_id: str, title: str,
                         deadline: str, message: str, sent_by_name: str = "Procurement Team"):
    """RFQ invitation to a vendor contact — same delivery path as the onboarding email,
    best-effort (caller should swallow failures when RESEND_API_KEY isn't configured)."""
    settings = get_settings()
    api_key = settings.resend_api_key
    if not api_key:
        raise Exception("RESEND_API_KEY not configured in .env")

    safe_message = message.replace("\n", "<br>")
    html = f"""
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f5f7;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
    <div style="background:#1a1a2e;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Request for Quotation · {rfq_id}</h1>
      <p style="color:#8888aa;margin:2px 0 0;font-size:13px;">AstonomiQ Finance Suite</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;line-height:1.7;font-size:15px;">Dear {vendor_name},</p>
      <p style="color:#333;line-height:1.7;font-size:15px;">{safe_message}</p>
      <div style="background:#f8f8fb;border-radius:8px;padding:18px 20px;margin-top:20px;">
        <p style="color:#444;font-size:13px;margin:0 0 6px;"><strong>RFQ:</strong> {title}</p>
        <p style="color:#444;font-size:13px;margin:0;"><strong>Quotation deadline:</strong> {deadline}</p>
      </div>
      <p style="color:#aaa;font-size:12px;margin-top:28px;">Sent by: {sent_by_name}</p>
    </div>
  </div>
</body></html>
"""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": "Procurement <procurement@astura.ai>", "to": [to_email],
                  "subject": f"RFQ {rfq_id} — {title}", "html": html})
    if resp.status_code not in (200, 201):
        raise Exception(f"Email send failed ({resp.status_code}): {resp.text}")
    return resp.json()


async def send_decision_email(to_email: str, vendor_name: str, decision: str,
                              reason: str = "", actor: str = "Compliance Team"):
    """Approval or rejection notification to the vendor contact.
    decision = 'approved' | 'rejected'."""
    settings = get_settings()
    api_key = settings.resend_api_key
    if not api_key:
        raise Exception("RESEND_API_KEY not configured in .env")

    approved = decision == "approved"
    accent = "#16a34a" if approved else "#dc2626"
    heading = "Vendor Onboarding Approved" if approved else "Vendor Onboarding Rejected"
    body = ("Congratulations! Your vendor account has been approved and activated. "
            "You can now receive purchase orders.") if approved else (
            "Your vendor onboarding could not be approved at this time.")
    reason_block = "" if approved or not reason else (
        f'<div style="background:#fef2f2;border-radius:8px;padding:14px 16px;margin-top:16px;'
        f'color:#991b1b;font-size:13px;"><strong>Reason:</strong> {reason}</div>')

    html = f"""
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f5f7;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
    <div style="background:{accent};padding:22px 32px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">{heading}</h1>
      <p style="color:rgba(255,255,255,.85);margin:2px 0 0;font-size:13px;">AstonomiQ Finance Suite · Intelezen Microfin</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;line-height:1.7;font-size:15px;">Dear {vendor_name},</p>
      <p style="color:#333;line-height:1.7;font-size:15px;">{body}</p>
      {reason_block}
      <p style="color:#aaa;font-size:12px;margin-top:28px;">Reviewed by: {actor}</p>
    </div>
  </div>
</body></html>
"""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": "Vendor Onboarding <onboarding@astura.ai>", "to": [to_email],
                  "subject": heading, "html": html})
    if resp.status_code not in (200, 201):
        raise Exception(f"Email send failed ({resp.status_code}): {resp.text}")
    return resp.json()
