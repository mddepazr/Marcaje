export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8005/api/v1";

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: "employee" | "admin" | string;
  job_title: string;
  is_active: boolean;
}

export interface JobRole {
  id: number;
  name: string;
  is_admin: boolean;
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
  missing_items?: string[];
  created_at: string;
}

export interface MarcajeSettings {
  zone_name: string;
  require_helmet: boolean;
  require_glasses: boolean;
  require_mask: boolean;
  min_confidence: number;
}

export interface AdminAttendanceRecord {
  id: number;
  user_id: number;
  user_full_name: string;
  user_email: string;
  person_detected: boolean;
  is_live_person: boolean;
  has_helmet: boolean;
  has_glasses: boolean;
  has_mask: boolean;
  is_compliant: boolean;
  confidence: number;
  has_evidence: boolean;
  created_at: string;
}

export interface AdminStats {
  total_scans: number;
  compliant_scans: number;
  non_compliant_scans: number;
  compliance_rate: number;
  live_scans: number;
  total_users: number;
}

export interface AdminUserItem {
  id: number;
  full_name: string;
  email: string;
  role: string;
  job_title: string;
  is_active: boolean;
  created_at: string;
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 665000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Error en el servidor" }));
      throw new Error(err.detail || `Error HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("El servidor tardó demasiado en responder. Intenta de nuevo.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

  me: () => request<User>("/auth/me", {}, 65000),

  getSettings: () => request<MarcajeSettings>("/admin/settings"),

  updateSettings: (data: MarcajeSettings) =>
    request<MarcajeSettings>("/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  getJobRoles: () => request<JobRole[]>("/admin/roles"),

  createJobRole: (data: { name: string; is_admin: boolean }) =>
    request<JobRole>("/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  scanFrames: (blobs: Blob[], mode: "live" | "upload" = "live") => {
    const formData = new FormData();
    blobs.forEach((blob, idx) => {
      formData.append("files", blob, `frame_${idx}.jpg`);
    });
    formData.append("mode", mode);
    return request<MarcajeRecord>(
      "/marcaje/scan",
      {
        method: "POST",
        body: formData,
      },
      25000
    );
  },

  getHistory: () => request<MarcajeRecord[]>("/marcaje/history"),

  getAdminStats: () => request<AdminStats>("/admin/stats"),

  getAdminRecords: (statusFilter = "all", search = "") => {
    const params = new URLSearchParams({ status_filter: statusFilter, search });
    return request<AdminAttendanceRecord[]>(`/admin/records?${params.toString()}`);
  },

  getAdminUsers: () => request<AdminUserItem[]>("/admin/users"),

  updateAdminUser: (userId: number, data: { job_title?: string; role?: string; is_active?: boolean }) =>
    request<AdminUserItem>(`/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  exportCsvUrl: `${API_BASE}/admin/records/export`,
  evidenceUrl: (recordId: number) => `${API_BASE}/admin/evidence/${recordId}`,
};
