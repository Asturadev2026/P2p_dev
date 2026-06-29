import { useState } from "react";
import { useApp } from "../context/AppContext";

const DEMO_USERS = [
  ["pradip", "Checker · AP Manager"], ["nidhi", "Maker · AP Executive"],
  ["meera", "Financial Controller"], ["anish", "CFO"], ["vikram", "Procurement"],
  ["rahul", "Requester · Branch"], ["tanvi", "Treasury Desk"], ["admin", "Administrator"],
  ["kavita", "Auditor"],
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
          <b>Demo logins</b> (password <span className="mono">intelezen123</span>):
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 6 }}>
            {DEMO_USERS.map(([u, r]) => (
              <a key={u} onClick={() => setUsername(u)}>{u} · {r}</a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
