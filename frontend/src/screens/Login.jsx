import { useState } from "react";
import { useApp } from "../context/AppContext";

const DEMO_USERS = [
  ["amardeep", "Compliance Reviewer"], ["vikram", "Procurement"],
  ["pradip", "Checker · AP Manager"], ["nidhi", "Maker · AP Executive"],
  ["meera", "Financial Controller"], ["anish", "CFO"],
  ["rahul", "Requester · Branch"], ["tanvi", "Treasury Desk"],
  ["kavita", "Auditor"], ["admin", "Administrator"],
];

export default function Login() {
  const { login, toast } = useApp();
  const [username, setUsername] = useState("pradip");
  const [password, setPassword] = useState("intelezen123");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  // One-click login for fast access (all demo users share the same password)
  const quickLogin = async (u) => {
    setUsername(u); setPassword("intelezen123"); setBusy(true);
    try {
      await login(u, "intelezen123");
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div className="brand-tile">AiQ</div>
          <div>
            <div className="brand-meta-eyebrow">AstonomiQ Finance Suite</div>
            <div className="brand-meta-title" style={{ fontSize: 15 }}>Procure-to-Pay</div>
            <div style={{ fontSize: 11, color: "var(--ink-500)" }}>Intelezen Microfin Limited · Jalandhar</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-pri" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div style={{ marginTop: 18, fontSize: 11, color: "var(--ink-500)" }}>
          <b>Quick login</b> — click a role to sign in instantly (password <span className="mono">intelezen123</span>):
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {DEMO_USERS.map(([u, r]) => (
              <button key={u} type="button" onClick={() => quickLogin(u)} disabled={busy}
                style={{ textAlign: "left", background: "#fff", border: "1px solid #e0ddd3", borderRadius: 7,
                  padding: "7px 10px", cursor: busy ? "not-allowed" : "pointer", fontSize: 11, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700, color: "#16233d" }}>{r}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
