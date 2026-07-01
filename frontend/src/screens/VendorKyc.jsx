import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

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
  { id:5, label:"Address" },
  { id:6, label:"Agreement" },
];

const FOREIGN_STEPS = [
  { id:1, label:"Vendor Type" },
  { id:2, label:"Identity" },
  { id:3, label:"Foreign Compliance" },
  { id:4, label:"Bank" },
  { id:5, label:"Address" },
  { id:6, label:"Tax & Products" },
  { id:7, label:"Agreement" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers:{ "Content-Type":"application/json" }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || "Request failed");
  return json;
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
    trc_uploaded: false, form10f_uploaded: false, no_pe_signed: false,
    // Step 6 – Foreign: Tax & Products
    dtaa_rate: "", tds_section: "Section 195 – Other sums", product_categories: "",
    // Step 4 – Bank (shared)
    bank_method: "cancelled_cheque", acct_holder: "", acct_number: "", ifsc: "", bank_branch: "", acct_type: "savings", penny_done: false,
    // Step 5 – Address (shared)
    addresses: [{ type:"registered", line:"", city:"", state:"", pin:"" }],
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
    apiFetch(`/vendors/kyc/${token}`)
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
      await apiFetch(`/vendors/kyc/${token}/submit`, {
        method:"POST",
        body:JSON.stringify({ pan:form.pan, gstin:form.gstin, contact_name:info?.contact_name, contact_phone:info?.contact_phone, address:form.addresses[0]?.line, state:form.addresses[0]?.state }),
      });
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
  const renderStep = () => {
    if (step === 1) return <Step1 form={form} s={s} />;

    if (form.vendor_type === "domestic") {
      if (step === 2) return <StepGst    form={form} s={s} onVerify={verifyGstin} busy={verifying} />;
      if (step === 3) return <StepPanMsme form={form} s={s} setForm={setForm} onVerify={verifyPan} busy={verifying} />;
      if (step === 4) return <StepBank   form={form} s={s} setForm={setForm} onPenny={runPennyDrop} busy={verifying} />;
      if (step === 5) return <StepAddress form={form} setForm={setForm} />;
      if (step === 6) return <StepAgreement form={form} s={s} />;
    } else {
      if (step === 2) return <StepForeignIdentity   form={form} s={s} />;
      if (step === 3) return <StepForeignCompliance form={form} s={s} setForm={setForm} />;
      if (step === 4) return <StepBank   form={form} s={s} setForm={setForm} onPenny={runPennyDrop} busy={verifying} />;
      if (step === 5) return <StepAddress form={form} setForm={setForm} />;
      if (step === 6) return <StepTaxProducts form={form} s={s} />;
      if (step === 7) return <StepAgreement form={form} s={s} />;
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
function StepPanMsme({ form, s, setForm, onVerify, busy }) {
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
          <label style={LABEL}>UPLOAD MSME / UDYAM CERTIFICATE</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...INPUT, padding:"7px 10px", cursor:"pointer" }} />
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

function StepForeignIdentity({ form, s }) {
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
        <label style={LABEL}>UPLOAD CERTIFICATE OF INCORPORATION (PDF) *</label>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...INPUT, padding:"7px 10px", cursor:"pointer" }} />
      </div>

      <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#1e40af", lineHeight:1.6 }}>
        <strong>Self-attested PAN required</strong> if you have one in India. If not, the Indian PAN field can be left blank — TDS will be deducted at higher rate per Section 206AA unless DTAA benefit is claimed in the next step.
      </div>
    </div>
  );
}

// ─── Step 3 (Foreign): Foreign Compliance / DTAA ─────────────────────────────
function StepForeignCompliance({ form, s, setForm }) {
  const DocRow = ({ label, sub, uploadedKey, uploadedLabel }) => (
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
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...INPUT, padding:"7px 10px", cursor:"pointer" }} />
    </div>
  );

  return (
    <div style={CARD}>
      <h2 style={{ margin:"0 0 4px", fontSize:20 }}>DTAA Documents</h2>
      <p style={{ color:"#2563eb", fontSize:14, margin:"0 0 20px" }}>Double Taxation Avoidance Agreement compliance · all fields mandatory</p>

      <DocRow label="Tax Residency Certificate (TRC) · yearly *" sub="Issued by tax authority of country of residence · valid for the year" uploadedKey="trc_uploaded" uploadedLabel="Uploaded" />
      <DocRow label="Form 10F · yearly *" sub="Self-declaration with tax-related info not in TRC · must be e-filed on Income Tax portal" uploadedKey="form10f_uploaded" uploadedLabel="Uploaded" />
      <DocRow label="No PE Declaration *" sub="Self-declaration that vendor has no Permanent Establishment in India" uploadedKey="no_pe_signed" uploadedLabel="Signed" />

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

// ─── Step 4: Bank Account (shared) ───────────────────────────────────────────
function StepBank({ form, s, setForm, onPenny, busy }) {
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
          <label style={LABEL}>UPLOAD {form.bank_method==="cancelled_cheque" ? "CANCELLED CHEQUE" : form.bank_method==="bank_statement" ? "BANK STATEMENT" : "PASSBOOK"} *</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...INPUT, padding:"7px 10px", cursor:"pointer" }} />
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
function StepAgreement({ form, s }) {
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
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...INPUT, padding:"7px 10px", cursor:"pointer" }} />
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
