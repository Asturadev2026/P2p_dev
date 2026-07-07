import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, DetailGrid, Loading, dt, dtt } from "../components/ui";

/* Vendor Detail — Profile / KYC / Bank / Addresses / Contacts / Sub Vendors /
   DTAA / Documents / Audit / Timeline. Compliance actions inline (role-gated;
   also enforced server-side). */

const TABS = ["Profile", "KYC", "Bank", "Addresses", "Contacts", "Sub Vendors", "DTAA", "Documents", "Audit", "Timeline"];

function VerifChip({ status }) {
  if (!status) return <span className="chip chip-grey">n/a</span>;
  const cls = { verified: "chip-green", pending: "chip-amber", mismatch: "chip-red", failed: "chip-red" }[status] || "chip-grey";
  return <span className={`chip ${cls}`}>{status}</span>;
}

export default function VendorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get(`/vendors/${id}/detail`), [id]);
  const [tab, setTab] = useState("Profile");
  const [reasonFor, setReasonFor] = useState(null);   // 'reject' | 'suspend'
  const [reason, setReason] = useState("");

  if (loading) return <Loading />;
  if (!data?.vendor) return <div className="empty">Vendor not found.</div>;

  const v = data.vendor;
  const onb = data.onboarding || {};
  const kyc = onb.kyc_payload || {};
  const isCompliance = user?.role === "compliance";

  const act = async (verb, body) => {
    try {
      await api.post(`/vendors/${id}/${verb}`, body || {});
      toast(`Vendor ${verb} done`);
      setReasonFor(null); setReason(""); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const submitReason = () => {
    if (!reason.trim()) { toast("Reason is mandatory", true); return; }
    act(reasonFor, { reason });
  };

  const statusChip = <Chip value={v.status === "pending_compliance" ? "in_progress" : v.status} label={v.status?.replaceAll("_", " ")} />;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <button className="btn btn-gho btn-sm" onClick={() => navigate("/vendors")}>← Vendor Master</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div className="page-title">{v.name} <span className="mono" style={{ fontSize: 14, color: "#9098a5" }}>· {v.id}</span></div>
          <div className="page-sub">{v.vendor_type} · {v.state || "—"} · {v.category_name || "—"} · {statusChip}</div>
        </div>
        {isCompliance && (
          <div style={{ display: "flex", gap: 8 }}>
            {v.status === "pending_compliance" && <>
              <button className="btn btn-pri" onClick={() => act("approve")}>Approve</button>
              <button className="btn btn-gho" onClick={() => setReasonFor("reject")}>Reject</button>
            </>}
            {v.status === "active" && <button className="btn btn-gho" onClick={() => setReasonFor("suspend")}>Suspend</button>}
            {v.status === "suspended" && <button className="btn btn-pri" onClick={() => act("resume")}>Resume</button>}
          </div>
        )}
      </div>

      {/* Verification summary strip */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16, fontSize: 13 }}>
        {["gst", "pan", "msme", "bank"].map((k) => (
          <span key={k}>{k.toUpperCase()} <VerifChip status={v[`${k}_status`]} /></span>
        ))}
        {v.vendor_type === "foreign" && <span>DTAA <VerifChip status={v.dtaa_status} /></span>}
        {v.bank_override_reason && <span style={{ color: "#b8600b" }}>· bank override: {v.bank_override_reason}</span>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid #e3e1d9", marginBottom: 18, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <div key={t} onClick={() => setTab(t)}
              style={{ padding: "0 2px 10px", cursor: "pointer", fontSize: 14, fontWeight: on ? 700 : 500,
                color: on ? "#16233d" : "#7a828f", borderBottom: on ? "2px solid #c0392b" : "2px solid transparent", marginBottom: -1 }}>
              {t}
            </div>
          );
        })}
      </div>

      {tab === "Profile" && (
        <Card title="Profile">
          <DetailGrid items={[
            ["Vendor ID", v.id], ["Legal name", v.name], ["Type", v.vendor_type], ["Status", v.status?.replaceAll("_", " ")],
            ["GSTIN", v.gstin || "—"], ["PAN", v.pan || "—"], ["State", v.state || "—"], ["Country", v.country || "—"],
            ["Category", v.category_name || "—"], ["Products", v.products || "—"], ["Tier", v.tier || "—"], ["Rating", v.rating ?? "—"],
            ["Payment terms", `Net ${v.payment_terms_days}`], ["MSME", v.is_msme ? (v.msme_category || "Yes") : "No"],
            ["Udyam", v.udyam_no || "—"], ["ERP vendor", v.erp_vendor_id || "—"],
            ["Approved by", v.approved_by || "—"], ["Approved at", v.approved_at ? dtt(v.approved_at) : "—"],
            ["Rejected reason", v.rejected_reason || "—"], ["Suspended reason", v.suspended_reason || "—"],
          ]} />
        </Card>
      )}

      {tab === "KYC" && (
        <Card title="KYC submission">
          <DetailGrid items={[
            ["Legal name", kyc.legal_name || onb.entity_name || v.name], ["Trade name", kyc.trade_name || onb.trade_name || "—"],
            ["Constitution", onb.constitution || "—"], ["GSTIN", v.gstin || "—"], ["PAN", v.pan || "—"],
            ["Onboarding ID", onb.id || "—"], ["Tracker status", onb.status || "—"],
            ["Submitted at", onb.submitted_at ? dtt(onb.submitted_at) : "—"],
            ["Contact", onb.contact_name || "—"], ["Email", onb.contact_email || "—"], ["Phone", onb.contact_phone || "—"],
          ]} />
          <h4 style={{ margin: "14px 0 8px" }}>Server-side verifications</h4>
          <DataTable columns={[
            { key: "kind", label: "Check", render: (r) => r.kind.toUpperCase() },
            { key: "status", label: "Status", render: (r) => <VerifChip status={r.status} /> },
            { key: "reference_id", label: "Reference id", render: (r) => <span className="mono">{r.reference_id}</span> },
            { key: "checked_at", label: "Checked", render: (r) => dt(r.checked_at) },
          ]} rows={data.verifications} empty="No verifications recorded." />
        </Card>
      )}

      {tab === "Bank" && (
        <Card title="Bank details">
          <DetailGrid items={[
            ["Account name", kyc.bank?.account_name || kyc.bank?.acct_holder || "—"],
            ["Account no", kyc.bank?.account_no || kyc.bank?.acct_number || "—"],
            ["IFSC", kyc.bank?.ifsc || "—"], ["Bank", v.bank_name || kyc.bank?.bank || "—"],
            ["Penny-drop status", v.bank_status || "—"], ["Override reason", v.bank_override_reason || "—"],
          ]} />
        </Card>
      )}

      {tab === "Addresses" && (
        <Card title="Addresses" pad={false}>
          <DataTable columns={[
            { key: "type", label: "Type", render: (r) => r.type || r.address_type || "—" },
            { key: "line", label: "Address", render: (r) => r.line || r.address || "—" },
            { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "pin", label: "PIN", render: (r) => r.pin || r.pin_code || "—" },
          ]} rows={kyc.addresses || []} empty="No addresses captured." />
        </Card>
      )}

      {tab === "Contacts" && (
        <Card title="Contacts" pad={false}>
          <DataTable columns={[
            { key: "is_primary", label: "Primary", render: (r) => (r.is_primary ? "★" : "") },
            { key: "name", label: "Name" }, { key: "designation", label: "Designation" },
            { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
          ]} rows={kyc.contacts || []} empty="No contacts captured." />
        </Card>
      )}

      {tab === "Sub Vendors" && (
        <Card title="Sub vendors" pad={false}>
          <DataTable columns={[
            { key: "name", label: "Name" }, { key: "gstin", label: "GSTIN" }, { key: "pan", label: "PAN" }, { key: "note", label: "Note" },
          ]} rows={kyc.sub_vendors || []} empty="No sub-vendors declared." />
        </Card>
      )}

      {tab === "DTAA" && (
        <Card title="DTAA / foreign compliance">
          {v.vendor_type !== "foreign" ? <div className="empty">Not a foreign vendor.</div> : (
            <DetailGrid items={[
              ["Country", kyc.foreign?.country || v.country || "—"],
              ["TRC ref", kyc.foreign?.trc_ref || kyc.foreign?.trc || "—"],
              ["Form 10F ref", kyc.foreign?.form_10f_ref || kyc.foreign?.form_10f || "—"],
              ["No-PE declaration", kyc.foreign?.no_pe ? "Yes" : "No"],
              ["DTAA rate", kyc.foreign?.dtaa_rate ?? "—"], ["Tax treaty", kyc.foreign?.tax_treaty || "—"],
              ["SWIFT", kyc.foreign?.swift || "—"], ["IBAN", kyc.foreign?.iban || "—"],
              ["DTAA valid till", v.dtaa_valid_till ? dt(v.dtaa_valid_till) : (kyc.foreign?.dtaa_valid_till || "—")],
              ["DTAA status", v.dtaa_status || "—"],
            ]} />
          )}
        </Card>
      )}

      {tab === "Documents" && (
        <Card title="Documents" pad={false}>
          <DataTable columns={[
            { key: "doc_type", label: "Type", render: (r) => r.doc_type || r.type || "—" },
            { key: "file_name", label: "File", render: (r) => r.file_name || r.name || "—" },
          ]} rows={kyc.documents || []} empty="No documents uploaded. (File upload/storage is not yet implemented — TODO.)" />
        </Card>
      )}

      {tab === "Audit" && (
        <Card title="Audit trail (tamper-evident)" pad={false}>
          <DataTable columns={[
            { key: "at", label: "When", render: (r) => dtt(r.at) },
            { key: "actor_name", label: "By" },
            { key: "action", label: "Action" },
            { key: "detail", label: "Detail" },
          ]} rows={data.audit} empty="No audit entries." />
        </Card>
      )}

      {tab === "Timeline" && (
        <Card title="Lifecycle timeline">
          {[
            ["Link sent", onb.link_sent_at], ["Opened", onb.opened_at], ["Submitted", onb.submitted_at],
            ["Approved", v.approved_at], ["Rejected", v.rejected_at], ["Suspended", v.suspended_at],
          ].filter(([, t]) => t).map(([label, t]) => (
            <div key={label} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid #f2f0ea" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#c0392b", flexShrink: 0 }} />
              <b style={{ minWidth: 110 }}>{label}</b>
              <span style={{ color: "#666" }}>{dtt(t)}</span>
            </div>
          ))}
          {!(onb.link_sent_at || onb.submitted_at || v.approved_at) && <div className="empty">No lifecycle events recorded.</div>}
        </Card>
      )}

      {reasonFor && (
        <Modal title={`${reasonFor === "reject" ? "Reject" : "Suspend"} ${v.name}`}
          onClose={() => { setReasonFor(null); setReason(""); }}
          footer={<button className="btn btn-pri" onClick={submitReason}>Confirm</button>}>
          <div className="field">
            <label>REASON (mandatory)</label>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontFamily: "inherit", fontSize: 14 }} />
          </div>
        </Modal>
      )}
    </>
  );
}
