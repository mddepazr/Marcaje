const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: "employee" | "admin";
  job_title: string;
  employee_code?: string | null;
  has_face_enrolled: boolean;
  is_active: boolean;
}

export interface WorkZone {
  id: number;
  name: string;
  description: string;
  require_helmet: boolean;
  require_glasses: boolean;
  require_mask: boolean;
  require_vest: boolean;
  require_epp_on_exit?: boolean;
  min_confidence: number;
  is_active: boolean;
}

export interface KioskConfig {
  active_zone_id: number | null;
  active_zone: WorkZone | null;
}

export interface BiometricProfile {
  id: number;
  full_name: string;
  job_title: string;
  employee_code?: string | null;
  face_descriptor: number[];
  face_samples?: number[][];
}

export interface MarcajeRecord {
  id: number;
  user_id: number;
  user_full_name: string;
  zone_id?: number | null;
  zone_name: string;
  event_type: "ENTRY" | "EXIT";
  recognition_method: "session" | "face_biometric";
  face_similarity?: number | null;
  person_detected: boolean;
  is_live_person: boolean;
  has_helmet: boolean;
  has_glasses: boolean;
  has_mask: boolean;
  has_vest: boolean;
  is_compliant: boolean;
  confidence: number;
  detections_raw: { label: string; confidence: number }[];
  missing_items?: string[];
  created_at: string;
}

export interface AdminAttendanceRecord {
  id: number;
  user_id: number;
  user_full_name: string;
  user_email: string;
  zone_name: string;
  event_type: "ENTRY" | "EXIT";
  recognition_method: "session" | "face_biometric";
  face_similarity?: number | null;
  person_detected: boolean;
  is_live_person: boolean;
  has_helmet: boolean;
  has_glasses: boolean;
  has_mask: boolean;
  has_vest: boolean;
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
  role: "employee" | "admin";
  job_title: string;
  employee_code?: string | null;
  has_face_enrolled: boolean;
  is_active: boolean;
  created_at: string;
}

export interface JobRole {
  id: number;
  name: string;
  is_admin: boolean;
}

export interface ScanRequestMeta {
  zoneId?: number;
  eventType?: "ENTRY" | "EXIT";
  recognizedUserId?: number;
  faceSimilarity?: number;
  clientLivenessVerified?: boolean;
  faceBox?: { x: number; y: number; width: number; height: number };
  bridgeBox?: { x: number; y: number; width: number; height: number };
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 665000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "El servidor tardó demasiado en responder (posible arranque en frío). Intenta de nuevo en unos segundos."
      );
    }
    throw new Error("Error de conexión con el servidor. Verifica tu red.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = "Error en la solicitud";
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  return response.json();
}

export const api = {
  register: (data: { full_name: string; employee_code: string; email: string; password: string }) =>
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

  me: () => request<User>("/auth/me", {}, 15000),

  getZones: () => request<WorkZone[]>("/marcaje/zones"),

  getKioskConfig: () => request<KioskConfig>("/marcaje/kiosk-config"),

  getBiometricDirectory: () => request<BiometricProfile[]>("/marcaje/biometric-directory"),

  enrollFace: (data: {
    user_id?: number;
    employee_code: string;
    face_descriptor: number[];
    face_samples?: number[][];
  }) =>
    request<{ message: string; user_id: number; full_name: string }>("/marcaje/enroll-face", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  scanFrames: (files: Blob[], mode: "live" | "upload" = "live", meta?: ScanRequestMeta) => {
    const formData = new FormData();
    files.forEach((blob, idx) => {
      formData.append("files", blob, `frame_${idx + 1}.jpg`);
    });
    formData.append("mode", mode);
    if (meta?.zoneId !== undefined) formData.append("zone_id", String(meta.zoneId));
    if (meta?.eventType) formData.append("event_type", meta.eventType);
    if (meta?.recognizedUserId !== undefined) {
      formData.append("recognized_user_id", String(meta.recognizedUserId));
    }
    if (meta?.faceSimilarity !== undefined) {
      formData.append("face_similarity", String(meta.faceSimilarity));
    }
    if (meta?.clientLivenessVerified) {
      formData.append("client_liveness_verified", "true");
    }
    if (meta?.faceBox) {
      const { x, y, width, height } = meta.faceBox;
      formData.append("face_box", [x, y, width, height].map((v) => Math.round(v)).join(","));
    }
    if (meta?.bridgeBox) {
      const { x, y, width, height } = meta.bridgeBox;
      formData.append("bridge_box", [x, y, width, height].map((v) => Math.round(v)).join(","));
    }
    return request<MarcajeRecord>(
      "/marcaje/scan",
      {
        method: "POST",
        body: formData,
      },
      120000
    );
  },

  getHistory: () => request<MarcajeRecord[]>("/marcaje/history"),

  getAdminStats: () => request<AdminStats>("/admin/stats"),

  getAdminZones: () => request<WorkZone[]>("/admin/zones"),

  setAdminKioskZone: (active_zone_id: number) =>
    request<WorkZone>("/admin/kiosk-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_zone_id }),
    }),

  createWorkZone: (data: Omit<WorkZone, "id" | "is_active">) =>
    request<WorkZone>("/admin/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  updateWorkZone: (id: number, data: Partial<WorkZone>) =>
    request<WorkZone>(`/admin/zones/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  getAdminRecords: (
    statusFilter = "all",
    search = "",
    zoneName = "",
    userId?: number
  ) => {
    const params = new URLSearchParams({ status_filter: statusFilter, search });
    if (zoneName) params.set("zone_name", zoneName);
    if (userId !== undefined) params.set("user_id", String(userId));
    return request<AdminAttendanceRecord[]>(`/admin/records?${params.toString()}`);
  },

  exportCsvUrl: `${BASE_URL}/admin/records/export`,

  evidenceUrl: (recordId: number) => `${BASE_URL}/admin/evidence/${recordId}`,

  getAdminUsers: () => request<AdminUserItem[]>("/admin/users"),

  updateAdminUser: (
    userId: number,
    data: { job_title?: string; role?: "employee" | "admin"; is_active?: boolean; employee_code?: string }
  ) =>
    request<AdminUserItem>(`/admin/users/${userId}`, {
      method: "PATCH",
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

  resetUserFace: (userId: number) =>
    request<{ message: string }>(`/admin/users/${userId}/face`, {
      method: "DELETE",
    }),

  resetEmployeeFaces: () =>
    request<{ message: string; cleared: number }>("/admin/faces/employees", {
      method: "DELETE",
    }),

  resetAllFaces: () =>
    request<{ message: string; cleared: number }>("/admin/faces/all", {
      method: "DELETE",
    }),
};
