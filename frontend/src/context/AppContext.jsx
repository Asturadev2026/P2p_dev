import { createContext, useCallback, useContext, useState } from "react";
import { api } from "../services/api";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem("auth_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, isError = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, isError }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post("/auth/login", { username, password });
    sessionStorage.setItem("auth_token", res.token);
    sessionStorage.setItem("auth_user", JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.clear();
    setUser(null);
  }, []);

  return (
    <AppContext.Provider value={{ user, login, logout, toast }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.isError ? " err" : ""}`}>{t.msg}</div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
