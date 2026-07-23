import { useState } from "react";
import { api } from "../services/api";
import { useApp } from "../context/AppContext";
import { useFetch, Card, DataTable, Chip, Modal, PageHead, Loading, Kpi, DetailGrid,
         inr, inrFull, dt, dtt, pct } from "../components/ui";
import SummaryModal from "../components/SummaryModal";

/* ============ Discount Desk ============ */
function eligibilityStatus(r) {
  if (r.payment_status === "payment_ready") return "payment_ready";
  if (r.liability_status === "liability_booked") return "liability_booked";
  return "approved";
}

function CreateDealModal({ invoice, pools, onClose, onCreated }) {
  const { toast } = useApp();
  const [poolId, setPoolId] = useState(pools[0]?.id || "");
  const [rate, setRate] = useState(9.5);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const pool = pools.find((p) => p.id === poolId);
  const isTreds = pool?.pool_type === "treds";
  const cof = pool ? +pool.cost_of_funds_pct || 0 : 0;
  const spread = rate - cof;
  const amount = +invoice.net_payable;
  const discount = amount * rate / 100 * days / 365;
  const advance = amount - discount;
  const gain = isTreds ? 0 : Math.round(amount * spread / 100 * days / 365 * 100) / 100;

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.post("/discounting/deals",
        { invoice_id: invoice.id, pool_id: poolId, vendor_rate_pct: +rate, days_saved: +days });
      toast(`Deal ${res.deal_id} created · offered · advance ${inrFull(res.advance)}`);
      onCreated(); onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Create Discount Deal · ${invoice.id}`} onClose={onClose}
      footer={<button className="btn btn-pri" disabled={busy} onClick={save}>Save · create deal</button>}>
      <DetailGrid items={[
        ["Invoice", invoice.id], ["Vendor", invoice.vendor_name],
        ["Invoice amount", inrFull(invoice.net_payable)],
        ["Due date", invoice.due_date ? dt(invoice.due_date) : "—"],
      ]} />
      <div className="field" style={{ marginTop: 14 }}><label>Funding Pool</label>
        <select value={poolId} onChange={(e) => setPoolId(e.target.value)}>
          {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="field"><label>Vendor Discount Rate (% p.a.)</label>
        <input type="number" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /></div>
      <div className="field"><label>Days Saved</label>
        <input type="number" value={days} onChange={(e) => setDays(+e.target.value)} /></div>
      <div className="field"><label>Advance Amount (computed)</label>
        <input value={inrFull(advance)} disabled /></div>
      <h4 style={{ margin: "14px 0 8px" }}>Calculation</h4>
      <DetailGrid items={[
        ["Cost of Funds", isTreds ? "—" : pct(cof)],
        ["Spread", isTreds ? "—" : pct(spread)],
        ["Expected Gain", isTreds ? inrFull(0) : inrFull(gain)],
        ["Net benefit", isTreds ? "Off-balance-sheet · liquidity benefit to vendor" : inrFull(gain)],
      ]} />
    </Modal>
  );
}

export function DiscountDesk() {
  const { toast, user } = useApp();
  const isTreasury = user?.role === "treasury" || user?.role === "admin";
  const { data: pools, loading, refresh: refreshPools } = useFetch(() => api.get("/discounting/pools"), []);
  const { data: deals, refresh: refreshDeals } = useFetch(() => api.get("/discounting/deals"), []);
  const { data: eligible, refresh: refreshEligible } = useFetch(() => api.get("/discounting/eligible-invoices"), []);
  const [summary, setSummary] = useState(null);
  const [dealFor, setDealFor] = useState(null);
  if (loading || !deals) return <Loading />;

  const activateDeal = async (id) => {
    try { await api.post(`/discounting/deals/${encodeURIComponent(id)}/activate`); toast(`${id} activated`); refreshDeals(); }
    catch (e) { toast(e.message, true); }
  };
  const settleDeal = async (id) => {
    try { await api.post(`/discounting/deals/${encodeURIComponent(id)}/settle`); toast(`${id} settled · invoice marked paid`);
      refreshDeals(); refreshEligible();
    } catch (e) { toast(e.message, true); }
  };
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
      <Card title="Eligible invoices for discounting" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "Vendor", render: (r) => <>{r.vendor_name} {r.is_msme && <Chip value="msme_priority" label="MSME" />}</> },
          { key: "net_payable", label: "Amount", num: true, render: (r) => inrFull(r.net_payable) },
          { key: "due_date", label: "Due date", render: (r) => r.due_date ? dt(r.due_date) : "—" },
          { key: "status", label: "Status", render: (r) => <Chip value={eligibilityStatus(r)} /> },
          { key: "_", label: "Action", render: (r) => (
            isTreasury
              ? <button className="btn btn-gho btn-sm" onClick={() => setDealFor(r)}>Create Deal</button>
              : "—") },
        ]} rows={eligible || []} empty="No invoices currently eligible for discounting" />
      </Card>
      {isTreasury && dealFor && <CreateDealModal invoice={dealFor} pools={pools.pools} onClose={() => setDealFor(null)}
        onCreated={() => { refreshDeals(); refreshEligible(); refreshPools(); }} />}
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
          { key: "_", label: "Action", render: (r) => (
            <span onClick={(e) => e.stopPropagation()}>
              {isTreasury && r.status === "offered" &&
                <button className="btn btn-blu btn-sm" onClick={() => activateDeal(r.id)}>Activate Deal</button>}
              {isTreasury && r.status === "active" &&
                <button className="btn btn-grn btn-sm" onClick={() => settleDeal(r.id)}>Mark Settled</button>}
              {!isTreasury && "—"}
            </span>) },
        ]} rows={deals} />
      </Card>
    </>
  );
}

/* ============ TReDS ============ */
const TREDS_PLATFORMS = [
  { id: "rxil", name: "RXIL" },
  { id: "m1x", name: "M1xchange" },
  { id: "invoicemart", name: "Invoicemart" },
];

function ListOnTredsModal({ invoice, onClose, onListed }) {
  const { toast } = useApp();
  const [platformId, setPlatformId] = useState(TREDS_PLATFORMS[0].id);
  const [days, setDays] = useState(30);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.post("/discounting/treds",
        { invoice_id: invoice.id, platform_id: platformId, settlement_days: +days, remarks });
      toast(`${res.id} listed on TReDS`);
      onListed(); onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <Modal title={`List on TReDS · ${invoice.id}`} onClose={onClose}
      footer={<button className="btn btn-pri" disabled={busy} onClick={save}>List on TReDS</button>}>
      <DetailGrid items={[
        ["Invoice", invoice.id], ["MSME vendor", invoice.vendor_name],
        ["Invoice amount", inrFull(invoice.net_payable)],
      ]} />
      <div className="field" style={{ marginTop: 14 }}><label>Platform</label>
        <select value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
          {TREDS_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <div className="field"><label>Expected settlement days</label>
        <input type="number" value={days} onChange={(e) => setDays(+e.target.value)} /></div>
      <div className="field"><label>Remarks</label>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
    </Modal>
  );
}

function MarkSettledModal({ fu, onClose, onSettled }) {
  const { toast } = useApp();
  const [settlementDate, setSettlementDate] = useState("");
  const [ref, setRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!settlementDate) return toast("Settlement date is required", true);
    setBusy(true);
    try {
      const res = await api.post(`/discounting/treds/${encodeURIComponent(fu.id)}/settle`,
        { settlement_date: settlementDate, settlement_ref: ref.trim() || null, remarks: remarks.trim() || null });
      toast(`${res.id} settled · invoice marked paid`);
      onSettled(); onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Mark Settled · ${fu.id}`} onClose={onClose}
      footer={<button className="btn btn-pri" disabled={busy} onClick={save}>Mark Settled</button>}>
      <DetailGrid items={[
        ["Factoring Unit ID", fu.id], ["MSME vendor", fu.vendor_name],
        ["Invoice amount", inrFull(fu.amount)],
        ["Winning financier", fu.best_bidder || "—"],
        ["Winning bid rate", fu.best_bid_pct ? pct(fu.best_bid_pct) : "—"],
      ]} />
      <div className="field" style={{ marginTop: 14 }}><label>Settlement date</label>
        <input type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} /></div>
      <div className="field"><label>Settlement reference / UTR</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. N123456789012" /></div>
      <div className="field"><label>Remarks</label>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
    </Modal>
  );
}

export function Treds() {
  const { toast, user } = useApp();
  const isTreasury = user?.role === "treasury" || user?.role === "admin";
  const { data, loading, refresh: refreshTreds } = useFetch(() => api.get("/discounting/treds"), []);
  const { data: eligible, refresh: refreshEligible } = useFetch(() => api.get("/discounting/treds/eligible-invoices"), []);
  const [bids, setBids] = useState(null);
  const [fu, setFu] = useState(null);
  const [listFor, setListFor] = useState(null);
  const [settleFor, setSettleFor] = useState(null);
  const openBids = async (r) => { setFu(r); setBids(await api.get(`/discounting/treds/${r.id}/bids`)); };
  const startBidding = async (r) => {
    try {
      const res = await api.post(`/discounting/treds/${encodeURIComponent(r.id)}/start-bidding`);
      toast(`${res.id} · ${res.bids} bids received · best ${pct(res.best_bid_pct)} · ${res.best_bidder}`);
      refreshTreds();
    } catch (e) { toast(e.message, true); }
  };
  const acceptBestBid = async () => {
    try {
      const res = await api.post(`/discounting/treds/${encodeURIComponent(fu.id)}/accept-best-bid`);
      toast(`${res.id} won by ${res.best_bidder} @ ${pct(res.best_bid_pct)}`);
      refreshTreds();
      setFu({ ...fu, status: "won", best_bid_pct: res.best_bid_pct, best_bidder: res.best_bidder });
      setBids(await api.get(`/discounting/treds/${fu.id}/bids`));
    } catch (e) { toast(e.message, true); }
  };
  if (loading) return <Loading />;
  const bestRate = bids?.length ? Math.min(...bids.map((b) => +b.rate_pct)) : null;
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
      <Card title="Eligible MSME invoices for TReDS" pad={false}>
        <DataTable columns={[
          { key: "id", label: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "MSME Vendor" },
          { key: "net_payable", label: "Amount", num: true, render: (r) => inrFull(r.net_payable) },
          { key: "due_date", label: "Due date", render: (r) => r.due_date ? dt(r.due_date) : "—" },
          { key: "status", label: "Status", render: (r) => <Chip value={eligibilityStatus(r)} /> },
          { key: "_", label: "Action", render: (r) => (
            isTreasury
              ? <button className="btn btn-gho btn-sm" onClick={() => setListFor(r)}>List on TReDS</button>
              : "—") },
        ]} rows={eligible || []} empty="No MSME invoices currently eligible for TReDS" />
      </Card>
      {isTreasury && listFor && <ListOnTredsModal invoice={listFor} onClose={() => setListFor(null)}
        onListed={() => { refreshTreds(); refreshEligible(); }} />}
      <Card title="Live auction queue · factoring units" sub="click for the bid stack" pad={false}>
        <DataTable columns={[
          { key: "id", label: "FU", render: (r) => <span className="mono">{r.id}</span> },
          { key: "vendor_name", label: "MSME vendor" },
          { key: "platform_name", label: "Platform" },
          { key: "amount", label: "Invoice amt", num: true, render: (r) => inrFull(r.amount) },
          { key: "bid_count", label: "Bids", num: true },
          { key: "best_bid_pct", label: "Best bid", num: true, render: (r) => r.best_bid_pct ? `${pct(r.best_bid_pct)} · ${r.best_bidder}` : "awaiting" },
          { key: "status", label: "Status", render: (r) => <Chip value={r.status} /> },
          { key: "_", label: "Action", render: (r) => {
            if (!isTreasury) return "—";
            if (r.status === "listed")
              return <button className="btn btn-blu btn-sm" onClick={(e) => { e.stopPropagation(); startBidding(r); }}>Start Bidding</button>;
            if (r.status === "won")
              return <button className="btn btn-grn btn-sm" onClick={(e) => { e.stopPropagation(); setSettleFor(r); }}>Mark Settled</button>;
            return "—";
          } },
        ]} rows={data.factoring_units} onRow={openBids} />
      </Card>
      {isTreasury && settleFor && <MarkSettledModal fu={settleFor} onClose={() => setSettleFor(null)}
        onSettled={() => { refreshTreds(); refreshEligible(); }} />}
      {bids && (
        <Modal title={`${fu.id} · bid stack`} onClose={() => setBids(null)}
          footer={isTreasury && fu.status === "bidding" && bids.length > 0 &&
            <button className="btn btn-pri" onClick={acceptBestBid}>Accept Best Bid</button>}>
          <DetailGrid items={[
            ["Factoring Unit ID", fu.id], ["MSME vendor", fu.vendor_name],
            ["Invoice amount", inrFull(fu.amount)], ["Platform", fu.platform_name],
          ]} />
          <h4 style={{ margin: "14px 0 8px" }}>Financier bids</h4>
          <DataTable columns={[
            { key: "financier", label: "Financier", render: (r) => (
              <>{r.financier} {+r.rate_pct === bestRate && <Chip value="active" label="Best bid" />}</>) },
            { key: "rate_pct", label: "Rate", num: true, render: (r) => pct(r.rate_pct) },
            { key: "advance_amount", label: "Advance", num: true, render: (r) => r.advance_amount ? inrFull(r.advance_amount) : "—" },
            { key: "settlement_days", label: "Settlement days", num: true, render: (r) => r.settlement_days ?? "—" },
            { key: "status", label: "Bid status", render: (r) => <Chip value={r.status || "submitted"} /> },
            { key: "bid_at", label: "Bid at", render: (r) => dtt(r.bid_at) },
          ]} rows={bids} empty="No bids yet · click Start Bidding to generate demo financier bids" />
        </Modal>
      )}
    </>
  );
}

/* ============ EBITDA Calculator ============ */
export function Ebitda() {
  const { toast, user } = useApp();
  const isTreasury = user?.role === "treasury" || user?.role === "admin";
  const { data, loading } = useFetch(() => api.get("/discounting/ebitda"), []);
  const { data: eligible, refresh: refreshEligible } = useFetch(() => api.get("/discounting/eligible-invoices"), []);
  const [form, setForm] = useState({ amount: 1000000, vendor_rate_pct: 9.5, days: 30, is_msme: false });
  const [invoiceId, setInvoiceId] = useState("");
  const [result, setResult] = useState(null);
  const [useBusy, setUseBusy] = useState(false);
  const compare = async () => setResult(await api.post("/discounting/compare", form));
  const useRecommendation = async (invoice) => {
    if (!invoice || !result?.recommended) return;
    setUseBusy(true);
    try {
      if (result.recommended === "treds") {
        const res = await api.post("/discounting/treds", {
          invoice_id: invoice.id, platform_id: "rxil",
          settlement_days: form.days, remarks: "Routed via EBITDA calculator recommendation",
        });
        toast(`${res.id} listed on TReDS (RXIL) · status listed`);
      } else {
        const res = await api.post("/discounting/deals", {
          invoice_id: invoice.id, pool_id: result.recommended,
          vendor_rate_pct: form.vendor_rate_pct, days_saved: form.days,
        });
        toast(`Deal ${res.deal_id} created · offered · advance ${inrFull(res.advance)}`);
      }
      refreshEligible();
    } catch (e) { toast(e.message, true); } finally { setUseBusy(false); }
  };
  const pickInvoice = (id) => {
    setInvoiceId(id);
    if (!id) return;
    const inv = (eligible || []).find((r) => r.id === id);
    if (!inv) return;
    const days = inv.due_date
      ? Math.max(1, Math.round((new Date(inv.due_date) - new Date()) / 86400000))
      : form.days;
    setForm({ ...form, amount: +inv.net_payable, is_msme: !!inv.is_msme, days });
  };
  if (loading) return <Loading />;
  const selectedInvoice = (eligible || []).find((r) => r.id === invoiceId);
  return (
    <>
      <PageHead title="EBITDA Gain Calculator" sub="same invoice routed three ways · engine recommendation" />
      <div className="kpi-row">
        <Kpi label="EBITDA · MTD" value={inrFull(data.totals.mtd)} noteClass="up" />
        <Kpi label="EBITDA · Total" value={inrFull(data.totals.ytd)} note="all settled + active deals" />
        <Kpi label="Avg spread" value={pct(data.totals.avg_spread)} note="vendor rate − CoF" />
      </div>
      <Card title="What-if comparison" sub="pick an eligible invoice or enter a candidate manually — the engine routes it across pools">
        <div className="field" style={{ marginBottom: 12 }}><label>Invoice (optional — auto-fills the fields below)</label>
          <select value={invoiceId} onChange={(e) => pickInvoice(e.target.value)}>
            <option value="">— Manual entry —</option>
            {(eligible || []).map((r) => (
              <option key={r.id} value={r.id}>{r.id} · {r.vendor_name} · {inrFull(r.net_payable)}</option>))}
          </select></div>
        {selectedInvoice && (
          <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginBottom: 12 }}>
            {selectedInvoice.vendor_name} {selectedInvoice.is_msme && <Chip value="msme_priority" label="MSME" />}
          </div>
        )}
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
                    ["Cost of Funds", p.cof != null ? pct(p.cof) : "—"],
                    ["Spread", p.spread != null ? pct(p.spread) : "—"],
                    ["Expected Gain", inrFull(p.gain)],
                    ["Recommendation", result.recommended === p.pool ? "Recommended · highest gain"
                      : p.rank ? `Rank #${p.rank}`
                      : p.pool === "treds" ? "Liquidity option · not gain-ranked"
                      : "Not recommended"],
                    ["Note", p.note],
                  ]} />
                </div>
              </div>
            ))}
          </div>
        )}
        {result && isTreasury && (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-pri" disabled={useBusy || !selectedInvoice || !result.recommended}
              onClick={() => useRecommendation(selectedInvoice)}>Use this recommendation</button>
            {!selectedInvoice && (
              <span style={{ fontSize: 12, color: "var(--text-muted, #888)", marginLeft: 10 }}>
                Select an invoice above to act on this recommendation
              </span>
            )}
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
  const { toast, user } = useApp();
  const isTreasury = user?.role === "treasury" || user?.role === "admin";
  const { data, loading, refresh } = useFetch(() => api.get("/discounting/early-pay"), []);
  const [summary, setSummary] = useState(null);
  const [declineFor, setDeclineFor] = useState(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineBusy, setDeclineBusy] = useState(false);
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
  const confirmDecline = async () => {
    if (!declineReason.trim()) { toast("A decline reason is required", true); return; }
    setDeclineBusy(true);
    try {
      await api.post(`/discounting/early-pay/${declineFor.id}/decline`, { reason: declineReason.trim() });
      toast("Declined"); setDeclineFor(null); setDeclineReason(""); refresh();
    } catch (e) { toast(e.message, true); } finally { setDeclineBusy(false); }
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
            isTreasury ? (
              <span style={{ display: "flex", gap: 5 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-gho btn-sm" onClick={() => recommend(r)}>AI</button>
                <button className="btn btn-grn btn-sm" onClick={() => accept(r)}>Accept</button>
                <button className="btn btn-red btn-sm" onClick={() => { setDeclineFor(r); setDeclineReason(""); }}>Decline</button>
              </span>
            ) : "—") },
        ]} rows={data} />
      </Card>
      {isTreasury && declineFor && (
        <Modal title={`Decline ${declineFor.id} — reason required`} onClose={() => setDeclineFor(null)}
          footer={<button className="btn btn-red" disabled={declineBusy} onClick={confirmDecline}>Confirm decline</button>}>
          <div className="field"><label>Reason</label>
            <textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Why is this early-pay request being declined?" /></div>
        </Modal>
      )}
    </>
  );
}
