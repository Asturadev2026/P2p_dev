import { useEffect, useState } from "react";

/* Currency / formatting helpers (Indian system) */
export const inr = (n) => {
  if (n == null) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
export const inrFull = (n) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
export const dt = (s) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const dtt = (s) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(2)}%`);

export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [...deps, tick]);
  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}

export function Kpi({ label, value, note, noteClass = "", onClick, onSummary }) {
  return (
    <div className={`kpi${onClick ? " kpi-link" : ""}`} onClick={onClick}
      title={onClick ? "Click to view items" : undefined}>
      {onSummary && (
        <button className="kpi-ai" title="View summary"
          onClick={(e) => { e.stopPropagation(); onSummary(); }}>≡</button>
      )}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className={`kpi-note ${noteClass}`}>{note}</div>}
      {onClick && <div className="kpi-drill">view items ↗</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, pad = true }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            <div className="card-title">{title}</div>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </div>
  );
}

export function DataTable({ columns, rows, onRow, empty = "Nothing here yet" }) {
  if (!rows?.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : ""} style={{textAlign: c.num ? "right" : "left"}}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={() => onRow && onRow(r)} style={{ cursor: onRow ? "pointer" : "default" }}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : ""}>
                  {c.render ? c.render(r) : r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHIP_MAP = {
  // invoice stages
  capture: "chip-blue", match: "chip-purple", gst2b: "chip-teal", tds: "chip-amber",
  approval: "chip-orange", liability: "chip-blue", payments: "chip-amber", paid: "chip-green",
  rejected: "chip-red", on_hold: "chip-red",
  // generic statuses
  active: "chip-green", open: "chip-blue", closed: "chip-grey", settled: "chip-green",
  pending: "chip-amber", pending_approval: "chip-amber", approved: "chip-green",
  declined: "chip-red", accepted: "chip-green", draft: "chip-grey",
  auto_matched: "chip-green", exception: "chip-red", matched: "chip-green",
  mismatch_tax: "chip-red", not_in_2b: "chip-amber", offered: "chip-amber",
  released: "chip-green", reconciled: "chip-green", building: "chip-amber", file_generated: "chip-blue",
  in_progress: "chip-amber", won: "chip-green", bidding: "chip-amber", listed: "chip-blue",
  queued: "chip-amber", failed: "chip-red", success: "chip-green", pushed: "chip-green",
  ready: "chip-amber", signed: "chip-green", simulated: "chip-amber", live: "chip-green",
  auto_approved: "chip-green", skipped: "chip-grey", high: "chip-red", normal: "chip-grey",
  partially_settled: "chip-amber", converted_po: "chip-green", converted_rfq: "chip-blue",
  quoted: "chip-amber", awarded: "chip-green", recorded: "chip-blue", validated: "chip-green",
  msme_priority: "chip-orange", partially_received: "chip-amber",
};

export function Chip({ value, label }) {
  const cls = CHIP_MAP[value] || "chip-grey";
  return <span className={`chip ${cls}`}>{(label ?? value ?? "—").toString().replaceAll("_", " ")}</span>;
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 860 } : {}} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button className="btn btn-gho btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function DetailGrid({ items }) {
  return (
    <div className="detail-grid">
      {items.filter(([, v]) => v !== undefined).map(([l, v]) => (
        <div className="detail-item" key={l}>
          <div className="dl">{l}</div>
          <div className="dv">{v ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

export function PageHead({ title, sub, actions }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">{title}</div>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}
