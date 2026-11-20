import { useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  Eye,
  LogOut,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  AdminAttendanceRecord,
  AdminStats,
  AdminUserItem,
  api,
  JobRole,
  User,
  WorkZone,
} from "../lib/api";
import { Toast, ToastData } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/ConfirmModal";

interface Props {
  user: User;
  onLogout: () => void;
  onSwitchToScanner: () => void;
}

export function AdminDashboard({ user, onLogout, onSwitchToScanner }: Props) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [evidenceRecordId, setEvidenceRecordId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  // Modal nueva área / zona
  const [newZoneModalOpen, setNewZoneModalOpen] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [zoneDesc, setZoneDesc] = useState("");
  const [zoneHelmet, setZoneHelmet] = useState(true);
  const [zoneGlasses, setZoneGlasses] = useState(true);
  const [zoneMask, setZoneMask] = useState(true);
  const [zoneVest, setZoneVest] = useState(true);
  const [creatingZone, setCreatingZone] = useState(false);

  // Modal crear nuevo puesto
  const [newRoleModalOpen, setNewRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleIsAdmin, setNewRoleIsAdmin] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);

  // Modales de confirmación
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    target: AdminUserItem;
    selectedRole: JobRole;
  } | null>(null);
  const [pendingStatusToggle, setPendingStatusToggle] = useState<AdminUserItem | null>(null);
  const [applyingAction, setApplyingAction] = useState(false);

  const loadAll = async (filter = statusFilter, query = search) => {
    try {
      const [statsRes, zonesRes, recRes, usersRes, rolesRes] = await Promise.all([
        api.getAdminStats(),
        api.getAdminZones(),
        api.getAdminRecords(filter, query),
        api.getAdminUsers(),
        api.getJobRoles(),
      ]);
      setStats(statsRes);
      setZones(zonesRes);
      setRecords(recRes);
      setUsers(usersRes);
      setJobRoles(rolesRes);
    } catch (err) {
      setToast({
        type: "error",
        title: "Error al cargar datos",
        message: err instanceof Error ? err.message : "No se pudo conectar con el servidor.",
      });
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleToggleZoneRule = async (
    zone: WorkZone,
    field: "require_helmet" | "require_glasses" | "require_mask" | "require_vest" | "is_active"
  ) => {
    try {
      const updated = await api.updateWorkZone(zone.id, { [field]: !zone[field] });
      setZones((prev) => prev.map((z) => (z.id === zone.id ? updated : z)));
      setToast({
        type: "success",
        title: "Regla actualizada",
        message: `Se actualizó la configuración de "${zone.name}".`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo actualizar el área",
        message: err instanceof Error ? err.message : "Error inesperado.",
      });
    }
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneName.trim()) return;
    setCreatingZone(true);
    try {
      const created = await api.createWorkZone({
        name: zoneName.trim(),
        description: zoneDesc.trim(),
        require_helmet: zoneHelmet,
        require_glasses: zoneGlasses,
        require_mask: zoneMask,
        require_vest: zoneVest,
        min_confidence: 0.2,
      });
      setZones((prev) => [...prev, created]);
      setZoneName("");
      setZoneDesc("");
      setNewZoneModalOpen(false);
      setToast({
        type: "success",
        title: "Área creada",
        message: `"${created.name}" ya está disponible en la terminal de marcaje.`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "Error al crear área",
        message: err instanceof Error ? err.message : "Verifica que el nombre no esté repetido.",
      });
    } finally {
      setCreatingZone(false);
    }
  };

  const handleFilterChange = async (newFilter: string, newSearch: string) => {
    setStatusFilter(newFilter);
    setSearch(newSearch);
    try {
      const recRes = await api.getAdminRecords(newFilter, newSearch);
      setRecords(recRes);
    } catch {
      // Silencioso
    }
  };

  const handleCreateJobRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreatingRole(true);
    try {
      const created = await api.createJobRole({
        name: newRoleName.trim(),
        is_admin: newRoleIsAdmin,
      });
      setJobRoles((prev) => [...prev, created]);
      setNewRoleName("");
      setNewRoleIsAdmin(false);
      setNewRoleModalOpen(false);
      setToast({
        type: "success",
        title: "Puesto agregado",
        message: `"${created.name}" ya está disponible.`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo crear el puesto",
        message: err instanceof Error ? err.message : "Verifica que no esté duplicado.",
      });
    } finally {
      setCreatingRole(false);
    }
  };

  const confirmRoleAssignment = async () => {
    if (!pendingRoleChange) return;
    setApplyingAction(true);
    const { target, selectedRole } = pendingRoleChange;
    try {
      await api.updateAdminUser(target.id, {
        job_title: selectedRole.name,
        role: selectedRole.is_admin ? "admin" : "employee",
      });
      setPendingRoleChange(null);
      await loadAll();
      setToast({
        type: "success",
        title: "Puesto actualizado",
        message: `${target.full_name} ahora tiene el puesto "${selectedRole.name}".`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo cambiar el puesto",
        message: err instanceof Error ? err.message : "Operación rechazada.",
      });
    } finally {
      setApplyingAction(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!pendingStatusToggle) return;
    setApplyingAction(true);
    const target = pendingStatusToggle;
    const nextState = !target.is_active;
    try {
      await api.updateAdminUser(target.id, { is_active: nextState });
      setPendingStatusToggle(null);
      await loadAll();
      setToast({
        type: "success",
        title: nextState ? "Cuenta activada" : "Cuenta desactivada",
        message: `El acceso de ${target.full_name} fue ${nextState ? "habilitado" : "suspendido"}.`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo actualizar el estado",
        message: err instanceof Error ? err.message : "Error al actualizar usuario.",
      });
    } finally {
      setApplyingAction(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white">Panel de Control Biométrico y EPP</h1>
              <span className="rounded-md bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300">
                {user.job_title || "Administrador"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Supervisor: <span className="font-medium text-slate-200">{user.full_name}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onSwitchToScanner}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
          >
            <Camera className="h-4 w-4" />
            Abrir Quiosco de Marcaje
          </button>

          <button
            onClick={onLogout}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Métricas globales */}
      {stats && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase text-slate-400">Total Marcajes</p>
            <p className="mt-2 text-2xl font-bold text-white">{stats.total_scans}</p>
            <p className="mt-1 text-xs text-slate-500">{stats.live_scans} con prueba de vida</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase text-slate-400">Cumplimiento EPP</p>
            <p className="mt-2 text-2xl font-bold text-indigo-400">{stats.compliance_rate}%</p>
            <p className="mt-1 text-xs text-slate-500">Tasa global de ingresos válidos</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase text-slate-400">Aprobados</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">{stats.compliant_scans}</p>
            <p className="mt-1 text-xs text-slate-500">Cumplen normativa del área</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase text-slate-400">Rechazados</p>
            <p className="mt-2 text-2xl font-bold text-rose-400">{stats.non_compliant_scans}</p>
            <p className="mt-1 text-xs text-slate-500">
              {users.filter((u) => u.has_face_enrolled).length} de {stats.total_users} rostros registrados
            </p>
          </div>
        </div>
      )}

      {/* Áreas / Zonas de Trabajo y EPP Obligatorio */}
      <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-white">
                Áreas Operativas y Normativa de EPP
              </h2>
              <p className="text-xs text-slate-400">
                Configura qué equipo exige cada departamento (si exige mascarilla, el quiosco activa validación en 2 fases anti-suplantación).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setNewZoneModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/15 px-3.5 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-600/25"
          >
            <Plus className="h-4 w-4" />
            Nueva Área / Zona
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="py-3 pr-4">Área / Departamento</th>
                <th className="py-3 px-3 text-center">Casco</th>
                <th className="py-3 px-3 text-center">Lentes</th>
                <th className="py-3 px-3 text-center">Mascarilla</th>
                <th className="py-3 px-3 text-center">Chaleco</th>
                <th className="py-3 px-3 text-center">Flujo Quiosco</th>
                <th className="py-3 pl-3 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {zones.map((z) => {
                const twoPhase = z.require_mask || z.require_glasses;
                return (
                  <tr key={z.id} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-white">{z.name}</p>
                      {z.description && <p className="text-xs text-slate-400">{z.description}</p>}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={z.require_helmet}
                        onChange={() => handleToggleZoneRule(z, "require_helmet")}
                        className="h-4 w-4 cursor-pointer rounded border-slate-600 text-indigo-600"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={z.require_glasses}
                        onChange={() => handleToggleZoneRule(z, "require_glasses")}
                        className="h-4 w-4 cursor-pointer rounded border-slate-600 text-indigo-600"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={z.require_mask}
                        onChange={() => handleToggleZoneRule(z, "require_mask")}
                        className="h-4 w-4 cursor-pointer rounded border-slate-600 text-indigo-600"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={z.require_vest}
                        onChange={() => handleToggleZoneRule(z, "require_vest")}
                        className="h-4 w-4 cursor-pointer rounded border-slate-600 text-indigo-600"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          twoPhase
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {twoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleZoneRule(z, "is_active")}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          z.is_active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {z.is_active ? "Activa" : "Inactiva"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historial Global de Marcajes */}
      <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">
            Registro Global de Asistencia y Cumplimiento EPP
          </h2>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar empleado o área..."
                value={search}
                onChange={(e) => handleFilterChange(statusFilter, e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-9 pr-3 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value, search)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">Todos los estados</option>
              <option value="approved">Solo Aprobados</option>
              <option value="rejected">Solo Rechazados</option>
            </select>

            <a
              href={api.exportCsvUrl}
              onClick={() =>
                setToast({
                  type: "success",
                  title: "Exportando reporte",
                  message: "Se inició la descarga del archivo CSV.",
                })
              }
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </a>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="py-3 pr-3">Fecha y Hora</th>
                <th className="py-3 px-3">Colaborador</th>
                <th className="py-3 px-3">Área</th>
                <th className="py-3 px-3">Tipo</th>
                <th className="py-3 px-3">Estado</th>
                <th className="py-3 px-2 text-center">Casco</th>
                <th className="py-3 px-2 text-center">Lentes</th>
                <th className="py-3 px-2 text-center">Masc.</th>
                <th className="py-3 px-2 text-center">Chaleco</th>
                <th className="py-3 pl-3 text-right">Foto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    No hay registros que coincidan con el filtro.
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-3 text-xs text-slate-300">
                      {new Date(rec.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-medium text-white">{rec.user_full_name}</p>
                      <p className="text-[11px] text-slate-400">
                        {rec.recognition_method === "face_biometric"
                          ? `Biométrico (${Math.round((rec.face_similarity || 0.85) * 100)}%)`
                          : "Sesión"}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-xs font-medium text-indigo-300">{rec.zone_name}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          rec.event_type === "EXIT"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {rec.event_type === "EXIT" ? "Salida" : "Entrada"}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          rec.is_compliant
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {rec.is_compliant ? "Aprobado" : "Rechazado"}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center text-xs">{rec.has_helmet ? "Sí" : "No"}</td>
                    <td className="py-3 px-2 text-center text-xs">{rec.has_glasses ? "Sí" : "No"}</td>
                    <td className="py-3 px-2 text-center text-xs">{rec.has_mask ? "Sí" : "No"}</td>
                    <td className="py-3 px-2 text-center text-xs">{rec.has_vest ? "Sí" : "No"}</td>
                    <td className="py-3 pl-3 text-right">
                      {rec.has_evidence ? (
                        <button
                          onClick={() => setEvidenceRecordId(rec.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:border-indigo-500/50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gestión de Usuarios y Biometría */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">
              Colaboradores, Puestos y Estado Biométrico
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setNewRoleModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/15 px-3.5 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-600/25"
          >
            <Plus className="h-4 w-4" />
            Crear nuevo puesto / rol
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="py-3 pr-4">Nombre</th>
                <th className="py-3 px-3">Código</th>
                <th className="py-3 px-3">Rostro</th>
                <th className="py-3 px-3">Puesto / Rol</th>
                <th className="py-3 px-3">Estado</th>
                <th className="py-3 pl-4 text-right">Cuenta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {users.map((u) => {
                const hasCustomValue = !jobRoles.some((r) => r.name === u.job_title);
                return (
                  <tr key={u.id} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-white">{u.full_name}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-slate-300">
                      {u.employee_code || "—"}
                    </td>
                    <td className="py-3 px-3">
                      {u.has_face_enrolled ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Registrado
                        </span>
                      ) : (
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={u.job_title}
                        disabled={u.id === user.id}
                        onChange={(e) => {
                          const chosen = jobRoles.find((r) => r.name === e.target.value);
                          if (chosen && chosen.name !== u.job_title) {
                            setPendingRoleChange({ target: u, selectedRole: chosen });
                          }
                        }}
                        className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                      >
                        {hasCustomValue && <option value={u.job_title}>{u.job_title}</option>}
                        {jobRoles.map((roleItem) => (
                          <option key={roleItem.id} value={roleItem.name}>
                            {roleItem.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-xs font-medium ${
                          u.is_active ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {u.is_active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <button
                        onClick={() => setPendingStatusToggle(u)}
                        disabled={u.id === user.id}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:border-rose-500/50 disabled:opacity-40"
                      >
                        {u.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Crear Nueva Área */}
      {newZoneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateZone}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <h3 className="text-sm font-bold text-white">Nueva Área / Zona de Trabajo</h3>
              <button
                type="button"
                onClick={() => setNewZoneModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Nombre del área
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Destilación, Especias, Laboratorio..."
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Descripción breve
                </label>
                <input
                  type="text"
                  placeholder="Ej. Ingreso con equipo completo de protección"
                  value={zoneDesc}
                  onChange={(e) => setZoneDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <span className="mb-2 block text-xs font-medium text-slate-300">
                  EPP obligatorio en esta área:
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={zoneHelmet}
                      onChange={(e) => setZoneHelmet(e.target.checked)}
                    />
                    Casco
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={zoneGlasses}
                      onChange={(e) => setZoneGlasses(e.target.checked)}
                    />
                    Lentes
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={zoneMask}
                      onChange={(e) => setZoneMask(e.target.checked)}
                    />
                    Mascarilla
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={zoneVest}
                      onChange={(e) => setZoneVest(e.target.checked)}
                    />
                    Chaleco
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 bg-slate-950/50 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setNewZoneModalOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingZone}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {creatingZone ? "Creando..." : "Guardar Área"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Crear Nuevo Puesto */}
      {newRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateJobRole}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <h3 className="text-sm font-bold text-white">Agregar Nuevo Puesto a la Lista</h3>
              <button
                type="button"
                onClick={() => setNewRoleModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Nombre del puesto o rol
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Ej. Operador de Destilación, Soldador..."
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Nivel de acceso en el sistema
                </label>
                <select
                  value={newRoleIsAdmin ? "admin" : "employee"}
                  onChange={(e) => setNewRoleIsAdmin(e.target.value === "admin")}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="employee">Operador (Solo terminal de marcaje)</option>
                  <option value="admin">Administrador (Panel de control + marcaje)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 bg-slate-950/50 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setNewRoleModalOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingRole}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {creatingRole ? "Agregando..." : "Guardar en lista"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        open={pendingRoleChange !== null}
        title="Confirmar cambio de puesto"
        message={
          pendingRoleChange
            ? `¿Asignar el puesto "${pendingRoleChange.selectedRole.name}" a ${pendingRoleChange.target.full_name}?`
            : ""
        }
        confirmLabel="Sí, asignar puesto"
        loading={applyingAction}
        onConfirm={confirmRoleAssignment}
        onCancel={() => setPendingRoleChange(null)}
      />

      <ConfirmModal
        open={pendingStatusToggle !== null}
        title={pendingStatusToggle?.is_active ? "Confirmar desactivación" : "Confirmar activación"}
        message={
          pendingStatusToggle
            ? `¿Deseas ${pendingStatusToggle.is_active ? "suspender el acceso" : "habilitar el acceso"} de ${
                pendingStatusToggle.full_name
              }?`
            : ""
        }
        confirmLabel={pendingStatusToggle?.is_active ? "Sí, desactivar" : "Sí, activar"}
        danger={Boolean(pendingStatusToggle?.is_active)}
        loading={applyingAction}
        onConfirm={confirmStatusChange}
        onCancel={() => setPendingStatusToggle(null)}
      />

      {evidenceRecordId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <span className="text-sm font-semibold text-white">
                Evidencia de Marcaje #{evidenceRecordId}
              </span>
              <button
                onClick={() => setEvidenceRecordId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="bg-slate-950 p-4">
              <img
                src={api.evidenceUrl(evidenceRecordId)}
                alt={`Evidencia ${evidenceRecordId}`}
                className="mx-auto max-h-[70vh] rounded-xl object-contain"
              />
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
