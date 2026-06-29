import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading,
         inr, inrFull, dt, dtt, Kpi } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Requisitions ============ */
export function Requisitions() {
  const { user, toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/requisitions"), []);
  const { data: masters } = useFetch(() => api.get("/vendors/masters/reference"), []);
  const [detail, setDetail] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({ title: "", department_id: "IT", category_id: "IT-HW",
    branch_id: "BR-HO", cost_center: "", justification: "",
    lines: [{ description: "", quantity: 1, uom: "NOS", est_unit_price: 0 }] });

  const openDetail = async (r) => setDetail(await api.get(`/requisitions/${r.id}/detail`));
  const submit = async (id) => {
    try { const res = await api.post(`/requisitions/${id}/submit`);
      toast(res.auto_approved ? "Auto-approved (below threshold)" : `Routed: ${res.stages.join(" → ")}`);
      setDetail(null); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const create = async () => {
    try {
      const res = await api.post("/requisitions", form);
      toast(`Created ${res.id} · ${inrFull(res.total_amount)}`);
      setShowNew(false); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const setLine = (i, k, v) => setForm((f) => {
    const lines = [...f.lines]; lines[i] = { ...lines[i], [k]: v }; return { ...f, lines };
  });

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Purchase Requisitions" sub="Raise · route · track — with live approver panel"
        actions={<>
          <button className="btn btn-gho" onClick={() => setSummary({ entity: "requisitions", filters: {}, title: "Requisitions" })}>≡ Summary</button>
          <button className="btn btn-pri" onClick={() => setShowNew(true)}>+ New requisition</button>
        </>} />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card pad={false}>
        <DataTable
          columns={[
            { key: "id", label: "PR", render: (r) => <span className="mono">{r.id}</span> },
            { key: "title", label: "Title" },
            { key: "department_name", label: "Department" },
            { key: "branch_name", label: "Branch" },
            { key: "requester_name", label: "Requester" },
            { key: "total_amount", label: "Amount", num: true, render: (r) => inr(r.total_amount) },
            { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          ]}
          rows={data} onRow={openDetail} />
      </Card>

      {detail && (
        <Modal wide title={`${detail.id} · ${detail.title}`} onClose={() => setDetail(null)}
          footer={detail.status === "draft" &&
            <button className="btn btn-pri" onClick={() => submit(detail.id)}>Submit for approval</button>}>
          <DetailGrid items={[["Department", detail.department_name], ["Category", detail.category_name],
            ["Branch", detail.branch_name], ["Cost centre", detail.cost_center],
            ["Amount", inrFull(detail.total_amount)], ["Status", detail.status],
            ["Requester", detail.requester_name], ["Justification", detail.justification]]} />
          <h4 style={{ margin: "14px 0 8px" }}>Lines</h4>
          <DataTable columns={[
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty", num: true },
            { key: "uom", label: "UoM" },
            { key: "est_unit_price", label: "Unit ₹", num: true, render: (r) => inrFull(r.est_unit_price) },
          ]} rows={detail.lines} />
          <h4 style={{ margin: "14px 0 8px" }}>Approver panel</h4>
          {detail.approvals.length ? detail.approvals.map((a) => (
            <div key={a.id} className={`wstep ${a.status === "approved" || a.status === "auto_approved" ? "done" : a.status === "pending" ? "active" : ""}`}>
              <div className="wstep-n">{a.stage_no}</div>
              <div style={{ flex: 1 }}>
                <b style={{ textTransform: "uppercase", fontSize: 11 }}>{a.stage_role}</b>
                <span style={{ color: "var(--ink-500)", marginLeft: 8, fontSize: 11 }}>
                  {a.acted_name ? `${a.acted_name} · ${dtt(a.acted_at)}` : a.assigned_name || "—"}
                </span>
              </div>
              <Chip value={a.status} />
            </div>
          )) : <div className="empty">Not yet submitted</div>}
        </Modal>
      )}

      {showNew && (
        <Modal wide title="New purchase requisition" onClose={() => setShowNew(false)}
          footer={<button className="btn btn-pri" onClick={create}>Create draft</button>}>
          <div className="field"><label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="form-row-3">
            <div className="field"><label>Department</label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                {masters?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></div>
            <div className="field"><label>Category</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                {masters?.categories.filter((c) => c.department_id === form.department_id)
                  .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label>Branch</label>
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                {masters?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Cost centre</label>
              <input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} /></div>
            <div className="field"><label>Justification</label>
              <input value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></div>
          </div>
          <h4 style={{ margin: "6px 0 8px" }}>Lines</h4>
          {form.lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1.4fr", gap: 8, marginBottom: 8 }}>
              <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)}
                style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
              <input type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", +e.target.value)}
                style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
              <input placeholder="UoM" value={l.uom} onChange={(e) => setLine(i, "uom", e.target.value)}
                style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
              <input type="number" placeholder="Unit price ₹" value={l.est_unit_price} onChange={(e) => setLine(i, "est_unit_price", +e.target.value)}
                style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
            </div>
          ))}
          <button className="btn btn-gho btn-sm"
            onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { description: "", quantity: 1, uom: "NOS", est_unit_price: 0 }] }))}>
            + Add line
          </button>
          <div style={{ marginTop: 10, fontWeight: 700 }}>
            Estimated total: {inrFull(form.lines.reduce((s, l) => s + l.quantity * l.est_unit_price, 0))}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ============ RFQs ============ */
export function Rfqs() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/procurement/rfqs"), []);
  const [detail, setDetail] = useState(null);
  const [override, setOverride] = useState("");

  const open = async (r) => { setOverride(""); setDetail(await api.get(`/procurement/rfqs/${r.id}/detail`)); };
  const award = async (vendorId, isLowest) => {
    try {
      await api.post(`/procurement/rfqs/${detail.id}/award`,
        { vendor_id: vendorId, override_reason: isLowest ? null : override || null });
      toast(`Awarded to ${vendorId}`); setDetail(null); refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="RFQ & Quotation Comparison" sub="Side-by-side quotes · lowest highlighted · controlled override" />
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "RFQ", render: (r) => <span className="mono">{r.id}</span> },
          { key: "title", label: "Title" },
          { key: "requisition_title", label: "From PR" },
          { key: "quote_count", label: "Quotes", num: true },
          { key: "due_date", label: "Due", render: (r) => dt(r.due_date) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "awarded_vendor_name", label: "Awarded to" },
        ]} rows={data} onRow={open} />
      </Card>
      {detail && (
        <Modal wide title={`${detail.id} · ${detail.title}`} onClose={() => setDetail(null)}>
          <DataTable columns={[
            { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
            { key: "amount", label: "Quote", num: true, render: (r) => inrFull(r.amount) },
            { key: "delivery_days", label: "Delivery", render: (r) => `${r.delivery_days}d` },
            { key: "payment_terms", label: "Terms" },
            { key: "score", label: "Score", num: true },
            { key: "notes", label: "Notes" },
            { key: "_", label: "", render: (r, i) => detail.status !== "awarded" && (
              <button className="btn btn-grn btn-sm" onClick={(e) => { e.stopPropagation(); award(r.vendor_id, r.amount === Math.min(...detail.quotations.map(q => +q.amount))); }}>
                Award
              </button>) },
          ]} rows={detail.quotations} />
          {detail.status !== "awarded" && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Override reason (required when not awarding the lowest quote)</label>
              <input value={override} onChange={(e) => setOverride(e.target.value)}
                placeholder="e.g. incumbent reliability · delivery timeline critical" />
            </div>
          )}
          {detail.award_override_reason && (
            <div style={{ marginTop: 10, fontSize: 12 }}><b>Override on record:</b> {detail.award_override_reason}</div>
          )}
        </Modal>
      )}
    </>
  );
}

/* ============ Purchase Orders ============ */
export function PurchaseOrders() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/procurement/pos"), []);
  const [detail, setDetail] = useState(null);
  const [summary, setSummary] = useState(null);

  const open = async (r) => setDetail(await api.get(`/procurement/pos/${r.id}/detail`));
  const esign = async () => {
    try { const res = await api.post(`/procurement/pos/${detail.id}/esign`);
      toast(`Signed · ${res.reference} (Class-3 DSC)`); setDetail(null); refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Purchase Orders" sub="From RFQ award or independent path · e-Sign where agreement-based"
        actions={<button className="btn btn-gho" onClick={() => setSummary({ entity: "purchase_orders", filters: {}, title: "Purchase orders" })}>≡ Summary</button>} />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "PO", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
          { key: "department_name", label: "Dept" },
          { key: "amount", label: "Amount", num: true, render: (r) => inr(r.amount) },
          { key: "esign_status", label: "e-Sign", render: (r) => <Chip value={r.esign_status || "—"} /> },
          { key: "grn_count", label: "GRNs", num: true },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "issued_at", label: "Issued", render: (r) => dt(r.issued_at) },
        ]} rows={data} onRow={open} />
      </Card>
      {detail && (
        <Modal wide title={`${detail.id} · ${detail.vendor_name}`} onClose={() => setDetail(null)}
          footer={detail.esign_status === "pending" &&
            <button className="btn btn-blu" onClick={esign}>e-Sign now (Class-3 DSC)</button>}>
          <DetailGrid items={[["Amount", inrFull(detail.amount)], ["GST", inrFull(detail.gst_amount)],
            ["Agreement-based", detail.agreement_based ? "Yes" : "No"],
            ["e-Sign", detail.esign_ref || detail.esign_status], ["Status", detail.status]]} />
          <h4 style={{ margin: "14px 0 8px" }}>Lines</h4>
          <DataTable columns={[
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty", num: true },
            { key: "unit_price", label: "Unit ₹", num: true, render: (r) => inrFull(r.unit_price) },
            { key: "gst_rate", label: "GST %", num: true },
          ]} rows={detail.lines} />
          {detail.invoices?.length > 0 && (<>
            <h4 style={{ margin: "14px 0 8px" }}>Invoices against this PO</h4>
            <DataTable columns={[
              { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
              { key: "total_amount", label: "Amount", num: true, render: (r) => inrFull(r.total_amount) },
              { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
            ]} rows={detail.invoices} /></>)}
        </Modal>
      )}
    </>
  );
}

/* ============ GRNs ============ */
export function Grns() {
  const { data, loading } = useFetch(() => api.get("/procurement/grns"), []);
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Goods Receipt Notes" sub="Branch evidence capture · quantity reconciliation against PO" />
      <div className="kpi-row">
        <Kpi label="GRNs recorded" value={data.length} note="across branches" />
        <Kpi label="With evidence" value={data.filter((g) => g.evidence?.length).length} note="photos · challans · reports" />
        <Kpi label="Reconciled" value={data.filter((g) => g.status === "reconciled").length} note="qty matched to PO" noteClass="up" />
      </div>
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "GRN", render: (r) => <span className="mono">{r.id}</span> },
          { key: "po_id", label: "PO", render: (r) => <span className="mono">{r.po_id}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "branch_name", label: "Branch" },
          { key: "received_by_name", label: "Received by" },
          { key: "received_at", label: "Received", render: (r) => dt(r.received_at) },
          { key: "evidence", label: "Evidence", render: (r) => r.evidence?.length ? `${r.evidence.length} file(s)` : "—" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
        ]} rows={data} />
      </Card>
    </>
  );
}
