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
  const [step, setStep] = useState("form"); // form | review
  const [capForm, setCapForm] = useState({ raw_text: "", source: "email", vendor_id: "" });
  const [file, setFile] = useState(null);
  const [capAlert, setCapAlert] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [reviewForm, setReviewForm] = useState(null);
  const [dupWarning, setDupWarning] = useState(null);

  const resetCapture = () => {
    setShowCapture(false); setStep("form"); setFile(null); setCapAlert(null);
    setPreview(null); setReviewForm(null); setDupWarning(null);
    setCapForm({ raw_text: "", source: "email", vendor_id: "" });
  };

  /* Step 1: Run OCR capture — extraction only, nothing is saved yet */
  const runOcr = async () => {
    setOcrBusy(true); setCapAlert(null);
    try {
      let res;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", capForm.source);
        fd.append("preview", "true");
        if (capForm.vendor_id) fd.append("vendor_id", capForm.vendor_id);
        res = await api.postForm("/invoices/capture-file", fd);
      } else {
        if (!capForm.raw_text.trim()) { setCapAlert({ missing: ["Nothing to capture — upload a file or paste invoice text"] }); return; }
        res = await api.post("/invoices/capture", { ...capForm, vendor_id: capForm.vendor_id || null, preview: true });
      }
      if (res.status === "rejected") {
        setCapAlert({ missing: res.missing, confidence: res.confidence });
        return;
      }
      const ex = res.extract || {};
      setPreview(res);
      setReviewForm({
        vendor_invoice_no: ex.vendor_invoice_no || "",
        invoice_date: ex.invoice_date || "",
        vendor_id: res.vendor?.id || capForm.vendor_id || "",
        po_id: ex.po_number || "",
        taxable_amount: ex.taxable_amount ?? "",
        gst_amount: ex.gst_amount ?? "",
        total_amount: ex.total_amount ?? "",
        ocr_confidence: ex.confidence ?? "",
        irn_status: ex.irn_status || (ex.irn ? "validated" : "not_applicable"),
        irn: ex.irn || "",
        remarks: "",
      });
      setStep("review");
    } catch (e) { toast(e.message, true); } finally { setOcrBusy(false); }
  };

  /* Step 2: Save / Draft / Send to match — persists the (edited) invoice */
  const confirmCapture = async (action, force = false) => {
    setConfirmBusy(true);
    try {
      const res = await api.post("/invoices/capture-confirm", {
        vendor_id: reviewForm.vendor_id,
        vendor_invoice_no: reviewForm.vendor_invoice_no,
        invoice_date: reviewForm.invoice_date,
        po_id: reviewForm.po_id || null,
        taxable_amount: Number(reviewForm.taxable_amount) || 0,
        gst_amount: Number(reviewForm.gst_amount) || 0,
        total_amount: reviewForm.total_amount !== "" ? Number(reviewForm.total_amount) : null,
        ocr_confidence: reviewForm.ocr_confidence !== "" ? Number(reviewForm.ocr_confidence) : null,
        irn_status: reviewForm.irn_status,
        irn: reviewForm.irn || null,
        remarks: reviewForm.remarks || null,
        source: capForm.source,
        action,
        force_duplicate: force,
      });
      if (res.status === "duplicate_warning") { setDupWarning({ existing: res.existing, pendingAction: action }); return; }
      const label = action === "send_to_match" ? "Sent to 3-Way Match" : action === "draft" ? "Draft created" : "Captured";
      toast(`${label} · ${res.id}`);
      resetCapture(); refresh();
    } catch (e) { toast(e.message, true); } finally { setConfirmBusy(false); }
  };

  const createDraft = async (id) => {
    try { await api.post(`/invoices/${id}/create-draft`); toast(`${id} marked as draft`); refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const sendToMatchRow = async (id) => {
    try { await api.post(`/invoices/${id}/send-to-match`); toast(`${id} sent to 3-Way Match`); refresh(); }
    catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  const avgConf = data.length ? (data.reduce((s, i) => s + Number(i.ocr_confidence || 0), 0) / data.length).toFixed(1) : "—";
  const selectedVendor = vendors?.find((v) => v.id === reviewForm?.vendor_id);
  return (
    <>
      <PageHead title="Capture Inbox" sub="email · WhatsApp · scan · vendor portal — OCR + IRN + duplicate prevention"
        actions={<button className="btn btn-pri" onClick={() => { resetCapture(); setShowCapture(true); }}>+ Capture invoice</button>} />
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
          { key: "capture_status", label: "Status", render: (r) => <Chip value={r.capture_status || "captured"} /> },
          { key: "actions", label: "Action", render: (r) => (
            <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-gho btn-sm" onClick={() => setTrace(r.id)}>View</button>
              {r.capture_status === "captured" &&
                <button className="btn btn-gho btn-sm" onClick={() => createDraft(r.id)}>Create Draft</button>}
              {r.capture_status !== "match_pending" &&
                <button className="btn btn-blu btn-sm" onClick={() => sendToMatchRow(r.id)}>Send to Match</button>}
            </div>
          ) },
        ])} rows={data} onRow={(r) => setTrace(r.id)} />
      </Card>
      {trace && <InvoiceTrace id={trace} onClose={() => setTrace(null)} onAction={refresh} />}
      {showCapture && (
        <Modal wide title={step === "form" ? "Capture invoice — upload a file or paste text" : "Extracted invoice details — verify & confirm"}
          onClose={resetCapture}
          footer={step === "form"
            ? <button className="btn btn-pri" disabled={ocrBusy} onClick={runOcr}>{ocrBusy ? "Extracting…" : "Run OCR capture"}</button>
            : <>
                <button className="btn btn-gho" disabled={confirmBusy} onClick={() => setStep("form")}>← Back</button>
                <button className="btn btn-gho" disabled={confirmBusy} onClick={() => confirmCapture("draft")}>Create Invoice Draft</button>
                <button className="btn btn-blu" disabled={confirmBusy} onClick={() => confirmCapture("save")}>Save Captured Invoice</button>
                <button className="btn btn-pri" disabled={confirmBusy} onClick={() => confirmCapture("send_to_match")}>Send to 3-Way Match</button>
              </>}>
          {step === "form" && (<>
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
          </>)}
          {step === "review" && reviewForm && (<>
            {preview?.extract?.note?.toLowerCase().includes("unavailable") ? (
              <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
                padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "var(--amber-700)" }}>
                ⚠ AI OCR unavailable, please review manually.
              </div>
            ) : preview?.extract?.confidence != null && Number(preview.extract.confidence) < 85 && (
              <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
                padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "var(--amber-700)" }}>
                ⚠ OCR confidence {preview.extract.confidence}% is below the 85% QC threshold — check every field carefully before saving.
              </div>
            )}
            {preview?.duplicate && !dupWarning && (
              <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
                padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "var(--amber-700)" }}>
                ⚠ Possible duplicate — <b>{preview.duplicate.id}</b> already exists for this vendor + invoice number (stage: {preview.duplicate.stage}).
              </div>
            )}
            {dupWarning && (
              <div role="alert" style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)",
                borderRadius: 9, padding: "12px 15px", marginBottom: 14 }}>
                <div style={{ fontWeight: 800, color: "var(--amber-700)", marginBottom: 6 }}>
                  ⚠ Duplicate invoice detected. This invoice may already be captured.
                </div>
                <div style={{ fontSize: 12.5, color: "var(--amber-700)" }}>
                  Existing: <b>{dupWarning.existing.id}</b> · stage {dupWarning.existing.stage} · {inrFull(dupWarning.existing.total_amount)}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button className="btn btn-gho btn-sm" onClick={() => setDupWarning(null)}>Cancel</button>
                  <button className="btn btn-pri btn-sm" onClick={() => confirmCapture(dupWarning.pendingAction, true)}>Save anyway</button>
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="field"><label>Invoice Number</label>
                <input value={reviewForm.vendor_invoice_no}
                  onChange={(e) => setReviewForm({ ...reviewForm, vendor_invoice_no: e.target.value })} /></div>
              <div className="field"><label>Invoice Date</label>
                <input type="date" value={reviewForm.invoice_date}
                  onChange={(e) => setReviewForm({ ...reviewForm, invoice_date: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Vendor Name</label>
                <select value={reviewForm.vendor_id} onChange={(e) => setReviewForm({ ...reviewForm, vendor_id: e.target.value })}>
                  <option value="">— select vendor —</option>
                  {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
              <div className="field"><label>Vendor GSTIN</label>
                <input value={selectedVendor?.gstin || preview?.extract?.vendor_gstin || ""} disabled /></div>
            </div>
            <div className="field"><label>PO Number (optional)</label>
              <input value={reviewForm.po_id} placeholder="e.g. PO/2026/05/00045"
                onChange={(e) => setReviewForm({ ...reviewForm, po_id: e.target.value })} /></div>
            <div className="form-row">
              <div className="field"><label>Taxable Amount</label>
                <input type="number" value={reviewForm.taxable_amount}
                  onChange={(e) => setReviewForm({ ...reviewForm, taxable_amount: e.target.value })} /></div>
              <div className="field"><label>GST Amount</label>
                <input type="number" value={reviewForm.gst_amount}
                  onChange={(e) => setReviewForm({ ...reviewForm, gst_amount: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Total Amount</label>
                <input type="number" value={reviewForm.total_amount}
                  onChange={(e) => setReviewForm({ ...reviewForm, total_amount: e.target.value })} /></div>
              <div className="field"><label>OCR Confidence (%)</label>
                <input type="number" min="0" max="100" value={reviewForm.ocr_confidence}
                  onChange={(e) => setReviewForm({ ...reviewForm, ocr_confidence: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>IRN Status</label>
                <select value={reviewForm.irn_status} onChange={(e) => setReviewForm({ ...reviewForm, irn_status: e.target.value })}>
                  {["pending", "validated", "failed", "not_applicable"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div className="field"><label>IRN (optional)</label>
                <input value={reviewForm.irn} onChange={(e) => setReviewForm({ ...reviewForm, irn: e.target.value })} /></div>
            </div>
            <div className="field"><label>Remarks</label>
              <textarea rows={2} value={reviewForm.remarks}
                onChange={(e) => setReviewForm({ ...reviewForm, remarks: e.target.value })} /></div>
          </>)}
        </Modal>
      )}
    </>
  );
}

/* ============ 3-Way Match ============ */
const CMP_MONEY_FIELDS = new Set(["Unit price", "Taxable amount", "GST amount", "Total amount"]);
function cmpVal(field, v) {
  if (v === "—" || v == null) return "—";
  if (CMP_MONEY_FIELDS.has(field) && typeof v === "number") return inrFull(v);
  if (field === "Quantity" && typeof v === "number") return v.toLocaleString("en-IN");
  return v;
}
function ResultBadge({ result }) {
  const map = { match: ["chip-green", "match"], mismatch: ["chip-red", "mismatch"], na: ["chip-grey", "n/a"] };
  const [cls, label] = map[result] || ["chip-grey", result];
  return <span className={`chip ${cls}`}>{label}</span>;
}
const CMP_COLS = [
  { key: "field", label: "Field" },
  { key: "invoice", label: "Invoice value", render: (r) => cmpVal(r.field, r.invoice) },
  { key: "po", label: "PO value", render: (r) => cmpVal(r.field, r.po) },
  { key: "grn", label: "GRN value", render: (r) => cmpVal(r.field, r.grn) },
  { key: "result", label: "Result", render: (r) => <ResultBadge result={r.result} /> },
  { key: "remark", label: "Remark", render: (r) => r.remark || "—" },
];

function MatchDetailModal({ id, onClose, onAction }) {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get(`/invoices/${id}/match-detail`), [id]);
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState(null); // null | "exception" | "send_back"
  const [reason, setReason] = useState("");

  const runMatch = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/invoices/${id}/run-match`);
      toast(`Match: ${res.status} · score ${res.score}%${res.flags?.length ? " · " + res.flags.join("; ") : ""}`);
      refresh(); onAction?.();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const sendToGst2b = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/send-to-gst2b`);
      toast(`${id} sent to GST 2B Recon`);
      onAction?.(); onClose();
    } catch (e) { toast(e.message, true); setBusy(false); }
  };
  const markException = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/mark-exception`, { reason: reason || null });
      toast(`${id} marked as exception`);
      setConfirmMode(null); setReason(""); refresh(); onAction?.();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const sendBackCapture = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/send-back-capture`, { note: reason || null });
      toast(`${id} sent back to Capture Inbox`);
      onAction?.(); onClose();
    } catch (e) { toast(e.message, true); setBusy(false); }
  };

  if (loading || !data) return null;
  const { invoice: inv, po, grn, comparison } = data;
  const canGst2b = !!po && !!grn && ["auto_matched", "exception"].includes(inv.match_status);

  return (
    <Modal wide title={`${inv.id} · ${inv.vendor_name} — 3-Way Match`} onClose={onClose}
      footer={<>
        <button className="btn btn-blu" disabled={busy} onClick={runMatch}>Run 3-Way Match</button>
        <button className="btn btn-pri" disabled={busy || !canGst2b}
          title={!canGst2b ? "Needs PO + GRN linked and a matched/exception result" : ""}
          onClick={sendToGst2b}>Send to GST 2B Recon</button>
        <button className="btn btn-gho" disabled={busy} onClick={() => setConfirmMode("exception")}>Mark Exception</button>
        <button className="btn btn-gho" disabled={busy} onClick={() => setConfirmMode("send_back")}>Send Back to Capture</button>
      </>}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <Chip value={inv.match_status || "match_pending"} />
        {inv.match_detail
          ? <span style={{ fontSize: 12.5, color: "var(--ink-600)" }}>
              Score {inv.match_detail.score}% {inv.match_detail.flags?.length ? "· " + inv.match_detail.flags.join("; ") : "· no flags"}
            </span>
          : <span style={{ fontSize: 12.5, color: "var(--ink-500)" }}>Not yet matched — click Run 3-Way Match</span>}
      </div>

      {confirmMode && (
        <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
          padding: "12px 15px", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: "var(--amber-700)", marginBottom: 8 }}>
            {confirmMode === "exception" ? "Mark as match exception" : "Send back to Capture Inbox"}
          </div>
          <div className="field"><label>Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn btn-gho btn-sm" onClick={() => { setConfirmMode(null); setReason(""); }}>Cancel</button>
            <button className="btn btn-pri btn-sm" disabled={busy}
              onClick={confirmMode === "exception" ? markException : sendBackCapture}>Confirm</button>
          </div>
        </div>
      )}

      <h4 style={{ margin: "0 0 8px" }}>Invoice</h4>
      <DetailGrid items={[
        ["Vendor", inv.vendor_name], ["Vendor invoice no", inv.vendor_invoice_no],
        ["PO", inv.po_id || "Non-PO"], ["GRN", grn?.id || (inv.po_id ? "Not received yet" : "—")],
        ["Taxable", inrFull(inv.taxable_amount)], ["GST", inrFull(+inv.cgst + +inv.sgst + +inv.igst)],
        ["Total", inrFull(inv.total_amount)], ["Stage", inv.stage],
      ]} />

      <h4 style={{ margin: "14px 0 8px" }}>Linked Purchase Order</h4>
      {po ? (
        <DetailGrid items={[
          ["PO number", po.id], ["Vendor", po.vendor_name], ["Status", po.status],
          ["Amount", inrFull(po.amount)], ["GST amount", inrFull(po.gst_amount)], ["Issued", dt(po.issued_at)],
          ["Lines", po.lines?.map((l) => `${l.description} · ${l.quantity} ${l.uom} @ ${inrFull(l.unit_price)}`).join("; ") || "—"],
        ]} />
      ) : <div className="empty">No PO linked to this invoice.</div>}

      <h4 style={{ margin: "14px 0 8px" }}>Linked Goods Receipt (GRN)</h4>
      {grn ? (
        <DetailGrid items={[
          ["GRN number", grn.id], ["Status", grn.status], ["Received", dt(grn.received_at)],
          ["Lines", grn.lines?.length
            ? grn.lines.map((l) => `${l.description || "line"} · received ${l.qty_received} / accepted ${l.qty_accepted}`).join("; ")
            : "No line-level quantities recorded (service receipt)"],
        ]} />
      ) : <div className="empty">No GRN found for this PO yet.</div>}

      <h4 style={{ margin: "14px 0 8px" }}>Invoice vs PO vs GRN comparison</h4>
      <DataTable columns={CMP_COLS} rows={comparison} />
    </Modal>
  );
}

export function MatchQueue() {
  const { data, loading, refresh } = useFetch(() => api.get("/invoices", { stage: "match" }), []);
  const [detail, setDetail] = useState(null);
  const [summary, setSummary] = useState(null);
  if (loading) return <Loading />;
  const exceptions = data.filter((i) => i.match_status === "exception");
  const failed = data.filter((i) => i.match_status === "failed");
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
        <Kpi label="Failed" value={failed.length} note="score below 80% · send back to Capture" noteClass="down"
          onSummary={() => setSummary({ entity: "invoices", filters: { match_status: "failed" }, title: "Failed matches" })} />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card title="Match queue" sub="click a row for the Invoice ↔ PO ↔ GRN comparison" pad={false}>
        <DataTable columns={INV_COLS([
          { key: "po_id", label: "PO", render: (r) => <span className="mono">{r.po_id || "—"}</span> },
          { key: "match_status", label: "Match", render: (r) => <Chip value={r.match_status || "pending"} /> },
          { key: "match_detail", label: "Score / flags", render: (r) =>
            r.match_detail ? `${r.match_detail.score}% ${r.match_detail.flags?.length ? "· " + r.match_detail.flags.join("; ") : ""}` : "—" },
        ])} rows={data} onRow={(r) => setDetail(r.id)} />
      </Card>
      {detail && <MatchDetailModal id={detail} onClose={() => setDetail(null)} onAction={refresh} />}
    </>
  );
}

/* ============ GST 2B ============ */
const GST2B_RECOMMENDATION = {
  pending_sync: "Awaiting GSTN sync",
  matched: "ITC eligible",
  mismatch_tax: "Payment hold recommended",
  not_in_2b: "Vendor follow-up required",
  tds_pending: "Moved to TDS Engine",
};

function Gst2bDetailModal({ record, onClose, onAction }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [showRemark, setShowRemark] = useState(false);
  const [remark, setRemark] = useState("");
  const id = record.invoice_id;
  const diff = record.gst_in_2b != null ? Number(record.gst_in_book || 0) - Number(record.gst_in_2b) : null;

  const markItc = async () => {
    setBusy(true);
    try { await api.post(`/invoices/${id}/gst2b/mark-itc-eligible`); toast(`${id} marked ITC eligible`); onAction?.(); onClose(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  const markHold = async () => {
    setBusy(true);
    try { await api.post(`/invoices/${id}/gst2b/mark-payment-hold`); toast(`${id} marked payment hold`); onAction?.(); onClose(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };
  const addRemark = async () => {
    if (!remark.trim()) return;
    setBusy(true);
    try { await api.post(`/invoices/${id}/gst2b/remark`, { remark }); toast("GST remark added"); setShowRemark(false); setRemark(""); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const moveToTds = async () => {
    setBusy(true);
    try { await api.post(`/invoices/${id}/gst2b/move-to-tds`); toast(`${id} moved to TDS Engine`); onAction?.(); onClose(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  };

  const cannotMove = record.status === "mismatch_tax" || record.status === "pending_sync";
  return (
    <Modal title={`${id} · ${record.vendor_name} — GST 2B`} onClose={onClose}
      footer={<>
        <button className="btn btn-blu" disabled={busy} onClick={markItc}>Mark ITC Eligible</button>
        <button className="btn btn-gho" disabled={busy} onClick={markHold}>Mark Payment Hold</button>
        <button className="btn btn-gho" disabled={busy} onClick={() => setShowRemark((s) => !s)}>Add GST Remark</button>
        <button className="btn btn-pri" disabled={busy || cannotMove}
          title={cannotMove ? "Resolve the tax mismatch (or sync first) before moving on" : ""}
          onClick={moveToTds}>Move to TDS Engine</button>
      </>}>
      {showRemark && (
        <div className="field"><label>Remark</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ flex: 1 }} value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder="e.g. vendor confirmed late filing, ITC to follow next cycle" />
            <button className="btn btn-pri btn-sm" disabled={busy} onClick={addRemark}>Save</button>
          </div>
        </div>
      )}
      <DetailGrid items={[
        ["Invoice number", id], ["Vendor", record.vendor_name],
        ["GSTIN", record.vendor_gstin], ["Period", record.period],
        ["Taxable amount", inrFull(record.taxable)], ["GST in book", inrFull(record.gst_in_book)],
        ["GST in 2B", record.gst_in_2b != null ? inrFull(record.gst_in_2b) : "Not found"],
        ["Difference", diff != null ? inrFull(Math.abs(diff)) : "—"],
        ["Current GST status", <Chip value={record.status} />],
        ["ITC eligibility", record.status === "matched" ? "Eligible"
          : record.status === "pending_sync" ? "Pending sync" : "Not eligible yet"],
        ["Recommendation", GST2B_RECOMMENDATION[record.status] || "—"],
      ]} />
    </Modal>
  );
}

export function Gst2b() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/invoices/gst2b/records"), []);
  const [detail, setDetail] = useState(null);
  const sync = async () => {
    try { const res = await api.post("/invoices/gst2b/sync");
      toast(`2B sync · period ${res.period} · ${res.synced} reconciled`); refresh();
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
      <Card title="2B reconciliation · invoice-by-invoice" sub="click a row for GST details" pad={false}>
        <DataTable columns={[
          { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id || "—"}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "vendor_gstin", label: "GSTIN", render: (r) => <span className="mono">{r.vendor_gstin}</span> },
          { key: "taxable", label: "Taxable", num: true, render: (r) => inrFull(r.taxable) },
          { key: "gst_in_book", label: "GST in book", num: true, render: (r) => inrFull(r.gst_in_book) },
          { key: "gst_in_2b", label: "GST in 2B", num: true, render: (r) => r.gst_in_2b != null ? inrFull(r.gst_in_2b) : "—" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "period", label: "Period" },
          { key: "actions", label: "", render: (r) =>
            <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>View GST Details</button> },
        ]} rows={data} onRow={(r) => r.invoice_id && setDetail(r)} />
      </Card>
      {detail && <Gst2bDetailModal record={detail} onClose={() => setDetail(null)} onAction={refresh} />}
    </>
  );
}

/* ============ TDS Engine ============ */
const TDS_SECTIONS = ["194C", "194J", "194I", "194D"];

function TdsDetailModal({ id, onClose, onAction }) {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get(`/invoices/${id}/tds-detail`), [id]);
  const [busy, setBusy] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [section, setSection] = useState("");
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");

  const compute = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/invoices/${id}/tds/compute`);
      toast(`TDS computed: ${res.tds_section} · ${pct(res.tds_rate)} · ${inrFull(res.tds_amount)}`);
      refresh(); onAction?.();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const openOverride = () => {
    setSection(data.invoice.tds_section || "");
    setRate(String(data.invoice.tds_rate ?? ""));
    setReason("");
    setShowOverride(true);
  };
  const saveOverride = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/invoices/${id}/tds/override`,
        { tds_section: section, tds_rate: Number(rate), reason: reason || null });
      toast(`TDS overridden: ${res.tds_section} · ${pct(res.tds_rate)}`);
      setShowOverride(false); refresh(); onAction?.();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const saveTds = async () => {
    setBusy(true);
    try { await api.post(`/invoices/${id}/tds/save`); toast("TDS saved · ready for approval"); refresh(); onAction?.(); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const sendToApproval = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/tds/send-to-approval`);
      toast(`${id} sent to Approval Workflow`);
      onAction?.(); onClose();
    } catch (e) { toast(e.message, true); setBusy(false); }
  };

  if (loading || !data) return null;
  const inv = data.invoice;
  const panMissing = !inv.pan;
  const gstIssue = inv.gst2b_status === "mismatch_tax" || inv.gst2b_status === "not_in_2b";

  return (
    <Modal title={`${inv.id} · ${inv.vendor_name} — TDS`} onClose={onClose}
      footer={<>
        <button className="btn btn-blu" disabled={busy} onClick={compute}>Auto-compute TDS</button>
        <button className="btn btn-gho" disabled={busy} onClick={openOverride}>Override Section / Rate</button>
        <button className="btn btn-gho" disabled={busy} onClick={saveTds}>Save TDS</button>
        <button className="btn btn-pri" disabled={busy || inv.tds_status !== "tds_ready"}
          title={inv.tds_status !== "tds_ready" ? "Save TDS first" : ""}
          onClick={sendToApproval}>Send to Approval Workflow</button>
      </>}>
      {panMissing && (
        <div style={{ background: "var(--red-100)", border: "1.5px solid var(--red-500)", borderRadius: 9,
          padding: "10px 14px", marginBottom: 10, fontSize: 12.5, color: "var(--red-700)" }}>
          ⚠ PAN missing — higher TDS may apply
        </div>
      )}
      {gstIssue && (
        <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
          padding: "10px 14px", marginBottom: 10, fontSize: 12.5, color: "var(--amber-700)" }}>
          ⚠ GST issue exists — payment hold may be required
        </div>
      )}
      {showOverride && (
        <div style={{ background: "var(--amber-100)", border: "1.5px solid var(--amber-500)", borderRadius: 9,
          padding: "12px 15px", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: "var(--amber-700)", marginBottom: 8 }}>Override TDS section / rate</div>
          <div className="form-row">
            <div className="field"><label>Section</label>
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                {TDS_SECTIONS.map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div className="field"><label>Rate (%)</label>
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          </div>
          <div className="field"><label>Override reason (required if section/rate changed)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. contractor reclassified under 194J" /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn btn-gho btn-sm" onClick={() => setShowOverride(false)}>Cancel</button>
            <button className="btn btn-pri btn-sm" disabled={busy} onClick={saveOverride}>Apply override</button>
          </div>
        </div>
      )}
      <DetailGrid items={[
        ["Invoice number", inv.id], ["Vendor", inv.vendor_name],
        ["PAN", inv.pan || "Missing"], ["Taxable amount", inrFull(inv.taxable_amount)],
        ["Invoice total", inrFull(inv.total_amount)], ["TDS section", inv.tds_section],
        ["TDS rate", pct(inv.tds_rate)], ["TDS amount", inrFull(inv.tds_amount)],
        ["Net payable", inrFull(inv.net_payable)],
        ["Current stage / status", <>{inv.stage} · <Chip value={inv.tds_status || "tds_pending"} /></>],
      ]} />
    </Modal>
  );
}

export function TdsEngine() {
  const { data, loading, refresh } = useFetch(() => api.get("/invoices/tds/queue"), []);
  const [detail, setDetail] = useState(null);
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
      <Card title="TDS deduction queue · section-wise" sub="auto-computed · vendor PAN cross-checked · click for details" pad={false}>
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
          { key: "actions", label: "", render: (r) =>
            <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(r.id); }}>View TDS Details</button> },
        ]} rows={data.queue} onRow={(r) => setDetail(r.id)} />
      </Card>
      {detail && <TdsDetailModal id={detail} onClose={() => setDetail(null)} onAction={refresh} />}
    </>
  );
}
