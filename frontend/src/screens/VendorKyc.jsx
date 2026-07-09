import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PROCUREMENT_CATEGORIES } from "../constants/procurementCategories";

const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8002") + "/api/v1";

// ─── Design tokens ────────────────────────────────────────────────────────────
const NAVY   = "#1a1a2e";
const RED    = "#dc2626";
const GREEN  = "#16a34a";
const BORDER = "#e0e2e7";

const LABEL = { display:"block", fontSize:11, fontWeight:700, color:"#555", letterSpacing:".5px", textTransform:"uppercase", marginBottom:5 };
const INPUT = { width:"100%", padding:"10px 12px", borderRadius:7, border:`1px solid ${BORDER}`, fontSize:14, boxSizing:"border-box", background:"#fff", outline:"none", fontFamily:"inherit" };
const CARD  = { background:"#fff", borderRadius:10, padding:28, boxShadow:"0 1px 6px rgba(0,0,0,.07)", marginBottom:20 };
const ROW   = { display:"flex", gap:14, marginBottom:16 };
const FLD   = { marginBottom:16 };

// ─── Step definitions (dynamic by vendor type) ────────────────────────────────
const DOMESTIC_STEPS = [
  { id:1, label:"Vendor Type" },
  { id:2, label:"GST Verification" },
  { id:3, label:"PAN & MSME" },
  { id:4, label:"Bank" },
  { id:5, label:"Products" },
  { id:6, label:"Address" },
  { id:7, label:"Agreement" },
];

const FOREIGN_STEPS = [
  { id:1, label:"Vendor Type" },
  { id:2, label:"Identity" },
  { id:3, label:"Foreign Compliance" },
  { id:4, label:"Bank" },
  { id:5, label:"Products" },
  { id:6, label:"Address" },
  { id:7, label:"Tax & Products" },
  { id:8, label:"Agreement" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers:{ "Content-Type":"application/json" }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || "Request failed");
  return json;
}

// ─── File Upload Field ────────────────────────────────────────────────────────
// Uploads immediately on file select → POST /vendors/kyc/{token}/upload (multipart)
// In preview mode: skips API call, shows filename locally
function FileUploadField({ token, docType, label, accept = ".pdf,.jpg,.jpeg,.png", isPreview }) {
  const [status,   setStatus]   = useState("idle"); // idle | uploading | done | error
  const [fileInfo, setFileInfo] = useState(null);
  const uid = `fu-${docType}`;

  const upload = async (file) => {
    if (!file) return;
    if (isPreview) {
      setStatus("done");
      setFileInfo({ filename: file.name, size: file.size });
      return;
    }
    setStatus("uploading");
    const fd = new FormData();
    fd.append("doc_type", docType);
    fd.append("file", file);
    try {
      const res = await fetch(`${BASE}/vendors/kyc/${token}/upload`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || "Upload failed");
      setStatus("done");
      setFileInfo(json);
    } catch (e) {
      setStatus("error");
      setFileInfo({ error: e.message });
    }
  };

  const borderColor = status === "done" ? GREEN : status === "error" ? "#dc2626" : BORDER;
  const bg          = status === "done" ? "#f0fdf4" : status === "error" ? "#fef2f2" : "#fafafa";

  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={LABEL}>{label}</label>}
      <label htmlFor={uid} style={{
        display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
        border: `1px dashed ${borderColor}`, borderRadius: 7, background: bg,
        cursor: "pointer", transition: "border-color .15s",
      }}>
        <input id={uid} type="file" accept={accept} style={{ display: "none" }}
          onChange={(e) => upload(e.target.files[0])} />
        {status === "uploading" && <span style={{ color: "#888", fontSize: 13 }}>Uploading…</span>}
        {status === "done"      && <span style={{ color: GREEN, fontSize: 13 }}>
          ✓ {fileInfo?.filename}
          <span style={{ color: "#888", marginLeft: 8 }}>
            ({fileInfo?.size ? `${(fileInfo.size / 1024).toFixed(0)} KB` : "uploaded"})
          </span>
          <span style={{ marginLeft: 8, color: "#888" }}>· click to replace</span>
        </span>}
        {status === "error"     && <span style={{ color: "#dc2626", fontSize: 13 }}>⚠ {fileInfo?.error} — click to retry</span>}
        {status === "idle"      && <span style={{ color: "#666", fontSize: 13 }}>📎 Click to upload · PDF / JPG / PNG · max 10 MB</span>}
      </label>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────
export default function VendorKyc() {
  const { token } = useParams();
  const isPreview = token === "preview";

  const [info,       setInfo]       = useState(null);
  const [loadErr,    setLoadErr]    = useState(null);
  const [step,       setStep]       = useState(1);
  const [submitted,  setSubmitted]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifying,  setVerifying]  = useState(false);
  const [banner,     setBanner]     = useState(null);

  const [form, setForm] = useState({
    // Step 1
    vendor_type: "domestic", entity_name: "", trade_name: "", constitution: "Private Limited", industry: "",
    // Step 2 – Domestic: GST
    gstin: "", gstin_verified: false, gstin_data: null,
    // Step 3 – Domestic: PAN & MSME
    pan: "", pan_verified: false, pan_holder: "", msme_status: "not_applicable", msme_class: "", udyam_no: "",
    // Step 2 – Foreign: Identity
    country: "", foreign_legal_name: "", foreign_tax_id: "", date_of_incorporation: "",
    // Step 3 – Foreign: Compliance
    trc_uploaded: false, form10f_uploaded: false, no_pe_signed: false, dtaa_valid_till: "",
    // Step 6 – Foreign: Tax & Products
    dtaa_rate: "", tds_section: "Section 195 – Other sums", product_categories: "",
    // Step 4 – Bank (shared)
    bank_method: "cancelled_cheque", acct_holder: "", acct_number: "", ifsc: "", bank_branch: "", acct_type: "savings", penny_done: false,
    // Step 5 – Address (shared)
    addresses: [{ type:"registered", line:"", city:"", state:"", pin:"" }],
    // Step 5 – Products (shared)
    products: [],
    // Last step – Agreement (shared)
    esigned: false, declaration: false,
  });

  const s = (k) => (v) => setForm((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));

  // Current step list depends on vendor type
  const steps = form.vendor_type === "foreign" ? FOREIGN_STEPS : DOMESTIC_STEPS;
  const totalSteps = steps.length;
  const pct = Math.round(((step - 1) / totalSteps) * 100);
  const isLastStep = step === totalSteps;

  useEffect(() => {
    if (isPreview) {
      setInfo({ entity_name: "Preview Company Ltd", trade_name: "", vendor_type: "domestic", contact_email: "vendor@example.com", contact_name: "Demo Vendor" });
      return;
    }
    apiFetch(`/public/onboard/${token}`)
      .then((d) => {
        setInfo(d);
        setForm((p) => ({
          ...p,
          entity_name: d.entity_name || "", trade_name: d.trade_name || "",
          vendor_type: d.vendor_type || "domestic", constitution: d.constitution || "Private Limited",
          pan: d.pan || "", gstin: d.gstin || "",
        }));
      })
      .catch((e) => setLoadErr(e.message));
  }, [token]);

  // ── Verification actions ──────────────────────────────────────────────────
  const verifyGstin = async () => {
    if (form.gstin.length < 15) { setBanner({ type:"err", msg:"Enter a valid 15-character GSTIN" }); return; }
    setVerifying(true); setBanner(null);
    await delay(1200);
    setForm((p) => ({ ...p, gstin_verified:true, gstin_data:{ legal_name:p.entity_name||"Fetched from GST portal", constitution:p.constitution, status:"Active · Regular", reg_date:"12 Mar 2018", last_return:"GSTR-3B · Apr 2026", einvoice:"Applicable" } }));
    setBanner({ type:"ok", msg:"GST details fetched successfully" });
    setVerifying(false);
  };

  const verifyPan = async () => {
    if (form.pan.length < 10) { setBanner({ type:"err", msg:"Enter a valid 10-character PAN" }); return; }
    setVerifying(true); setBanner(null);
    await delay(900);
    setForm((p) => ({ ...p, pan_verified:true, pan_holder:p.entity_name||"Verified via NSDL" }));
    setBanner({ type:"ok", msg:"PAN verified via NSDL" });
    setVerifying(false);
  };

  const runPennyDrop = async () => {
    setVerifying(true); setBanner(null);
    await delay(1500);
    setForm((p) => ({ ...p, penny_done:true }));
    setBanner({ type:"ok", msg:"₹1 verification successful · account validated" });
    setVerifying(false);
  };

  const doSubmit = async () => {
    if (isPreview) { setBanner({ type:"ok", msg:"Preview mode — form submission is disabled. Close this tab to return." }); return; }
    if (!form.declaration) { setBanner({ type:"err", msg:"Please accept the declaration to proceed" }); return; }
    setSubmitting(true); setBanner(null);
    try {
      // Full KYC payload — persisted server-side to vendor_onboarding.kyc_payload,
      // then verified (GST/PAN/MSME/Bank/DTAA) and routed to pending_compliance.
      const payload = {
        legal_name: form.entity_name, trade_name: form.trade_name,
        pan: form.pan, gstin: form.gstin,
        state: form.addresses[0]?.state,
        addresses: form.addresses,
        contacts: [{ is_primary: true, name: info?.contact_name, email: info?.contact_email, phone: info?.contact_phone }],
        sub_vendors: [],   // not collected in this wizard yet — TODO
        bank: {
          account_no: form.acct_number, ifsc: form.ifsc, account_name: form.acct_holder,
          bank_branch: form.bank_branch, acct_type: form.acct_type, method: form.bank_method,
        },
        agreement: { esigned: form.esigned, declaration: form.declaration },
        products: form.product_categories,
        products_data: form.products || [],
      };
      if (form.vendor_type === "foreign") {
        payload.foreign = {
          country: form.country, foreign_legal_name: form.foreign_legal_name,
          foreign_tax_id: form.foreign_tax_id,
          trc_ref: form.trc_uploaded ? "TRC-UPLOADED" : "",
          form_10f_ref: form.form10f_uploaded ? "FORM10F-UPLOADED" : "",
          no_pe: form.no_pe_signed, dtaa_rate: form.dtaa_rate,
          tds_section: form.tds_section, dtaa_valid_till: form.dtaa_valid_till || null,
        };
      }
      await apiFetch(`/public/onboard/${token}/submit`, { method: "POST", body: JSON.stringify(payload) });
      setSubmitted(true);
    } catch(e) { setBanner({ type:"err", msg:e.message }); }
    finally { setSubmitting(false); }
  };

  const next = () => { setStep((n) => n + 1); setBanner(null); };
  const prev = () => { setStep((n) => n - 1); setBanner(null); };

  // ── Special screens ───────────────────────────────────────────────────────
  if (loadErr)   return <Centered><ErrCard msg={loadErr} /></Centered>;
  if (!info)     return <Centered><p style={{ color:"#888" }}>Loading your onboarding form…</p></Centered>;
  if (submitted) return <Centered><SuccessCard email={info.contact_email} /></Centered>;

  // ── Step render (domestic vs foreign branching) ───────────────────────────
  const up = { token, isPreview }; // shorthand for file-upload props
  const renderStep = () => {
    if (step === 1) return <Step1 form={form} s={s} />;

    if (form.vendor_type === "domestic") {
      if (step === 2) return <StepGst    form={form} s={s} onVerify={verifyGstin} busy={verifying} />;
      if (step === 3) return <StepPanMsme form={form} s={s} setForm={setForm} onVerify={verifyPan} busy={verifying} {...up} />;
      if (step === 4) return <StepBank   form={form} s={s} setForm={setForm} onPenny={runPennyDrop} busy={verifying} {...up} />;
      if (step === 5) return <StepProducts form={form} setForm={setForm} {...up} />;
      if (step === 6) return <StepAddress form={form} setForm={setForm} />;
      if (step === 7) return <StepAgreement form={form} s={s} {...up} />;
    } else {
      if (step === 2) return <StepForeignIdentity   form={form} s={s} {...up} />;
      if (step === 3) return <StepForeignCompliance form={form} s={s} setForm={setForm} {...up} />;
      if (step === 4) return <StepBank   form={form} s={s} setForm={setForm} onPenny={runPennyDrop} busy={verifying} {...up} />;
      if (step === 5) return <StepProducts form={form} setForm={setForm} {...up} />;
      if (step === 6) return <StepAddress form={form} setForm={setForm} />;
      if (step === 7) return <StepTaxProducts form={form} s={s} />;
      if (step === 8) return <StepAgreement form={form} s={s} {...up} />;
    }
    return null;
  };

  return (
    <div style={{ minHeight:"100vh", background:"#f0f2f5" }}>

      {/* ── Preview banner ──────────────────────────────────────────────── */}
      {isPreview && (
        <div style={{ background:"#f59e0b", color:"#78350f", padding:"10px 28px", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:8 }}>
          <span>👁 PREVIEW MODE</span>
          <span style={{ fontWeight:400 }}>— This is a staff preview of the vendor KYC form. Fields are editable but nothing will be saved or submitted.</span>
          <button onClick={() => window.close()} style={{ marginLeft:"auto", background:"rgba(0,0,0,.12)", border:"none", borderRadius:5, padding:"4px 12px", cursor:"pointer", fontSize:12, fontWeight:700, color:"#78350f" }}>Close tab ✕</button>
        </div>
      )}

      {/* ── Dark header ─────────────────────────────────────────────────── */}
      <div style={{ background:NAVY }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"20px 28px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
            <div style={{ background:"rgba(255,255,255,.12)", borderRadius:7, padding:"4px 10px", color:"#fff", fontWeight:700, fontSize:13 }}>IN</div>
            <div style={{ color:"#7777aa", fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Vendor Onboarding Portal</div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <h1 style={{ color:"#fff", margin:"0 0 5px", fontSize:22, fontWeight:700 }}>Welcome · Complete Your Vendor KYC</h1>
              <p style={{ color:"#7777aa", margin:0, fontSize:13 }}>
                Secure link · Step {step} of {totalSteps} · {pct}% complete · estimated 8 min remaining
              </p>
            </div>
            <button style={{ background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.18)", color:"#ddd", borderRadius:6, padding:"8px 14px", cursor:"pointer", fontSize:12, whiteSpace:"nowrap" }}>
              ← Back to admin
            </button>
          </div>
          <div style={{ height:3, background:"rgba(255,255,255,.1)", borderRadius:2, marginTop:18 }}>
            <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#dc2626,#f59e0b)", borderRadius:2, transition:"width .45s ease" }} />
          </div>
        </div>
      </div>

      {/* ── Step tabs ───────────────────────────────────────────────────── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb" }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 28px", display:"flex", overflowX:"auto" }}>
          {steps.map((st) => {
            const done   = st.id < step;
            const active = st.id === step;
            return (
              <div key={st.id} style={{ padding:"13px 18px 10px", borderBottom:`3px solid ${done ? GREEN : active ? RED : "transparent"}`, flexShrink:0, userSelect:"none" }}>
                <div style={{ fontSize:10, color:done ? GREEN : active ? RED : "#aaa", fontWeight:700, letterSpacing:.5 }}>STEP {st.id}</div>
                <div style={{ fontSize:12, fontWeight:done||active ? 600 : 400, color:done ? GREEN : active ? "#111" : "#888", marginTop:2 }}>{st.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ maxWidth:780, margin:"0 auto", padding:"28px 24px 56px" }}>

        {banner && (
          <div style={{ background:banner.type==="ok" ? "#f0fdf4" : "#fef2f2", border:`1px solid ${banner.type==="ok" ? "#bbf7d0" : "#fecaca"}`, borderRadius:8, padding:"11px 16px", marginBottom:18, color:banner.type==="ok" ? "#166534" : RED, fontSize:14 }}>
            {banner.type==="ok" ? "✓ " : "⚠ "}{banner.msg}
          </div>
        )}

        {renderStep()}

        {/* ── Nav ─────────────────────────────────────────────────────── */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:24, paddingTop:20, borderTop:"1px solid #eee" }}>
          <button onClick={prev} disabled={step===1}
            style={{ background:"transparent", border:"1px solid #ddd", borderRadius:7, padding:"10px 20px", cursor:step===1 ? "not-allowed":"pointer", color:step===1 ? "#ccc":"#555", fontSize:14 }}>
            ← Previous
          </button>
          <div style={{ display:"flex", gap:10 }}>
            <button style={{ background:"transparent", border:"1px solid #ddd", borderRadius:7, padding:"10px 20px", cursor:"pointer", fontSize:14, color:"#555" }}>
              Save & Exit
            </button>
            {!isLastStep ? (
              <button onClick={next}
                style={{ background:NAVY, color:"#fff", border:"none", borderRadius:7, padding:"10px 24px", cursor:"pointer", fontSize:14, fontWeight:600 }}>
                Continue →
              </button>
            ) : (
              <button onClick={doSubmit} disabled={submitting || (!isPreview && !form.declaration)}
                style={{ background:isPreview ? "#f59e0b" : RED, color:isPreview ? "#78350f":"#fff", border:"none", borderRadius:7, padding:"10px 24px", cursor:submitting ? "not-allowed":"pointer", fontSize:14, fontWeight:600, opacity:(!isPreview && !form.declaration) ? .5:1 }}>
                {isPreview ? "Preview Only — cannot submit" : submitting ? "Submitting…" : "Submit for Review →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Utility screens ──────────────────────────────────────────────────────────
function Centered({ children }) {
  return <div style={{ minHeight:"100vh", background:"#f0f2f5", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>{children}</div>;
}
function ErrCard({ msg }) {
  return (
    <div style={{ background:"#fff", borderRadius:12, padding:48, maxWidth:440, textAlign:"center", boxShadow:"0 4px 20px rgba(0,0,0,.08)" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
      <div style={{ fontWeight:700, fontSize:20, color:RED, marginBottom:8 }}>Link issue</div>
      <div style={{ color:"#666", fontSize:14, lineHeight:1.7 }}>{msg}</div>
      <div style={{ color:"#aaa", fontSize:13, marginTop:10 }}>Contact your procurement team for a new link.</div>
    </div>
  );
}
function SuccessCard({ email }) {
  return (
    <div style={{ background:"#fff", borderRadius:12, padding:52, maxWidth:480, textAlign:"center", boxShadow:"0 4px 20px rgba(0,0,0,.08)" }}>
      <div style={{ fontSize:52, marginBottom:20 }}>✅</div>
      <div style={{ fontWeight:700, fontSize:22, color:GREEN, marginBottom:12 }}>Submitted for Review</div>
      <div style={{ color:"#555", fontSize:15, lineHeight:1.7 }}>
        Thank you! Our compliance team will review your KYC within <strong>2–3 business days</strong>.<br />
        {email && <>You'll be notified at <strong>{email}</strong>.</>}
      </div>
    </div>
  );
}

// ─── Step 1: Vendor Type (shared) ────────────────────────────────────────────
function Step1({ form, s }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Vendor Type</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Are you registered in India or supplying from abroad?</p>

      <div style={{ display:"flex", gap:14, marginBottom:24 }}>
        {[
          { val:"domestic", iconBg:NAVY, icon:"IN", title:"Domestic Vendor", sub:"India-based · GST registered", docs:"GSTIN, PAN, bank account, MSME (if applicable)" },
          { val:"foreign",  iconBg:"#2563eb", icon:"🌐", title:"Foreign Vendor", sub:"Outside India · DTAA applicable", docs:"Tax Residency Certificate, Form 10F, No PE declaration" },
        ].map((t) => (
          <div key={t.val} onClick={() => s("vendor_type")(t.val)}
            style={{ flex:1, border:`2px solid ${form.vendor_type===t.val ? RED : BORDER}`, borderRadius:9, padding:"16px 18px", cursor:"pointer", background:form.vendor_type===t.val ? "#fff8f8":"#fff", transition:"border-color .15s" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <div style={{ background:t.iconBg, borderRadius:7, padding:"5px 9px", color:"#fff", fontWeight:700, fontSize:13 }}>{t.icon}</div>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{t.title}</div>
                  <div style={{ color:"#888", fontSize:12 }}>{t.sub}</div>
                </div>
              </div>
              {form.vendor_type===t.val && <span style={{ color:RED, fontSize:14 }}>●</span>}
            </div>
            <div style={{ marginTop:10, color:"#666", fontSize:12 }}>{t.docs}</div>
          </div>
        ))}
      </div>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>LEGAL ENTITY NAME *</label>
          <input style={INPUT} placeholder="As registered with GST / MCA" value={form.entity_name} onChange={s("entity_name")} />
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>TRADE NAME (IF DIFFERENT)</label>
          <input style={INPUT} placeholder="Brand / DBA name" value={form.trade_name} onChange={s("trade_name")} />
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>CONSTITUTION *</label>
          <select style={INPUT} value={form.constitution} onChange={s("constitution")}>
            {["Private Limited","Public Limited","LLP","Partnership","Proprietorship","Trust / Society","HUF","Foreign Company"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>INDUSTRY / BUSINESS TYPE</label>
          <input style={INPUT} placeholder="e.g. IT Hardware, Office Supplies, Consulting" value={form.industry} onChange={s("industry")} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 (Domestic): GST Verification ─────────────────────────────────────
function StepGst({ form, s, onVerify, busy }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>GST Verification</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>We'll auto-fetch your registered details using the GSTN portal API</p>

      <div style={FLD}>
        <label style={LABEL}>GSTIN *</label>
        <div style={{ display:"flex", gap:10 }}>
          <input style={{ ...INPUT, flex:1, textTransform:"uppercase" }} placeholder="22AAAAA0000A1Z5" value={form.gstin} onChange={s("gstin")} maxLength={15} />
          <button onClick={onVerify} disabled={busy || form.gstin_verified}
            style={{ background:form.gstin_verified ? GREEN : NAVY, color:"#fff", border:"none", borderRadius:7, padding:"10px 18px", cursor:busy?"wait":"pointer", fontSize:14, fontWeight:600, whiteSpace:"nowrap" }}>
            {busy ? "Verifying…" : form.gstin_verified ? "✓ Verified" : "Verify via API"}
          </button>
        </div>
      </div>

      {form.gstin_verified && form.gstin_data ? (
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:9, padding:18 }}>
          <div style={{ fontWeight:700, color:"#166534", marginBottom:14, fontSize:14 }}>✓ GST details fetched</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 24px" }}>
            {[["Legal Name",form.gstin_data.legal_name],["Constitution",form.gstin_data.constitution],["Status",form.gstin_data.status],["Registration Date",form.gstin_data.reg_date],["Last Return Filed",form.gstin_data.last_return],["E-Invoice",form.gstin_data.einvoice]].map(([l,v]) => (
              <div key={l}><div style={{ fontSize:11, color:"#555", fontWeight:700, textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:13, color:"#166534", marginTop:2 }}>{v}</div></div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background:"#f8f9fb", borderRadius:8, padding:14, fontSize:13, color:"#555", lineHeight:1.6 }}>
          <strong>What we'll fetch:</strong> Legal name, Trade name, Constitution, Principal place of business, additional places, registration date, current status, last return filed, e-invoice applicability, composition scheme status.{" "}
          <span style={{ color:"#2563eb" }}>No data leaves the GST portal.</span>
        </div>
      )}
    </div>
  );
}

// ─── Step 3 (Domestic): PAN & MSME ───────────────────────────────────────────
function StepPanMsme({ form, s, setForm, onVerify, busy, token, isPreview }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>PAN & MSME Status</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>PAN auto-derived from GSTIN · MSME details auto-fetched if registered</p>

      <div style={{ display:"flex", gap:14, alignItems:"flex-end", marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>PAN *</label>
          <input style={{ ...INPUT, textTransform:"uppercase" }} placeholder="AAAAA0000A" value={form.pan} onChange={s("pan")} maxLength={10} />
        </div>
        <button onClick={onVerify} disabled={busy || form.pan_verified}
          style={{ background:form.pan_verified ? GREEN : NAVY, color:"#fff", border:"none", borderRadius:7, padding:"10px 20px", height:42, cursor:busy?"wait":"pointer", fontSize:14, fontWeight:600, whiteSpace:"nowrap" }}>
          {busy ? "Verifying…" : form.pan_verified ? "✓ Verified" : "Verify"}
        </button>
        <div style={{ flex:1 }}>
          <label style={LABEL}>PAN HOLDER NAME</label>
          <input style={{ ...INPUT, background:"#f8f9fb", color:"#555" }} placeholder="Auto-filled from PAN" value={form.pan_holder} readOnly />
        </div>
      </div>

      <hr style={{ border:"none", borderTop:"1px solid #f0f0f0", margin:"20px 0" }} />
      <h3 style={{ margin:"0 0 4px", fontSize:16 }}>MSME Registration</h3>
      <p style={{ color:"#666", fontSize:13, margin:"0 0 16px" }}>Required for 45-day payment compliance · auto-fetched via Udyam API</p>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>MSME STATUS</label>
          <select style={INPUT} value={form.msme_status} onChange={s("msme_status")}>
            <option value="not_applicable">Not Applicable</option>
            <option value="auto_fetch">Auto-fetch via Udhyam Number</option>
            <option value="upload">Upload Manually</option>
          </select>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>CLASSIFICATION</label>
          <select style={INPUT} value={form.msme_class} onChange={s("msme_class")} disabled={form.msme_status==="not_applicable"}>
            <option value="">—</option>
            <option value="micro">Micro</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
          </select>
        </div>
      </div>

      {form.msme_status==="auto_fetch" && (
        <div style={FLD}>
          <label style={LABEL}>UDYAM REGISTRATION NUMBER</label>
          <input style={INPUT} placeholder="UDYAM-XX-00-0000000" value={form.udyam_no} onChange={s("udyam_no")} />
        </div>
      )}
      {form.msme_status==="upload" && (
        <div style={FLD}>
          <FileUploadField token={token} isPreview={isPreview} docType="msme_cert" label="UPLOAD MSME / UDYAM CERTIFICATE *" />
        </div>
      )}

      <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#92400e" }}>
        MSME Timely Payment Act: 45-day payment SLA (or as agreed in PO) will apply based on your MSME classification.
      </div>
    </div>
  );
}

// ─── Step 2 (Foreign): Foreign Vendor Identity ────────────────────────────────
const COUNTRIES = ["United States","United Kingdom","Singapore","UAE","Germany","Japan","Australia","Netherlands","Switzerland","Canada","Other"];

function StepForeignIdentity({ form, s, token, isPreview }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Foreign Vendor Identity</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Identity & jurisdiction details for cross-border compliance</p>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>COUNTRY OF INCORPORATION *</label>
          <select style={INPUT} value={form.country} onChange={s("country")}>
            <option value="">Select country…</option>
            {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>LEGAL NAME *</label>
          <input style={INPUT} placeholder="As per incorporation certificate" value={form.foreign_legal_name} onChange={s("foreign_legal_name")} />
        </div>
      </div>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>FOREIGN TAX IDENTIFICATION NUMBER *</label>
          <input style={INPUT} placeholder="EIN / VAT / Tax ID" value={form.foreign_tax_id} onChange={s("foreign_tax_id")} />
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>DATE OF INCORPORATION</label>
          <input type="date" style={INPUT} value={form.date_of_incorporation} onChange={s("date_of_incorporation")} />
        </div>
      </div>

      <div style={FLD}>
        <FileUploadField token={token} isPreview={isPreview} docType="incorp_cert" label="UPLOAD CERTIFICATE OF INCORPORATION (PDF) *" />
      </div>

      <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#1e40af", lineHeight:1.6 }}>
        <strong>Self-attested PAN required</strong> if you have one in India. If not, the Indian PAN field can be left blank — TDS will be deducted at higher rate per Section 206AA unless DTAA benefit is claimed in the next step.
      </div>
    </div>
  );
}

// ─── Step 3 (Foreign): Foreign Compliance / DTAA ─────────────────────────────
function StepForeignCompliance({ form, s, setForm, token, isPreview }) {
  const DocRow = ({ label, sub, uploadedKey, uploadedLabel, docType }) => (
    <div style={{ border:`1px solid ${BORDER}`, borderRadius:9, padding:18, marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:14 }}>{label}</div>
          <div style={{ color:"#888", fontSize:12, marginTop:2 }}>{sub}</div>
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"#555", whiteSpace:"nowrap" }}>
          <input type="checkbox" checked={form[uploadedKey]} onChange={(e) => setForm((p) => ({ ...p, [uploadedKey]:e.target.checked }))}
            style={{ width:15, height:15, accentColor:GREEN }} />
          {uploadedLabel}
        </label>
      </div>
      <FileUploadField token={token} isPreview={isPreview} docType={docType} />
    </div>
  );

  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>DTAA Documents</h2>
      <p style={{ color:"#2563eb", fontSize:14, margin:"0 0 20px" }}>Double Taxation Avoidance Agreement compliance · all fields mandatory</p>

      <DocRow label="Tax Residency Certificate (TRC) · yearly *" sub="Issued by tax authority of country of residence · valid for the year" uploadedKey="trc_uploaded" uploadedLabel="Uploaded" docType="trc" />
      <DocRow label="Form 10F · yearly *" sub="Self-declaration with tax-related info not in TRC · must be e-filed on Income Tax portal" uploadedKey="form10f_uploaded" uploadedLabel="Uploaded" docType="form_10f" />
      <DocRow label="No PE Declaration *" sub="Self-declaration that vendor has no Permanent Establishment in India" uploadedKey="no_pe_signed" uploadedLabel="Signed" docType="no_pe_declaration" />

      <div style={{ marginBottom:14 }}>
        <label style={LABEL}>TRC / FORM 10F VALID TILL *</label>
        <input style={INPUT} type="date" value={form.dtaa_valid_till} onChange={s("dtaa_valid_till")} />
        <div style={{ color:"#888", fontSize:12, marginTop:4 }}>Activation is blocked if this date is missing or in the past.</div>
      </div>

      <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#92400e", lineHeight:1.6 }}>
        <strong>Reminder:</strong> TRC and Form 10F must be renewed every financial year. We will send automated reminders 30 days before expiry. Failure to renew leads to higher TDS deduction without DTAA benefit.
      </div>
    </div>
  );
}

// ─── Step 6 (Foreign): Tax & Products ────────────────────────────────────────
function StepTaxProducts({ form, s }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Tax & Products</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>DTAA rate and product / service category</p>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>APPLICABLE DTAA RATE (%)</label>
          <input style={INPUT} placeholder="e.g. 10" value={form.dtaa_rate} onChange={s("dtaa_rate")} type="number" min={0} max={100} />
          <div style={{ color:"#888", fontSize:12, marginTop:4 }}>As per India – Country DTAA</div>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>TDS SECTION (PRESUMPTIVE)</label>
          <select style={INPUT} value={form.tds_section} onChange={s("tds_section")}>
            <option>Section 195 – Other sums</option>
            <option>Section 9(1)(vi) – Royalty</option>
            <option>Section 9(1)(vii) – Fees for technical services</option>
          </select>
        </div>
      </div>

      <div style={FLD}>
        <label style={LABEL}>PRODUCT/SERVICE CATEGORIES SUPPLIED</label>
        <input style={INPUT} placeholder="e.g. SaaS subscription, IT consulting, Hardware" value={form.product_categories} onChange={s("product_categories")} />
      </div>

      <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#92400e", lineHeight:1.6 }}>
        Withholding tax and GST under Reverse Charge Mechanism (RCM) will be calculated automatically on every invoice based on these settings. Vendor should not include Indian GST in their invoices.
      </div>
    </div>
  );
}

// ─── Step 5: Products You Will Supply (shared) ───────────────────────────────
const PROD_CATS = PROCUREMENT_CATEGORIES;
const UOMS = ["Piece (Nos)","Box","Ream","Kilogram (Kg)","Litre","Metre","Set","Packet"];
const GST_RATES = [0, 5, 12, 18, 28];

const EMPTY_PROD = {
  name:"", sku:"", category:"", sub_category:"", brand:"", uom:"",
  description:"", colour:"", size:"", model:"", country_of_origin:"India", moq:"", warranty:"",
  supply_type:"goods", hsn_sac:"", gst_rate:18, cess:"No", cess_rate:0,
  price_type:"exclusive", basic_rate:"", discount:0,
  payment_terms:"30 days credit", payment_mode:"NEFT / RTGS", lead_time:"", freight:"Included in price", warranty_period:"", rate_validity:"",
};

const INNER_STEPS = [
  {id:1,label:"Product Details"},{id:2,label:"Particulars"},{id:3,label:"Tax & HSN"},
  {id:4,label:"Pricing"},{id:5,label:"Payment Terms"},{id:6,label:"Review"},
];

function StepProducts({ form, setForm, token, isPreview }) {
  const initStep = (form.products || []).length > 0 ? 6 : 1;
  const [pStep, setPStep] = useState(initStep);
  const [prod, setProd]   = useState({ ...EMPTY_PROD });
  const p = (k) => (v) => setProd((prev) => ({ ...prev, [k]: v?.target ? v.target.value : v }));
  const products = form.products || [];

  const addProduct = () => {
    const updated = [...products, { ...prod, _id: products.length + 1 }];
    setForm((f) => ({ ...f, products: updated }));
    setProd({ ...EMPTY_PROD });
    setPStep(6);
  };

  // Landed price calc
  const basic   = parseFloat(prod.basic_rate) || 0;
  const disc    = parseFloat(prod.discount)   || 0;
  const taxable = prod.price_type === "exclusive"
    ? basic - (basic * disc / 100)
    : basic / (1 + prod.gst_rate / 100);
  const gstAmt  = taxable * prod.gst_rate / 100;
  const cessAmt = prod.cess === "Yes" ? taxable * (parseFloat(prod.cess_rate) || 0) / 100 : 0;
  const landed  = taxable + gstAmt + cessAmt;

  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Add Products You Will Supply</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Your product catalog so procurement can match during RFQ & PO creation</p>

      {/* Inner step tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #eee", marginBottom:24, overflowX:"auto" }}>
        {INNER_STEPS.map((st) => {
          const done = st.id < pStep; const active = st.id === pStep;
          return (
            <div key={st.id} style={{ padding:"10px 16px 8px", borderBottom:`2px solid ${done ? GREEN : active ? RED : "transparent"}`, flexShrink:0 }}>
              <div style={{ fontSize:10, color:done ? GREEN : active ? RED : "#aaa", fontWeight:700, letterSpacing:.5 }}>STEP {st.id}</div>
              <div style={{ fontSize:12, fontWeight:done||active ? 600:400, color:done ? GREEN : active ? "#111":"#888", marginTop:2 }}>{st.label}{done ? " ✓":""}</div>
            </div>
          );
        })}
      </div>

      {pStep === 1 && <ProdDetails prod={prod} p={p} />}
      {pStep === 2 && <ProdParticulars prod={prod} p={p} />}
      {pStep === 3 && <ProdTaxHsn prod={prod} p={p} setProd={setProd} />}
      {pStep === 4 && <ProdPricing prod={prod} p={p} setProd={setProd} basic={basic} disc={disc} taxable={taxable} gstAmt={gstAmt} cessAmt={cessAmt} landed={landed} />}
      {pStep === 5 && <ProdPaymentTerms prod={prod} p={p} onAdd={addProduct} token={token} isPreview={isPreview} />}
      {pStep === 6 && <ProdReview products={products} setForm={setForm} onAddMore={() => { setProd({ ...EMPTY_PROD }); setPStep(1); }} />}

      {/* Inner nav (hidden on review step since review has its own actions) */}
      {pStep < 6 && (
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:20, paddingTop:16, borderTop:"1px solid #eee" }}>
          <button onClick={() => setPStep((n) => n - 1)} disabled={pStep === 1}
            style={{ background:"transparent", border:"1px solid #ddd", borderRadius:7, padding:"9px 18px", cursor:pStep===1?"not-allowed":"pointer", color:pStep===1?"#ccc":"#555", fontSize:13 }}>
            ← Back
          </button>
          {pStep < 5 ? (
            <button onClick={() => setPStep((n) => n + 1)}
              style={{ background:NAVY, color:"#fff", border:"none", borderRadius:7, padding:"9px 20px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
              Save & Continue →
            </button>
          ) : (
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setPStep(6)}
                style={{ background:"transparent", border:`1px solid ${NAVY}`, color:NAVY, borderRadius:7, padding:"9px 18px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
                Review & Continue →
              </button>
              <button onClick={addProduct}
                style={{ background:GREEN, color:"#fff", border:"none", borderRadius:7, padding:"9px 20px", cursor:"pointer", fontSize:13, fontWeight:700 }}>
                + Add This Product
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inner product sub-steps ────────────────────────────────────────────────────
function ProdDetails({ prod, p }) {
  return (
    <>
      <div style={ROW}>
        <div style={{ flex:2 }}><label style={LABEL}>PRODUCT / ITEM NAME *</label><input style={INPUT} placeholder="e.g. A4 Copier Paper 75 GSM" value={prod.name} onChange={p("name")} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>PRODUCT CODE / SKU</label><input style={INPUT} placeholder="Your own item code (optional)" value={prod.sku} onChange={p("sku")} /></div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>CATEGORY *</label>
          <select style={INPUT} value={prod.category} onChange={p("category")}>
            <option value="">Select category</option>
            {PROD_CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex:1 }}><label style={LABEL}>SUB-CATEGORY</label><input style={INPUT} placeholder="e.g. Paper Products" value={prod.sub_category} onChange={p("sub_category")} /></div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>BRAND / MAKE</label><input style={INPUT} placeholder="e.g. JK Copier" value={prod.brand} onChange={p("brand")} /></div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>UNIT OF MEASUREMENT (UOM) *</label>
          <select style={INPUT} value={prod.uom} onChange={p("uom")}>
            <option value="">Select unit</option>
            {UOMS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}

function ProdParticulars({ prod, p }) {
  return (
    <>
      <div style={FLD}><label style={LABEL}>PRODUCT DESCRIPTION *</label><textarea style={{ ...INPUT, height:80, resize:"vertical" }} placeholder="Describe the product — material, quality, packing, standard etc." value={prod.description} onChange={p("description")} /></div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>COLOUR / VARIANT</label><input style={INPUT} placeholder="e.g. White" value={prod.colour} onChange={p("colour")} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>SIZE / DIMENSION</label><input style={INPUT} placeholder="e.g. 210 × 297 mm" value={prod.size} onChange={p("size")} /></div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>MODEL / GRADE</label><input style={INPUT} placeholder="e.g. 75 GSM" value={prod.model} onChange={p("model")} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>COUNTRY OF ORIGIN *</label><input style={INPUT} placeholder="India" value={prod.country_of_origin} onChange={p("country_of_origin")} /></div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>MINIMUM ORDER QUANTITY (MOQ)</label><input style={INPUT} placeholder="e.g. 50" value={prod.moq} onChange={p("moq")} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>SHELF LIFE / WARRANTY (IF ANY)</label><input style={INPUT} placeholder="e.g. 1 year warranty" value={prod.warranty} onChange={p("warranty")} /></div>
      </div>
    </>
  );
}

function ProdTaxHsn({ prod, p, setProd }) {
  return (
    <>
      <div style={FLD}>
        <label style={LABEL}>SUPPLY TYPE *</label>
        <div style={{ display:"flex", gap:0, borderRadius:8, overflow:"hidden", border:`1px solid ${BORDER}` }}>
          {[["goods","Goods (HSN)"],["service","Service (SAC)"]].map(([val,lbl]) => (
            <button key={val} onClick={() => setProd((p) => ({ ...p, supply_type:val }))}
              style={{ flex:1, padding:"11px 0", border:"none", background:prod.supply_type===val ? NAVY:"#fff", color:prod.supply_type===val ? "#fff":"#555", cursor:"pointer", fontSize:14, fontWeight:prod.supply_type===val ? 700:400 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>HSN / SAC CODE *</label>
          <input style={INPUT} placeholder="e.g. 4802 (paper)" value={prod.hsn_sac} onChange={p("hsn_sac")} />
          <div style={{ color:"#888", fontSize:12, marginTop:4 }}>4-digit minimum · 6/8-digit preferred for turnover above ₹5 crore</div>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>GST RATE *</label>
          <select style={INPUT} value={prod.gst_rate} onChange={(e) => setProd((prev) => ({ ...prev, gst_rate: Number(e.target.value) }))}>
            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>IS CESS APPLICABLE?</label>
          <select style={INPUT} value={prod.cess} onChange={p("cess")}>
            <option>No</option>
            <option>Yes</option>
          </select>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>CESS RATE (%)</label>
          <input style={INPUT} placeholder="0" value={prod.cess_rate} onChange={p("cess_rate")} disabled={prod.cess === "No"} type="number" min={0} />
        </div>
      </div>
      <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#1e40af" }}>
        Tax type (CGST + SGST or IGST) will be decided automatically at billing based on your registered state versus the buyer's state.
      </div>
    </>
  );
}

function ProdPricing({ prod, p, setProd, basic, disc, taxable, gstAmt, cessAmt, landed }) {
  const fmt = (n) => `₹${Number(n).toFixed(2)}`;
  return (
    <>
      <div style={FLD}>
        <label style={LABEL}>QUOTED PRICE IS *</label>
        <div style={{ display:"flex", gap:0, borderRadius:8, overflow:"hidden", border:`1px solid ${BORDER}` }}>
          {[["exclusive","Exclusive of GST"],["inclusive","Inclusive of GST"]].map(([val,lbl]) => (
            <button key={val} onClick={() => setProd((p) => ({ ...p, price_type:val }))}
              style={{ flex:1, padding:"11px 0", border:"none", background:prod.price_type===val ? NAVY:"#fff", color:prod.price_type===val ? "#fff":"#555", cursor:"pointer", fontSize:14, fontWeight:prod.price_type===val ? 700:400 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>BASIC RATE PER UNIT (₹) *</label><input style={INPUT} placeholder="e.g. 280" value={prod.basic_rate} onChange={p("basic_rate")} type="number" min={0} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>DISCOUNT (%)</label><input style={INPUT} placeholder="0" value={prod.discount} onChange={p("discount")} type="number" min={0} max={100} /></div>
      </div>
      <div style={{ border:`1px solid ${BORDER}`, borderRadius:9, overflow:"hidden" }}>
        <div style={{ background:"#f8f9fb", padding:"10px 16px", fontWeight:700, fontSize:13, borderBottom:`1px solid ${BORDER}` }}>LANDED PRICE WORKING (PER UNIT)</div>
        {[
          ["Basic Rate", fmt(basic), false],
          ["Less: Discount", disc > 0 ? `- ${fmt(basic * disc / 100)}` : "- ₹0.00", false],
          ["Taxable Value", fmt(taxable), false],
          [`GST (${prod.gst_rate}%)`, fmt(gstAmt), false],
          ["Cess", fmt(cessAmt), false],
          ["Final Landed Price", fmt(landed), true],
        ].map(([label, value, bold]) => (
          <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${BORDER}`, background:bold ? "#f0f9ff":"#fff" }}>
            <span style={{ fontSize:13, fontWeight:bold ? 700:400 }}>{label}</span>
            <span style={{ fontSize:13, fontWeight:bold ? 700:400, color:bold ? NAVY:"#333" }}>{value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ProdPaymentTerms({ prod, p, onAdd, token, isPreview }) {
  return (
    <>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>PAYMENT TERMS *</label>
          <select style={INPUT} value={prod.payment_terms} onChange={p("payment_terms")}>
            {["Advance","7 days credit","15 days credit","30 days credit","45 days credit","60 days credit","Against delivery"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>PREFERRED MODE OF PAYMENT</label>
          <select style={INPUT} value={prod.payment_mode} onChange={p("payment_mode")}>
            {["NEFT / RTGS","Cheque","UPI","Letter of Credit"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>DELIVERY LEAD TIME (DAYS) *</label><input style={INPUT} placeholder="e.g. 7" value={prod.lead_time} onChange={p("lead_time")} type="number" min={1} /></div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>FREIGHT / TRANSPORT CHARGES</label>
          <select style={INPUT} value={prod.freight} onChange={p("freight")}>
            {["Included in price","Extra – as actuals","Extra – fixed rate","Free delivery"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}><label style={LABEL}>WARRANTY / GUARANTEE</label><input style={INPUT} placeholder="e.g. 12 months replacement warranty" value={prod.warranty_period} onChange={p("warranty_period")} /></div>
        <div style={{ flex:1 }}><label style={LABEL}>RATE VALIDITY (UP TO)</label><input type="date" style={INPUT} value={prod.rate_validity} onChange={p("rate_validity")} /></div>
      </div>
      <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>Supporting Documents</div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <FileUploadField token={token} isPreview={isPreview} docType="product_catalogue" label="PRODUCT CATALOGUE" accept=".pdf,.jpg,.png" />
        </div>
        <div style={{ flex:1 }}>
          <FileUploadField token={token} isPreview={isPreview} docType="product_image" label="PRODUCT IMAGE" accept=".jpg,.jpeg,.png" />
        </div>
      </div>
      <FileUploadField token={token} isPreview={isPreview} docType="rate_contract" label="RATE CONTRACT / QUOTATION (optional)" accept=".pdf" />
    </>
  );
}

function ProdReview({ products, setForm, onAddMore }) {
  const removeProduct = (id) => {
    const updated = products.filter((p) => p._id !== id);
    setForm((f) => ({ ...f, products: updated }));
  };
  return (
    <>
      <div style={{ border:`1px solid ${BORDER}`, borderRadius:9, overflow:"hidden", marginBottom:18 }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"#f8f9fb" }}>
              {["Product","HSN","UOM","Basic ₹","GST","Landed ₹",""].map((h) => (
                <th key={h} style={{ padding:"10px 14px", fontSize:12, fontWeight:700, color:"#555", textAlign:h==="Basic ₹"||h==="Landed ₹" ? "right":"left", borderBottom:`1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign:"center", padding:"20px", color:"#aaa", fontSize:13 }}>No products added yet. Go to Step 5 and tap "Add This Product".</td></tr>
            ) : products.map((pr) => (
              <tr key={pr._id} style={{ borderBottom:`1px solid ${BORDER}` }}>
                <td style={{ padding:"10px 14px", fontSize:13 }}><div style={{ fontWeight:600 }}>{pr.name}</div><div style={{ color:"#888", fontSize:11 }}>{pr.category}</div></td>
                <td style={{ padding:"10px 14px", fontSize:13 }}>{pr.hsn_sac || "—"}</td>
                <td style={{ padding:"10px 14px", fontSize:13 }}>{pr.uom || "—"}</td>
                <td style={{ padding:"10px 14px", fontSize:13, textAlign:"right" }}>₹{parseFloat(pr.basic_rate || 0).toFixed(2)}</td>
                <td style={{ padding:"10px 14px", fontSize:13 }}>{pr.gst_rate}%</td>
                <td style={{ padding:"10px 14px", fontSize:13, textAlign:"right", fontWeight:600 }}>
                  {(() => { const b=parseFloat(pr.basic_rate)||0; const t=b-(b*(parseFloat(pr.discount)||0)/100); return `₹${(t+t*pr.gst_rate/100).toFixed(2)}`; })()}
                </td>
                <td style={{ padding:"10px 14px" }}><button onClick={() => removeProduct(pr._id)} style={{ background:"transparent", border:"none", color:RED, cursor:"pointer", fontSize:16, lineHeight:1 }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {products.length > 0 && (
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#166534", marginBottom:16 }}>
          ✓ {products.length} product{products.length > 1 ? "s" : ""} added. Click <strong>Continue →</strong> below to proceed, or add more products.
        </div>
      )}
      <button onClick={onAddMore}
        style={{ background:NAVY, color:"#fff", border:"none", borderRadius:8, padding:"11px 22px", cursor:"pointer", fontSize:14, fontWeight:600 }}>
        + Add More Products
      </button>
    </>
  );
}

// ─── Step 4: Bank Account (shared) ───────────────────────────────────────────
function StepBank({ form, s, setForm, onPenny, busy, token, isPreview }) {
  const ACCT_TYPES = ["Current","Savings","Cash Credit","Overdraft"];
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Bank Account Details</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Upload cancelled cheque · we'll auto-extract account info and verify with ₹1 test transaction</p>

      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>VERIFICATION METHOD *</label>
          <select style={INPUT} value={form.bank_method} onChange={s("bank_method")}>
            <option value="cancelled_cheque">Cancelled Cheque (recommended · OCR auto-fetch)</option>
            <option value="bank_statement">Bank Statement (3 months)</option>
            <option value="passbook">Passbook copy (front page)</option>
          </select>
        </div>
        <div style={{ flex:1 }}>
          <FileUploadField
            token={token} isPreview={isPreview} docType="bank_proof"
            label={`UPLOAD ${form.bank_method==="cancelled_cheque" ? "CANCELLED CHEQUE" : form.bank_method==="bank_statement" ? "BANK STATEMENT" : "PASSBOOK"} *`}
          />
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>ACCOUNT HOLDER NAME *</label>
          <input style={{ ...INPUT, background:"#f8f9fb" }} placeholder="Auto-fills from cheque" value={form.acct_holder} onChange={s("acct_holder")} />
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>ACCOUNT NUMBER *</label>
          <input style={{ ...INPUT, background:"#f8f9fb" }} placeholder="Auto-fills from cheque" value={form.acct_number} onChange={s("acct_number")} />
        </div>
      </div>
      <div style={ROW}>
        <div style={{ flex:1 }}>
          <label style={LABEL}>IFSC CODE *</label>
          <input style={{ ...INPUT, background:"#f8f9fb", textTransform:"uppercase" }} placeholder="Auto-fills from cheque" value={form.ifsc} onChange={s("ifsc")} />
        </div>
        <div style={{ flex:1 }}>
          <label style={LABEL}>BANK & BRANCH *</label>
          <input style={{ ...INPUT, background:"#f8f9fb" }} placeholder="Auto-fills from IFSC" value={form.bank_branch} onChange={s("bank_branch")} />
        </div>
      </div>

      <div style={FLD}>
        <label style={LABEL}>ACCOUNT TYPE *</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {ACCT_TYPES.map((t) => {
            const val = t.toLowerCase().replace(" ","_");
            const active = form.acct_type === val;
            return (
              <button key={t} onClick={() => s("acct_type")(val)}
                style={{ padding:"9px 20px", borderRadius:7, border:`1px solid ${active ? NAVY : BORDER}`, background:active ? NAVY : "#fff", color:active ? "#fff":"#555", cursor:"pointer", fontSize:14, fontWeight:active ? 600:400, transition:"all .15s" }}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#1e40af", marginBottom:16 }}>
        <strong>Verification process:</strong> Once bank details are saved, we will deposit ₹1 to this account. You'll receive an OTP via SMS/email which you must enter to confirm. ₹1 will be auto-debited within 48 hours.
      </div>

      <button onClick={onPenny} disabled={busy || form.penny_done}
        style={{ width:"100%", background:form.penny_done ? GREEN : NAVY, color:"#fff", border:"none", borderRadius:8, padding:13, fontSize:14, fontWeight:700, cursor:busy ? "wait":"pointer", transition:"background .2s" }}>
        {busy ? "Processing ₹1 verification…" : form.penny_done ? "✓ ₹1 Verification Successful (demo)" : "Simulate ₹1 Verification (demo)"}
      </button>
    </div>
  );
}

// ─── Step 5: Addresses (shared) ──────────────────────────────────────────────
function StepAddress({ form, setForm }) {
  const update = (i, k, v) => setForm((p) => { const a=[...p.addresses]; a[i]={...a[i],[k]:v}; return {...p,addresses:a}; });
  const add    = () => setForm((p) => ({ ...p, addresses:[...p.addresses,{type:"branch",line:"",city:"",state:"",pin:""}] }));
  const remove = (i) => setForm((p) => ({ ...p, addresses:p.addresses.filter((_,idx) => idx!==i) }));

  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Addresses</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Add registered office and any branches/warehouses · multiple addresses supported</p>

      {form.addresses.map((addr, i) => (
        <div key={i} style={{ border:`1px solid ${BORDER}`, borderRadius:9, padding:18, marginBottom:14, position:"relative" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
            <select value={addr.type} onChange={(e) => update(i,"type",e.target.value)} style={{ ...INPUT, width:"auto", minWidth:150 }}>
              {["registered","branch","warehouse","shipping","billing"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
            {i===0 && <span style={{ background:"#dbeafe", color:"#1d4ed8", fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>Primary</span>}
            {i>0 && <button onClick={() => remove(i)} style={{ position:"absolute", top:14, right:14, background:"transparent", border:"none", color:RED, cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>}
          </div>
          <div style={FLD}>
            <label style={LABEL}>ADDRESS LINE</label>
            <input style={INPUT} placeholder="Building, street, locality" value={addr.line} onChange={(e) => update(i,"line",e.target.value)} />
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <div style={{ flex:1 }}><label style={LABEL}>CITY</label><input style={INPUT} value={addr.city} onChange={(e) => update(i,"city",e.target.value)} /></div>
            <div style={{ flex:1 }}><label style={LABEL}>STATE</label><input style={INPUT} value={addr.state} onChange={(e) => update(i,"state",e.target.value)} /></div>
            <div style={{ flex:1 }}><label style={LABEL}>PINCODE</label><input style={INPUT} value={addr.pin} onChange={(e) => update(i,"pin",e.target.value)} maxLength={6} /></div>
          </div>
        </div>
      ))}

      <button onClick={add} style={{ width:"100%", background:"transparent", border:`1px dashed ${BORDER}`, borderRadius:8, padding:"11px 0", cursor:"pointer", color:"#666", fontSize:14 }}>
        + Add another address
      </button>
    </div>
  );
}

// ─── Last step: Agreement & Declaration (shared) ──────────────────────────────
function StepAgreement({ form, s, token, isPreview }) {
  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>Agreement & Declaration</h2>
      <p style={{ color:"#666", fontSize:14, margin:"0 0 20px" }}>Sign vendor agreement and declare information accuracy</p>

      <div style={{ display:"flex", gap:14, marginBottom:24 }}>
        <div style={{ flex:1, border:`1px solid ${BORDER}`, borderRadius:9, padding:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:14 }}>
            <span style={{ fontSize:20 }}>📄</span>
            <div><div style={{ fontWeight:700, fontSize:14 }}>Master Vendor Agreement</div><div style={{ color:"#888", fontSize:12 }}>Standard T&C · 4 pages</div></div>
          </div>
          <button style={{ width:"100%", background:"transparent", border:`1px solid ${BORDER}`, borderRadius:7, padding:"9px 0", fontSize:13, cursor:"pointer", color:"#555", marginBottom:8 }}>
            📥 Download Template
          </button>
          <button onClick={() => s("esigned")(true)}
            style={{ width:"100%", background:form.esigned ? GREEN : NAVY, color:"#fff", border:"none", borderRadius:7, padding:"9px 0", fontSize:13, cursor:"pointer", fontWeight:600 }}>
            {form.esigned ? "✓ E-Signed" : "🔒 E-Sign Agreement"}
          </button>
        </div>

        <div style={{ flex:1, border:`1px solid ${BORDER}`, borderRadius:9, padding:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:14 }}>
            <span style={{ fontSize:20 }}>📤</span>
            <div><div style={{ fontWeight:700, fontSize:14 }}>Upload Signed Copy</div><div style={{ color:"#888", fontSize:12 }}>If e-sign not available</div></div>
          </div>
          <FileUploadField token={token} isPreview={isPreview} docType="agreement_signed" />
        </div>
      </div>

      <div style={{ background:"#f8f9fb", borderRadius:9, padding:"18px 20px" }}>
        <div style={{ fontWeight:700, marginBottom:10, fontSize:14 }}>Declaration · please read carefully</div>
        <p style={{ color:"#555", fontSize:13, lineHeight:1.75, margin:"0 0 18px" }}>
          I/We hereby declare that all information provided in this onboarding form is true, accurate, and complete to the best of my knowledge. I/We undertake to inform the company of any change in the above details, especially KYC, GST registration, MSME status, bank details and applicable tax certifications. I/We understand that providing false information may lead to immediate termination of vendor relationship and recovery of any losses suffered by the company.
        </p>
        <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer" }}>
          <input type="checkbox" checked={form.declaration} onChange={(e) => s("declaration")(e.target.checked)}
            style={{ marginTop:3, width:16, height:16, cursor:"pointer", flexShrink:0, accentColor:NAVY }} />
          <span style={{ fontSize:13, color:"#333", lineHeight:1.6 }}>
            I confirm the declaration above and authorise the company to verify the information provided through GST portal, MSME registry, NSDL/CDSL and the relevant banking systems.
          </span>
        </label>
      </div>
    </div>
  );
}
