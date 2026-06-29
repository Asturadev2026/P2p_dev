import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, PageHead, Loading, Kpi,
         inr, inrFull, dt, dtt, pct } from "../components/ui";

/* ============ Reports ============ */
export function Reports() {
  const [dim, setDim] = useState("department");
  const { data: spend, loading } = useFetch(() => api.get("/reports/spend", { dimension: dim }), [dim]);
  const { data: ageing } = useFetch(() => api.get("/reports/ageing"), []);
  const { data: sla } = useFetch(() => api.get("/reports/approval-sla"), []);
  const { data: stat } = useFetch(() => api.get("/reports/statutory"), []);
  if (loading || !stat) return <Loading />;
  return (
    <>
      <PageHead title="Reports" sub="operational + statutory · CSV export per report"
        actions={<a className="btn btn-gho" href={api.downloadUrl(`/reports/export?report=spend&dimension=${dim}`)} target="_blank" rel="noreferrer">Export CSV</a>} />
      <Card title="Spend cube" sub="by department · vendor · category · branch"
        actions={["department", "vendor", "category", "branch"].map((d) => (
          <button key={d} className={`btn btn-sm ${dim === d ? "btn-pri" : "btn-gho"}`} onClick={() => setDim(d)}>{d}</button>
        ))} pad={false}>
        <DataTable columns={[
          { key: "name", label: dim },
          { key: "invoices", label: "Invoices", num: true },
          { key: "spend", label: "Spend", num: true, render: (r) => inr(r.spend) },
          { key: "gst", label: "GST", num: true, render: (r) => inr(r.gst) },
          { key: "tds", label: "TDS", num: true, render: (r) => inr(r.tds) },
        ]} rows={spend} />
      </Card>
      <div className="grid-2">
        <Card title="Ageing · open payables" pad={false}>
          <DataTable columns={[
            { key: "bucket", label: "Bucket" },
            { key: "invoices", label: "Invoices", num: true },
            { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
          ]} rows={ageing || []} />
        </Card>
        <Card title="Approval SLA · by stage role" pad={false}>
          <DataTable columns={[
            { key: "stage_role", label: "Role" },
            { key: "pending", label: "Pending", num: true },
            { key: "sla_breached", label: "Breached", num: true },
            { key: "actioned", label: "Actioned", num: true },
            { key: "avg_hours", label: "Avg hrs", num: true },
          ]} rows={sla || []} />
        </Card>
      </div>
      <Card title="Statutory exposure" sub="MSME 45-day · TDS · GST ITC · RCM">
        <div className="kpi-row">
          <Kpi label="MSME at-risk invoices" value={stat.msme_45day.length} note="Section 43B(h)" noteClass="down" />
          <Kpi label="GST ITC at risk" value={inrFull(stat.gst_itc_risk.itc_at_risk)} note={`${stat.gst_itc_risk.invoices} mismatched invoice(s)`} noteClass="down" />
          <Kpi label="RCM liability" value={inrFull(stat.rcm.liability)} note={`${stat.rcm.invoices} invoice(s)`} />
        </div>
        <DataTable columns={[
          { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "MSME vendor" },
          { key: "net_payable", label: "Net payable", num: true, render: (r) => inrFull(r.net_payable) },
          { key: "msme_due_date", label: "45-day due", render: (r) => dt(r.msme_due_date) },
          { key: "days_remaining", label: "Days left", num: true, render: (r) =>
            <span style={{ color: r.days_remaining <= 7 ? "var(--red-600)" : undefined, fontWeight: 700 }}>{r.days_remaining}</span> },
        ]} rows={stat.msme_45day} empty="No MSME invoices at risk" />
      </Card>
    </>
  );
}

/* ============ ERP / Bank Sync ============ */
export function ErpSync() {
  const { data, loading } = useFetch(() => api.get("/admin/sync-log"), []);
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="ERP / Bank Sync" sub="every external call logged · simulated until Intelezen APIs go live" />
      <Card title="Recent sync activity" sub="bidirectional · vendor master · JV · payments · verifications" pad={false}>
        <DataTable columns={[
          { key: "at", label: "Time", render: (r) => dtt(r.at) },
          { key: "integration_name", label: "Integration" },
          { key: "direction", label: "Dir", render: (r) => <Chip value={r.direction === "push" ? "open" : "active"} label={r.direction} /> },
          { key: "object_type", label: "Object" },
          { key: "reference", label: "Reference", render: (r) => <span className="mono">{r.reference}</span> },
          { key: "result", label: "Result", render: (r) => <Chip value={r.result} /> },
          { key: "simulated", label: "Mode", render: (r) => <Chip value={r.simulated ? "simulated" : "live"} /> },
        ]} rows={data} />
      </Card>
    </>
  );
}

/* ============ Audit Trail ============ */
export function AuditTrail() {
  const { toast } = useApp();
  const { data, loading } = useFetch(() => api.get("/admin/audit", { limit: 200 }), []);
  const verify = async () => {
    const res = await api.get("/admin/audit/verify-chain");
    toast(res.chain_intact ? `Hash chain intact · ${res.rows_checked} rows verified` : `TAMPER DETECTED at rows ${res.breaks.join(", ")}`, !res.chain_intact);
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Audit Trail" sub="named user · timestamp · before/after state · sha-256 hash chain"
        actions={<button className="btn btn-blu" onClick={verify}>Verify tamper-evidence</button>} />
      <Card pad={false}>
        <DataTable columns={[
          { key: "at", label: "Time", render: (r) => dtt(r.at) },
          { key: "actor_name", label: "Actor" },
          { key: "action", label: "Action" },
          { key: "entity_id", label: "Target", render: (r) => <span className="mono">{r.entity_id || "—"}</span> },
          { key: "detail", label: "Detail" },
          { key: "row_hash", label: "Hash", render: (r) => <span className="mono" style={{ color: "var(--ink-400)" }}>{r.row_hash?.slice(0, 10)}…</span> },
        ]} rows={data} />
      </Card>
    </>
  );
}

/* ============ Admin Console ============ */
export function AdminConsole() {
  const { user, toast } = useApp();
  const { data: config, loading, refresh } = useFetch(() => api.get("/admin/configuration"), []);
  const { data: integrations, refresh: refreshInt } = useFetch(() => api.get("/admin/integrations"), []);
  const { data: agents } = useFetch(() => api.get("/admin/agent-invocations"), []);
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState("");

  const save = async () => {
    try {
      await api.put(`/admin/configuration/${editKey}`, { value: JSON.parse(editVal) });
      toast(`Saved ${editKey}`); setEditKey(null); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const toggleMode = async (i) => {
    const mode = i.mode === "simulated" ? "live" : "simulated";
    try {
      await api.put(`/admin/integrations/${i.id}`,
        { mode, base_url: mode === "live" ? (i.base_url || prompt("Intelezen-provided API base URL:")) : null });
      toast(`${i.name} → ${mode}`); refreshInt();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Admin Console" sub={`rules as configuration · signed in as ${user.name} (${user.role})`} />
      <Card title="Integration mode switches" sub="simulated for testing · live in production with Intelezen-provided APIs" pad={false}>
        <DataTable columns={[
          { key: "name", label: "Integration" },
          { key: "mode", label: "Mode", render: (r) => <Chip value={r.mode} /> },
          { key: "base_url", label: "Live endpoint", render: (r) => r.base_url || "—" },
          { key: "api_key_ref", label: "Key env var", render: (r) => <span className="mono">{r.api_key_ref}</span> },
          { key: "_", label: "", render: (r) => (
            <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); toggleMode(r); }}>
              Switch to {r.mode === "simulated" ? "live" : "simulated"}
            </button>) },
        ]} rows={integrations || []} />
      </Card>
      <Card title="Rules engine configuration" sub="tolerances · thresholds · TDS rates · SLAs — click to edit (admin only)" pad={false}>
        <DataTable columns={[
          { key: "key", label: "Key", render: (r) => <span className="mono">{r.key}</span> },
          { key: "value", label: "Value", render: (r) => <span className="mono">{JSON.stringify(r.value)}</span> },
          { key: "description", label: "Description" },
          { key: "updated_at", label: "Updated", render: (r) => dtt(r.updated_at) },
        ]} rows={config} onRow={(r) => { setEditKey(r.key); setEditVal(JSON.stringify(r.value)); }} />
      </Card>
      {editKey && (
        <Card title={`Edit · ${editKey}`} actions={<>
          <button className="btn btn-gho btn-sm" onClick={() => setEditKey(null)}>Cancel</button>
          <button className="btn btn-pri btn-sm" onClick={save}>Save</button></>}>
          <div className="field"><label>Value (JSON)</label>
            <textarea value={editVal} onChange={(e) => setEditVal(e.target.value)} /></div>
        </Card>
      )}
      <Card title="AI agent invocations" sub="every GPT-4o call audited · human-in-the-loop outcomes" pad={false}>
        <DataTable columns={[
          { key: "at", label: "Time", render: (r) => dtt(r.at) },
          { key: "agent", label: "Agent", render: (r) => <Chip value="open" label={r.agent} /> },
          { key: "entity_id", label: "Entity", render: (r) => <span className="mono">{r.entity_id}</span> },
          { key: "confidence", label: "Conf", num: true, render: (r) => pct(r.confidence) },
          { key: "accepted", label: "Human outcome", render: (r) =>
            r.accepted == null ? <Chip value="pending" label="awaiting" /> : <Chip value={r.accepted ? "accepted" : "declined"} /> },
          { key: "latency_ms", label: "Latency", num: true, render: (r) => `${r.latency_ms}ms` },
        ]} rows={agents || []} />
      </Card>
    </>
  );
}
