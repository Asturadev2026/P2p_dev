import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, PageHead, Loading, Kpi,
         inr, inrFull, dt, dtt } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Approvals ============ */
export function Approvals() {
  const { user, toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/approvals/queue"), []);
  const { data: matrix } = useFetch(() => api.get("/approvals/matrix"), []);
  const [actionFor, setActionFor] = useState(null); // { id, decision, entityType }
  const [remark, setRemark] = useState("");
  const canAct = ["checker", "fc", "cfo"].includes(user.role);

  const act = async (id, decision, comments) => {
    try { const res = await api.post(`/approvals/${id}/act`, { decision, comments });
      toast(`Stage ${decision.replace("_", " ")}d · chain: ${res.chain_status}${res.next_stage ? " → " + res.next_stage : ""}`);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  const approve = (id) => act(id, "approve", "Approved via UI");
  const confirmAction = async () => {
    if (!remark.trim()) {
      toast(`A remark is required when ${actionFor.decision === "send_back" ? "sending back" : "rejecting"}`, true);
      return;
    }
    await act(actionFor.id, actionFor.decision, remark);
    setActionFor(null); setRemark("");
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Approval Workflow"
        sub={canAct ? `Signed in as ${user.name} (${user.role}) — your actionable queue below`
                    : "View only access — approval routing queue"} />
      <Card title="My pending approvals" sub="SLA-tracked · stages activate in sequence" pad={false}>
        <DataTable columns={[
          { key: "entity_type", label: "Type", render: (r) => <Chip value="open" label={r.entity_type.replace("_", " ")} /> },
          { key: "entity_id", label: "Reference", render: (r) => <span className="mono">{r.entity_id}</span> },
          { key: "entity_summary", label: "Summary" },
          { key: "stage_no", label: "Stage", render: (r) => `${r.stage_no} · ${r.stage_role.toUpperCase()}` },
          { key: "sla_due_at", label: "SLA due", render: (r) => r.sla_due_at ? dtt(r.sla_due_at) : "—" },
          { key: "_", label: "Action", render: (r) => canAct && r.actionable ? (
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-grn btn-sm" onClick={(e) => { e.stopPropagation(); approve(r.id); }}>Approve</button>
              {r.entity_type === "invoice" &&
                <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation();
                  setActionFor({ id: r.id, decision: "send_back" }); setRemark(""); }}>Send Back</button>}
              <button className="btn btn-red btn-sm" onClick={(e) => { e.stopPropagation();
                setActionFor({ id: r.id, decision: "reject" }); setRemark(""); }}>Reject</button>
            </span>) : r.actionable ? <span className="muted">View only access</span>
              : <Chip value="pending" label="awaiting earlier stage" /> },
        ]} rows={data} empty="Queue clear — nothing awaiting your role" />
      </Card>
      <Card title="Approval matrix · routing rules" sub="configuration, not code — edit in Admin Console" pad={false}>
        <DataTable columns={[
          { key: "rule_name", label: "Rule" },
          { key: "entity_type", label: "Entity" },
          { key: "min_amount", label: "From", num: true, render: (r) => inrFull(r.min_amount) },
          { key: "max_amount", label: "To", num: true, render: (r) => r.max_amount ? inrFull(r.max_amount) : "∞" },
          { key: "msme_priority", label: "MSME", render: (r) => r.msme_priority ? <Chip value="msme_priority" label="fast-track" /> : "—" },
          { key: "stages", label: "Stages", render: (r) => (Array.isArray(r.stages) ? r.stages : []).join(" → ") },
          { key: "sla_hours", label: "SLA", render: (r) => r.sla_hours ? `${r.sla_hours}h` : "instant" },
        ]} rows={matrix || []} />
      </Card>
      {actionFor && (
        <Modal title={`${actionFor.decision === "send_back" ? "Send Back" : "Reject"} ${actionFor.id} — remark required`}
          onClose={() => setActionFor(null)}
          footer={<button className={actionFor.decision === "send_back" ? "btn btn-gho" : "btn btn-red"}
            onClick={confirmAction}>{actionFor.decision === "send_back" ? "Confirm send back" : "Confirm reject"}</button>}>
          <div className="field"><label>Remark</label>
            <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder={actionFor.decision === "send_back" ? "What needs to be corrected before resubmission?" : "Why is this being rejected?"} /></div>
        </Modal>
      )}
    </>
  );
}

/* ============ Liability & JV ============ */
export function LiabilityJv() {
  const { user, toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/payments/jvs"), []);
  const isFc = user?.role === "fc";
  const push = async (id) => {
    try { const res = await api.post(`/payments/jvs/${encodeURIComponent(id)}/push`);
      toast(`Pushed · ERP doc ${res.erp_doc_no}`); refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Liability & JV Posting"
        sub={isFc ? "Dr/Cr balanced · GL auto-derived · structured ERP hand-off"
                  : "View only access — Dr/Cr balanced · GL auto-derived · structured ERP hand-off"} />
      <div className="kpi-row">
        <Kpi label="JVs ready" value={data.filter((j) => j.status === "ready").length} note={inr(data.filter((j) => j.status === "ready").reduce((s, j) => s + +j.amount, 0)) + " liability impact"} />
        <Kpi label="Pushed" value={data.filter((j) => j.status === "pushed").length} note="ERP confirmed" noteClass="up" />
      </div>
      <Card title="ERP push queue" sub="journal vouchers · Sundry Creditors 2401001" pad={false}>
        <DataTable columns={[
          { key: "id", label: "JV", render: (r) => <span className="mono">{r.id}</span> },
          { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "dr_gl", label: "Dr GL", render: (r) => <span className="mono">{r.dr_gl}</span> },
          { key: "cr_gl", label: "Cr GL", render: (r) => <span className="mono">{r.cr_gl}</span> },
          { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "erp_doc_no", label: "ERP doc", render: (r) => <span className="mono">{r.erp_doc_no || "—"}</span> },
          { key: "_", label: "", render: (r) => isFc && r.status === "ready" &&
            <button className="btn btn-blu btn-sm" onClick={(e) => { e.stopPropagation(); push(r.id); }}>Push to ERP</button> },
        ]} rows={data} />
      </Card>
    </>
  );
}

/* ============ Payment Batches ============ */
export function PaymentBatches() {
  const { user, toast } = useApp();
  const isTreasury = user.role === "treasury";
  const canView = ["treasury", "fc", "cfo", "auditor"].includes(user.role);
  const { data, loading, refresh } = useFetch(() => canView ? api.get("/payments/batches") : Promise.resolve([]), [canView]);
  const { data: ready, refresh: refreshReady } = useFetch(
    () => canView ? api.get("/invoices", { stage: "payments" }) : Promise.resolve([]), [canView]);
  const [items, setItems] = useState(null);
  const [batchId, setBatchId] = useState(null);
  const [utrFor, setUtrFor] = useState(null);
  const [utr, setUtr] = useState("");
  const [payDate, setPayDate] = useState("");
  const [remarks, setRemarks] = useState("");

  const readyCount = (ready || []).filter((i) => i.payment_status === "payment_ready").length;

  const openBatch = async (b) => {
    if (!isTreasury) return;
    setBatchId(b.id);
    try { setItems(await api.get(`/payments/batches/${encodeURIComponent(b.id)}/items`)); }
    catch (e) { toast(e.message, true); }
  };
  const build = async () => {
    const ids = (ready || []).filter((i) => i.payment_status === "payment_ready").map((i) => i.id);
    if (!ids.length) return toast("No invoices ready for payment", true);
    try { const res = await api.post("/payments/batches", { invoice_ids: ids, channel: "NEFT" });
      toast(`Built ${res.id} · ${inrFull(res.total_amount)}`); refresh(); refreshReady();
    } catch (e) { toast(e.message, true); }
  };
  const release = async (id) => {
    try { await api.post(`/payments/batches/${encodeURIComponent(id)}/release`); toast("Batch released to bank portal"); refresh(); refreshReady(); }
    catch (e) { toast(e.message, true); }
  };
  const openUtr = (id) => { setUtrFor(id); setUtr(""); setPayDate(""); setRemarks(""); };
  const confirmUtr = async () => {
    if (!utr.trim()) return toast("UTR / reference number is required", true);
    if (!payDate) return toast("Payment date is required", true);
    try {
      const res = await api.post(`/payments/batches/${encodeURIComponent(utrFor)}/capture-utr`,
        { utr: utr.trim(), payment_date: payDate, remarks: remarks.trim() || null });
      toast(`UTR captured · ${res.count} invoice(s) marked paid · remittance advices sent`);
      const id = utrFor;
      setUtrFor(null); refresh(); refreshReady(); if (batchId === id) openBatch({ id });
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  if (!canView) {
    return (
      <>
        <PageHead title="Payment Batches" sub="View only access — you do not have permission to view Payment Batch" />
        <Card title="Batches" pad={false}>
          <div className="empty">You do not have permission to view Payment Batch.</div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHead title="Payment Batches"
        sub={isTreasury ? "bank-ready payout file · UTR capture · branded remittance advice"
                        : "View only access — payment status summary"}
        actions={isTreasury &&
          <button className="btn btn-pri" onClick={build}>+ Build batch from payments queue ({readyCount})</button>} />
      <Card title="Batches" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Batch", render: (r) => <span className="mono">{r.id}</span> },
          { key: "item_count", label: "Items", num: true },
          { key: "total_amount", label: "Total", num: true, render: (r) => inrFull(r.total_amount) },
          { key: "channel", label: "Channel" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "file_name", label: "Payout file", render: (r) => r.file_name ? <span className="mono">{r.file_name}</span> : "—" },
          { key: "_", label: "Actions", render: (r) => (
            <span style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
              {isTreasury && <a className="btn btn-gho btn-sm" href={api.downloadUrl(`/payments/batches/${encodeURIComponent(r.id)}/file`)} target="_blank" rel="noreferrer">CSV</a>}
              {isTreasury && ["building", "file_generated"].includes(r.status) &&
                <button className="btn btn-grn btn-sm" onClick={() => release(r.id)}>Release</button>}
              {isTreasury && r.status === "released" &&
                <button className="btn btn-blu btn-sm" onClick={() => openUtr(r.id)}>Capture UTR</button>}
              {!isTreasury && <span className="muted">View only access</span>}
            </span>) },
        ]} rows={data} onRow={isTreasury ? openBatch : undefined} />
      </Card>
      {isTreasury && items && (
        <Modal wide title={`${batchId} · items`} onClose={() => setItems(null)}>
          <DataTable columns={[
            { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id}</span> },
            { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.msme_priority && <Chip value="msme_priority" label="MSME 45d" />}</> },
            { key: "bank_account", label: "A/c", render: (r) => <span className="mono">{r.bank_account} · {r.bank_ifsc}</span> },
            { key: "net_amount", label: "Net pay", num: true, render: (r) => inrFull(r.net_amount) },
            { key: "mode", label: "Mode" },
            { key: "utr", label: "UTR", render: (r) => <span className="mono">{r.utr || "—"}</span> },
            { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          ]} rows={items} />
        </Modal>
      )}
      {isTreasury && utrFor && (
        <Modal title={`Capture UTR — ${utrFor}`} onClose={() => setUtrFor(null)}
          footer={<button className="btn btn-pri" onClick={confirmUtr}>Save</button>}>
          <div className="field"><label>UTR / reference number</label>
            <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. N123456789012" /></div>
          <div className="field"><label>Payment date</label>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          <div className="field"><label>Remarks (optional)</label>
            <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any note for this settlement" /></div>
        </Modal>
      )}
    </>
  );
}

/* ============ Advances & Imprest ============ */
function CreateAdvanceModal({ advanceType, onClose, onCreated }) {
  const { toast } = useApp();
  const { data: vendors } = useFetch(() => api.get("/vendors"), []);
  const { data: users } = useFetch(() => api.get("/auth/users"), []);
  const { data: masters } = useFetch(() => api.get("/vendors/masters/reference"), []);
  const [form, setForm] = useState({ vendor_id: "", holder_id: "", department_id: "", branch_id: "", amount: "", purpose: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async () => {
    if (!form.amount || +form.amount <= 0) return toast("Enter a valid amount", true);
    if (advanceType === "vendor_advance" && !form.vendor_id) return toast("Select a vendor", true);
    if (advanceType === "imprest" && !form.holder_id) return toast("Select an imprest holder", true);
    try {
      const res = await api.post("/payments/advances", {
        advance_type: advanceType,
        vendor_id: advanceType === "vendor_advance" ? form.vendor_id : null,
        holder_id: advanceType === "imprest" ? form.holder_id : null,
        department_id: form.department_id || null, branch_id: form.branch_id || null,
        amount: +form.amount, purpose: form.purpose || null,
      });
      toast(`${res.id} created · sent for approval`); onCreated(); onClose();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <Modal title={advanceType === "imprest" ? "Create Imprest" : "Create Vendor Advance"} onClose={onClose}
      footer={<button className="btn btn-pri" onClick={create}>Create & submit for approval</button>}>
      {advanceType === "vendor_advance" ? (
        <div className="field"><label>Vendor</label>
          <select value={form.vendor_id} onChange={set("vendor_id")}>
            <option value="">Select vendor…</option>
            {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></div>
      ) : (
        <div className="field"><label>Imprest holder</label>
          <select value={form.holder_id} onChange={set("holder_id")}>
            <option value="">Select holder…</option>
            {(users || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
          </select></div>
      )}
      <div className="field"><label>Department</label>
        <select value={form.department_id} onChange={set("department_id")}>
          <option value="">—</option>
          {(masters?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></div>
      <div className="field"><label>Branch</label>
        <select value={form.branch_id} onChange={set("branch_id")}>
          <option value="">—</option>
          {(masters?.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></div>
      <div className="field"><label>Amount</label>
        <input type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" /></div>
      <div className="field"><label>Purpose</label>
        <input value={form.purpose} onChange={set("purpose")} placeholder="Reason for this advance" /></div>
    </Modal>
  );
}

function SettleAdvanceModal({ advance, onClose, onSettled }) {
  const { toast } = useApp();
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);

  const settle = async () => {
    const amt = +amount;
    if (!amt || amt <= 0) return toast("Enter a valid amount", true);
    if (amt > +advance.balance) return toast(`Exceeds balance ${inrFull(advance.balance)}`, true);
    try {
      if (file) {
        const fd = new FormData();
        fd.append("file", file); fd.append("amount", amt); if (note) fd.append("note", note);
        await api.postForm(`/payments/advances/${encodeURIComponent(advance.id)}/settle-bill`, fd);
      } else {
        await api.post(`/payments/advances/${encodeURIComponent(advance.id)}/settle`,
          { invoice_id: invoiceId || null, amount: amt, note: note || null });
      }
      toast("Settlement recorded"); onSettled(); onClose();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <Modal title={`Settle ${advance.id}`} onClose={onClose}
      footer={<button className="btn btn-pri" onClick={settle}>Save settlement</button>}>
      {advance.advance_type === "vendor_advance" && (
        <div className="field"><label>Adjust against invoice (optional)</label>
          <input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="e.g. INV-2026-04-1234" /></div>
      )}
      {advance.advance_type === "imprest" && (
        <div className="field"><label>Upload bill / receipt (optional)</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
      )}
      <div className="field"><label>Amount</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Balance ${inrFull(advance.balance)}`} /></div>
      <div className="field"><label>Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bill description, or 'refund of unspent balance'" /></div>
    </Modal>
  );
}

function AdvanceDetailModal({ advance, onClose }) {
  const { data: settlements, loading } = useFetch(() => api.get(`/payments/advances/${encodeURIComponent(advance.id)}/settlements`), [advance.id]);
  return (
    <Modal wide title={`${advance.id} · settlement history`} onClose={onClose}>
      <DetailGrid items={[
        ["Type", advance.advance_type.replace("_", " ")], ["Vendor / Holder", advance.vendor_name || advance.holder_name],
        ["Amount", inrFull(advance.amount)], ["Settled", inrFull(advance.settled_amount)], ["Balance", inrFull(advance.balance)],
        ["Status", advance.status], ["Purpose", advance.purpose],
        ["Disbursed", advance.disbursed_at ? dtt(advance.disbursed_at) : "Not yet disbursed"],
      ]} />
      <h4 style={{ margin: "14px 0 8px" }}>Settlements · bills · refunds</h4>
      {loading ? <Loading /> : (
        <DataTable columns={[
          { key: "settled_at", label: "Date", render: (r) => dtt(r.settled_at) },
          { key: "invoice_id", label: "Against invoice", render: (r) => r.invoice_id ? <span className="mono">{r.invoice_id}</span> : "—" },
          { key: "bill_file", label: "Bill file", render: (r) => r.bill_file || "—" },
          { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
          { key: "note", label: "Note" },
        ]} rows={settlements || []} empty="No settlements recorded yet" />
      )}
    </Modal>
  );
}

export function Advances() {
  const { user, toast } = useApp();
  const isTreasury = user.role === "treasury";
  const { data, loading, refresh } = useFetch(() => api.get("/payments/advances"), []);
  const [summary, setSummary] = useState(null);
  const [createType, setCreateType] = useState(null); // null | "vendor_advance" | "imprest"
  const [settleFor, setSettleFor] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  if (loading) return <Loading />;
  const open = data.filter((a) => ["open", "partially_settled"].includes(a.status));

  const disburse = async (id) => {
    try { await api.post(`/payments/advances/${encodeURIComponent(id)}/disburse`); toast("Advance disbursed"); refresh(); }
    catch (e) { toast(e.message, true); }
  };

  return (
    <>
      <PageHead title="Advances & Imprest" sub="auto-adjustment against final bills · bill-based reconciliation"
        actions={<span style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-gho" onClick={() => setCreateType("vendor_advance")}>+ Create Advance</button>
          <button className="btn btn-pri" onClick={() => setCreateType("imprest")}>+ Create Imprest</button>
        </span>} />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <div className="kpi-row">
        <Kpi label="Open balance" value={inr(open.reduce((s, a) => s + +a.balance, 0))} note={`${open.length} open advance(s)`}
          onSummary={() => setSummary({ entity: "advances", filters: {}, title: "Advances & imprest" })} />
        <Kpi label="Settled this period" value={inr(data.reduce((s, a) => s + +a.settled_amount, 0))} note="auto-adjusted vs bills" noteClass="up" />
        <Kpi label="Pending approval" value={data.filter((a) => a.status === "pending_approval").length} note="checker → FC chain"
          onSummary={() => setSummary({ entity: "advances", filters: { status: "pending_approval" }, title: "Advances pending approval" })} />
      </div>
      <Card title="Advance & imprest ledger" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Ref", render: (r) => <span className="mono">{r.id}</span> },
          { key: "advance_type", label: "Type", render: (r) => <Chip value={r.advance_type === "imprest" ? "open" : "active"} label={r.advance_type.replace("_", " ")} /> },
          { key: "vendor_name", label: "Vendor / Holder", render: (r) => r.vendor_name || r.holder_name },
          { key: "branch_name", label: "Branch" },
          { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
          { key: "settled_amount", label: "Settled", num: true, render: (r) => inrFull(r.settled_amount) },
          { key: "balance", label: "Balance", num: true, render: (r) => inrFull(r.balance) },
          { key: "purpose", label: "Purpose" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "_", label: "Actions", render: (r) => (
            <span style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
              {isTreasury && r.status === "approved" &&
                <button className="btn btn-grn btn-sm" onClick={() => disburse(r.id)}>Disburse</button>}
              {["open", "partially_settled"].includes(r.status) &&
                <button className="btn btn-blu btn-sm" onClick={() => setSettleFor(r)}>Settle</button>}
            </span>) },
        ]} rows={data} onRow={(r) => setDetailFor(r)} />
      </Card>
      {createType && <CreateAdvanceModal advanceType={createType} onClose={() => setCreateType(null)} onCreated={refresh} />}
      {settleFor && <SettleAdvanceModal advance={settleFor} onClose={() => setSettleFor(null)} onSettled={refresh} />}
      {detailFor && <AdvanceDetailModal advance={detailFor} onClose={() => setDetailFor(null)} />}
    </>
  );
}
