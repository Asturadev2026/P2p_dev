import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useFetch, Kpi, Card, DataTable, Chip, inr, dt, Loading, PageHead } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

const STAGE_ROUTE = { capture: "/capture", match: "/match", gst2b: "/gst2b", tds: "/tds",
  approval: "/approvals", liability: "/liability", payments: "/payments", paid: "/payments" };
const STAGE_ORDER = ["capture", "match", "gst2b", "tds", "approval", "liability", "payments", "paid"];

export default function CommandCentre() {
  const nav = useNavigate();
  const [summary, setSummary] = useState(null);
  const { data, loading } = useFetch(() => api.get("/dashboard/stats"), []);
  if (loading || !data) return <Loading />;

  const pipeMap = Object.fromEntries(data.pipeline.map((p) => [p.stage, p]));
  const totalValue = data.pipeline.filter(p => p.stage !== "paid").reduce((s, p) => s + Number(p.value), 0);

  return (
    <>
      <PageHead title="Command Centre" sub="Live AP & Discounting overview · refreshed on load" />
      <div className="kpi-row">
        <Kpi label="In Pipeline" value={inr(totalValue)} note={`across ${data.pipeline.length} stages`}
          onSummary={() => setSummary({ entity: "invoices", filters: { open_only: true }, title: "Invoices in pipeline" })} />
        <Kpi label="Match Exceptions" value={data.match_exceptions} note="price + qty variances flagged" noteClass="down"
          onClick={() => nav("/match")}
          onSummary={() => setSummary({ entity: "invoices", filters: { match_status: "exception" }, title: "Match exceptions" })} />
        <Kpi label="MSME 45-Day Risk" value={inr(data.msme_risk.value)} note={`${data.msme_risk.n} invoices · Section 43B(h)`} noteClass="down"
          onSummary={() => setSummary({ entity: "invoices", filters: { msme: true, open_only: true }, title: "MSME 45-day exposure" })} />
        <Kpi label="EBITDA Gain · Total" value={inr(data.ebitda.ytd)} note="treasury · CC · TReDS" noteClass="up"
          onClick={() => nav("/discount-desk")}
          onSummary={() => setSummary({ entity: "deals", filters: {}, title: "Discount deals" })} />
        <Kpi label="TDS Liability" value={inr(data.tds.liability)} note={`${data.tds.deductees} deductee records · ITNS 281`}
          onClick={() => nav("/tds")}
          onSummary={() => setSummary({ entity: "invoices", filters: { has_tds: true }, title: "TDS deductions" })} />
      </div>
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}

      <Card title="End-to-end pipeline" sub="click any stage to drill down">
        <div className="pipeline">
          {STAGE_ORDER.map((s) => (
            <div className="pipe-stage" key={s} onClick={() => nav(STAGE_ROUTE[s])}>
              <div className="pipe-count">{pipeMap[s]?.count ?? 0}</div>
              <div className="pipe-label">{s}</div>
              <div className="pipe-value">{inr(pipeMap[s]?.value ?? 0)}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Top open invoices · by value" sub="click any row for the full trail">
          <DataTable
            columns={[
              { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
              { key: "vendor_name", label: "Vendor" },
              { key: "total_amount", label: "Amount", num: true, render: (r) => inr(r.total_amount) },
              { key: "stage", label: "Stage", render: (r) => <Chip value={r.stage} /> },
              { key: "due_date", label: "Due", render: (r) => dt(r.due_date) },
            ]}
            rows={data.top_open_invoices}
            onRow={(r) => nav(STAGE_ROUTE[r.stage] || "/capture")}
          />
        </Card>
        <div>
          <Card title="Compliance & risk" sub="live regulatory exposure">
            <div className="detail-grid">
              <div className="detail-item"><div className="dl">GST 2B matched</div><div className="dv">{data.gst2b.matched}</div></div>
              <div className="detail-item"><div className="dl">2B mismatches</div><div className="dv" style={{color:"var(--red-600)"}}>{data.gst2b.mismatched + data.gst2b.not_in_2b}</div></div>
              <div className="detail-item"><div className="dl">Pending · Maker</div><div className="dv">{data.pending_approvals.maker}</div></div>
              <div className="detail-item"><div className="dl">Pending · Checker</div><div className="dv">{data.pending_approvals.checker}</div></div>
              <div className="detail-item"><div className="dl">Pending · FC/CFO</div><div className="dv">{data.pending_approvals.fc_cfo}</div></div>
              <div className="detail-item"><div className="dl">Active vendors</div><div className="dv">{data.vendors.total} · {data.vendors.msme} MSME</div></div>
            </div>
          </Card>
          <Card title="Capture sources · all time" sub="multi-channel · OCR-validated">
            {data.capture_sources.map((s) => (
              <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 110, fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" }}>{s.source.replace("_", " ")}</div>
                <div className="progress" style={{ flex: 1 }}>
                  <div style={{ width: `${(s.count / data.capture_sources[0].count) * 100}%` }} />
                </div>
                <div className="mono" style={{ width: 24, textAlign: "right" }}>{s.count}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
