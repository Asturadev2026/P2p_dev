import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading,
         Kpi, inr, inrFull, dt, dtt, pct } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* Shared invoice trace modal */
function InvoiceTrace({ id, onClose, onAction }) {
  const { toast } = useApp();
  const { data: inv, refresh } = useFetch(() => api.get(`/invoices/${id}/trace`), [id]);
  if (!inv) return null;
  const advance = async () => {
    try { const res = await api.post(`/invoices/${id}/advance`, { note: "advanced from UI" });
      toast(`Moved ${res.from} → ${res.to}`); refresh(); onAction?.();
    } catch (e) { toast(e.message, true); }
  };
  const runMatch = async () => {
    try { const res = await api.post(`/invoices/${id}/run-match`);
      toast(`Match: ${res.status} · score ${res.score}%${res.flags.length ? " · " + res.flags.join("; ") : ""}`);
      refresh(); onAction?.();
    } catch (e) { toast(e.message, true); }
  };
  return (
    <Modal wide title={`${inv.id} · ${inv.vendor_name}`} onClose={onClose}
      footer={<>
        {inv.stage === "match" && <button className="btn btn-blu" onClick={runMatch}>Run 3-way match</button>}
        {!["paid", "rejected"].includes(inv.stage) &&
          <button className="btn btn-pri" onClick={advance}>Advance stage →</button>}
      </>}>
      <DetailGrid items={[
        ["Vendor invoice no", inv.vendor_invoice_no], ["Stage", inv.stage],
        ["Source", inv.source], ["PO", inv.po_id || "Non-PO"],
        ["Taxable", inrFull(inv.taxable_amount)],
        ["GST (C/S/I)", `${inrFull(inv.cgst)} / ${inrFull(inv.sgst)} / ${inrFull(inv.igst)}`],
        ["TDS", `${inv.tds_section || "—"} · ${pct(inv.tds_rate)} · ${inrFull(inv.tds_amount)}`],
        ["Net payable", inrFull(inv.net_payable)],
        ["IRN", inv.irn ? `${inv.irn.slice(0, 12)}… · ${inv.irn_status}` : inv.irn_status],
        ["OCR confidence", pct(inv.ocr_confidence)],
        ["Match", inv.match_detail ? `${inv.match_detail.score}% · ${inv.match_detail.flags?.join("; ") || "clean"}` : "—"],
        ["GST 2B", inv.gst2b_status || "—"],
        ["MSME due", inv.msme_due_date ? dt(inv.msme_due_date) : "Not MSME"],
        ["Due date", dt(inv.due_date)],
      ]} />
      {inv.approvals?.length > 0 && (<>
        <h4 style={{ margin: "14px 0 8px" }}>Approval chain</h4>
        {inv.approvals.map((a) => (
          <div key={a.id} className={`wstep ${["approved", "auto_approved"].includes(a.status) ? "done" : a.status === "pending" ? "active" : ""}`}>
            <div className="wstep-n">{a.stage_no}</div>
            <div style={{ flex: 1 }}><b style={{ fontSize: 11, textTransform: "uppercase" }}>{a.stage_role}</b>
              <span style={{ fontSize: 11, color: "var(--ink-500)", marginLeft: 8 }}>
                {a.acted_name ? `${a.acted_name} · ${dtt(a.acted_at)}` : a.assigned_name || ""}</span></div>
            <Chip value={a.status} />
          </div>))}
      </>)}
      <h4 style={{ margin: "14px 0 8px" }}>Stage history</h4>
      {inv.stage_history.map((h) => (
        <div key={h.id} style={{ display: "flex", gap: 10, fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
          <span className="mono" style={{ color: "var(--ink-400)", width: 120 }}>{dtt(h.at)}</span>
          <Chip value={h.to_stage} />
          <span style={{ color: "var(--ink-600)" }}>{h.note}</span>
        </div>))}
      <h4 style={{ margin: "14px 0 8px" }}>Audit trail (this invoice)</h4>
      {inv.audit.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
          <span className="mono" style={{ color: "var(--ink-400)", width: 120 }}>{dtt(a.at)}</span>
          <b style={{ width: 110 }}>{a.actor_name}</b>
          <span>{a.action} — <span style={{ color: "var(--ink-500)" }}>{a.detail}</span></span>
        </div>))}
    </Modal>
  );
}

const INV_COLS = (extra = []) => [
  { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
  { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.msme_due_date && <Chip value="msme_priority" label="MSME" />}</> },
  { key: "total_amount", label: "Amount", num: true, render: (r) => inr(r.total_amount) },
  ...extra,
];

/* ============ Capture Inbox ============ */
export function CaptureInbox() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/invoices", { stage: "capture" }), []);
  const { data: all } = useFetch(() => api.get("/invoices"), []);
  const { data: vendors } = useFetch(() => api.get("/vendors"), []);
  const [trace, setTrace] = useState(null);
  const [summary, setSummary] = useState(null);
  const [showCapture, setShowCapture] = useState(false);
  const [capForm, setCapForm] = useState({ raw_text: "", source: "email", vendor_id: "" });
  const [file, setFile] = useState(null);
  const [capAlert, setCapAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    setBusy(true); setCapAlert(null);
    try {
      let res;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", capForm.source);
        if (capForm.vendor_id) fd.append("vendor_id", capForm.vendor_id);
        res = await api.postForm("/invoices/capture-file", fd);
      } else {
        if (!capForm.raw_text.trim()) { setCapAlert({ missing: ["Nothing to capture — upload a file or paste invoice text"] }); return; }
        res = await api.post("/invoices/capture", { ...capForm, vendor_id: capForm.vendor_id || null });
      }
      if (res.status === "rejected") {
        setCapAlert({ missing: res.missing, confidence: res.confidence });
        return;
      }
      toast(`Captured ${res.id} · ${res.vendor.name} · OCR ${res.extract.confidence}%`);
      res.warnings?.forEach((w) => toast(`⚠ ${w}`, true));
      setShowCapture(false); setFile(null); refresh();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  const avgConf = data.length ? (data.reduce((s, i) => s + Number(i.ocr_confidence || 0), 0) / data.length).toFixed(1) : "—";
  return (
    <>
      <PageHead title="Capture Inbox" sub="email · WhatsApp · scan · vendor portal — OCR + IRN + duplicate prevention"
        actions={<button className="btn btn-pri" onClick={() => setShowCapture(true)}>+ Capture invoice</button>} />
      <div className="kpi-row">
        <Kpi label="In capture" value={data.length} note="awaiting QC / match"
          onSummary={() => setSummary({ entity: "invoices", filters: { stage: "capture" }, title: "Invoices in capture" })} />
        <Kpi label="Avg OCR confidence" value={`${avgConf}%`} note="GPT-4o · India invoice-tuned" />
        <Kpi label="IRN validated" value={data.filter((i) => i.irn_status === "validated").length} note="live IRP check" noteClass="up" />
        <Kpi label="All-time captures" value={all?.length ?? "—"} note="across 5 channels"
          onSummary={() => setSummary({ entity: "invoices", filters: {}, title: "All invoices" })} />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card title="Live capture stream" sub="click a row for extraction · IRN · confidence breakdown" pad={false}>
        <DataTable columns={INV_COLS([
          { key: "source", label: "Source", render: (r) => <Chip value={r.source} label={r.source.replace("_", " ")} /> },
          { key: "ocr_confidence", label: "OCR", num: true, render: (r) => pct(r.ocr_confidence) },
          { key: "irn_status", label: "IRN", render: (r) => <Chip value={r.irn_status} /> },
          { key: "captured_at", label: "Captured", render: (r) => dtt(r.captured_at) },
        ])} rows={data} onRow={(r) => setTrace(r.id)} />
      </Card>
      {trace && <InvoiceTrace id={trace} onClose={() => setTrace(null)} onAction={refresh} />}
      {showCapture && (
        <Modal title="Capture invoice — upload a file or paste text" onClose={() => { setShowCapture(false); setFile(null); setCapAlert(null); }}
          footer={<button className="btn btn-pri" disabled={busy} onClick={capture}>{busy ? "Extracting…" : "Run OCR capture"}</button>}>
          {capAlert && (
            <div role="alert" style={{ background: "var(--red-100)", border: "1.5px solid var(--red-500)",
              borderRadius: 9, padding: "12px 15px", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: "var(--red-700)", marginBottom: 6 }}>
                ⚠ Capture blocked — OCR could not extract mandatory details
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--red-700)", fontSize: 12.5 }}>
                {capAlert.missing.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
              {capAlert.confidence != null && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--red-700)" }}>
                  OCR confidence: {capAlert.confidence}% · fix the document or select the vendor manually, then retry.
                </div>)}
            </div>
          )}
          <div className="field">
            <label>Invoice file (PDF · PNG · JPG · TXT — max 10 MB)</label>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setCapAlert(null); }}
              style={{ padding: "6px 10px", height: "auto" }} />
            {file && <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 4 }}>
              Selected: <b>{file.name}</b> ({(file.size / 1024).toFixed(0)} KB) — images go through GPT-4o vision OCR
            </div>}
          </div>
          <div className="form-row">
            <div className="field"><label>Source channel</label>
              <select value={capForm.source} onChange={(e) => setCapForm({ ...capForm, source: e.target.value })}>
                {["email", "whatsapp", "scan", "vendor_portal", "manual"].map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div className="field"><label>Vendor (optional — OCR will try to detect)</label>
              <select value={capForm.vendor_id} onChange={(e) => setCapForm({ ...capForm, vendor_id: e.target.value })}>
                <option value="">— auto-detect —</option>
                {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></div>
          </div>
          <div className="field"><label>…or paste invoice text {file && "(ignored while a file is selected)"}</label>
            <textarea rows={6} disabled={!!file} value={capForm.raw_text} onChange={(e) => setCapForm({ ...capForm, raw_text: e.target.value })}
              placeholder={"TAX INVOICE\nVijay Stationery & Print Solutions\nGSTIN 03AAEFV6612J1ZP\nInvoice No VS/26/0291 dt 11-06-2026\nBranch forms qty 5000 @ ₹24.50 = ₹1,22,500\nIGST 18% ₹22,050 · Total ₹1,44,550"} /></div>
        </Modal>
      )}
    </>
  );
}

/* ============ 3-Way Match ============ */
export function MatchQueue() {
  const { data, loading, refresh } = useFetch(() => api.get("/invoices", { stage: "match" }), []);
  const [trace, setTrace] = useState(null);
  const [summary, setSummary] = useState(null);
  if (loading) return <Loading />;
  const exceptions = data.filter((i) => i.match_status === "exception");
  return (
    <>
      <PageHead title="3-Way Match Queue" sub="Invoice ↔ PO ↔ GRN · tolerance: price ±2% · qty 0% · GST exact · auto-approve ≥95%" />
      <div className="kpi-row">
        <Kpi label="In match queue" value={data.length} note={inr(data.reduce((s, i) => s + +i.total_amount, 0)) + " total"}
          onSummary={() => setSummary({ entity: "invoices", filters: { stage: "match" }, title: "Match queue" })} />
        <Kpi label="Auto-matched" value={data.filter((i) => i.match_status === "auto_matched").length} note="first-pass clean" noteClass="up"
          onSummary={() => setSummary({ entity: "invoices", filters: { match_status: "auto_matched" }, title: "Auto-matched invoices" })} />
        <Kpi label="Exceptions" value={exceptions.length} note="price + qty variances" noteClass="down"
          onSummary={() => setSummary({ entity: "invoices", filters: { match_status: "exception" }, title: "Match exceptions" })} />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card title="Match queue" sub="amount · qty · GST cross-verified — click for AI exception analysis" pad={false}>
        <DataTable columns={INV_COLS([
          { key: "po_id", label: "PO", render: (r) => <span className="mono">{r.po_id || "—"}</span> },
          { key: "match_status", label: "Match", render: (r) => <Chip value={r.match_status || "pending"} /> },
          { key: "match_detail", label: "Score / flags", render: (r) =>
            r.match_detail ? `${r.match_detail.score}% ${r.match_detail.flags?.length ? "· " + r.match_detail.flags.join("; ") : ""}` : "—" },
        ])} rows={data} onRow={(r) => setTrace(r.id)} />
      </Card>
      {trace && <InvoiceTrace id={trace} onClose={() => setTrace(null)} onAction={refresh} />}
    </>
  );
}

/* ============ GST 2B ============ */
export function Gst2b() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/invoices/gst2b/records"), []);
  const [trace, setTrace] = useState(null);
  const sync = async () => {
    try { const res = await api.post("/invoices/gst2b/sync");
      toast(`2B sync · period ${res.period} · ${res.synced} newly reconciled`); refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (loading) return <Loading />;
  const m = (s) => data.filter((r) => r.status === s).length;
  return (
    <>
      <PageHead title="GST 2B Reconciliation" sub="GSTN feed · ITC eligibility · vendor filing watch"
        actions={<button className="btn btn-blu" onClick={sync}>Sync GSTR-2B now</button>} />
      <div className="kpi-row">
        <Kpi label="Matched · ITC eligible" value={m("matched")} noteClass="up" note="input credit protected" />
        <Kpi label="Tax mismatch" value={m("mismatch_tax")} noteClass="down" note="payment hold recommended" />
        <Kpi label="Not in 2B" value={m("not_in_2b")} noteClass="down" note="vendor follow-up" />
      </div>
      <Card title="2B reconciliation · invoice-by-invoice" pad={false}>
        <DataTable columns={[
          { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id || "—"}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "vendor_gstin", label: "GSTIN", render: (r) => <span className="mono">{r.vendor_gstin}</span> },
          { key: "taxable", label: "Taxable", num: true, render: (r) => inrFull(r.taxable) },
          { key: "gst_in_book", label: "GST in book", num: true, render: (r) => inrFull(r.gst_in_book) },
          { key: "gst_in_2b", label: "GST in 2B", num: true, render: (r) => inrFull(r.gst_in_2b) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "period", label: "Period" },
        ]} rows={data} onRow={(r) => r.invoice_id && setTrace(r.invoice_id)} />
      </Card>
      {trace && <InvoiceTrace id={trace} onClose={() => setTrace(null)} onAction={refresh} />}
    </>
  );
}

/* ============ TDS Engine ============ */
export function TdsEngine() {
  const { data, loading } = useFetch(() => api.get("/invoices/tds/queue"), []);
  const [trace, setTrace] = useState(null);
  const [summary, setSummary] = useState(null);
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="TDS Engine" sub="Section-wise computation at source · PAN-verified · challan-ready" />
      <div className="kpi-row">
        {data.summary.map((s) => (
          <Kpi key={s.tds_section} label={`${s.tds_section}`} value={inr(s.total)}
            note={`${s.invoices} invoice(s)`} />
        ))}
        <Kpi label="Total TDS" value={inr(data.summary.reduce((t, s) => t + +s.total, 0))}
          note="due 07th next month · ITNS 281" noteClass="down"
          onSummary={() => setSummary({ entity: "invoices", filters: { has_tds: true }, title: "TDS deductions" })} />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card title="TDS deduction queue · section-wise" sub="auto-computed · vendor PAN cross-checked" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "pan", label: "PAN", render: (r) => <span className="mono">{r.pan}</span> },
          { key: "tds_section", label: "Section", render: (r) => <Chip value="active" label={r.tds_section} /> },
          { key: "taxable_amount", label: "Taxable", num: true, render: (r) => inrFull(r.taxable_amount) },
          { key: "tds_rate", label: "Rate", num: true, render: (r) => pct(r.tds_rate) },
          { key: "tds_amount", label: "TDS", num: true, render: (r) => inrFull(r.tds_amount) },
          { key: "net_payable", label: "Net pay", num: true, render: (r) => inrFull(r.net_payable) },
          { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
        ]} rows={data.queue} onRow={(r) => setTrace(r.id)} />
      </Card>
      {trace && <InvoiceTrace id={trace} onClose={() => setTrace(null)} />}
    </>
  );
}
