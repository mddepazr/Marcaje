const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8005/api/v1";

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface MarcajeRecord {
  id: number;
  user_id: number;
  person_detected: boolean;
  is_live_person: boolean;
  has_helmet: boolean;
  has_glasses: boolean;
  has_mask: boolean;
  is_compliant: boolean;
  confidence: number;
  created_at: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Error en el servidor" }));
    throw new Error(err.detail || `Error HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  register: (data: { full_name: string; email: string; password: string }) =>
    request<User>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<User>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  logout: () => request<{ message: string }>("/auth/logout", { method: "POST" }),

  me: () => request<User>("/auth/me"),

  scanFrames: (blobs: Blob[], mode: "live" | "upload" = "live") => {
    const formData = new FormData();
    blobs.forEach((blob, idx) => {
      formData.append("files", blob, `frame_${idx}.jpg`);
    });
    formData.append("mode", mode);
    return request<MarcajeRecord>("/marcaje/scan", {
      method: "POST",
      body: formData,
    });
  },

  getHistory: () => request<MarcajeRecord[]>("/marcaje/history"),
};
