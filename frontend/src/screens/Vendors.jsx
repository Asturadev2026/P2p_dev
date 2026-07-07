import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading, Kpi,
         inr, inrFull, dt, dtt, pct } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Vendor Master + 360 ============ */
const VM_TABS = [
  { key: "all",                label: "All",                fn: () => true },
  { key: "active",             label: "Active",             fn: (v) => v.status === "active" },
  { key: "pending_compliance", label: "Pending Compliance", fn: (v) => v.status === "pending_compliance" },
  { key: "rejected",           label: "Rejected",           fn: (v) => v.status === "rejected" },
  { key: "suspended",          label: "Suspended",          fn: (v) => v.status === "suspended" },
  { key: "foreign",            label: "Foreign",            fn: (v) => v.vendor_type === "foreign" },
  { key: "msme",               label: "MSME",               fn: (v) => v.is_msme },
];

const vmInitials = (name = "") => {
  const p = name.trim().split(/\s+/);
  return (((p[0]?.[0]) || "") + ((p[1]?.[0]) || "")).toUpperCase() || "?";
};
const vmMsmeLabel = (v) =>
  !v.is_msme ? "Non-MSME" : (v.msme_category ? v.msme_category[0].toUpperCase() + v.msme_category.slice(1) : "MSME");

const VM_OUTLINE = { background: "#fff", border: "1px solid #d9d5ca", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, color: "#16233d", cursor: "pointer" };
const VM_DARK = { background: "#16233d", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" };
const VM_SELECT = { padding: "10px 12px", border: "1px solid #e0ddd3", borderRadius: 8, fontSize: 14, background: "#fff", color: "#3a4453", cursor: "pointer" };
const VM_AVATAR = { width: 38, height: 38, borderRadius: "50%", background: "#16233d", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 };
const VM_PILL_BLUE = { background: "#e8f0fe", color: "#2563eb", fontWeight: 600, fontSize: 12, padding: "3px 12px", borderRadius: 20 };
const VM_VIEW = { background: "#fff", border: "1px solid #d9d5ca", borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#16233d", cursor: "pointer", whiteSpace: "nowrap" };

function VmKpi({ label, value, note, valueColor, noteColor }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #edeae1", borderRadius: 10, padding: "18px 20px" }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#9098a5", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor || "#16233d", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: noteColor || "#9098a5", marginTop: 8 }}>{note}</div>
    </div>
  );
}

const VM_STATUS_STYLE = {
  active:             { bg: "#e7f4ec", color: "#1a7f4b", label: "Active" },
  pending_compliance: { bg: "#e8f0fe", color: "#2563eb", label: "Pending Compliance" },
  rejected:           { bg: "#fde8e8", color: "#c0392b", label: "Rejected" },
  suspended:          { bg: "#fdecd7", color: "#b8600b", label: "Suspended" },
  draft:              { bg: "#f0eee8", color: "#8a8f98", label: "Draft" },
};

function VmStatus({ status }) {
  if (status === "active")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#1a7f4b", fontWeight: 600, fontSize: 13 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1a7f4b" }} />Active
      </span>
    );
  const st = VM_STATUS_STYLE[status] || { bg: "#f0eee8", color: "#8a8f98", label: status || "—" };
  return <span style={{ background: st.bg, color: st.color, fontWeight: 600, fontSize: 12, padding: "3px 12px", borderRadius: 20 }}>{st.label}</span>;
}

function VmMsme({ v }) {
  const label = vmMsmeLabel(v);
  const non = label === "Non-MSME";
  return <span style={{ background: non ? "#f0eee8" : "#e8f0fe", color: non ? "#8a8f98" : "#2563eb", fontWeight: 600, fontSize: 12, padding: "3px 12px", borderRadius: 20 }}>{label}</span>;
}

export function VendorMaster() {
  const navigate = useNavigate();
  const { user } = useApp();
  const canOnboard = ["procurement", "admin"].includes(user?.role);
  const { data, loading } = useFetch(() => api.get("/vendors", { include_inactive: true }), []);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [stateF, setStateF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [typeF, setTypeF] = useState("");
  const [msmeF, setMsmeF] = useState("");

  if (loading) return <Loading />;

  const vendors = data || [];
  const states = [...new Set(vendors.map((v) => v.state).filter(Boolean))].sort();
  const count = (key) => vendors.filter(VM_TABS.find((t) => t.key === key).fn).length;

  const rows = vendors
    .filter(VM_TABS.find((t) => t.key === tab).fn)
    .filter((v) => !stateF || v.state === stateF)
    .filter((v) => !statusF || v.status === statusF)
    .filter((v) => !typeF || v.vendor_type === typeF)
    .filter((v) => !msmeF || (msmeF === "Non-MSME" ? !v.is_msme : vmMsmeLabel(v) === msmeF))
    .filter((v) => {
      const s = q.trim().toLowerCase();
      // Search: Vendor / GST / PAN (+ Email once a vendor email column exists — TODO)
      return !s || [v.name, v.gstin, v.pan].some((x) => (x || "").toLowerCase().includes(s));
    });

  const exportCsv = () => {
    const head = ["ID", "Vendor", "GSTIN", "PAN", "Type", "Products", "State", "Spend YTD", "MSME", "Status", "Rating"];
    const cell = (x) => `"${(x ?? "").toString().replaceAll('"', '""')}"`;
    const body = rows.map((v) => [v.id, v.name, v.gstin, v.pan, v.vendor_type, v.category_name, v.state, v.spend_ytd, vmMsmeLabel(v), v.status, v.rating].map(cell).join(","));
    const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vendor_master.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "#9098a5", fontWeight: 700 }}>VENDOR MANAGEMENT</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#16233d", lineHeight: 1.1, margin: "2px 0 4px" }}>Vendor Master</div>
          <div style={{ fontSize: 13, color: "#7a828f" }}>{vendors.length} onboarded vendors · spend tracked YTD · MSME compliance monitored</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={exportCsv} style={VM_OUTLINE}>Export CSV</button>
          {canOnboard && (
            <button onClick={() => navigate("/onboarding")} style={VM_DARK}>+ Onboard New Vendor</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 26, borderBottom: "1px solid #e3e1d9", marginBottom: 20 }}>
        {VM_TABS.map((t) => {
          const on = tab === t.key;
          return (
            <div key={t.key} onClick={() => setTab(t.key)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 12px", cursor: "pointer", borderBottom: on ? "2px solid #c0392b" : "2px solid transparent", marginBottom: -1 }}>
              <span style={{ fontSize: 14, fontWeight: on ? 700 : 500, color: on ? "#16233d" : "#7a828f" }}>{t.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: on ? "#fff" : "#7a828f", background: on ? "#16233d" : "transparent", borderRadius: 20, padding: on ? "1px 8px" : "1px 4px", textAlign: "center" }}>{count(t.key)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, marginBottom: 20 }}>
        <VmKpi label="TOTAL VENDORS" value={vendors.length} note="all statuses" />
        <VmKpi label="MSME VENDORS" value={vendors.filter((v) => v.is_msme).length} note="Udyam-registered" />
        <VmKpi label="FOREIGN VENDORS" value={vendors.filter((v) => v.vendor_type === "foreign").length} note="cross-border · DTAA" />
        <VmKpi label="PENDING COMPLIANCE" value={vendors.filter((v) => v.status === "pending_compliance").length}
          valueColor="#b8860b" note="awaiting compliance review" />
      </div>

      <div style={{ background: "#fbfbf8", border: "1px solid #edeae1", borderRadius: 10, padding: 14, marginBottom: 14, display: "flex", gap: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa" }}>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, GST, PAN…"
            style={{ width: "100%", padding: "10px 12px 10px 32px", border: "1px solid #e0ddd3", borderRadius: 8, fontSize: 14, background: "#fff" }} />
        </div>
        <select value={stateF} onChange={(e) => setStateF(e.target.value)} style={VM_SELECT}>
          <option value="">All States</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={msmeF} onChange={(e) => setMsmeF(e.target.value)} style={VM_SELECT}>
          <option value="">All MSME Status</option>
          {["Micro", "Small", "Medium", "Non-MSME"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={VM_SELECT}>
          <option value="">All Status</option>
          {["active", "pending_compliance", "rejected", "suspended", "draft"].map((s) => (
            <option key={s} value={s}>{(VM_STATUS_STYLE[s] || {}).label || s}</option>
          ))}
        </select>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} style={VM_SELECT}>
          <option value="">All Types</option>
          <option value="domestic">Domestic</option>
          <option value="foreign">Foreign</option>
        </select>
      </div>

      <div style={{ background: "#fff", border: "1px solid #edeae1", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9098a5", fontSize: 11, letterSpacing: 0.5 }}>
              {["VENDOR", "GSTIN / PAN", "TYPE", "PRODUCTS", "SPEND YTD", "MSME", "STATUS", ""].map((h, i) => (
                <th key={i} style={{ padding: "14px 18px", fontWeight: 700, borderBottom: "1px solid #edeae1" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} style={{ borderBottom: "1px solid #f2f0ea" }}>
                <td style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={VM_AVATAR}>{vmInitials(v.name)}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: "#16233d" }}>{v.name}</div>
                      <div style={{ fontSize: 12, color: "#9098a5" }}>{[v.id, v.state].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, color: "#3a4453" }}>{v.gstin || "—"}</div>
                  <div style={{ fontSize: 12, color: "#9098a5" }}>{v.pan || "—"}</div>
                </td>
                <td style={{ padding: "14px 18px" }}><span style={VM_PILL_BLUE}>{v.vendor_type === "foreign" ? "Foreign" : "Domestic"}</span></td>
                <td style={{ padding: "14px 18px", color: "#3a4453" }}>{v.category_name || "—"}</td>
                <td style={{ padding: "14px 18px", color: "#16233d", fontWeight: 600 }}>{inrFull(v.spend_ytd)}</td>
                <td style={{ padding: "14px 18px" }}><VmMsme v={v} /></td>
                <td style={{ padding: "14px 18px" }}><VmStatus status={v.status} /></td>
                <td style={{ padding: "14px 18px", textAlign: "right" }}>
                  <button onClick={() => navigate(`/vendors/${v.id}`)} style={VM_VIEW}>View →</button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#9098a5" }}>No vendors match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
                  <input placeholder="e.g. IT Services" value={form.category} onChange={f("category")} />
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
  const { toast, user } = useApp();
  const canManage = ["procurement", "admin"].includes(user?.role);
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
    if (!canManage) return null;
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
            {canManage && (
              <button className="btn btn-pri" onClick={() => setShowSendLink(true)}>✉ Send Onboarding Link</button>
            )}
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
