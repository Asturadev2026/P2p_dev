import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading, Kpi,
         inr, inrFull, dt, dtt, pct } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Vendor Master + 360 ============ */
export function VendorMaster() {
  const [msmeOnly, setMsmeOnly] = useState(false);
  const { data, loading } = useFetch(() => api.get("/vendors", { msme_only: msmeOnly }), [msmeOnly]);
  const [v360, setV360] = useState(null);
  const [summary, setSummary] = useState(null);

  const open = async (v) => setV360(await api.get(`/vendors/${v.id}/v360`));
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Vendor Master" sub="single source of truth · GSTIN · PAN · MSME · bank — live verified"
        actions={<button className="btn btn-gho" onClick={() => setMsmeOnly(!msmeOnly)}>{msmeOnly ? "All vendors" : "MSME only"}</button>} />
      <div className="kpi-row">
        <Kpi label="Active vendors" value={data.length} note="governed master"
          onSummary={() => setSummary({ entity: "vendors", filters: {}, title: "Active vendors" })} />
        <Kpi label="MSME-flagged" value={data.filter((v) => v.is_msme).length} note="45-day SLA active"
          onSummary={() => setSummary({ entity: "vendors", filters: { msme: true }, title: "MSME vendors" })} />
        <Kpi label="Spend YTD" value={inr(data.reduce((s, v) => s + +v.spend_ytd, 0))} note="across categories"
          onSummary={() => setSummary({ entity: "vendors", filters: {}, title: "Vendor spend" })} />
        <Kpi label="Compliance health" value={`${Math.round(data.filter((v) => v.gstin_verified && v.pan_verified && v.bank_verified).length / (data.length || 1) * 100)}%`} note="GST + PAN + bank verified" noteClass="up" />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card title="Vendor master" sub="click a vendor for the 360 view" pad={false}>
        <DataTable columns={[
          { key: "id", label: "ID", render: (r) => <span className="mono">{r.id}</span> },
          { key: "name", label: "Vendor" },
          { key: "gstin", label: "GSTIN", render: (r) => <span className="mono">{r.gstin || "—"}</span> },
          { key: "state", label: "State" },
          { key: "is_msme", label: "MSME", render: (r) => r.is_msme ? <Chip value="msme_priority" label="MSME" /> : "—" },
          { key: "tier", label: "Tier" },
          { key: "tds_section", label: "TDS" },
          { key: "open_invoices", label: "Open", num: true },
          { key: "spend_ytd", label: "Spend YTD", num: true, render: (r) => inr(r.spend_ytd) },
          { key: "rating", label: "Rating", num: true },
        ]} rows={data} onRow={open} />
      </Card>
      {v360 && (
        <Modal wide title={`${v360.id} · ${v360.name}`} onClose={() => setV360(null)}>
          <DetailGrid items={[
            ["GSTIN", v360.gstin], ["PAN", v360.pan], ["State", v360.state],
            ["MSME", v360.is_msme ? `${v360.udyam_no || "Yes"}` : "No"],
            ["Bank", `${v360.bank_name} · ${v360.bank_account}`], ["TDS", v360.tds_section || "—"],
            ["Terms", `Net ${v360.payment_terms_days}`], ["Rating", v360.rating],
            ["Spend YTD", inr(v360.totals.spend_ytd)], ["Invoices", v360.totals.invoice_count],
            ["Open dues", inr(v360.totals.open_dues)],
            ["Discount earnings", `${inrFull(v360.discount_earnings.total)} · ${v360.discount_earnings.deals} deals`],
          ]} />
          <h4 style={{ margin: "14px 0 8px" }}>Six-month ledger (compliance review view)</h4>
          <DataTable columns={[
            { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
            { key: "invoice_date", label: "Date", render: (r) => dt(r.invoice_date) },
            { key: "total_amount", label: "Gross", num: true, render: (r) => inrFull(r.total_amount) },
            { key: "tds_amount", label: "TDS", num: true, render: (r) => inrFull(r.tds_amount) },
            { key: "net_payable", label: "Net", num: true, render: (r) => inrFull(r.net_payable) },
            { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
            { key: "utr", label: "UTR", render: (r) => <span className="mono">{r.utr || "—"}</span> },
          ]} rows={v360.six_month_ledger} />
          {v360.discounting_history.length > 0 && (<>
            <h4 style={{ margin: "14px 0 8px" }}>Discounting history</h4>
            <DataTable columns={[
              { key: "id", label: "Deal", render: (r) => <span className="mono">{r.id}</span> },
              { key: "pool_name", label: "Pool" },
              { key: "advance_amount", label: "Advance", num: true, render: (r) => inrFull(r.advance_amount) },
              { key: "days_saved", label: "Days", num: true },
              { key: "vendor_rate_pct", label: "Rate", num: true, render: (r) => pct(r.vendor_rate_pct) },
              { key: "ebitda_gain", label: "Gain", num: true, render: (r) => inrFull(r.ebitda_gain) },
              { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
            ]} rows={v360.discounting_history} /></>)}
        </Modal>
      )}
    </>
  );
}

/* ============ Onboarding ============ */
const STEPS = ["Initiate", "GSTIN + PAN verify", "Udyam · MSME", "Penny drop", "Risk scoring", "ERP push"];

const EMPTY_LINK_FORM = {
  entity_name: "", trade_name: "", vendor_type: "domestic",
  constitution: "Private Limited", category: "",
  contact_email: "", contact_phone: "", contact_name: "",
  link_validity_days: 7,
  email_subject: "Vendor Onboarding Invitation · Intelezen Microfin",
  email_message: "Dear Partner,\n\nGreetings from Intelezen Microfin. Following our discussions, please complete the vendor onboarding process by clicking the secure link below.\n\nThe form takes around 8 minutes and you will need: GST certificate, PAN, bank details (cancelled cheque), and MSME certificate (if applicable).\n\nWarm regards,\nProcurement Team",
};

const TAB_DEFS = [
  { key: "all",                  label: "All",                  fn: () => true },
  { key: "link_sent",            label: "Link Sent",            fn: (r) => r.status === "link_sent" },
  { key: "kyc_in_progress",      label: "KYC In Progress",      fn: (r) => r.status === "kyc_in_progress" },
  { key: "submitted_for_review", label: "Submitted for Review", fn: (r) => r.status === "submitted_for_review" },
  { key: "approved",             label: "Approved & Activated", fn: (r) => r.status === "approved" },
  { key: "link_expired",         label: "Expired",              fn: (r) => r.status === "link_expired" },
];

function SendLinkView({ onCancel, onSent }) {
  const { toast } = useApp();
  const [form, setForm] = useState(EMPTY_LINK_FORM);
  const [sending, setSending] = useState(false);
  const f = (k) => (v) => setForm((p) => ({ ...p, [k]: typeof v === "object" ? v.target.value : v }));

  const send = async () => {
    if (!form.entity_name.trim() || !form.contact_email.trim()) {
      toast("Vendor name and email are required", true); return;
    }
    setSending(true);
    try {
      const res = await api.post("/vendors/onboarding/send-link", form);
      toast(`Onboarding link sent to ${form.contact_email}`);
      onSent(res);
    } catch (e) { toast(e.message, true); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <button className="btn btn-gho btn-sm" onClick={onCancel}>← Back</button>
        <span style={{ fontSize: 12, color: "#888" }}>VENDOR ONBOARDING / SEND LINK</span>
      </div>
      <div className="page-head" style={{ marginBottom: 24 }}>
        <div>
          <div className="page-title">Send Onboarding Link</div>
          <div className="page-sub">Vendor receives a unique secure link to complete KYC · valid for {form.link_validity_days} days</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-gho" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* ── Left: form ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Vendor Details */}
          <div className="card">
            <div className="card-head"><div className="card-title">Vendor Details</div></div>
            <div className="card-body">
              <div className="form-row">
                <div className="field">
                  <label>LEGAL VENDOR NAME *</label>
                  <input placeholder="e.g. Acme Industries Pvt Ltd" value={form.entity_name} onChange={f("entity_name")} />
                </div>
                <div className="field">
                  <label>TRADE NAME (IF DIFFERENT)</label>
                  <input placeholder="e.g. Acme" value={form.trade_name} onChange={f("trade_name")} />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>VENDOR TYPE *</label>
                  <select value={form.vendor_type} onChange={f("vendor_type")}>
                    <option value="domestic">Domestic (India)</option>
                    <option value="foreign">Foreign</option>
                  </select>
                </div>
                <div className="field">
                  <label>CONSTITUTION</label>
                  <select value={form.constitution} onChange={f("constitution")}>
                    {["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Trust / Society"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>EXPECTED CATEGORY</label>
                  <select value={form.category} onChange={f("category")}>
                    <option value="">Select category</option>
                    <option>IT &amp; Hardware</option>
                    <option>Office Supplies</option>
                    <option>Travel &amp; Hospitality</option>
                    <option>Marketing</option>
                    <option>Legal &amp; Compliance</option>
                    <option>Facility &amp; Admin</option>
                    <option>HR &amp; Training</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>EMAIL * (KYC LINK SENT HERE)</label>
                  <input type="email" placeholder="accounts@vendor.com" value={form.contact_email} onChange={f("contact_email")} />
                </div>
                <div className="field">
                  <label>MOBILE *</label>
                  <input placeholder="+91 XXXXX XXXXX" value={form.contact_phone} onChange={f("contact_phone")} />
                </div>
              </div>
              <div className="field">
                <label>VENDOR CONTACT PERSON</label>
                <input placeholder="e.g. Mr. Suresh Khanna · Director" value={form.contact_name} onChange={f("contact_name")} />
              </div>
            </div>
          </div>

          {/* Email Customisation */}
          <div className="card">
            <div className="card-head"><div className="card-title">Email Customisation</div></div>
            <div className="card-body">
              <div className="field">
                <label>SUBJECT</label>
                <input value={form.email_subject} onChange={f("email_subject")} />
              </div>
              <div className="field">
                <label>PERSONAL MESSAGE (OPTIONAL)</label>
                <textarea rows={6} value={form.email_message} onChange={f("email_message")}
                  style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 14, padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd" }} />
              </div>
            </div>
          </div>

          {/* Link Settings */}
          <div className="card">
            <div className="card-head"><div className="card-title">Link Settings</div></div>
            <div className="card-body">
              <div className="form-row">
                <div className="field">
                  <label>LINK VALIDITY</label>
                  <select value={form.link_validity_days} onChange={(e) => setForm((p) => ({ ...p, link_validity_days: Number(e.target.value) }))}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
                <div className="field">
                  <label>REMINDER</label>
                  <select defaultValue="2">
                    <option value="0">No reminder</option>
                    <option value="1">1 reminder auto-sent</option>
                    <option value="2">2 reminders auto-sent</option>
                  </select>
                </div>
                <div className="field">
                  <label>APPROVAL PATH</label>
                  <select defaultValue="proc_comp">
                    <option value="proc_comp">Procurement → Compliance</option>
                    <option value="direct">Direct Approval</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: preview panel ── */}
        <div style={{ width: 270, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card-head"><div className="card-title">What the vendor will see</div></div>
            <div className="card-body">
              <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Click below to preview the actual KYC form they will fill</p>
              <div style={{ background: "#1a1a2e", borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  {form.email_subject || "Vendor Onboarding"}
                </div>
                <div style={{ color: "#aaa", fontSize: 12, marginBottom: 10 }}>
                  Click the secure link to share your GST, PAN, bank and MSME details…
                </div>
                <div style={{ background: "#dc2626", color: "#fff", borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
                  → Complete KYC
                </div>
              </div>
              <button className="btn btn-gho" style={{ width: "100%", marginBottom: 8 }} onClick={() => window.open("/kyc/preview", "_blank")}>Preview KYC Form →</button>
              <button className="btn btn-pri" style={{ width: "100%" }} onClick={send} disabled={sending}>
                {sending ? "Sending…" : "Send Link to Vendor"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <p style={{ fontSize: 12, color: "#555", fontWeight: 700, marginBottom: 8 }}>REQUIRED DOCUMENTS</p>
              {["GST certificate (auto-fetched)", "PAN card", "Cancelled cheque OR bank statement",
                "MSME / Udyam certificate (if applicable)", "Signed agreement template"].map((d) => (
                <div key={d} style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>✓ {d}</div>
              ))}
              {form.vendor_type === "foreign" && (
                <>
                  <p style={{ fontSize: 12, color: "#555", fontWeight: 700, margin: "10px 0 6px" }}>For foreign vendors:</p>
                  {["Tax Residency Certificate (yearly)", "Form 10F", "No PE declaration"].map((d) => (
                    <div key={d} style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>✓ {d}</div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Onboarding() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/vendors/onboarding/list"), []);
  const [active, setActive] = useState(null);
  const [showSendLink, setShowSendLink] = useState(false);
  const [tab, setTab] = useState("all");
  const [bank, setBank] = useState({ account_no: "", ifsc: "", account_name: "" });

  const advance = async (o) => {
    try {
      const body = o.stage === 3 ? bank : undefined;
      const res = await api.post(`/vendors/onboarding/${o.id}/advance`, body);
      toast(`${o.id} → step ${res.stage} (${STEPS[res.stage - 1] || "complete"})`);
      refresh(); setActive(null);
    } catch (e) { toast(e.message, true); }
  };

  const resend = async (o, ev) => {
    ev.stopPropagation();
    try {
      await api.post(`/vendors/onboarding/${o.id}/resend-link`, {});
      toast(`Link resent to ${o.contact_email}`); refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;

  if (showSendLink) {
    return <SendLinkView onCancel={() => setShowSendLink(false)} onSent={() => { setShowSendLink(false); refresh(); }} />;
  }

  const rows = (data || []).filter(TAB_DEFS.find((t) => t.key === tab)?.fn || (() => true));

  const actionBtn = (r) => {
    if (r.status === "link_sent" || r.status === "link_expired")
      return <button className="btn btn-gho btn-sm" onClick={(e) => resend(r, e)}>Resend</button>;
    if (r.status === "submitted_for_review")
      return <button className="btn btn-pri btn-sm" onClick={(e) => { e.stopPropagation(); setActive(r); }}>Review →</button>;
    if (r.status === "approved")
      return <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); setActive(r); }}>View</button>;
    return null;
  };

  return (
    <>
      <PageHead title="Vendor Onboarding"
        sub="Send invite links · track KYC progress · review and activate vendors"
        actions={
          <>
            <button className="btn btn-gho" onClick={() => window.open("/kyc/preview", "_blank")}>Preview KYC Form</button>
            <button className="btn btn-pri" onClick={() => setShowSendLink(true)}>✉ Send Onboarding Link</button>
          </>
        } />

      <div className="kpi-row">
        <Kpi label="In flight" value={(data || []).filter((o) => ["link_sent","kyc_in_progress","submitted_for_review","in_progress"].includes(o.status)).length} note="across KYC stages" />
        <Kpi label="High-risk flagged" value={(data || []).filter((o) => o.risk_flag === "high").length} note="PAN/GST mismatch · escalated" noteClass="down" />
        <Kpi label="Live as vendors" value={(data || []).filter((o) => o.status === "approved").length} note="ERP-pushed" noteClass="up" />
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TAB_DEFS.map((t) => {
          const count = (data || []).filter(t.fn).length;
          return (
            <button key={t.key}
              onClick={() => setTab(t.key)}
              className={`btn ${tab === t.key ? "btn-pri" : "btn-gho"} btn-sm`}
              style={{ borderRadius: 20, padding: "4px 14px" }}>
              {t.label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <Card title="Onboarding pipeline" sub="click a row to view details" pad={false}>
        <DataTable
          columns={[
            { key: "id", label: "Onboarding ID", render: (r) => <span className="mono">{r.id}</span> },
            { key: "entity_name", label: "Vendor" },
            { key: "vendor_type", label: "Type", render: (r) => <Chip value={r.vendor_type} /> },
            { key: "contact_email", label: "Email · Phone", render: (r) => (
              <div style={{ fontSize: 13 }}>
                <div>{r.contact_email || "—"}</div>
                <div style={{ color: "#888", fontSize: 11 }}>{r.contact_phone || ""}</div>
              </div>
            )},
            { key: "sent_by_name", label: "Sent By", render: (r) => r.sent_by_name || r.initiated_by_name || "—" },
            { key: "link_sent_at", label: "Sent", render: (r) => r.link_sent_at ? dt(r.link_sent_at) : (r.created_at ? dt(r.created_at) : "—") },
            { key: "link_expires_at", label: "Expires", render: (r) => r.link_expires_at ? dt(r.link_expires_at) : "—" },
            { key: "status", label: "Status / Stage", render: (r) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Chip value={r.status} />
                {r.status === "in_progress" && <span style={{ fontSize: 11, color: "#888" }}>{r.stage}/6</span>}
              </div>
            )},
            { key: "_action", label: "", render: (r) => actionBtn(r) },
          ]}
          rows={rows}
          onRow={(r) => { setBank({ account_no: "", ifsc: "", account_name: r.entity_name }); setActive(r); }}
        />
      </Card>

      {/* Detail / action modal */}
      {active && (
        <Modal title={`${active.id} · ${active.entity_name}`} onClose={() => setActive(null)}
          footer={active.status === "in_progress" &&
            <button className="btn btn-pri" onClick={() => advance(active)}>
              Run step {active.stage}: {STEPS[active.stage - 1]} →
            </button>}>

          {/* 6-step pipeline view for in_progress records */}
          {active.status === "in_progress" && (
            <>
              {STEPS.map((s, i) => (
                <div key={s} className={`wstep ${i + 1 < active.stage ? "done" : i + 1 === active.stage ? "active" : ""}`}>
                  <div className="wstep-n">{i + 1}</div>
                  <div style={{ flex: 1 }}><b style={{ fontSize: 12 }}>{s}</b></div>
                  {i + 1 < active.stage ? <Chip value="approved" label="done" /> :
                   i + 1 === active.stage ? <Chip value="pending" label="next" /> : null}
                </div>
              ))}
              {active.stage === 3 && (
                <div style={{ marginTop: 12 }}>
                  <h4 style={{ marginBottom: 8 }}>Bank details for penny drop (₹1 · NPCI name match)</h4>
                  <div className="form-row-3">
                    <div className="field"><label>Account no</label>
                      <input value={bank.account_no} onChange={(e) => setBank({ ...bank, account_no: e.target.value })} /></div>
                    <div className="field"><label>IFSC</label>
                      <input value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value })} /></div>
                    <div className="field"><label>Name at bank</label>
                      <input value={bank.account_name} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} /></div>
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <DetailGrid items={[
              ["Status", <Chip key="s" value={active.status} />],
              ["Email", active.contact_email], ["Phone", active.contact_phone],
              ["Sent", active.link_sent_at ? dt(active.link_sent_at) : dt(active.created_at)],
              ["Expires", active.link_expires_at ? dt(active.link_expires_at) : "—"],
              ["GSTIN verified", active.gstin_verified == null ? "—" : active.gstin_verified ? "✓" : "✗"],
              ["PAN verified", active.pan_verified == null ? "—" : active.pan_verified ? "✓" : "✗"],
              ["Udyam", active.udyam_no || "—"], ["Penny drop", active.penny_drop_status || "—"],
              ["Risk", active.risk_score ? `${active.risk_score} · ${active.risk_tier}` : "—"],
              ["ERP vendor", active.erp_vendor_id || "—"],
            ]} />
          </div>
        </Modal>
      )}
    </>
  );
}
