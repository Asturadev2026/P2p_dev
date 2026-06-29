import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, PageHead, Loading, Kpi,
         inr, inrFull, dt, dtt } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Approvals ============ */
export function Approvals() {
  const { user, toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/approvals/queue"), []);
  const { data: matrix } = useFetch(() => api.get("/approvals/matrix"), []);

  const act = async (id, decision) => {
    try { const res = await api.post(`/approvals/${id}/act`, { decision, comments: `${decision} via UI` });
      toast(`Stage ${decision}d · chain: ${res.chain_status}${res.next_stage ? " → " + res.next_stage : ""}`);
      refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Approval Workflow" sub={`Signed in as ${user.name} (${user.role}) — your actionable queue below`} />
      <Card title="My pending approvals" sub="SLA-tracked · stages activate in sequence" pad={false}>
        <DataTable columns={[
          { key: "entity_type", label: "Type", render: (r) => <Chip value="open" label={r.entity_type.replace("_", " ")} /> },
          { key: "entity_id", label: "Reference", render: (r) => <span className="mono">{r.entity_id}</span> },
          { key: "entity_summary", label: "Summary" },
          { key: "stage_no", label: "Stage", render: (r) => `${r.stage_no} · ${r.stage_role.toUpperCase()}` },
          { key: "sla_due_at", label: "SLA due", render: (r) => r.sla_due_at ? dtt(r.sla_due_at) : "—" },
          { key: "_", label: "Action", render: (r) => r.actionable ? (
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-grn btn-sm" onClick={(e) => { e.stopPropagation(); act(r.id, "approve"); }}>Approve</button>
              <button className="btn btn-red btn-sm" onClick={(e) => { e.stopPropagation(); act(r.id, "reject"); }}>Reject</button>
            </span>) : <Chip value="pending" label="awaiting earlier stage" /> },
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
    </>
  );
}

/* ============ Liability & JV ============ */
export function LiabilityJv() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/payments/jvs"), []);
  const push = async (id) => {
    try { const res = await api.post(`/payments/jvs/${encodeURIComponent(id)}/push`);
      toast(`Pushed · ERP doc ${res.erp_doc_no}`); refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Liability & JV Posting" sub="Dr/Cr balanced · GL auto-derived · structured ERP hand-off" />
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
          { key: "_", label: "", render: (r) => r.status === "ready" &&
            <button className="btn btn-blu btn-sm" onClick={(e) => { e.stopPropagation(); push(r.id); }}>Push to ERP</button> },
        ]} rows={data} />
      </Card>
    </>
  );
}

/* ============ Payment Batches ============ */
export function PaymentBatches() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/payments/batches"), []);
  const { data: ready, refresh: refreshReady } = useFetch(() => api.get("/invoices", { stage: "payments" }), []);
  const [items, setItems] = useState(null);
  const [batchId, setBatchId] = useState(null);

  const openBatch = async (b) => { setBatchId(b.id); setItems(await api.get(`/payments/batches/${encodeURIComponent(b.id)}/items`)); };
  const build = async () => {
    const ids = ready.filter((i) => !i.in_batch).map((i) => i.id);
    if (!ids.length) return toast("No invoices at payments stage", true);
    try { const res = await api.post("/payments/batches", { invoice_ids: ids, channel: "NEFT" });
      toast(`Built ${res.id} · ${inrFull(res.total_amount)}`); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const release = async (id) => {
    try { await api.post(`/payments/batches/${encodeURIComponent(id)}/release`); toast("Batch released to bank portal"); refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const captureUtr = async (id) => {
    try { const res = await api.post(`/payments/batches/${encodeURIComponent(id)}/capture-utr`);
      toast(`${res.utrs.length} UTRs captured · invoices marked paid · remittance advices sent`);
      refresh(); refreshReady(); if (batchId === id) openBatch({ id });
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Payment Batches" sub="bank-ready payout file · UTR capture · branded remittance advice"
        actions={<button className="btn btn-pri" onClick={build}>+ Build batch from payments queue ({ready?.length ?? 0})</button>} />
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
              <a className="btn btn-gho btn-sm" href={api.downloadUrl(`/payments/batches/${encodeURIComponent(r.id)}/file`)} target="_blank" rel="noreferrer">CSV</a>
              {["building", "file_generated"].includes(r.status) &&
                <button className="btn btn-grn btn-sm" onClick={() => release(r.id)}>Release</button>}
              {r.status === "released" &&
                <button className="btn btn-blu btn-sm" onClick={() => captureUtr(r.id)}>Capture UTR</button>}
            </span>) },
        ]} rows={data} onRow={openBatch} />
      </Card>
      {items && (
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
    </>
  );
}

/* ============ Advances & Imprest ============ */
export function Advances() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/payments/advances"), []);
  const [summary, setSummary] = useState(null);
  if (loading) return <Loading />;
  const open = data.filter((a) => ["open", "partially_settled"].includes(a.status));
  return (
    <>
      <PageHead title="Advances & Imprest" sub="auto-adjustment against final bills · bill-based reconciliation" />
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
        ]} rows={data} />
      </Card>
    </>
  );
}
