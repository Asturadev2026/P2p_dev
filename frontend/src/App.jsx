import { Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./context/AppContext";
import Layout from "./components/Layout";
import Login from "./screens/Login";
import CommandCentre from "./screens/CommandCentre";
import { Requisitions, Rfqs, PurchaseOrders, Grns } from "./screens/Procurement";
import { CaptureInbox, MatchQueue, Gst2b, TdsEngine } from "./screens/ApInvoices";
import { Approvals, LiabilityJv, PaymentBatches, Advances } from "./screens/ApprovalsPayments";
import { VendorMaster, Onboarding } from "./screens/Vendors";
import { DiscountDesk, Treds, Ebitda, EarlyPay } from "./screens/Discounting";
import { Reports, ErpSync, AuditTrail, AdminConsole } from "./screens/Platform";
import VendorKyc from "./screens/VendorKyc";

export default function App() {
  const { user } = useApp();
  return (
    <Routes>
      {/* Public vendor KYC form — no login required */}
      <Route path="/kyc/:token" element={<VendorKyc />} />

      {/* Auth-guarded app */}
      {!user ? (
        <Route path="*" element={<Login />} />
      ) : (
      <Route element={<Layout />}>
        <Route path="/" element={<CommandCentre />} />
        <Route path="/requisitions" element={<Requisitions />} />
        <Route path="/rfqs" element={<Rfqs />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/grns" element={<Grns />} />
        <Route path="/capture" element={<CaptureInbox />} />
        <Route path="/match" element={<MatchQueue />} />
        <Route path="/gst2b" element={<Gst2b />} />
        <Route path="/tds" element={<TdsEngine />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/liability" element={<LiabilityJv />} />
        <Route path="/payments" element={<PaymentBatches />} />
        <Route path="/advances" element={<Advances />} />
        <Route path="/vendors" element={<VendorMaster />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/discount-desk" element={<DiscountDesk />} />
        <Route path="/treds" element={<Treds />} />
        <Route path="/ebitda" element={<Ebitda />} />
        <Route path="/early-pay" element={<EarlyPay />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/erp-sync" element={<ErpSync />} />
        <Route path="/audit" element={<AuditTrail />} />
        <Route path="/admin" element={<AdminConsole />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      )}
    </Routes>
  );
}
