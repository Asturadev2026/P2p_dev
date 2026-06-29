import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Modal, DataTable, Chip, inr, inrFull, dt, pct } from "./ui";

/* Column layouts per entity (match the summary router's fetcher output). */
const COLS = {
  invoices: [
    { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
    { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
    { key: "total_amount", label: "Amount", num: true, render: (r) => inr(r.total_amount) },
    { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
    { key: "source", label: "Source", render: (r) => <Chip value={r.source} label={r.source?.replace("_", " ")} /> },
    { key: "due_date", label: "Due", render: (r) => dt(r.due_date) },
  ],
  vendors: [
    { key: "id", label: "ID", render: (r) => <span className="mono">{r.id}</span> },
    { key: "name", label: "Vendor", render: (r) => <><b>{r.name}</b><div style={{ fontSize: 11, color: "var(--ink-500)" }}>{r.gstin || "—"}</div></> },
    { key: "tier", label: "Tier" },
    { key: "is_msme", label: "MSME", render: (r) => r.is_msme ? <Chip value="msme_priority" label="MSME" /> : "—" },
    { key: "tds_section", label: "TDS" },
    { key: "spend_ytd", label: "Spend YTD", num: true, render: (r) => inr(r.spend_ytd) },
  ],
  requisitions: [
    { key: "id", label: "PR", render: (r) => <span className="mono">{r.id}</span> },
    { key: "title", label: "Title" },
    { key: "department_name", label: "Department" },
    { key: "requester_name", label: "Requester" },
    { key: "total_amount", label: "Amount", num: true, render: (r) => inr(r.total_amount) },
    { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
  ],
  purchase_orders: [
    { key: "id", label: "PO", render: (r) => <span className="mono">{r.id}</span> },
    { key: "vendor_name", label: "Vendor" },
    { key: "department_name", label: "Dept" },
    { key: "amount", label: "Amount", num: true, render: (r) => inr(r.amount) },
    { key: "esign_status", label: "e-Sign", render: (r) => <Chip value={r.esign_status || "—"} /> },
    { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
  ],
  deals: [
    { key: "id", label: "Deal", render: (r) => <span className="mono">{r.id}</span> },
    { key: "vendor_name", label: "Vendor" },
    { key: "pool_name", label: "Pool" },
    { key: "advance_amount", label: "Advance", num: true, render: (r) => inrFull(r.advance_amount) },
    { key: "vendor_rate_pct", label: "V rate", num: true, render: (r) => pct(r.vendor_rate_pct) },
    { key: "ebitda_gain", label: "Gain", num: true, render: (r) => inrFull(r.ebitda_gain) },
    { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
  ],
  early_pay: [
    { key: "id", label: "Req", render: (r) => <span className="mono">{r.id}</span> },
    { key: "vendor_name", label: "Vendor" },
    { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id}</span> },
    { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
    { key: "days_available", label: "Days", num: true },
    { key: "expected_gain", label: "Exp gain", num: true, render: (r) => inrFull(r.expected_gain) },
    { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
  ],
  advances: [
    { key: "id", label: "Ref", render: (r) => <span className="mono">{r.id}</span> },
    { key: "advance_type", label: "Type", render: (r) => <Chip value={r.advance_type === "imprest" ? "open" : "active"} label={r.advance_type?.replace("_", " ")} /> },
    { key: "party", label: "Vendor / Holder" },
    { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
    { key: "balance", label: "Balance", num: true, render: (r) => inrFull(r.balance) },
    { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
  ],
};

export default function SummaryModal({ entity, filters = {}, title, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    api.post("/ai/summary", { entity, filters })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message || "Failed to load summary"));
    return () => { live = false; };
  }, [entity, JSON.stringify(filters)]);

  return (
    <Modal title={`Summary — ${title}`} onClose={onClose} wide>
      {error && <div className="empty" style={{ color: "var(--red-600)" }}>⚠ {error}</div>}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <>
          <div style={{ background: "var(--orange-50)", border: "1px solid var(--orange-100)",
            borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
            <b style={{ fontSize: 12.5, display: "block", marginBottom: 6 }}>{data.count} item(s) in view</b>
            <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{data.summary}</div>
            {data.highlights?.length > 0 && (
              <ul style={{ margin: "8px 0 0 16px", fontSize: 12, lineHeight: 1.6 }}>
                {data.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
            {data.source && (
              <div style={{ marginTop: 8, fontSize: 10, color: "var(--ink-400)" }}>
                Source: {data.source} · {data.latency_ms ?? "?"}ms · logged to audit trail
              </div>
            )}
          </div>
          <DataTable columns={COLS[entity] || COLS.invoices} rows={data.items}
            empty="No items in this scope" />
        </>
      )}
    </Modal>
  );
}
