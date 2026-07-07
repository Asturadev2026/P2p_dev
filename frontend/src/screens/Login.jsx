import { useState } from "react";
import { useApp } from "../context/AppContext";

// role label -> username (username is used only to authenticate, never shown)
const ROLES = [
  ["Compliance Reviewer", "amardeep"], ["Procurement", "vikram"],
  ["Checker · AP Manager", "pradip"], ["Maker · AP Executive", "nidhi"],
  ["Financial Controller", "meera"], ["CFO", "anish"],
  ["Requester · Branch", "rahul"], ["Treasury Desk", "tanvi"],
  ["Auditor", "kavita"], ["Administrator", "admin"],
];

export default function Login() {
  const { login, toast } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

  // Sign in by role (username resolved internally, not displayed)
  const loginAs = async (u) => {
    setBusy(true);
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
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn btn-pri" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div style={{ marginTop: 18, fontSize: 11, color: "var(--ink-500)" }}>
          <b>Sign in by role</b> — click to enter:
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {ROLES.map(([role, u]) => (
              <button key={u} type="button" onClick={() => loginAs(u)} disabled={busy}
                style={{ textAlign: "left", background: "#fff", border: "1px solid #e0ddd3", borderRadius: 7,
                  padding: "8px 11px", cursor: busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, color: "#16233d" }}>
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
