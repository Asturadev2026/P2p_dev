import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, PageHead, Loading, Kpi, DetailGrid,
         inr, inrFull, dtt, pct } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Discount Desk ============ */
export function DiscountDesk() {
  const { data: pools, loading } = useFetch(() => api.get("/discounting/pools"), []);
  const { data: deals } = useFetch(() => api.get("/discounting/deals"), []);
  const [summary, setSummary] = useState(null);
  if (loading || !deals) return <Loading />;
  const mtd = pools.pools.reduce((s, p) => s + +p.gain_mtd, 0);
  return (
    <>
      <PageHead title="Discount Desk" sub="treasury-led · bank CC-led · TReDS — one desk, three pools" />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <div className="kpi-row">
        <Kpi label="Active deals" value={deals.filter((d) => ["active", "offered"].includes(d.status)).length}
          note={inr(deals.filter((d) => ["active", "offered"].includes(d.status)).reduce((s, d) => s + +d.advance_amount, 0)) + " deployed"}
          onSummary={() => setSummary({ entity: "deals", filters: { status: "active" }, title: "Active discount deals" })} />
        <Kpi label="EBITDA · MTD" value={inrFull(mtd)} noteClass="up" note="vendor rate − cost of funds"
          onSummary={() => setSummary({ entity: "deals", filters: {}, title: "All discount deals" })} />
        <Kpi label="Treasury surplus" value={inr(pools.pools.find((p) => p.id === "treasury")?.capacity)} note="idle FDs · available" />
        <Kpi label="CC headroom" value={inr(pools.cc_facilities.reduce((s, c) => s + (+c.sanction - +c.drawn), 0))} note="HDFC + ICICI sanctions" />
      </div>
      <div className="grid-3">
        {pools.pools.map((p) => (
          <Card key={p.id} title={p.name} sub={p.pool_type === "treds" ? "off-balance-sheet · RBI-regulated" : `CoF ${pct(p.cost_of_funds_pct)}`}>
            <DetailGrid items={[
              ["Active deals", p.active_deals], ["Volume", inr(p.volume)],
              ["Gain MTD", inrFull(p.gain_mtd)],
              ["Capacity", p.capacity ? inr(p.capacity) : "Marketplace"],
            ]} />
          </Card>
        ))}
      </div>
      <Card title="Recent deals · all pools" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Deal", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor" },
          { key: "pool_name", label: "Pool" },
          { key: "advance_amount", label: "Advance", num: true, render: (r) => inrFull(r.advance_amount) },
          { key: "days_saved", label: "Days", num: true },
          { key: "vendor_rate_pct", label: "V rate", num: true, render: (r) => pct(r.vendor_rate_pct) },
          { key: "cof_pct", label: "CoF", num: true, render: (r) => pct(r.cof_pct) },
          { key: "spread_pct", label: "Spread", num: true, render: (r) => pct(r.spread_pct) },
          { key: "ebitda_gain", label: "Gain", num: true, render: (r) => inrFull(r.ebitda_gain) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
        ]} rows={deals} />
      </Card>
    </>
  );
}

/* ============ TReDS ============ */
export function Treds() {
  const { data, loading } = useFetch(() => api.get("/discounting/treds"), []);
  const [bids, setBids] = useState(null);
  const [fu, setFu] = useState(null);
  const openBids = async (r) => { setFu(r); setBids(await api.get(`/discounting/treds/${r.id}/bids`)); };
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="TReDS Marketplace" sub="MSME factoring without recourse · financiers compete · settlement T+1/T+2" />
      <div className="grid-3">
        {data.platforms.map((p) => (
          <Card key={p.id} title={p.name} sub={p.operator}>
            <DetailGrid items={[
              ["Status", p.onboarded ? "Live" : "Pending"],
              ["Vendors", p.stats.vendors], ["Deals MTD", p.stats.deals_mtd],
              ["Note", p.stats.note],
            ]} />
          </Card>
        ))}
      </div>
      <Card title="Live auction queue · factoring units" sub="click for the bid stack" pad={false}>
        <DataTable columns={[
          { key: "id", label: "FU", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "MSME vendor" },
          { key: "platform_name", label: "Platform" },
          { key: "amount", label: "Invoice amt", num: true, render: (r) => inrFull(r.amount) },
          { key: "bid_count", label: "Bids", num: true },
          { key: "best_bid_pct", label: "Best bid", num: true, render: (r) => r.best_bid_pct ? `${pct(r.best_bid_pct)} · ${r.best_bidder}` : "awaiting" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
        ]} rows={data.factoring_units} onRow={openBids} />
      </Card>
      {bids && (
        <Modal title={`${fu.id} · bid stack`} onClose={() => setBids(null)}>
          <DataTable columns={[
            { key: "financier", label: "Financier" },
            { key: "rate_pct", label: "Rate", num: true, render: (r) => pct(r.rate_pct) },
            { key: "bid_at", label: "Bid at", render: (r) => dtt(r.bid_at) },
          ]} rows={bids} empty="No bids yet" />
        </Modal>
      )}
    </>
  );
}

/* ============ EBITDA Calculator ============ */
export function Ebitda() {
  const { data, loading } = useFetch(() => api.get("/discounting/ebitda"), []);
  const [form, setForm] = useState({ amount: 1000000, vendor_rate_pct: 9.5, days: 30, is_msme: false });
  const [result, setResult] = useState(null);
  const compare = async () => setResult(await api.post("/discounting/compare", form));
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="EBITDA Gain Calculator" sub="same invoice routed three ways · engine recommendation" />
      <div className="kpi-row">
        <Kpi label="EBITDA · MTD" value={inrFull(data.totals.mtd)} noteClass="up" />
        <Kpi label="EBITDA · Total" value={inrFull(data.totals.ytd)} note="all settled + active deals" />
        <Kpi label="Avg spread" value={pct(data.totals.avg_spread)} note="vendor rate − CoF" />
      </div>
      <Card title="What-if comparison" sub="enter a candidate invoice — the engine routes it across pools">
        <div className="form-row-3" style={{ alignItems: "end" }}>
          <div className="field"><label>Net payable (₹)</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} /></div>
          <div className="field"><label>Vendor discount rate (% p.a.)</label>
            <input type="number" step="0.1" value={form.vendor_rate_pct} onChange={(e) => setForm({ ...form, vendor_rate_pct: +e.target.value })} /></div>
          <div className="field"><label>Days saved</label>
            <input type="number" value={form.days} onChange={(e) => setForm({ ...form, days: +e.target.value })} /></div>
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
          <input type="checkbox" checked={form.is_msme} onChange={(e) => setForm({ ...form, is_msme: e.target.checked })}
            style={{ width: "auto", height: "auto" }} /> MSME vendor (enables TReDS)
        </label>
        <button className="btn btn-pri" onClick={compare}>Compare pools</button>
        {result && (
          <div className="grid-3" style={{ marginTop: 16 }}>
            {result.pools.map((p) => (
              <div key={p.pool} className="card" style={{ margin: 0, border: result.recommended === p.pool ? "2px solid var(--orange-500)" : undefined }}>
                <div className="card-body">
                  <div className="card-title" style={{ textTransform: "capitalize" }}>
                    {p.pool} {result.recommended === p.pool && <Chip value="active" label="engine pick" />}
                  </div>
                  <DetailGrid items={[
                    ["Eligible", p.eligible ? "Yes" : "No"],
                    ["CoF", p.cof != null ? pct(p.cof) : "—"],
                    ["Spread", p.spread != null ? pct(p.spread) : "—"],
                    ["EBITDA gain", inrFull(p.gain)],
                    ["Note", p.note],
                  ]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="EBITDA by pool" pad={false}>
        <DataTable columns={[
          { key: "name", label: "Pool" },
          { key: "active_deals", label: "Active", num: true },
          { key: "volume", label: "Volume", num: true, render: (r) => inr(r.volume) },
          { key: "avg_vendor_rate", label: "Avg V rate", num: true, render: (r) => pct(r.avg_vendor_rate) },
          { key: "avg_cof", label: "Avg CoF", num: true, render: (r) => pct(r.avg_cof) },
          { key: "gain_mtd", label: "Gain MTD", num: true, render: (r) => inrFull(r.gain_mtd) },
          { key: "gain_total", label: "Gain total", num: true, render: (r) => inrFull(r.gain_total) },
        ]} rows={data.by_pool} />
      </Card>
    </>
  );
}

/* ============ Early-Pay ============ */
export function EarlyPay() {
  const { toast } = useApp();
  const { data, loading, refresh } = useFetch(() => api.get("/discounting/early-pay"), []);
  const [summary, setSummary] = useState(null);
  const recommend = async (r) => {
    try { const rec = await api.post(`/discounting/early-pay/${r.id}/recommend`);
      toast(`AI: route to ${rec.pool} · expected gain ${inrFull(rec.expected_gain)} (${rec.confidence}% conf)`);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  const accept = async (r) => {
    try { const res = await api.post(`/discounting/early-pay/${r.id}/accept`, {});
      toast(`Accepted · deal ${res.deal.deal_id} · gain ${inrFull(res.deal.ebitda_gain)}`); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const decline = async (r) => {
    try { await api.post(`/discounting/early-pay/${r.id}/decline`, { reason: "declined via UI" });
      toast("Declined"); refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (loading) return <Loading />;
  const pending = data.filter((r) => r.status === "pending");
  return (
    <>
      <PageHead title="Early-Pay Requests" sub="vendor-initiated · AI recommends the optimal pool · human approves" />
      {summary && <SummaryModal {...summary} onClose={() => setSummary(null)} />}
      <div className="kpi-row">
        <Kpi label="Pending requests" value={pending.length} note={inr(pending.reduce((s, r) => s + +r.amount, 0)) + " requested"}
          onSummary={() => setSummary({ entity: "early_pay", filters: { status: "pending" }, title: "Pending early-pay requests" })} />
        <Kpi label="Expected EBITDA" value={inrFull(pending.reduce((s, r) => s + +(r.expected_gain || 0), 0))} noteClass="up" note="if all accepted as routed"
          onSummary={() => setSummary({ entity: "early_pay", filters: {}, title: "All early-pay requests" })} />
        <Kpi label="Auto-routing" value="GPT-4o" note="recommendation only · human-in-the-loop" />
      </div>
      <Card title="Vendor-initiated requests" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Req", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
          { key: "invoice_id", label: "Invoice", render: (r) => <span className="mono">{r.invoice_id}</span> },
          { key: "amount", label: "Amount", num: true, render: (r) => inrFull(r.amount) },
          { key: "days_available", label: "Days", num: true },
          { key: "requested_rate_pct", label: "Req rate", num: true, render: (r) => pct(r.requested_rate_pct) },
          { key: "suggested_pool_name", label: "AI pool", render: (r) => r.suggested_pool_name || "—" },
          { key: "expected_gain", label: "Exp gain", num: true, render: (r) => inrFull(r.expected_gain) },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "_", label: "Actions", render: (r) => r.status === "pending" && (
            <span style={{ display: "flex", gap: 5 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-gho btn-sm" onClick={() => recommend(r)}>AI</button>
              <button className="btn btn-grn btn-sm" onClick={() => accept(r)}>Accept</button>
              <button className="btn btn-red btn-sm" onClick={() => decline(r)}>Decline</button>
            </span>) },
        ]} rows={data} />
      </Card>
    </>
  );
}
