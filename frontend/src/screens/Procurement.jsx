import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading,
         inr, inrFull, dt, dtt, Kpi } from "../components/ui";
import SummaryModal from "../components/SummaryModal";
import { PROCUREMENT_CATEGORIES } from "../constants/procurementCategories";
import { RFQ_TERMS_MASTER } from "../constants/rfqTerms";

/* ============ Shared helpers ============ */
const APPROVER_ROLES = ["compliance", "admin"];
const isApprover = (role) => APPROVER_ROLES.includes(role);
const isProcurement = (role) => role === "procurement" || role === "admin";

const emptyLine = () => ({ description: "", quantity: 1, uom: "NOS", est_unit_price: 0 });

function lineTotal(l) { return (Number(l.quantity) || 0) * (Number(l.est_unit_price) || 0); }

function Timeline({ stages, current }) {
  const idx = stages.indexOf(current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "6px 0 16px", flexWrap: "wrap" }}>
      {stages.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "";
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div className={`wstep ${state}`} style={{ margin: 0, padding: "5px 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{s.replaceAll("_", " ")}</span>
            </div>
            {i < stages.length - 1 && <span style={{ color: "var(--ink-300)" }}>→</span>}
          </div>
        );
      })}
    </div>
  );
}

const PR_STAGES = ["draft", "pending_approval", "approved", "rfq_issued", "quotation_comparison", "po_created", "closed"];
const PR_STATUS_LABELS = {
  draft: "Draft",
  pending_approval: "Pending Compliance Review",
  sent_back: "Sent Back",
  approved: "Approved / Ready for Procurement",
  rfq_issued: "RFQ Issued",
  po_created: "PO Created",
  closed: "Closed",
  declined: "Declined",
};
const prStatusLabel = (status) => PR_STATUS_LABELS[status] || status;
const RFQ_STAGES = ["draft", "sent", "quotations_received", "finalized"];
const PO_STAGES = ["draft", "active", "awaiting_delivery", "goods_received"];
const GRN_STAGES = ["draft", "submitted", "fully_received"];

function prNextAction(r, role, myId) {
  switch (r.status) {
    case "draft": return (r.requester_id === myId || role === "admin") ? "Submit for approval" : "Draft";
    case "pending_approval": return isApprover(role) ? "Approve / Send back / Decline" : "Awaiting approval";
    case "sent_back": return (r.requester_id === myId || role === "admin") ? "Edit & resubmit" : "Sent back for edits";
    case "declined": return "Declined — no further action";
    case "approved": return isProcurement(role) ? "Create RFQ" : "Approved · awaiting RFQ";
    case "rfq_issued": return "RFQ in progress";
    case "quotation_comparison": return "Compare quotations";
    case "po_created": return "PO issued";
    case "closed": return "Completed";
    default: return "—";
  }
}
function rfqNextAction(r) {
  switch (r.status) {
    case "draft": return "Send RFQ";
    case "sent": return "Add quotations";
    case "quotations_received": return "Compare / Select winner";
    case "finalized": return "Create PO";
    case "cancelled": return "Cancelled";
    default: return "—";
  }
}
function poNextAction(p) {
  switch (p.status) {
    case "draft": case "pending_approval": return "Submit / Approve PO";
    case "active": return "Mark awaiting delivery / Create GRN";
    case "awaiting_delivery": return "Create GRN";
    case "goods_received": return "Goods received";
    case "closed": return "Closed";
    case "cancelled": return "Cancelled";
    default: return "—";
  }
}
function poType(p) {
  if (p.rfq_id) return "From RFQ";
  if (p.agreement_based) return "Agreement";
  return "Direct";
}
function poDeliveryStatus(p) {
  if (["draft", "pending_approval", "active"].includes(p.status)) return "Pending delivery";
  if (p.status === "awaiting_delivery") return "Awaiting delivery";
  if (p.status === "goods_received") return "Delivered";
  return "—";
}

/* ============ Requisition form (create + edit/resubmit) ============ */
function ReqFormModal({ mode, initial, requisitionId, masters, onClose, toast, onDone }) {
  const [form, setForm] = useState(initial);
  const procCats = (masters?.categories || []).filter((c) => c.is_procurement_category);

  const setLine = (i, k, v) => setForm((f) => {
    const lines = [...f.lines]; lines[i] = { ...lines[i], [k]: v }; return { ...f, lines };
  });
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const save = async () => {
    try {
      if (mode === "create") {
        const res = await api.post("/requisitions", form);
        toast(`Created ${res.id} · ${inrFull(res.total_amount)}`);
      } else {
        await api.put(`/requisitions/${requisitionId}`, form);
        toast("Saved. Resubmitting for approval…");
        await api.post(`/requisitions/${requisitionId}/submit`);
      }
      onDone(); onClose();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <Modal wide title={mode === "create" ? "New purchase requisition" : `Edit ${requisitionId} & resubmit`} onClose={onClose}
      footer={<button className="btn btn-pri" onClick={save}>{mode === "create" ? "Create draft" : "Save & resubmit"}</button>}>
      <div className="field"><label>Title</label>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div className="form-row-3">
        <div className="field"><label>Department</label>
          <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            {masters?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div className="field"><label>Category</label>
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">Select category</option>
            {PROCUREMENT_CATEGORIES.map((name) => {
              const c = procCats.find((pc) => pc.name === name);
              return c ? <option key={c.id} value={c.id}>{name}</option> : null;
            })}
          </select></div>
        <div className="field"><label>Branch</label>
          <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
            {masters?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="field"><label>Cost centre</label>
          <input value={form.cost_center || ""} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} /></div>
        <div className="field"><label>Justification</label>
          <input value={form.justification || ""} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></div>
      </div>
      <h4 style={{ margin: "6px 0 8px" }}>Lines</h4>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1.4fr 1.4fr 28px", gap: 8, marginBottom: 6, fontSize: 11, fontWeight: 700, color: "var(--ink-500)" }}>
        <div>Description</div><div>Qty</div><div>UoM</div><div>Est. rate ₹</div><div>Line total</div><div></div>
      </div>
      {form.lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1.4fr 1.4fr 28px", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)}
            style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
          <input type="number" min={0} placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", +e.target.value)}
            style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
          <input placeholder="UoM" value={l.uom} onChange={(e) => setLine(i, "uom", e.target.value)}
            style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
          <input type="number" min={0} placeholder="Rate ₹" value={l.est_unit_price} onChange={(e) => setLine(i, "est_unit_price", +e.target.value)}
            style={{ height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px" }} />
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{inrFull(lineTotal(l))}</div>
          <button className="btn btn-gho btn-sm" style={{ padding: "0 8px" }} disabled={form.lines.length === 1}
            onClick={() => removeLine(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn-gho btn-sm" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
        + Add line
      </button>
      <div style={{ marginTop: 10, fontWeight: 700 }}>
        Estimated total: {inrFull(form.lines.reduce((s, l) => s + lineTotal(l), 0))}
      </div>
    </Modal>
  );
}

/* ============ RFQ creation building blocks (Choose Source PR, off-system vendor) ============ */
function ChooseSourcePrModal({ onClose, onContinue }) {
  const { data: approved, loading } = useFetch(() => api.get("/requisitions", { status: "approved" }), []);
  const [prId, setPrId] = useState("");

  useEffect(() => {
    if (!prId && approved?.length) setPrId(approved[0].id);
  }, [approved]);

  return (
    <Modal title="Choose Source PR" onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-gho" onClick={onClose}>Cancel</button>
        <button className="btn btn-pri" disabled={!prId} onClick={() => onContinue(prId)}>Continue →</button>
      </div>}>
      <div style={{ color: "var(--ink-500)", fontSize: 12.5, marginBottom: 10 }}>RFQ will be linked to this PR</div>
      {loading ? <Loading /> : !approved?.length ? (
        <div className="empty">No approved PRs available. Approve a requisition first.</div>
      ) : (
        <div className="field"><label>Approved PR</label>
          <select value={prId} onChange={(e) => setPrId(e.target.value)}>
            {approved.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.title} · {inrFull(r.total_amount)}</option>)}
          </select>
        </div>
      )}
    </Modal>
  );
}

function AddOffSystemVendorModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const add = () => {
    if (!name.trim() || !email.trim() || !phone.trim()) return;
    onAdd({ name: name.trim(), email: email.trim(), phone: phone.trim() });
  };

  return (
    <Modal title="Add Off-System Vendor" onClose={onClose}
      footer={<button className="btn btn-pri" onClick={add}>Add to RFQ</button>}>
      <div style={{ color: "var(--ink-500)", fontSize: 12.5, marginBottom: 12 }}>
        For RFQ only · full onboarding required before any PO is issued.
      </div>
      <div className="field"><label>Vendor name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-row">
        <div className="field"><label>Email *</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>Mobile *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
        This vendor will only receive the RFQ. Full onboarding (KYC, GST, bank, MSME) is mandatory before any PO is issued.
      </div>
    </Modal>
  );
}

/* ============ Requisitions ============ */
export function Requisitions() {
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState("");
  const { data, loading, refresh } = useFetch(() => api.get("/requisitions", categoryFilter ? { category_id: categoryFilter } : undefined), [categoryFilter]);
  const { data: masters } = useFetch(() => api.get("/vendors/masters/reference"), []);
  const [detail, setDetail] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState("");
  const [summary, setSummary] = useState(null);

  const procCats = (masters?.categories || []).filter((c) => c.is_procurement_category);

  const openDetail = async (r) => setDetail(await api.get(`/requisitions/${r.id}/detail`));
  const refreshDetail = async () => detail && setDetail(await api.get(`/requisitions/${detail.id}/detail`));

  const submit = async (id) => {
    try { await api.post(`/requisitions/${id}/submit`);
      toast("Submitted for approval");
      refreshDetail(); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const decide = async (action) => {
    if (action !== "approve" && !comments.trim()) {
      return toast(`A remark is required to ${action.replace("-", " ")} a PR`, true);
    }
    try {
      await api.post(`/requisitions/${detail.id}/${action}`, { comments });
      toast(`PR ${action.replace("-", " ")}d`); setComments("");
      refreshDetail(); refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Purchase Requisitions" sub="Raise · route · track — with live approver panel"
        actions={<>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ height: 32, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 10px", fontSize: 12.5 }}>
            <option value="">All categories</option>
            {PROCUREMENT_CATEGORIES.map((name) => {
              const c = procCats.find((pc) => pc.name === name);
              return c ? <option key={c.id} value={c.id}>{name}</option> : null;
            })}
          </select>
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
            { key: "status", label: "Status", render: (r) => <Chip value={r.status} label={prStatusLabel(r.status)} /> },
            { key: "next", label: "Next action", render: (r) => {
              if (r.status === "draft" && (r.requester_id === user.id || user.role === "admin")) {
                return <button className="btn btn-pri btn-sm" onClick={(e) => { e.stopPropagation(); submit(r.id); }}>
                  Submit for approval
                </button>;
              }
              return <span style={{ fontSize: 12 }}>{prNextAction(r, user.role, user.id)}</span>;
            } },
          ]}
          rows={data} onRow={openDetail} />
      </Card>

      {detail && (
        <Modal wide title={`${detail.id} · ${detail.title}`} onClose={() => setDetail(null)}
          footer={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {detail.status === "draft" && (detail.requester_id === user.id || user.role === "admin") &&
              <button className="btn btn-pri" onClick={() => submit(detail.id)}>Submit for approval</button>}
            {detail.status === "sent_back" && (detail.requester_id === user.id || user.role === "admin") &&
              <button className="btn btn-pri" onClick={() => setEditing(true)}>Edit & resubmit</button>}
            {detail.status === "approved" && isProcurement(user.role) &&
              <button className="btn btn-pri" onClick={() => navigate("/rfqs", { state: { createFromPrId: detail.id } })}>Create RFQ</button>}
          </div>}>
          <Timeline stages={PR_STAGES} current={detail.status} />
          <DetailGrid items={[["Department", detail.department_name], ["Category", detail.category_name],
            ["Branch", detail.branch_name], ["Cost centre", detail.cost_center],
            ["Amount", inrFull(detail.total_amount)], ["Status", prStatusLabel(detail.status)],
            ["Requester", detail.requester_name], ["Justification", detail.justification]]} />
          <h4 style={{ margin: "14px 0 8px" }}>Lines</h4>
          <DataTable columns={[
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty", num: true },
            { key: "uom", label: "UoM" },
            { key: "est_unit_price", label: "Unit ₹", num: true, render: (r) => inrFull(r.est_unit_price) },
            { key: "total", label: "Line total", num: true, render: (r) => inrFull(r.quantity * r.est_unit_price) },
          ]} rows={detail.lines} />

          {detail.status === "pending_approval" && isApprover(user.role) && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
              <div className="field"><label>Comments (required for Send Back / Decline)</label>
                <textarea value={comments} onChange={(e) => setComments(e.target.value)} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-grn btn-sm" onClick={() => decide("approve")}>Approve</button>
                <button className="btn btn-gho btn-sm" onClick={() => decide("send-back")}>Send Back</button>
                <button className="btn btn-red btn-sm" onClick={() => decide("decline")}>Decline</button>
              </div>
            </div>
          )}

          {(detail.rfqs?.length > 0 || detail.purchase_orders?.length > 0) && (
            <div style={{ marginTop: 14, fontSize: 12.5 }}>
              {detail.rfqs?.length > 0 && <div><b>RFQ(s):</b> {detail.rfqs.map((r) => `${r.id} (${r.status})`).join(", ")}</div>}
              {detail.purchase_orders?.length > 0 && <div><b>PO(s):</b> {detail.purchase_orders.map((p) => `${p.id} (${p.status})`).join(", ")}</div>}
            </div>
          )}

          {detail.approvals.length > 0 && (
            <>
              <h4 style={{ margin: "14px 0 8px" }}>Approver panel</h4>
              {detail.approvals.map((a) => (
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
              ))}
            </>
          )}
        </Modal>
      )}

      {editing && detail && (
        <ReqFormModal mode="edit" requisitionId={detail.id} masters={masters} toast={toast}
          initial={{
            title: detail.title, department_id: detail.department_id, category_id: detail.category_id,
            branch_id: detail.branch_id, cost_center: detail.cost_center, justification: detail.justification,
            lines: detail.lines.map((l) => ({ description: l.description, quantity: l.quantity, uom: l.uom, est_unit_price: l.est_unit_price })),
          }}
          onClose={() => setEditing(false)}
          onDone={() => { refreshDetail(); refresh(); }} />
      )}

      {showNew && (
        <ReqFormModal mode="create" masters={masters} toast={toast}
          initial={{ title: "", department_id: masters?.departments?.[0]?.id || "IT", category_id: "",
            branch_id: masters?.branches?.[0]?.id || "BR-HO", cost_center: "", justification: "", lines: [emptyLine()] }}
          onClose={() => setShowNew(false)} onDone={refresh} />
      )}
    </>
  );
}

/* ============ Manual quotation entry ============ */
const PAYMENT_TERMS_OPTIONS = ["30 days", "45 days", "Net 60 days", "Advance"];

function ManualQuoteForm({ invited, totalQty, onAdd, onCancel }) {
  const [vendorId, setVendorId] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [deliveryDays, setDeliveryDays] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(PAYMENT_TERMS_OPTIONS[0]);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!vendorId || !unitPrice) return;
    const gst = +gstRate || 18;
    const amount = Math.round(+unitPrice * (totalQty || 1) * (1 + gst / 100) * 100) / 100;
    setSaving(true);
    try {
      await onAdd({
        vendor_id: vendorId, amount, gst_rate: gst,
        delivery_days: deliveryDays ? +deliveryDays : null,
        payment_terms: paymentTerms || null,
        notes: quoteRef ? `Quote ref: ${quoteRef}` : null,
      }, file);
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Enter Manual Quotation" onClose={onCancel}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-gho" onClick={onCancel}>Cancel</button>
        <button className="btn btn-pri" disabled={!vendorId || !unitPrice || saving} onClick={save}>
          {saving ? "Saving…" : "Save Quotation"}
        </button>
      </div>}>
      <div style={{ color: "var(--ink-500)", fontSize: 12.5, marginBottom: 14 }}>
        For vendors who replied via email or hand-delivered quote
      </div>
      <div className="form-row">
        <div className="field"><label>Vendor</label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {invited.filter((v) => !v.is_off_system).map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
          </select></div>
        <div className="field"><label>Quote reference (optional)</label>
          <input placeholder="QT-VENDOR-XXXX" value={quoteRef} onChange={(e) => setQuoteRef(e.target.value)} /></div>
      </div>
      <div className="form-row-3">
        <div className="field"><label>Unit price (₹)</label>
          <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
        <div className="field"><label>GST %</label>
          <input type="number" min={0} value={gstRate} onChange={(e) => setGstRate(e.target.value)} /></div>
        <div className="field"><label>Delivery (days)</label>
          <input type="number" min={0} value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="field"><label>Payment terms</label>
          <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
            {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></div>
        <div className="field"><label>Signed quotation file</label>
          <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
      </div>
    </Modal>
  );
}

/* ============ Create RFQ page (vendors + T&C + schedule/message) ============ */
function CreateRfqPage({ pr, onCancel, onSent, toast }) {
  const { data: match } = useFetch(() => api.get(`/procurement/vendors-for-requisition/${pr.id}`), [pr.id]);
  const { data: allVendors } = useFetch(() => api.get("/vendors"), []);
  const [selected, setSelected] = useState(new Set());
  const [browseAll, setBrowseAll] = useState(false);
  const [offSystem, setOffSystem] = useState([]);
  const [showOffModal, setShowOffModal] = useState(false);
  const [selectedTerms, setSelectedTerms] = useState(new Set());
  const [dueDate, setDueDate] = useState("");
  const [cutoffTime, setCutoffTime] = useState("17:00");
  const [message, setMessage] = useState("Please review the specifications and submit your best quotation before the deadline.");
  const [sending, setSending] = useState(false);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTerm = (t) => setSelectedTerms((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const matchedIds = new Set((match?.vendors || []).map((v) => v.vendor_id));
  const vendorsSelectedCount = selected.size + offSystem.length;
  const sizeLabel = (m) => (m ? m[0].toUpperCase() + m.slice(1) : null);

  const send = async () => {
    if (vendorsSelectedCount === 0) return toast("Select at least one vendor", true);
    setSending(true);
    try {
      const res = await api.post("/procurement/rfqs", {
        requisition_id: pr.id, vendor_ids: [...selected], off_system_vendors: offSystem,
        due_date: dueDate || null, cutoff_time: cutoffTime || null,
        terms: [...selectedTerms].join("\n"), message,
      });
      await api.post(`/procurement/rfqs/${res.id}/send`);
      toast(`RFQ ${res.id} sent to ${vendorsSelectedCount} vendor${vendorsSelectedCount === 1 ? "" : "s"}`);
      onSent(res.id);
    } catch (e) { toast(e.message, true); setSending(false); }
  };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 4 }}>
        RFQ & Quotations / Create
      </div>
      <PageHead title="Request for Quotation" sub={`For PR ${pr.id} · ${pr.title} · ${inrFull(pr.total_amount)}`}
        actions={<>
          <button className="btn btn-gho" onClick={onCancel}>Cancel</button>
          <button className="btn btn-pri" disabled={sending} onClick={send}>
            {sending ? "Sending…" : `Send RFQ to ${vendorsSelectedCount} Vendor${vendorsSelectedCount === 1 ? "" : "s"} →`}
          </button>
        </>} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          <Card title="1 · Select Vendors for Quotation" sub={`Onboarded vendors matching category: ${pr.category_name}`}
            actions={<button className="btn btn-gho btn-sm" onClick={() => setShowOffModal(true)}>+ Add vendor not in system</button>}>
            {match?.no_match ? (
              <div className="empty" style={{ padding: "14px 0" }}>
                No matching active vendor found for <b>{pr.category_name}</b>. Add an off-system vendor,
                browse all vendors below, or send an onboarding link from the Vendors page.
              </div>
            ) : (
              (match?.vendors || []).map((v) => (
                <label key={v.vendor_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
                  <input type="checkbox" checked={selected.has(v.vendor_id)} onChange={() => toggle(v.vendor_id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{v.vendor_name}</div>
                    <div style={{ color: "var(--ink-500)", fontSize: 11 }}>{v.contact_email || "—"} · {v.product_name}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 12 }}>{inr(v.spend_ytd)}</div>
                    <div style={{ fontSize: 10, color: "var(--ink-500)" }}>YTD spend</div>
                  </div>
                  {v.msme_category && <Chip value="msme_priority" label={sizeLabel(v.msme_category)} />}
                </label>
              ))
            )}

            <button className="btn btn-gho btn-sm" style={{ marginTop: 10 }} onClick={() => setBrowseAll((b) => !b)}>
              {browseAll ? "Hide" : "Browse all active vendors (select manually)"}
            </button>
            {browseAll && (
              <div style={{ maxHeight: 200, overflow: "auto", marginTop: 8, border: "1px solid var(--hairline)", borderRadius: 8, padding: "6px 10px" }}>
                {(allVendors || []).filter((v) => !matchedIds.has(v.id)).map((v) => (
                  <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                    <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                    <span>{v.name}</span>
                    <span style={{ color: "var(--ink-500)", fontSize: 11 }}>{v.category_name || "—"}</span>
                  </label>
                ))}
              </div>
            )}

            {offSystem.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {offSystem.map((o, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{o.name} <span style={{ color: "var(--ink-500)" }}>{o.email}</span></span>
                    <Chip value="offsystem" label="Off-system" />
                    <button className="btn btn-gho btn-sm" onClick={() => setOffSystem((arr) => arr.filter((_, idx) => idx !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div style={{ height: 14 }} />

          <Card title="2 · Terms & Conditions" sub="Pick from master (multi-select)">
            <div style={{ maxHeight: 220, overflow: "auto" }}>
              {RFQ_TERMS_MASTER.map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", fontSize: 13 }}>
                  <input type="checkbox" checked={selectedTerms.has(t)} onChange={() => toggleTerm(t)} style={{ marginTop: 2 }} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 8 }}>
              {selectedTerms.size} term{selectedTerms.size === 1 ? "" : "s"} selected · vendor can also attach their own T&C
            </div>
          </Card>

          <div style={{ height: 14 }} />

          <Card title="3 · Schedule & Message">
            <div className="form-row">
              <div className="field"><label>Last date for quotations</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div className="field"><label>Cut-off time</label>
                <input type="time" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} /></div>
            </div>
            <div className="field"><label>Message to vendors</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} /></div>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#1e40af" }}>
              The RFQ will be emailed to each selected vendor (on-system contact + off-system) with the deadline and your message.
            </div>
          </Card>
        </div>

        <div style={{ position: "sticky", top: 12 }}>
          <Card title="Items in this RFQ">
            {pr.lines.map((l) => (
              <div key={l.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{l.description}</div>
                <div style={{ color: "var(--ink-500)", fontSize: 11 }}>Qty {l.quantity} {l.uom} · Est. {inrFull(l.quantity * l.est_unit_price)}</div>
              </div>
            ))}
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>Estimated Value</span><span>{inrFull(pr.total_amount)}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 4 }}>
              Vendors will quote against these specs · cannot be modified post-send
            </div>
          </Card>
          <div style={{ height: 14 }} />
          <Card title="RFQ Status Preview">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip value="pending" label={`${vendorsSelectedCount} vendor${vendorsSelectedCount === 1 ? "" : "s"} selected`} />
              <Chip value="pending" label={`${selectedTerms.size} T&C`} />
            </div>
          </Card>
        </div>
      </div>

      {showOffModal && (
        <AddOffSystemVendorModal onClose={() => setShowOffModal(false)}
          onAdd={(v) => { setOffSystem((arr) => [...arr, v]); setShowOffModal(false); }} />
      )}
    </>
  );
}

/* ============ Quotation comparison page (simulate replies, compare, finalize + create PO) ============ */
function ComparisonPage({ rfqId, onBack, toast, refreshList, navigate }) {
  const [detail, setDetail] = useState(null);
  const [winner, setWinner] = useState("");
  const [override, setOverride] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => setDetail(await api.get(`/procurement/rfqs/${rfqId}/detail`));
  useEffect(() => { load(); }, [rfqId]);

  if (!detail) return <Loading />;

  const totalQty = detail.lines.reduce((s, l) => s + Number(l.quantity), 0) || 1;
  const quotes = detail.quotations || [];
  const lowestVendorId = quotes.find((q) => q.recommended)?.vendor_id;

  const send = async () => {
    try { await api.post(`/procurement/rfqs/${rfqId}/send`); toast("RFQ sent"); load(); refreshList(); }
    catch (e) { toast(e.message, true); }
  };
  const addQuote = async (body, file) => {
    try {
      await api.post(`/procurement/rfqs/${rfqId}/quotations`, body);
      if (file) {
        const fd = new FormData(); fd.append("file", file);
        await api.postForm(`/procurement/rfqs/${rfqId}/quotations/${body.vendor_id}/document`, fd);
      }
      toast("Quotation added"); setShowManual(false); load(); refreshList();
    } catch (e) { toast(e.message, true); }
  };
  const simulate = async () => {
    try {
      const res = await api.post(`/procurement/rfqs/${rfqId}/simulate-quotations`);
      toast(`${res.simulated_vendor_ids.length} vendor repl${res.simulated_vendor_ids.length === 1 ? "y" : "ies"} simulated`);
      load(); refreshList();
    } catch (e) { toast(e.message, true); }
  };
  const cancel = async () => {
    try { await api.post(`/procurement/rfqs/${rfqId}/cancel`, { reason: "Cancelled by procurement" }); toast("RFQ cancelled"); load(); refreshList(); }
    catch (e) { toast(e.message, true); }
  };
  const uploadDoc = async (vendorId, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { await api.postForm(`/procurement/rfqs/${rfqId}/quotations/${vendorId}/document`, fd); toast("Document attached"); load(); }
    catch (e) { toast(e.message, true); }
  };
  const finalizeAndCreatePo = async () => {
    if (!winner) return toast("Pick a vendor first", true);
    setBusy(true);
    try {
      await api.post(`/procurement/rfqs/${rfqId}/finalize`, { vendor_id: winner, override_reason: override || null });
      const po = await api.post("/procurement/pos", { rfq_id: rfqId });
      toast(`PO ${po.id} created as draft · ${inrFull(po.amount)}`);
      refreshList(); navigate("/purchase-orders", { state: { reviewPoId: po.id } });
    } catch (e) { toast(e.message, true); setBusy(false); }
  };
  const createPoOnly = async () => {
    setBusy(true);
    try {
      const po = await api.post("/procurement/pos", { rfq_id: rfqId });
      toast(`PO ${po.id} created as draft · ${inrFull(po.amount)}`);
      refreshList(); navigate("/purchase-orders", { state: { reviewPoId: po.id } });
    } catch (e) { toast(e.message, true); setBusy(false); }
  };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 4 }}>
        RFQ & Quotations / {detail.id}
      </div>
      <PageHead title="Quotation Comparison"
        sub={`${detail.title} · linked to ${detail.requisition_id} · Deadline ${dt(detail.due_date)}`}
        actions={<>
          <button className="btn btn-gho" onClick={onBack}>← Back to list</button>
          {["draft", "sent", "quotations_received"].includes(detail.status) &&
            <button className="btn btn-gho" onClick={cancel}>Cancel RFQ</button>}
          {quotes.length > 0 && detail.status !== "cancelled" &&
            <button className="btn btn-gho" onClick={() => setShowManual(true)}>+ Manual Quote</button>}
          {detail.status === "quotations_received" && (
            <button className="btn btn-pri" disabled={!winner || busy} onClick={finalizeAndCreatePo}>
              {busy ? "Finalizing…" : "Finalize & Create PO →"}
            </button>
          )}
          {detail.status === "finalized" && !detail.pos?.length && (
            <button className="btn btn-pri" disabled={busy} onClick={createPoOnly}>
              {busy ? "Creating…" : "Create PO →"}
            </button>
          )}
        </>} />

      {detail.status === "draft" && (
        <Card>
          <div className="empty">This RFQ hasn't been sent yet.</div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button className="btn btn-pri" onClick={send}>Send RFQ</button>
          </div>
        </Card>
      )}

      {detail.status === "cancelled" && <Card><div className="empty">This RFQ was cancelled.</div></Card>}

      {["sent", "quotations_received", "finalized"].includes(detail.status) && quotes.length === 0 && (
        <Card>
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Awaiting vendor responses</div>
            <div style={{ color: "var(--ink-500)", fontSize: 13, marginBottom: 18, maxWidth: 480, margin: "0 auto 18px" }}>
              {detail.invited_vendors.length} vendor(s) received the RFQ. They can respond via the secure form,
              attach a signed quotation, or you can enter a bid manually for vendors who reply offline.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn btn-gho" onClick={() => setShowManual(true)}>Enter Manual Quote</button>
              <button className="btn btn-pri" onClick={simulate}>Simulate Vendor Replies</button>
            </div>
          </div>
        </Card>
      )}

      {showManual && (
        <ManualQuoteForm invited={detail.invited_vendors} totalQty={totalQty} onAdd={addQuote} onCancel={() => setShowManual(false)} />
      )}

      {quotes.length > 0 && (
        <Card pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Criterion</th>
                  {quotes.map((q) => (
                    <th key={q.vendor_id}>
                      {q.vendor_name}{q.recommended && <span style={{ color: "var(--green-600)", marginLeft: 6 }}>★ Lowest</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr><td>Quote ID</td>{quotes.map((q) => <td key={q.vendor_id} className="mono">{q.quote_code}</td>)}</tr>
                <tr><td>Unit price (₹)</td>{quotes.map((q) => <td key={q.vendor_id}>{inrFull(q.unit_price)}</td>)}</tr>
                <tr><td>Quantity quoted</td>{quotes.map((q) => <td key={q.vendor_id}>{totalQty}</td>)}</tr>
                <tr><td>GST rate</td>{quotes.map((q) => <td key={q.vendor_id}>{q.gst_rate}%</td>)}</tr>
                <tr><td>Total (incl. GST)</td>{quotes.map((q) => <td key={q.vendor_id} style={{ fontWeight: 700 }}>{inrFull(q.amount)}</td>)}</tr>
                <tr><td>Payment terms</td>{quotes.map((q) => <td key={q.vendor_id}>{q.payment_terms || "—"}</td>)}</tr>
                <tr><td>Delivery time</td>{quotes.map((q) => <td key={q.vendor_id}>{q.delivery_days ? `${q.delivery_days} days` : "—"}</td>)}</tr>
                <tr><td>Received on</td>{quotes.map((q) => <td key={q.vendor_id}>{dt(q.received_at)}</td>)}</tr>
                <tr><td>Signed quote</td>{quotes.map((q) => (
                  <td key={q.vendor_id}>
                    {q.documents?.length ? q.documents.map((d) => (
                      <div key={d.id}><a href={api.downloadUrl(`/procurement/quotations/documents/${d.id}`)} target="_blank" rel="noreferrer">📎 {d.filename}</a></div>
                    )) : (
                      <label style={{ cursor: "pointer", color: "var(--blue-700)", fontSize: 12 }}>
                        + Attach
                        <input type="file" style={{ display: "none" }} onChange={(e) => uploadDoc(q.vendor_id, e.target.files[0])} />
                      </label>
                    )}
                  </td>
                ))}</tr>
                <tr><td>Vendor status</td>{quotes.map((q) => (
                  <td key={q.vendor_id}>
                    {q.msme_category && <Chip value="msme_priority" label={q.msme_category[0].toUpperCase() + q.msme_category.slice(1)} />}
                    {" "}{q.tier && <Chip value="approved" label={q.tier} />}
                  </td>
                ))}</tr>
                <tr><td>Selection</td>{quotes.map((q) => (
                  <td key={q.vendor_id}>
                    {detail.status === "finalized"
                      ? (detail.awarded_vendor_id === q.vendor_id ? <Chip value="approved" label="Selected" /> : null)
                      : winner === q.vendor_id
                        ? <Chip value="approved" label="Selected" />
                        : <button className="btn btn-gho btn-sm" onClick={() => { setWinner(q.vendor_id); setOverride(""); }}>Pick this</button>}
                  </td>
                ))}</tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {winner && winner !== lowestVendorId && detail.status === "quotations_received" && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Override reason (required — not the lowest quote)</label>
          <input value={override} onChange={(e) => setOverride(e.target.value)} />
        </div>
      )}
      {detail.award_override_reason && (
        <div style={{ marginTop: 10, fontSize: 12 }}><b>Override on record:</b> {detail.award_override_reason}</div>
      )}

      {detail.last_purchase && (
        <>
          <div style={{ height: 14 }} />
          <Card title="Last Purchase Reference">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <div><div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase" }}>Last vendor</div>
                <div style={{ fontWeight: 600 }}>{detail.last_purchase.vendor_name}</div></div>
              <div><div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase" }}>Last rate</div>
                <div style={{ fontWeight: 600 }}>{inrFull(detail.last_purchase.rate)}</div></div>
              <div><div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase" }}>Last procured</div>
                <div style={{ fontWeight: 600 }}>{dt(detail.last_purchase.procured_at)}</div></div>
              <div><div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase" }}>Best quote vs last</div>
                <div style={{ fontWeight: 700, color: (detail.last_purchase.best_vs_last_pct ?? 0) <= 0 ? "var(--green-600)" : "var(--red-600)" }}>
                  {detail.last_purchase.best_vs_last_pct != null
                    ? `${detail.last_purchase.best_vs_last_pct > 0 ? "▲" : "▼"} ${Math.abs(detail.last_purchase.best_vs_last_pct)}%`
                    : "—"}
                </div></div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ============ RFQs ============ */
export function Rfqs() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refresh } = useFetch(() => api.get("/procurement/rfqs"), []);
  const [view, setView] = useState("list"); // list | choose-pr | create | compare
  const [chosenPr, setChosenPr] = useState(null);
  const [activeRfqId, setActiveRfqId] = useState(null);
  const consumedNavState = useRef(false);

  useEffect(() => {
    if (!consumedNavState.current && location.state?.createFromPrId) {
      consumedNavState.current = true;
      api.get(`/requisitions/${location.state.createFromPrId}/detail`).then((pr) => {
        setChosenPr(pr); setView("create");
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  const openRow = (r) => { setActiveRfqId(r.id); setView("compare"); };

  if (view === "create" && chosenPr) {
    return <CreateRfqPage pr={chosenPr} toast={toast}
      onCancel={() => { setChosenPr(null); setView("list"); }}
      onSent={(rfqId) => { setChosenPr(null); setActiveRfqId(rfqId); setView("compare"); refresh(); }} />;
  }
  if (view === "compare" && activeRfqId) {
    return <ComparisonPage rfqId={activeRfqId} toast={toast} navigate={navigate}
      onBack={() => { setActiveRfqId(null); setView("list"); refresh(); }}
      refreshList={refresh} />;
  }

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="RFQ & Quotation Comparison" sub="Auto-matched vendors · side-by-side quotes · controlled override"
        actions={<button className="btn btn-pri" onClick={() => setView("choose-pr")}>+ New RFQ</button>} />
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "RFQ", render: (r) => <span className="mono">{r.id}</span> },
          { key: "requisition_id", label: "PR", render: (r) => <span className="mono">{r.requisition_id || "—"}</span> },
          { key: "requisition_title", label: "PR title" },
          { key: "category_name", label: "Category" },
          { key: "vendors_invited", label: "Vendors invited", num: true },
          { key: "due_date", label: "Deadline", render: (r) => dt(r.due_date) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "next", label: "Next action", render: (r) => <span style={{ fontSize: 12 }}>{rfqNextAction(r)}</span> },
        ]} rows={data} onRow={openRow} />
      </Card>

      {view === "choose-pr" && (
        <ChooseSourcePrModal onClose={() => setView("list")}
          onContinue={async (prId) => { const pr = await api.get(`/requisitions/${prId}/detail`); setChosenPr(pr); setView("create"); }} />
      )}
    </>
  );
}

/* ============ Create PO building blocks (from RFQ, or independent) ============ */
function CreatePoFromRfqModal({ onClose, onContinue }) {
  const { data: rfqs, loading } = useFetch(() => api.get("/procurement/rfqs"), []);
  const finalizedNoPo = (rfqs || []).filter((r) => r.status === "finalized" && !r.po_count);
  const [rfqId, setRfqId] = useState("");

  useEffect(() => {
    if (!rfqId && finalizedNoPo.length) setRfqId(finalizedNoPo[0].id);
  }, [rfqs]);

  return (
    <Modal title="Create PO from RFQ" onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-gho" onClick={onClose}>Cancel</button>
        <button className="btn btn-pri" disabled={!rfqId} onClick={() => onContinue(rfqId)}>Continue →</button>
      </div>}>
      <div style={{ color: "var(--ink-500)", fontSize: 12.5, marginBottom: 10 }}>Select a finalized RFQ to issue a PO</div>
      {loading ? <Loading /> : !finalizedNoPo.length ? (
        <div className="empty">No finalized RFQs are waiting on a PO.</div>
      ) : (
        <div className="field"><label>Finalized RFQ</label>
          <select value={rfqId} onChange={(e) => setRfqId(e.target.value)}>
            {finalizedNoPo.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.requisition_title} · {r.awarded_vendor_name}</option>)}
          </select>
        </div>
      )}
    </Modal>
  );
}

function NewIndependentPoModal({ onClose, onCreated, toast }) {
  const { data: masters } = useFetch(() => api.get("/vendors/masters/reference"), []);
  const { data: vendors } = useFetch(() => api.get("/vendors"), []);
  const [vendorId, setVendorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30 days credit");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: 1, uom: "NOS", unit_price: 0, gst_rate: 18 }]);
  const [creating, setCreating] = useState(false);
  const inputStyle = { height: 34, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: "0 8px" };

  useEffect(() => {
    if (masters) {
      if (!departmentId) setDepartmentId(masters.departments?.[0]?.id || "");
      if (!branchId) setBranchId(masters.branches?.[0]?.id || "");
    }
  }, [masters]);

  const setLine = (i, k, v) => setLines((arr) => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const total = lines.reduce((s, l) => s + (+l.quantity || 0) * (+l.unit_price || 0) * (1 + (+l.gst_rate || 0) / 100), 0);
  const procCats = (masters?.categories || []).filter((c) => c.is_procurement_category);

  const create = async () => {
    if (!vendorId || lines.some((l) => !l.description)) return toast("Vendor and every line description are required", true);
    setCreating(true);
    try {
      const po = await api.post("/procurement/pos", {
        vendor_id: vendorId, department_id: departmentId, category_id: categoryId || null, branch_id: branchId,
        payment_terms: paymentTerms, delivery_terms: deliveryTerms, notes,
        lines: lines.map((l) => ({ ...l, quantity: +l.quantity, unit_price: +l.unit_price, gst_rate: +l.gst_rate })),
      });
      toast(`${po.id} created as draft · ${inrFull(po.amount)}`);
      onCreated(po.id);
    } catch (e) { toast(e.message, true); setCreating(false); }
  };

  return (
    <Modal wide title="New Independent PO" onClose={onClose}
      footer={<button className="btn btn-pri" disabled={creating} onClick={create}>{creating ? "Creating…" : "Create draft"}</button>}>
      <div className="field"><label>Vendor</label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Select vendor…</option>
          {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></div>
      <div className="form-row-3">
        <div className="field"><label>Department</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {masters?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div className="field"><label>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {procCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="field"><label>Branch</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {masters?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
      </div>
      <h4 style={{ margin: "10px 0 8px" }}>Lines</h4>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2.4fr 0.8fr 0.8fr 1fr 0.8fr 24px", gap: 6, marginBottom: 6 }}>
          <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} style={inputStyle} />
          <input placeholder="UoM" value={l.uom} onChange={(e) => setLine(i, "uom", e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Unit ₹" value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} style={inputStyle} />
          <input type="number" placeholder="GST %" value={l.gst_rate} onChange={(e) => setLine(i, "gst_rate", e.target.value)} style={inputStyle} />
          <button className="btn btn-gho btn-sm" disabled={lines.length === 1}
            onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="btn btn-gho btn-sm"
        onClick={() => setLines((arr) => [...arr, { description: "", quantity: 1, uom: "NOS", unit_price: 0, gst_rate: 18 }])}>
        + Add line
      </button>
      <div className="form-row" style={{ marginTop: 12 }}>
        <div className="field"><label>Payment terms</label>
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></div>
        <div className="field"><label>Delivery terms</label>
          <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} /></div>
      </div>
      <div className="field"><label>Notes / special instructions</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div style={{ fontWeight: 700, marginTop: 6 }}>Estimated total: {inrFull(total)}</div>
    </Modal>
  );
}

/* ============ PO review page (draft PO → edit qty/terms → Issue PO) ============ */
function PoReviewPage({ poId, onCancel, onIssued, toast }) {
  const [po, setPo] = useState(null);
  const [lineEdits, setLineEdits] = useState({});
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [issuing, setIssuing] = useState(false);

  const load = async () => {
    const d = await api.get(`/procurement/pos/${poId}/detail`);
    setPo(d); setPaymentTerms(d.payment_terms || ""); setDeliveryTerms(d.delivery_terms || ""); setNotes(d.notes || "");
  };
  useEffect(() => { load(); }, [poId]);

  if (!po) return <Loading />;

  const qty = (line) => lineEdits[line.id] ?? line.quantity;
  const lineTotal = (line) => qty(line) * line.unit_price * (1 + line.gst_rate / 100);
  const grandTotal = po.lines.reduce((s, l) => s + lineTotal(l), 0);

  const issue = async () => {
    setIssuing(true);
    try {
      const changedLines = po.lines
        .filter((l) => lineEdits[l.id] != null && +lineEdits[l.id] !== l.quantity)
        .map((l) => ({ id: l.id, quantity: +lineEdits[l.id] }));
      await api.put(`/procurement/pos/${poId}`, {
        lines: changedLines.length ? changedLines : undefined,
        payment_terms: paymentTerms, delivery_terms: deliveryTerms, notes,
      });
      await api.post(`/procurement/pos/${poId}/approve`);
      toast(`${poId} issued`);
      onIssued(poId);
    } catch (e) { toast(e.message, true); setIssuing(false); }
  };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 4 }}>
        Purchase Orders / {po.rfq_id ? "Create from RFQ" : "Create"}
      </div>
      <PageHead title="New Purchase Order"
        sub={po.rfq_id ? `From ${po.rfq_id} · Winner: ${po.vendor_name}` : `Independent PO · ${po.vendor_name}`}
        actions={<>
          <button className="btn btn-gho" onClick={onCancel}>Cancel</button>
          <button className="btn btn-pri" disabled={issuing} onClick={issue}>{issuing ? "Issuing…" : "Issue PO →"}</button>
        </>} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          <Card title="Vendor & Reference">
            <DetailGrid items={[["Vendor", po.vendor_name], ["Source PR", po.requisition_id || "—"], ["Source RFQ", po.rfq_id || "—"]]} />
          </Card>
          <div style={{ height: 14 }} />
          <Card title={po.rfq_id ? "Items (locked from quotation)" : "Items"}
            sub={po.rfq_id ? "Quantity can only be decreased from the quoted amount" : ""}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Product</th><th>UoM</th><th>Qty</th><th>Unit price</th><th>GST %</th><th>Total</th></tr></thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{l.uom}</td>
                      <td><input type="number" min={0.01} max={l.quantity} step="0.01" value={qty(l)}
                        onChange={(e) => setLineEdits((m) => ({ ...m, [l.id]: e.target.value }))}
                        style={{ width: 70, height: 30, border: "1px solid var(--hairline-strong)", borderRadius: 6, padding: "0 6px" }} /></td>
                      <td>{inrFull(l.unit_price)}</td>
                      <td>{l.gst_rate}%</td>
                      <td style={{ fontWeight: 600 }}>{inrFull(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ textAlign: "right", marginTop: 10, fontWeight: 700 }}>Total: {inrFull(grandTotal)}</div>
          </Card>
          <div style={{ height: 14 }} />
          <Card title="Terms & Delivery">
            <div className="form-row">
              <div className="field"><label>Payment terms</label>
                <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></div>
              <div className="field"><label>Delivery time</label>
                <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} /></div>
            </div>
            <div className="field"><label>Special instructions to vendor</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </Card>
        </div>
        <div style={{ position: "sticky", top: 12 }}>
          {po.last_purchase && (
            <Card title="Procurement Intel" sub="Reference for this PO">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{po.last_purchase.description}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
                <span>Last paid</span><span>{inrFull(po.last_purchase.rate)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span>This PO rate</span><span>{inrFull(po.lines[0]?.unit_price)}</span>
              </div>
            </Card>
          )}
          <div style={{ height: 14 }} />
          <Card title="Approval Path">
            <div className="wstep active"><div className="wstep-n">1</div><div style={{ flex: 1 }}>Issue PO · You</div></div>
            <div className="wstep"><div className="wstep-n">2</div><div style={{ flex: 1 }}>Vendor acknowledges</div></div>
            <div className="wstep"><div className="wstep-n">3</div><div style={{ flex: 1 }}>Goods received (GRN)</div></div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ============ PO detail page (full page, lifecycle sidebar, Record GRN nav) ============ */
function PoDetailPage({ poId, onBack, toast, refreshList, navigate }) {
  const [po, setPo] = useState(null);
  const load = async () => setPo(await api.get(`/procurement/pos/${poId}/detail`));
  useEffect(() => { load(); }, [poId]);

  if (!po) return <Loading />;

  const approve = async () => {
    try { await api.post(`/procurement/pos/${poId}/approve`); toast("PO active"); load(); refreshList(); }
    catch (e) { toast(e.message, true); }
  };
  const markAwaiting = async () => {
    try { await api.post(`/procurement/pos/${poId}/mark-awaiting-delivery`); toast("PO awaiting delivery"); load(); refreshList(); }
    catch (e) { toast(e.message, true); }
  };
  const esign = async () => {
    try { const res = await api.post(`/procurement/pos/${poId}/esign`); toast(`Signed · ${res.reference} (Class-3 DSC)`); load(); refreshList(); }
    catch (e) { toast(e.message, true); }
  };
  const goToGrn = () => navigate("/grns", { state: { recordForPoId: poId } });

  const banner = {
    draft: { text: "Ready to issue — submit / approve to activate this PO.", action: null },
    pending_approval: { text: "Awaiting approval before activation.", action: null },
    active: { text: "PO is active. Mark awaiting delivery once the vendor confirms dispatch, or record GRN directly on receipt.",
      action: { label: "Record GRN →", fn: goToGrn } },
    awaiting_delivery: { text: "Awaiting delivery. Record goods receipt once items arrive.",
      action: { label: "Record GRN →", fn: goToGrn } },
    goods_received: { text: "Goods received in full.", action: null },
    closed: { text: "Closed.", action: null },
    cancelled: { text: "Cancelled.", action: null },
  }[po.status] || { text: "", action: null };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 4 }}>
        Purchase Orders / {po.id}
      </div>
      <PageHead title={po.requisition_title || po.id} sub={`${po.id} · ${po.vendor_name} · ${dt(po.issued_at)}`}
        actions={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-gho" onClick={onBack}>← Back to list</button>
          {["draft", "pending_approval"].includes(po.status) && <button className="btn btn-pri" onClick={approve}>Submit / Approve PO</button>}
          {po.status === "active" && <button className="btn btn-gho" onClick={markAwaiting}>Mark awaiting delivery</button>}
          {po.esign_status === "pending" && <button className="btn btn-blu" onClick={esign}>e-Sign now (Class-3 DSC)</button>}
        </div>} />

      {banner.text && (
        <div style={{ background: "#1a1a2e", color: "#fff", borderRadius: 10, padding: "14px 18px", marginBottom: 16,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, opacity: .7, textTransform: "uppercase" }}>
              Stage {po.status.replaceAll("_", " ")} · Next action
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{banner.text}</div>
          </div>
          {banner.action && <button className="btn btn-red" onClick={banner.action.fn}>{banner.action.label}</button>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          <Card>
            <DetailGrid items={[["Vendor", po.vendor_name], ["Source PR", po.requisition_id || "—"],
              ["Source RFQ", po.rfq_id || "—"], ["Amount", inrFull(po.amount)], ["GST", inrFull(po.gst_amount)],
              ["Payment terms", po.payment_terms], ["Delivery terms", po.delivery_terms],
              ["Status", po.status], ["Notes", po.notes]]} />
          </Card>
          <div style={{ height: 14 }} />
          <Card title="Line items">
            <DataTable columns={[
              { key: "description", label: "Description" },
              { key: "quantity", label: "Qty", num: true },
              { key: "unit_price", label: "Unit ₹", num: true, render: (r) => inrFull(r.unit_price) },
              { key: "gst_rate", label: "GST %", num: true },
            ]} rows={po.lines} />
          </Card>
          {po.agreement_based && (<>
            <div style={{ height: 14 }} />
            <Card title="Signature & Compliance">
              <DetailGrid items={[["e-Sign status", po.esign_status], ["Reference", po.esign_ref || "—"]]} />
            </Card>
          </>)}
          {po.grns?.length > 0 && (<>
            <div style={{ height: 14 }} />
            <Card title="GRNs against this PO">
              <DataTable columns={[
                { key: "id", label: "GRN", render: (r) => <span className="mono">{r.id}</span> },
                { key: "received_at", label: "Received", render: (r) => dt(r.received_at) },
                { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
              ]} rows={po.grns} />
            </Card>
          </>)}
          {po.invoices?.length > 0 && (<>
            <div style={{ height: 14 }} />
            <Card title="Invoices against this PO">
              <DataTable columns={[
                { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
                { key: "total_amount", label: "Amount", num: true, render: (r) => inrFull(r.total_amount) },
                { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
              ]} rows={po.invoices} />
            </Card>
          </>)}
        </div>
        <div style={{ position: "sticky", top: 12 }}>
          {po.last_purchase && (
            <Card title="Procurement Intel" sub="Reference for this category">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{po.last_purchase.description}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
                <span>Last paid</span><span>{inrFull(po.last_purchase.rate)}</span>
              </div>
            </Card>
          )}
          <div style={{ height: 14 }} />
          <Card title="PO Lifecycle">
            {[
              ["PO Created", true, dt(po.issued_at)],
              ["Issued / Active", ["active", "awaiting_delivery", "goods_received", "closed"].includes(po.status), null],
              ["Awaiting Delivery", ["awaiting_delivery", "goods_received", "closed"].includes(po.status), null],
              ["Goods Received", ["goods_received", "closed"].includes(po.status), null],
            ].map(([label, done, sub]) => (
              <div key={label} className={`wstep ${done ? "done" : ""}`}>
                <div className="wstep-n">{done ? "✓" : "•"}</div>
                <div style={{ flex: 1 }}>{label}{sub && <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{sub}</div>}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ============ Purchase Orders ============ */
export function PurchaseOrders() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refresh } = useFetch(() => api.get("/procurement/pos"), []);
  const [view, setView] = useState("list"); // list | choose-rfq | new-independent | review | detail
  const [activePoId, setActivePoId] = useState(null);
  const [summary, setSummary] = useState(null);
  const consumedNavState = useRef(false);

  useEffect(() => {
    if (!consumedNavState.current && location.state?.reviewPoId) {
      consumedNavState.current = true;
      setActivePoId(location.state.reviewPoId); setView("review");
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  const openRow = (r) => { setActivePoId(r.id); setView(r.status === "draft" ? "review" : "detail"); };

  if (view === "review" && activePoId) {
    return <PoReviewPage poId={activePoId} toast={toast}
      onCancel={() => { setActivePoId(null); setView("list"); refresh(); }}
      onIssued={() => { setView("detail"); refresh(); }} />;
  }
  if (view === "detail" && activePoId) {
    return <PoDetailPage poId={activePoId} toast={toast} navigate={navigate} refreshList={refresh}
      onBack={() => { setActivePoId(null); setView("list"); refresh(); }} />;
  }

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Purchase Orders" sub="Issue POs from finalized RFQs or independently against existing agreements"
        actions={<>
          <button className="btn btn-gho" onClick={() => setSummary({ entity: "purchase_orders", filters: {}, title: "Purchase orders" })}>≡ Summary</button>
          <button className="btn btn-gho" onClick={() => setView("choose-rfq")}>From Quotation</button>
          <button className="btn btn-pri" onClick={() => setView("new-independent")}>+ New Independent PO</button>
        </>} />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "PO", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
          { key: "requisition_id", label: "Source PR", render: (r) => <span className="mono">{r.requisition_id || "—"}</span> },
          { key: "rfq_id", label: "Source RFQ", render: (r) => <span className="mono">{r.rfq_id || "—"}</span> },
          { key: "type", label: "Type", render: (r) => poType(r) },
          { key: "amount", label: "Amount", num: true, render: (r) => inr(r.amount) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "delivery", label: "Delivery status", render: (r) => poDeliveryStatus(r) },
          { key: "next", label: "Next action", render: (r) => <span style={{ fontSize: 12 }}>{poNextAction(r)}</span> },
        ]} rows={data} onRow={openRow} />
      </Card>

      {view === "choose-rfq" && (
        <CreatePoFromRfqModal onClose={() => setView("list")}
          onContinue={async (rfqId) => {
            try {
              const po = await api.post("/procurement/pos", { rfq_id: rfqId });
              toast(`${po.id} created as draft`);
              setActivePoId(po.id); setView("review");
            } catch (e) { toast(e.message, true); }
          }} />
      )}
      {view === "new-independent" && (
        <NewIndependentPoModal toast={toast} onClose={() => setView("list")}
          onCreated={(poId) => { setActivePoId(poId); setView("review"); }} />
      )}
    </>
  );
}

/* ============ GRN record page (full page: receipt details, items, photo evidence) ============ */
function GrnRecordPage({ po, onCancel, onDone, toast }) {
  const { data: masters } = useFetch(() => api.get("/vendors/masters/reference"), []);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState(po.branch_id || "");
  const [condition, setCondition] = useState("Good");
  const [lines, setLines] = useState((po.lines || []).map((l) => ({
    po_line_id: l.id, description: l.description, uom: l.uom, ordered_qty: l.quantity,
    qty_received: 0, qty_accepted: 0, qty_rejected: 0, rejection_reason: "",
  })));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (masters && !branchId) setBranchId(masters.branches?.[0]?.id || ""); }, [masters]);

  const setLine = (i, k, v) => setLines((arr) => arr.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, [k]: v };
    if (k === "qty_received") { next.qty_accepted = +v || 0; next.qty_rejected = 0; }
    return next;
  }));

  const fillFullyReceived = () => setLines((arr) => arr.map((l) => ({
    ...l, qty_received: l.ordered_qty, qty_accepted: l.ordered_qty, qty_rejected: 0, rejection_reason: "",
  })));

  const totals = lines.reduce((acc, l) => ({
    ordered: acc.ordered + Number(l.ordered_qty), received: acc.received + Number(l.qty_received),
    accepted: acc.accepted + Number(l.qty_accepted), rejected: acc.rejected + Number(l.qty_rejected),
  }), { ordered: 0, received: 0, accepted: 0, rejected: 0 });

  const anyRejected = lines.some((l) => Number(l.qty_rejected) > 0);
  const fullyReceived = lines.every((l) => Number(l.qty_received) >= Number(l.ordered_qty) - 0.001
    && Number(l.qty_accepted) >= Number(l.ordered_qty) - 0.001);
  const predictedStatus = anyRejected ? "received_with_rejection" : fullyReceived ? "fully_received" : "partial";

  const save = async () => {
    if (!photos.length) return toast("At least one photo is required as evidence", true);
    if (lines.every((l) => Number(l.qty_received) === 0)) return toast("Enter received quantity for at least one item", true);
    setSaving(true);
    try {
      const combinedNotes = `Condition: ${condition}${notes ? " · " + notes : ""}`;
      const res = await api.post("/procurement/grns", {
        po_id: po.id, branch_id: branchId, notes: combinedNotes,
        lines: lines.map((l) => ({ po_line_id: l.po_line_id, qty_received: +l.qty_received,
          qty_accepted: +l.qty_accepted, qty_rejected: +l.qty_rejected, rejection_reason: l.rejection_reason || null })),
      });
      for (const file of photos) {
        const fd = new FormData(); fd.append("file", file);
        await api.postForm(`/procurement/grns/${res.id}/documents`, fd);
      }
      const submitRes = await api.post(`/procurement/grns/${res.id}/submit`);
      toast(`${res.id} submitted · ${submitRes.status.replaceAll("_", " ")}`);
      onDone();
    } catch (e) { toast(e.message, true); setSaving(false); }
  };

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--ink-500)", textTransform: "uppercase", marginBottom: 4 }}>
        GRN / Record New
      </div>
      <PageHead title="Record Goods Receipt" sub={`Against PO ${po.id} · ${po.vendor_name} · ${inrFull(po.amount)}`}
        actions={<>
          <button className="btn btn-gho" onClick={onCancel}>Cancel</button>
          <button className="btn btn-pri" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save GRN →"}</button>
        </>} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          <Card title="Receipt Details">
            <div className="form-row-3">
              <div className="field"><label>Date received</label>
                <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
              <div className="field"><label>Branch / Location</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {masters?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <div className="field"><label>Overall condition</label>
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {["Good", "Damaged", "Partial"].map((c) => <option key={c}>{c}</option>)}
                </select></div>
            </div>
          </Card>

          <div style={{ height: 14 }} />
          <Card title="Items Received"
            actions={<button className="btn btn-gho btn-sm" onClick={fillFullyReceived}>Mark all fully received</button>}>
            {lines.map((l, i) => (
              <div key={l.po_line_id} style={{ border: "1px solid var(--hairline)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{l.description}
                  <span style={{ color: "var(--ink-500)", fontWeight: 400 }}> · ordered {l.ordered_qty} {l.uom}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label>Received</label>
                    <input type="number" min={0} max={l.ordered_qty} value={l.qty_received}
                      onChange={(e) => setLine(i, "qty_received", e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Accepted</label>
                    <input type="number" min={0} value={l.qty_accepted}
                      onChange={(e) => setLine(i, "qty_accepted", e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Rejected</label>
                    <input type="number" min={0} value={l.qty_rejected}
                      onChange={(e) => setLine(i, "qty_rejected", e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Rejection reason</label>
                    <input value={l.rejection_reason} onChange={(e) => setLine(i, "rejection_reason", e.target.value)} /></div>
                </div>
              </div>
            ))}
          </Card>

          <div style={{ height: 14 }} />
          <Card title="Photo Evidence (mandatory)">
            <label style={{ display: "block", border: "1px dashed var(--hairline-strong)", borderRadius: 10, padding: 24, textAlign: "center", cursor: "pointer", color: "var(--ink-500)" }}>
              📷 Add Photo
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => setPhotos((arr) => [...arr, ...Array.from(e.target.files)])} />
            </label>
            {photos.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12.5 }}>
                {photos.map((f, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                    <span>📎 {f.name}</span>
                    <button className="btn btn-gho btn-sm" onClick={() => setPhotos((arr) => arr.filter((_, idx) => idx !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div style={{ height: 14 }} />
          <Card title="Remarks & Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. All cartons sealed, condition good. 1 unit had minor scratch but accepted after vendor agreed to discount…"
              style={{ width: "100%", minHeight: 70, border: "1px solid var(--hairline-strong)", borderRadius: 7, padding: 10 }} />
          </Card>
        </div>

        <div style={{ position: "sticky", top: 12 }}>
          <Card title="PO Reference">
            <DetailGrid items={[["PO ID", po.id], ["Vendor", po.vendor_name], ["Total", inrFull(po.amount)]]} />
          </Card>
          <div style={{ height: 14 }} />
          <Card title="Receipt Summary">
            <DetailGrid items={[["Total ordered", totals.ordered], ["Total received", totals.received],
              ["Total accepted", totals.accepted], ["Total rejected", totals.rejected]]} />
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              Status will be: <Chip value={predictedStatus} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ============ GRNs ============ */
function RecordGrnModal({ onClose, onContinue }) {
  const { data: pos, loading } = useFetch(() => api.get("/procurement/pos"), []);
  const [poId, setPoId] = useState("");
  const eligible = (pos || []).filter((p) => ["active", "awaiting_delivery"].includes(p.status));

  useEffect(() => {
    if (!poId && eligible.length) setPoId(eligible[0].id);
  }, [pos]);

  return (
    <Modal title="Record GRN" onClose={onClose}
      footer={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-gho" onClick={onClose}>Cancel</button>
        <button className="btn btn-pri" disabled={!poId} onClick={() => onContinue(poId)}>Continue →</button>
      </div>}>
      <div style={{ color: "var(--ink-500)", fontSize: 12.5, marginBottom: 10 }}>Select PO against which goods received</div>
      {loading ? <Loading /> : !eligible.length ? (
        <div className="empty">No POs awaiting goods receipt.</div>
      ) : (
        <div className="field"><label>PO</label>
          <select value={poId} onChange={(e) => setPoId(e.target.value)}>
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.vendor_name} · {inrFull(p.amount)}</option>)}
          </select>
        </div>
      )}
    </Modal>
  );
}

export function Grns() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refresh } = useFetch(() => api.get("/procurement/grns"), []);
  const [detail, setDetail] = useState(null);
  const [recordPo, setRecordPo] = useState(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const consumedNavState = useRef(false);

  useEffect(() => {
    if (!consumedNavState.current && location.state?.recordForPoId) {
      consumedNavState.current = true;
      api.get(`/procurement/pos/${location.state.recordForPoId}/detail`).then(setRecordPo);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  const open = async (r) => setDetail(await api.get(`/procurement/grns/${r.id}/detail`));
  const chooseGrnPo = async (poId) => {
    setShowRecordModal(false);
    setRecordPo(await api.get(`/procurement/pos/${poId}/detail`));
  };

  if (recordPo) {
    return <GrnRecordPage po={recordPo} toast={toast}
      onCancel={() => setRecordPo(null)}
      onDone={() => { setRecordPo(null); refresh(); }} />;
  }

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Goods Receipt Notes" sub="Received / accepted / rejected reconciliation against PO"
        actions={<button className="btn btn-pri" onClick={() => setShowRecordModal(true)}>+ Record New GRN</button>} />
      <div className="kpi-row">
        <Kpi label="GRNs recorded" value={data.length} note="across branches" />
        <Kpi label="Fully received" value={data.filter((g) => g.status === "fully_received").length} note="all ordered qty accepted" noteClass="up" />
        <Kpi label="With rejections" value={data.filter((g) => g.status === "received_with_rejection").length} note="qty rejected on receipt" noteClass="down" />
      </div>
      <Card pad={false}>
        <DataTable columns={[
          { key: "id", label: "GRN", render: (r) => <span className="mono">{r.id}</span> },
          { key: "po_id", label: "PO", render: (r) => <span className="mono">{r.po_id}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "branch_name", label: "Branch" },
          { key: "received_at", label: "Received", render: (r) => dt(r.received_at) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "summary", label: "Accepted / Rejected", render: (r) => `${r.total_accepted} / ${r.total_rejected}` },
        ]} rows={data} onRow={open} empty="No GRNs recorded yet" />
      </Card>

      {detail && (
        <Modal wide title={`${detail.id} · ${detail.vendor_name}`} onClose={() => setDetail(null)}>
          <Timeline stages={GRN_STAGES} current={detail.status} />
          <DetailGrid items={[["PO", detail.po_id], ["Vendor", detail.vendor_name],
            ["Received", dt(detail.received_at)], ["Status", detail.status], ["Notes", detail.notes]]} />
          <h4 style={{ margin: "14px 0 8px" }}>Lines</h4>
          <DataTable columns={[
            { key: "description", label: "PO item" },
            { key: "ordered_qty", label: "Ordered", num: true },
            { key: "qty_received", label: "Received", num: true },
            { key: "qty_accepted", label: "Accepted", num: true },
            { key: "qty_rejected", label: "Rejected", num: true },
            { key: "rejection_reason", label: "Rejection reason" },
          ]} rows={detail.lines} />
          {detail.documents?.length > 0 && (<>
            <h4 style={{ margin: "14px 0 8px" }}>Photo evidence</h4>
            {detail.documents.map((d) => (
              <div key={d.id}><a href={api.downloadUrl(`/procurement/grns/documents/${d.id}`)} target="_blank" rel="noreferrer">📎 {d.filename}</a></div>
            ))}
          </>)}
        </Modal>
      )}

      {showRecordModal && (
        <RecordGrnModal onClose={() => setShowRecordModal(false)} onContinue={chooseGrnPo} />
      )}
    </>
  );
}
