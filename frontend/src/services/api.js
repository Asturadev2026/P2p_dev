const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8002";

async function request(path, options = {}) {
  const token = sessionStorage.getItem("auth_token");
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

async function requestForm(path, formData) {
  const token = sessionStorage.getItem("auth_token");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
  }
  return res.json();
}

export const api = {
  postForm: (path, formData) => requestForm(`/api/v1${path}`, formData),
  get:  (path, params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/api/v1${path}${qs}`);
  },
  post:   (path, body) => request(`/api/v1${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put:    (path, body) => request(`/api/v1${path}`, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: (path)       => request(`/api/v1${path}`, { method: "DELETE" }),
  downloadUrl: (path)  => `${BASE}/api/v1${path}`,
};
