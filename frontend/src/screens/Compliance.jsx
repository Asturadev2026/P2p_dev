import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, PageHead, Loading, Kpi, dt } from "../components/ui";

/* Compliance — Pending Vendor Approvals.
   Only reachable by the Compliance Reviewer role (route + nav are role-gated, and every
   action is enforced server-side). */

function VerifChip({ status }) {
  if (!status) return <span className="chip chip-grey">n/a</span>;
  const cls = { verified: "chip-green", pending: "chip-amber", mismatch: "chip-red", failed: "chip-red" }[status] || "chip-grey";
  return <span className={`chip ${cls}`}>{status}</span>;
}

export default function ComplianceDashboard() {
  const { toast } = useApp();
  const { data: stats } = useFetch(() => api.get("/vendors/compliance/stats"), []);
  const { data: queue, loading, refresh } = useFetch(() => api.get("/vendors/compliance/queue"), []);
  const [active, setActive] = useState(null);
  const [verifs, setVerifs] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [reason, setReason] = useState("");

  const openView = async (v) => { setActive(v); setVerifs(await api.get(`/vendors/${v.id}/verifications`)); };

  const approve = async (v) => {
    try { await api.post(`/vendors/${v.id}/approve`, {}); toast(`${v.name} activated`); setActive(null); refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const doReject = async () => {
    if (!reason.trim()) { toast("Rejection reason is mandatory", true); return; }
    try {
      await api.post(`/vendors/${rejectFor.id}/reject`, { reason });
      toast(`${rejectFor.name} rejected`); setRejectFor(null); setReason(""); setActive(null); refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (loading) return <Loading />;
  const s = stats || {};
  const rows = queue || [];

  return (
    <>
      <PageHead title="Compliance — Pending Vendor Approvals"
        sub="Review KYC and server-side verification, then approve or reject with reason" />

      <div className="kpi-row">
        <Kpi label="Pending" value={s.pending ?? 0} note="awaiting decision" />
        <Kpi label="Approved today" value={s.approved_today ?? 0} note="activated" noteClass="up" />
        <Kpi label="Rejected today" value={s.rejected_today ?? 0} note="with reason" noteClass="down" />
        <Kpi label="Avg processing" value={s.avg_hours != null ? `${s.avg_hours} h` : "—"} note="submit → approve" />
      </div>

      <Card title="Pending compliance" sub="Approve activates the vendor · Reject requires a reason" pad={false}>
        <DataTable
          columns={[
            { key: "name", label: "Vendor" },
            { key: "vendor_type", label: "Type", render: (r) => <Chip value={r.vendor_type} /> },
            { key: "submitted_at", label: "Submitted", render: (r) => dt(r.submitted_at) },
            { key: "gst_status", label: "GST", render: (r) => <VerifChip status={r.gst_status} /> },
            { key: "pan_status", label: "PAN", render: (r) => <VerifChip status={r.pan_status} /> },
            { key: "msme_status", label: "MSME", render: (r) => <VerifChip status={r.msme_status} /> },
            { key: "bank_status", label: "Bank", render: (r) => <VerifChip status={r.bank_status} /> },
            { key: "dtaa_status", label: "DTAA", render: (r) => r.vendor_type === "foreign" ? <VerifChip status={r.dtaa_status} /> : "—" },
            { key: "_a", label: "Actions", render: (r) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); openView(r); }}>View</button>
                <button className="btn btn-pri btn-sm" onClick={(e) => { e.stopPropagation(); approve(r); }}>Approve</button>
                <button className="btn btn-gho btn-sm" onClick={(e) => { e.stopPropagation(); setRejectFor(r); }}>Reject</button>
              </div>
            ) },
          ]}
          rows={rows}
          onRow={openView}
          empty="No vendors pending compliance."
        />
      </Card>

      {active && (
        <Modal wide title={`${active.id} · ${active.name}`} onClose={() => setActive(null)}
          footer={<>
            <button className="btn btn-gho" onClick={() => setRejectFor(active)}>Reject</button>
            <button className="btn btn-pri" onClick={() => approve(active)}>Approve &amp; Activate</button>
          </>}>
          <p style={{ margin: "0 0 10px", color: "#666" }}>
            {active.vendor_type} · {active.state || "—"} · {active.contact_email || ""}
          </p>
          <h4 style={{ margin: "8px 0" }}>Server-side verification</h4>
          <DataTable
            columns={[
              { key: "kind", label: "Check", render: (r) => r.kind.toUpperCase() },
              { key: "status", label: "Status", render: (r) => <VerifChip status={r.status} /> },
              { key: "reference_id", label: "Reference id", render: (r) => <span className="mono">{r.reference_id}</span> },
              { key: "checked_at", label: "Checked", render: (r) => dt(r.checked_at) },
            ]}
            rows={verifs || []}
            empty="No verifications recorded."
          />
          {active.vendor_type === "foreign" && active.dtaa_status !== "verified" && (
            <p style={{ color: "#c0392b", marginTop: 10 }}>⚠ DTAA missing/expired — activation is blocked for this foreign vendor.</p>
          )}
          {active.bank_status === "failed" && !active.bank_override_reason && (
            <p style={{ color: "#c0392b", marginTop: 10 }}>⚠ Bank penny-drop failed — admin override (with reason) required before activation.</p>
          )}
          {(active.gst_status === "mismatch" || active.pan_status === "mismatch") && (
            <p style={{ color: "#a6791f", marginTop: 10 }}>⚠ GST/PAN mismatch is a warning only — compliance decides; it does not auto-block.</p>
          )}
        </Modal>
      )}

      {rejectFor && (
        <Modal title={`Reject ${rejectFor.name}`} onClose={() => { setRejectFor(null); setReason(""); }}
          footer={<button className="btn btn-pri" onClick={doReject}>Confirm rejection</button>}>
          <div className="field">
            <label>REASON (mandatory)</label>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this vendor is being rejected…"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontFamily: "inherit", fontSize: 14 }} />
          </div>
        </Modal>
      )}
    </>
  );
}
