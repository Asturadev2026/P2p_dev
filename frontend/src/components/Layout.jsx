import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";

const NAV = [
  { section: "Overview", items: [
    { to: "/", label: "Command Centre" },
  ]},
  { section: "Procurement", items: [
    { to: "/requisitions", label: "Requisitions" },
    { to: "/rfqs", label: "RFQ & Quotations" },
    { to: "/purchase-orders", label: "Purchase Orders" },
    { to: "/grns", label: "Goods Receipt" },
  ]},
  { section: "AP Automation", items: [
    { to: "/capture", label: "Capture Inbox" },
    { to: "/match", label: "3-Way Match" },
    { to: "/gst2b", label: "GST 2B Recon" },
    { to: "/tds", label: "TDS Engine", pill: "194C·J·I", pillClass: "pill-purple" },
    { to: "/approvals", label: "Approval Workflow" },
    { to: "/liability", label: "Liability & JV" },
    { to: "/payments", label: "Payment Batch" },
    { to: "/advances", label: "Advances & Imprest" },
  ]},
  { section: "Vendor 360", items: [
    { to: "/vendors", label: "Vendor Master" },
    { to: "/onboarding", label: "Onboarding" },
  ]},
  { section: "Invoice Discounting", items: [
    { to: "/discount-desk", label: "Discount Desk" },
    { to: "/treds", label: "TReDS Marketplace", pill: "RBI", pillClass: "pill-purple" },
    { to: "/ebitda", label: "EBITDA Calculator" },
    { to: "/early-pay", label: "Early-Pay Requests" },
  ]},
  { section: "Platform", items: [
    { to: "/reports", label: "Reports" },
    { to: "/erp-sync", label: "ERP / Bank Sync" },
    { to: "/audit", label: "Audit Trail" },
    { to: "/admin", label: "Admin Console" },
  ]},
];

const TITLES = {
  "/": ["Overview", "Command Centre", "Live P2P & Discounting overview"],
  "/requisitions": ["Procurement", "Purchase Requisitions", "Multi-line · cost centre · statutory flags · approver panel"],
  "/rfqs": ["Procurement", "RFQ & Quotation Comparison", "Single-screen comparison · controlled override with audit"],
  "/purchase-orders": ["Procurement", "Purchase Orders", "From RFQ or independent path · e-Sign for agreement-based"],
  "/grns": ["Procurement", "Goods Receipt Notes", "Branch evidence capture · quantity reconciliation"],
  "/capture": ["AP Automation", "Capture Inbox", "Multi-channel ingestion · OCR · IRN validation · duplicate prevention"],
  "/match": ["AP Automation", "3-Way Match Queue", "Invoice ↔ PO ↔ GRN with tolerance bands"],
  "/gst2b": ["AP Automation", "GST 2B Reconciliation", "GSTN sync · ITC eligibility · payment-hold recommendations"],
  "/tds": ["AP Automation", "TDS Engine", "Section-wise computation · 194C · 194J · 194I · 194D"],
  "/approvals": ["AP Automation", "Approval Workflow", "Maker · Checker · FC · CFO routing with SLA tracking"],
  "/liability": ["AP Automation", "Liability & JV Posting", "GL coding · auto-JV · ERP push queue"],
  "/payments": ["AP Automation", "Payment Batches", "Bank-ready payout file · UTR capture · remittance advice"],
  "/advances": ["AP Automation", "Advances & Imprest", "Auto-adjustment · bill-based reconciliation"],
  "/vendors": ["Vendor 360", "Vendor Master", "Single source of truth · live verification status"],
  "/onboarding": ["Vendor 360", "Vendor Onboarding", "KYC · GST · PAN · Udyam · penny drop · ERP push"],
  "/discount-desk": ["Invoice Discounting", "Discount Desk", "Treasury · Bank CC · TReDS pools · MTD gain tracker"],
  "/treds": ["Invoice Discounting", "TReDS Marketplace", "RXIL · M1xchange · Invoicemart · financier auctions"],
  "/ebitda": ["Invoice Discounting", "EBITDA Gain Calculator", "Side-by-side pool comparison · engine recommendation"],
  "/early-pay": ["Invoice Discounting", "Early-Pay Requests", "Vendor-initiated · AI-routed to optimal pool"],
  "/reports": ["Platform", "Reports", "Spend · ageing · approval SLA · statutory exposure"],
  "/erp-sync": ["Platform", "ERP / Bank Sync", "Bidirectional sync log · all integrations"],
  "/audit": ["Platform", "Audit Trail", "Tamper-evident · before/after state · 7-year retention"],
  "/admin": ["Platform", "Admin Console", "Rules as configuration · integration mode switches"],
};

export default function Layout() {
  const { user, logout } = useApp();
  const loc = useLocation();
  const meta = TITLES[loc.pathname] || TITLES["/"];
  const initials = (user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-blk">
          <div className="brand-tile">AiQ</div>
          <div>
            <div className="brand-meta-eyebrow">AstonomiQ Finance Suite</div>
            <div className="brand-meta-title">Procure-to-Pay · Intelezen Microfin</div>
          </div>
        </div>
        <div className="nav-scroll">
          {NAV.map((s) => (
            <div className="nav-section" key={s.section}>
              <div className="nav-section-title">{s.section}</div>
              {s.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === "/"}
                  className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                  <span>{it.label}</span>
                  {it.pill && <span className={`nav-pill ${it.pillClass}`}>{it.pill}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <div className="nav-foot">
          <span><span className="live-dot" />Engine running</span>
          <span className="mono">v1.0</span>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <div className="crumb">
            {meta[0]} <span className="sep">/</span> <b>{meta[1]}</b>
            <span className="sep">·</span> {meta[2]}
          </div>
          <div className="user-chip" title="Click to sign out" onClick={logout} style={{ cursor: "pointer" }}>
            <div className="user-avatar">{initials}</div>
            <div>
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{user?.role?.toUpperCase()} · {user?.branch || "HO"}</div>
            </div>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
