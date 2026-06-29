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

export function Onboarding() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/vendors/onboarding/list"), []);
  const [active, setActive] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [bank, setBank] = useState({ account_no: "", ifsc: "", account_name: "" });
  const [form, setForm] = useState({ entity_name: "", business_type: "pvt_ltd", vendor_type: "domestic",
    pan: "", gstin: "", contact_name: "", contact_email: "", state: "Punjab" });

  const start = async () => {
    try { const res = await api.post("/vendors/onboarding", form);
      toast(`Onboarding ${res.id} initiated`); setShowNew(false); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const advance = async (o) => {
    try {
      const body = o.stage === 3 ? bank : undefined;
      const res = await api.post(`/vendors/onboarding/${o.id}/advance`, body);
      toast(`${o.id} → step ${res.stage} (${STEPS[res.stage - 1] || "complete"})`);
      refresh(); setActive(null);
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Vendor Onboarding" sub="digitised KYC · all verification APIs Intelezen-provided · simulated until live"
        actions={<button className="btn btn-pri" onClick={() => setShowNew(true)}>+ Start onboarding</button>} />
      <div className="kpi-row">
        <Kpi label="In flight" value={data.filter((o) => o.status === "in_progress").length} note="across 6 funnel stages" />
        <Kpi label="High-risk flagged" value={data.filter((o) => o.risk_flag === "high").length} note="PAN/GST mismatch · escalated" noteClass="down" />
        <Kpi label="Live as vendors" value={data.filter((o) => o.status === "approved").length} note="ERP-pushed" noteClass="up" />
      </div>
      <Card title="Onboarding pipeline" sub="click a row to run the next verification step" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Ref", render: (r) => <span className="mono">{r.id}</span> },
          { key: "entity_name", label: "Vendor" },
          { key: "vendor_type", label: "Type" },
          { key: "pan", label: "PAN", render: (r) => <span className="mono">{r.pan || "—"}</span> },
          { key: "stage", label: "Stage", render: (r) => `${r.stage}/6 · ${STEPS[r.stage - 1]}` },
          { key: "risk_flag", label: "Risk", render: (r) => <Chip value={r.risk_flag} /> },
          { key: "is_msme", label: "MSME", render: (r) => r.is_msme == null ? "—" : r.is_msme ? "Yes" : "No" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
        ]} rows={data} onRow={(r) => { setBank({ account_no: "", ifsc: "", account_name: r.entity_name }); setActive(r); }} />
      </Card>

      {active && (
        <Modal title={`${active.id} · ${active.entity_name}`} onClose={() => setActive(null)}
          footer={active.status === "in_progress" &&
            <button className="btn btn-pri" onClick={() => advance(active)}>
              Run step {active.stage}: {STEPS[active.stage - 1]} →
            </button>}>
          {STEPS.map((s, i) => (
            <div key={s} className={`wstep ${i + 1 < active.stage ? "done" : i + 1 === active.stage && active.status === "in_progress" ? "active" : active.status === "approved" ? "done" : ""}`}>
              <div className="wstep-n">{i + 1}</div>
              <div style={{ flex: 1 }}><b style={{ fontSize: 12 }}>{s}</b></div>
              {i + 1 < active.stage || active.status === "approved" ? <Chip value="approved" label="done" /> :
               i + 1 === active.stage ? <Chip value="pending" label="next" /> : null}
            </div>
          ))}
          {active.stage === 3 && active.status === "in_progress" && (
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
          <div style={{ marginTop: 12 }}>
            <DetailGrid items={[
              ["GSTIN verified", active.gstin_verified == null ? "—" : active.gstin_verified ? "✓" : "✗"],
              ["PAN verified", active.pan_verified == null ? "—" : active.pan_verified ? "✓" : "✗"],
              ["Udyam", active.udyam_no || "—"], ["Penny drop", active.penny_drop_status || "—"],
              ["NPCI match", active.npci_name_match ? `${active.npci_name_match}%` : "—"],
              ["Risk", active.risk_score ? `${active.risk_score} · ${active.risk_tier}` : "—"],
              ["ERP vendor", active.erp_vendor_id || "—"], ["Notes", active.notes],
            ]} />
          </div>
        </Modal>
      )}

      {showNew && (
        <Modal title="Start vendor onboarding" onClose={() => setShowNew(false)}
          footer={<button className="btn btn-pri" onClick={start}>Initiate</button>}>
          <div className="field"><label>Entity name</label>
            <input value={form.entity_name} onChange={(e) => setForm({ ...form, entity_name: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Business type</label>
              <select value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                {["pvt_ltd", "public_ltd", "llp", "partnership", "proprietorship"].map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div className="field"><label>Vendor type</label>
              <select value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value })}>
                <option value="domestic">Domestic</option>
                <option value="foreign">Foreign (separate documentation path)</option>
              </select></div>
          </div>
          <div className="form-row">
            <div className="field"><label>PAN</label>
              <input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} /></div>
            <div className="field"><label>GSTIN {form.vendor_type === "foreign" && "(n/a for foreign)"}</label>
              <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} maxLength={15} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Contact name</label>
              <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
            <div className="field"><label>Contact email</label>
              <input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
