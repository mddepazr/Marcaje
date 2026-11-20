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
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
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
import { ThemeSwitcher } from "../components/ui/ThemeSwitcher";

interface Props {
  user: User;
  onLogout: () => void;
  onSwitchToScanner: () => void;
}

export function AdminDashboard({ user, onLogout, onSwitchToScanner }: Props) {
  const [activeTab, setActiveTab] = useState<"records" | "zones" | "users">("records");

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [evidenceRecordId, setEvidenceRecordId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const [newZoneModalOpen, setNewZoneModalOpen] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [zoneDesc, setZoneDesc] = useState("");
  const [zoneHelmet, setZoneHelmet] = useState(true);
  const [zoneGlasses, setZoneGlasses] = useState(true);
  const [zoneMask, setZoneMask] = useState(true);
  const [zoneVest, setZoneVest] = useState(true);
  const [creatingZone, setCreatingZone] = useState(false);

  const [newRoleModalOpen, setNewRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleAccess, setNewRoleAccess] = useState<"employee" | "admin">("employee");
  const [creatingRole, setCreatingRole] = useState(false);

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
        is_admin: newRoleAccess === "admin",
      });
      setJobRoles((prev) => [...prev, created]);
      setNewRoleName("");
      setNewRoleAccess("employee");
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
    <div style={{ backgroundColor: "var(--color-background-body)" }} className="min-h-screen">
      <header
        style={{
          backgroundColor: "var(--color-background-surface)",
          borderColor: "var(--color-border-subtle)",
        }}
        className="border-b"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-3">
            <HStack gap={3} vAlign="center">
              <div
                style={{
                  backgroundColor: "var(--color-background-muted)",
                  borderColor: "var(--color-border-subtle)",
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
              >
                <ShieldCheck className="h-5 w-5" />
              </div>
              <VStack gap={0.5}>
                <Heading level={3}>Panel de Control EPP</Heading>
                <Text type="supporting">Supervisor: {user.full_name}</Text>
              </VStack>
            </HStack>

            <Badge label={user.job_title || "Administrador"} variant="neutral" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 lg:justify-end">
            <ThemeSwitcher />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                label="Quiosco de Marcaje"
                variant="primary"
                size="sm"
                icon={<Camera className="h-3.5 w-3.5" />}
                onClick={onSwitchToScanner}
              />
              <Button
                label="Cerrar sesión"
                variant="secondary"
                size="sm"
                icon={<LogOut className="h-3.5 w-3.5" />}
                onClick={onLogout}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <VStack gap={6}>
          {stats && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Card padding={4}>
                <VStack gap={1}>
                  <Text type="supporting">Total Marcajes</Text>
                  <Heading level={2}>
                    <Text hasTabularNumbers type="inherit">
                      {stats.total_scans}
                    </Text>
                  </Heading>
                  <Text maxLines={1} type="supporting">
                    {stats.live_scans} en vivo
                  </Text>
                </VStack>
              </Card>

              <Card padding={4}>
                <VStack gap={1}>
                  <Text type="supporting">Cumplimiento</Text>
                  <Heading level={2}>
                    <Text hasTabularNumbers type="inherit">
                      {stats.compliance_rate}%
                    </Text>
                  </Heading>
                  <Text maxLines={1} type="supporting">
                    Tasa global válida
                  </Text>
                </VStack>
              </Card>

              <Card padding={4}>
                <VStack gap={1}>
                  <Text type="supporting">Aprobados</Text>
                  <Heading level={2}>
                    <Text hasTabularNumbers type="inherit">
                      {stats.compliant_scans}
                    </Text>
                  </Heading>
                  <Text maxLines={1} type="supporting">
                    Cumplen normativa
                  </Text>
                </VStack>
              </Card>

              <Card padding={4}>
                <VStack gap={1}>
                  <Text type="supporting">Rechazados</Text>
                  <Heading level={2}>
                    <Text hasTabularNumbers type="inherit">
                      {stats.non_compliant_scans}
                    </Text>
                  </Heading>
                  <Text maxLines={1} type="supporting">
                    {users.filter((u) => u.has_face_enrolled).length}/{stats.total_users} rostros
                  </Text>
                </VStack>
              </Card>
            </div>
          )}

          <TabList
            value={activeTab}
            onChange={(val) => setActiveTab(val as "records" | "zones" | "users")}
            hasDivider
          >
            <Tab label="Asistencia" value="records" />
            <Tab label="Áreas y EPP" value="zones" />
            <Tab label="Personal" value="users" />
          </TabList>

          {activeTab === "records" && (
            <Card padding={5}>
              <VStack gap={5}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <VStack gap={0.5}>
                    <Heading level={3}>Registro Global de Asistencia</Heading>
                    <Text type="supporting">
                      Historial auditado con evidencia fotográfica y similitud biométrica
                    </Text>
                  </VStack>

                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                    <TextInput
                      label="Buscar"
                      isLabelHidden
                      type="search"
                      size="sm"
                      hasClear
                      startIcon={<Search className="h-3.5 w-3.5" />}
                      placeholder="Buscar empleado o área..."
                      value={search}
                      onChange={(val) => handleFilterChange(statusFilter, val)}
                      width="100%"
                    />

                    <div className="flex items-center gap-2">
                      <div className="min-w-[165px] flex-1">
                        <Selector
                          isLabelHidden
                          label="Estado"
                          size="sm"
                          value={statusFilter}
                          width="100%"
                          options={[
                            { value: "all", label: "Todos los estados" },
                            { value: "approved", label: "Solo Aprobados" },
                            { value: "rejected", label: "Solo Rechazados" },
                          ]}
                          onChange={(val) => handleFilterChange(val, search)}
                        />
                      </div>

                      <Button
                        label="CSV"
                        variant="secondary"
                        size="sm"
                        icon={<Download className="h-3.5 w-3.5" />}
                        href={api.exportCsvUrl}
                        onClick={() =>
                          setToast({
                            type: "success",
                            title: "Exportando reporte",
                            message: "Se inició la descarga del archivo CSV.",
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {records.length === 0 ? (
                  <div className="py-8 text-center">
                    <Text type="supporting">No hay registros que coincidan con el filtro.</Text>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-3 md:hidden">
                      {records.map((rec) => (
                        <div
                          key={rec.id}
                          style={{
                            backgroundColor: "var(--color-background-muted)",
                            borderColor: "var(--color-border-subtle)",
                          }}
                          className="rounded-xl border p-4"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <VStack gap={0.5}>
                              <Text type="label">{rec.user_full_name}</Text>
                              <Text type="supporting">
                                {rec.zone_name} ·{" "}
                                {rec.recognition_method === "face_biometric"
                                  ? `Biométrico (${Math.round((rec.face_similarity || 0.85) * 100)}%)`
                                  : "Sesión"}
                              </Text>
                              <Text hasTabularNumbers type="supporting">
                                {new Date(rec.created_at).toLocaleString()}
                              </Text>
                            </VStack>
                            <Badge
                              variant={rec.is_compliant ? "success" : "error"}
                              label={rec.is_compliant ? "Aprobado" : "Rechazado"}
                            />
                          </div>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant={rec.event_type === "EXIT" ? "orange" : "blue"}
                                label={rec.event_type === "EXIT" ? "Salida" : "Entrada"}
                              />
                              <Badge
                                variant="neutral"
                                label={`EPP: ${
                                  [
                                    rec.has_helmet ? "Casco" : null,
                                    rec.has_glasses ? "Lentes" : null,
                                    rec.has_mask ? "Masc." : null,
                                    rec.has_vest ? "Chaleco" : null,
                                  ]
                                    .filter(Boolean)
                                    .join(", ") || "Ninguno"
                                }`}
                              />
                            </div>

                            {rec.has_evidence && (
                              <Button
                                label="Foto"
                                variant="secondary"
                                size="sm"
                                icon={<Eye className="h-3.5 w-3.5" />}
                                onClick={() => setEvidenceRecordId(rec.id)}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr
                            style={{ borderColor: "var(--color-border-subtle)" }}
                            className="border-b uppercase"
                          >
                            <th className="py-3 pr-3">
                              <Text type="supporting">Fecha y Hora</Text>
                            </th>
                            <th className="py-3 px-3">
                              <Text type="supporting">Colaborador</Text>
                            </th>
                            <th className="py-3 px-3">
                              <Text type="supporting">Área</Text>
                            </th>
                            <th className="py-3 px-3">
                              <Text type="supporting">Tipo</Text>
                            </th>
                            <th className="py-3 px-3">
                              <Text type="supporting">Estado</Text>
                            </th>
                            <th className="py-3 px-2 text-center">
                              <Text type="supporting">Casco</Text>
                            </th>
                            <th className="py-3 px-2 text-center">
                              <Text type="supporting">Lentes</Text>
                            </th>
                            <th className="py-3 px-2 text-center">
                              <Text type="supporting">Masc.</Text>
                            </th>
                            <th className="py-3 px-2 text-center">
                              <Text type="supporting">Chaleco</Text>
                            </th>
                            <th className="py-3 pl-3 text-right">
                              <Text type="supporting">Foto</Text>
                            </th>
                          </tr>
                        </thead>
                        <tbody
                          style={{ borderColor: "var(--color-border-subtle)" }}
                          className="divide-y"
                        >
                          {records.map((rec) => (
                            <tr key={rec.id}>
                              <td className="whitespace-nowrap py-3 pr-3">
                                <Text hasTabularNumbers type="supporting">
                                  {new Date(rec.created_at).toLocaleString()}
                                </Text>
                              </td>
                              <td className="py-3 px-3">
                                <VStack gap={0}>
                                  <Text type="label">{rec.user_full_name}</Text>
                                  <Text type="supporting">
                                    {rec.recognition_method === "face_biometric"
                                      ? `Biométrico (${Math.round((rec.face_similarity || 0.85) * 100)}%)`
                                      : "Sesión"}
                                  </Text>
                                </VStack>
                              </td>
                              <td className="py-3 px-3">
                                <Text type="supporting">{rec.zone_name}</Text>
                              </td>
                              <td className="py-3 px-3">
                                <Badge
                                  variant={rec.event_type === "EXIT" ? "orange" : "blue"}
                                  label={rec.event_type === "EXIT" ? "Salida" : "Entrada"}
                                />
                              </td>
                              <td className="py-3 px-3">
                                <Badge
                                  variant={rec.is_compliant ? "success" : "error"}
                                  label={rec.is_compliant ? "Aprobado" : "Rechazado"}
                                />
                              </td>
                              <td className="py-3 px-2 text-center">
                                <Text type="supporting">{rec.has_helmet ? "Sí" : "No"}</Text>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <Text type="supporting">{rec.has_glasses ? "Sí" : "No"}</Text>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <Text type="supporting">{rec.has_mask ? "Sí" : "No"}</Text>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <Text type="supporting">{rec.has_vest ? "Sí" : "No"}</Text>
                              </td>
                              <td className="py-3 pl-3 text-right">
                                {rec.has_evidence ? (
                                  <Button
                                    label="Ver"
                                    variant="secondary"
                                    size="sm"
                                    icon={<Eye className="h-3.5 w-3.5" />}
                                    onClick={() => setEvidenceRecordId(rec.id)}
                                  />
                                ) : (
                                  <Text type="supporting">—</Text>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </VStack>
            </Card>
          )}

          {activeTab === "zones" && (
            <Card padding={5}>
              <VStack gap={5}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <HStack gap={2} vAlign="center">
                    <MapPin className="h-5 w-5 shrink-0" />
                    <VStack gap={0.5}>
                      <Heading level={3}>Áreas Operativas y Normativa EPP</Heading>
                      <Text type="supporting">
                        Si un área exige mascarilla o lentes, el quiosco activa validación en 2
                        fases anti-suplantación.
                      </Text>
                    </VStack>
                  </HStack>

                  <Button
                    label="Nueva Área"
                    variant="primary"
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => setNewZoneModalOpen(true)}
                  />
                </div>

                <div className="flex flex-col gap-3 md:hidden">
                  {zones.map((z) => {
                    const twoPhase = z.require_mask || z.require_glasses;
                    return (
                      <div
                        key={z.id}
                        style={{
                          backgroundColor: "var(--color-background-muted)",
                          borderColor: "var(--color-border-subtle)",
                        }}
                        className="rounded-xl border p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <VStack gap={0.5}>
                            <Text type="label">{z.name}</Text>
                            {z.description && <Text type="supporting">{z.description}</Text>}
                          </VStack>
                          <Button
                            label={z.is_active ? "Activa" : "Inactiva"}
                            variant={z.is_active ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => handleToggleZoneRule(z, "is_active")}
                          />
                        </div>

                        <div className="mt-3">
                          <Badge
                            variant={twoPhase ? "yellow" : "green"}
                            label={twoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <Switch
                            label="Casco"
                            size="sm"
                            value={z.require_helmet}
                            onChange={() => handleToggleZoneRule(z, "require_helmet")}
                          />
                          <Switch
                            label="Lentes"
                            size="sm"
                            value={z.require_glasses}
                            onChange={() => handleToggleZoneRule(z, "require_glasses")}
                          />
                          <Switch
                            label="Mascarilla"
                            size="sm"
                            value={z.require_mask}
                            onChange={() => handleToggleZoneRule(z, "require_mask")}
                          />
                          <Switch
                            label="Chaleco"
                            size="sm"
                            value={z.require_vest}
                            onChange={() => handleToggleZoneRule(z, "require_vest")}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr
                        style={{ borderColor: "var(--color-border-subtle)" }}
                        className="border-b uppercase"
                      >
                        <th className="py-3 pr-4">
                          <Text type="supporting">Área / Departamento</Text>
                        </th>
                        <th className="py-3 px-3 text-center">
                          <Text type="supporting">Casco</Text>
                        </th>
                        <th className="py-3 px-3 text-center">
                          <Text type="supporting">Lentes</Text>
                        </th>
                        <th className="py-3 px-3 text-center">
                          <Text type="supporting">Mascarilla</Text>
                        </th>
                        <th className="py-3 px-3 text-center">
                          <Text type="supporting">Chaleco</Text>
                        </th>
                        <th className="py-3 px-3 text-center">
                          <Text type="supporting">Flujo Quiosco</Text>
                        </th>
                        <th className="py-3 pl-3 text-right">
                          <Text type="supporting">Estado</Text>
                        </th>
                      </tr>
                    </thead>
                    <tbody
                      style={{ borderColor: "var(--color-border-subtle)" }}
                      className="divide-y"
                    >
                      {zones.map((z) => {
                        const twoPhase = z.require_mask || z.require_glasses;
                        return (
                          <tr key={z.id}>
                            <td className="py-3.5 pr-4">
                              <VStack gap={0.5}>
                                <Text type="label">{z.name}</Text>
                                {z.description && <Text type="supporting">{z.description}</Text>}
                              </VStack>
                            </td>
                            <td className="py-3.5 px-3">
                              <div className="flex justify-center">
                                <Switch
                                  isLabelHidden
                                  label={`Exigir casco en ${z.name}`}
                                  size="sm"
                                  value={z.require_helmet}
                                  onChange={() => handleToggleZoneRule(z, "require_helmet")}
                                />
                              </div>
                            </td>
                            <td className="py-3.5 px-3">
                              <div className="flex justify-center">
                                <Switch
                                  isLabelHidden
                                  label={`Exigir lentes en ${z.name}`}
                                  size="sm"
                                  value={z.require_glasses}
                                  onChange={() => handleToggleZoneRule(z, "require_glasses")}
                                />
                              </div>
                            </td>
                            <td className="py-3.5 px-3">
                              <div className="flex justify-center">
                                <Switch
                                  isLabelHidden
                                  label={`Exigir mascarilla en ${z.name}`}
                                  size="sm"
                                  value={z.require_mask}
                                  onChange={() => handleToggleZoneRule(z, "require_mask")}
                                />
                              </div>
                            </td>
                            <td className="py-3.5 px-3">
                              <div className="flex justify-center">
                                <Switch
                                  isLabelHidden
                                  label={`Exigir chaleco en ${z.name}`}
                                  size="sm"
                                  value={z.require_vest}
                                  onChange={() => handleToggleZoneRule(z, "require_vest")}
                                />
                              </div>
                            </td>
                            <td className="py-3.5 px-3 text-center">
                              <Badge
                                variant={twoPhase ? "yellow" : "green"}
                                label={twoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                              />
                            </td>
                            <td className="py-3.5 pl-3 text-right">
                              <Button
                                label={z.is_active ? "Activa" : "Inactiva"}
                                variant={z.is_active ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => handleToggleZoneRule(z, "is_active")}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </VStack>
            </Card>
          )}

          {activeTab === "users" && (
            <Card padding={5}>
              <VStack gap={5}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <HStack gap={2} vAlign="center">
                    <Users className="h-5 w-5 shrink-0" />
                    <VStack gap={0.5}>
                      <Heading level={3}>Colaboradores, Puestos y Biometría</Heading>
                      <Text type="supporting">
                        Administra roles operativos, accesos administrativos y registro facial
                      </Text>
                    </VStack>
                  </HStack>

                  <Button
                    label="Nuevo puesto"
                    variant="primary"
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => setNewRoleModalOpen(true)}
                  />
                </div>

                <div className="flex flex-col gap-3 md:hidden">
                  {users.map((u) => {
                    const hasCustomValue = !jobRoles.some((r) => r.name === u.job_title);
                    const roleOptions = [
                      ...(hasCustomValue ? [{ value: u.job_title, label: u.job_title }] : []),
                      ...jobRoles.map((r) => ({ value: r.name, label: r.name })),
                    ];

                    return (
                      <div
                        key={u.id}
                        style={{
                          backgroundColor: "var(--color-background-muted)",
                          borderColor: "var(--color-border-subtle)",
                        }}
                        className="rounded-xl border p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <VStack gap={0.5}>
                            <Text type="label">{u.full_name}</Text>
                            <Text type="supporting">{u.email}</Text>
                          </VStack>
                          <Badge
                            variant={u.is_active ? "success" : "error"}
                            label={u.is_active ? "Activo" : "Inactivo"}
                          />
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {u.has_face_enrolled ? (
                            <Badge
                              variant="green"
                              icon={<CheckCircle2 className="h-3 w-3" />}
                              label="Rostro registrado"
                            />
                          ) : (
                            <Badge label="Rostro pendiente" variant="neutral" />
                          )}
                          {u.employee_code && (
                            <Badge label={`ID: ${u.employee_code}`} variant="neutral" />
                          )}
                        </div>

                        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                          <div className="flex-1">
                            <Selector
                              disabledMessage="No puedes cambiar tu propio rol"
                              isDisabled={u.id === user.id}
                              label="Puesto / Rol"
                              options={roleOptions}
                              size="sm"
                              value={u.job_title}
                              width="100%"
                              onChange={(val) => {
                                const chosen = jobRoles.find((r) => r.name === val);
                                if (chosen && chosen.name !== u.job_title) {
                                  setPendingRoleChange({ target: u, selectedRole: chosen });
                                }
                              }}
                            />
                          </div>
                          <Button
                            isDisabled={u.id === user.id}
                            label={u.is_active ? "Desactivar" : "Activar"}
                            size="sm"
                            variant="secondary"
                            onClick={() => setPendingStatusToggle(u)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr
                        style={{ borderColor: "var(--color-border-subtle)" }}
                        className="border-b uppercase"
                      >
                        <th className="py-3 pr-4">
                          <Text type="supporting">Nombre</Text>
                        </th>
                        <th className="py-3 px-3">
                          <Text type="supporting">Código</Text>
                        </th>
                        <th className="py-3 px-3">
                          <Text type="supporting">Rostro</Text>
                        </th>
                        <th className="py-3 px-3">
                          <Text type="supporting">Puesto / Rol</Text>
                        </th>
                        <th className="py-3 px-3">
                          <Text type="supporting">Estado</Text>
                        </th>
                        <th className="py-3 pl-4 text-right">
                          <Text type="supporting">Cuenta</Text>
                        </th>
                      </tr>
                    </thead>
                    <tbody
                      style={{ borderColor: "var(--color-border-subtle)" }}
                      className="divide-y"
                    >
                      {users.map((u) => {
                        const hasCustomValue = !jobRoles.some((r) => r.name === u.job_title);
                        const roleOptions = [
                          ...(hasCustomValue ? [{ value: u.job_title, label: u.job_title }] : []),
                          ...jobRoles.map((r) => ({ value: r.name, label: r.name })),
                        ];

                        return (
                          <tr key={u.id}>
                            <td className="py-3.5 pr-4">
                              <VStack gap={0}>
                                <Text type="label">{u.full_name}</Text>
                                <Text type="supporting">{u.email}</Text>
                              </VStack>
                            </td>
                            <td className="py-3.5 px-3">
                              <Text type="code">{u.employee_code || "—"}</Text>
                            </td>
                            <td className="py-3.5 px-3">
                              {u.has_face_enrolled ? (
                                <Badge
                                  variant="green"
                                  icon={<CheckCircle2 className="h-3 w-3" />}
                                  label="Registrado"
                                />
                              ) : (
                                <Badge label="Pendiente" variant="neutral" />
                              )}
                            </td>
                            <td className="py-3.5 px-3">
                              <Selector
                                disabledMessage="No puedes cambiar tu propio rol"
                                isDisabled={u.id === user.id}
                                isLabelHidden
                                label={`Puesto de ${u.full_name}`}
                                options={roleOptions}
                                size="sm"
                                value={u.job_title}
                                width={220}
                                onChange={(val) => {
                                  const chosen = jobRoles.find((r) => r.name === val);
                                  if (chosen && chosen.name !== u.job_title) {
                                    setPendingRoleChange({ target: u, selectedRole: chosen });
                                  }
                                }}
                              />
                            </td>
                            <td className="py-3.5 px-3">
                              <Badge
                                variant={u.is_active ? "success" : "error"}
                                label={u.is_active ? "Activo" : "Inactivo"}
                              />
                            </td>
                            <td className="py-3.5 pl-4 text-right">
                              <Button
                                isDisabled={u.id === user.id}
                                label={u.is_active ? "Desactivar" : "Activar"}
                                size="sm"
                                variant="secondary"
                                onClick={() => setPendingStatusToggle(u)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </VStack>
            </Card>
          )}
        </VStack>
      </main>

      <Dialog
        isOpen={newZoneModalOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !creatingZone) setNewZoneModalOpen(false);
        }}
        width={460}
        purpose="form"
      >
        <form onSubmit={handleCreateZone}>
          <VStack gap={4}>
            <DialogHeader
              onOpenChange={(isOpen) => {
                if (!isOpen && !creatingZone) setNewZoneModalOpen(false);
              }}
              subtitle="Define el nombre y el equipo de protección obligatorio"
              title="Nueva Área / Zona de Trabajo"
            />

            <TextInput
              isRequired
              label="Nombre del área"
              placeholder="Ej. Destilación, Especias, Laboratorio..."
              value={zoneName}
              onChange={setZoneName}
              width="100%"
            />

            <TextInput
              isOptional
              label="Descripción breve"
              placeholder="Ej. Ingreso con equipo completo de protección"
              value={zoneDesc}
              onChange={setZoneDesc}
              width="100%"
            />

            <VStack gap={2}>
              <Text type="label">EPP obligatorio en esta área</Text>
              <div className="grid grid-cols-2 gap-3">
                <CheckboxInput label="Casco" value={zoneHelmet} onChange={setZoneHelmet} />
                <CheckboxInput label="Lentes" value={zoneGlasses} onChange={setZoneGlasses} />
                <CheckboxInput label="Mascarilla" value={zoneMask} onChange={setZoneMask} />
                <CheckboxInput label="Chaleco" value={zoneVest} onChange={setZoneVest} />
              </div>
            </VStack>

            <HStack gap={2} hAlign="end">
              <Button
                isDisabled={creatingZone}
                label="Cancelar"
                variant="secondary"
                onClick={() => setNewZoneModalOpen(false)}
              />
              <Button
                isLoading={creatingZone}
                label={creatingZone ? "Creando..." : "Guardar Área"}
                type="submit"
                variant="primary"
              />
            </HStack>
          </VStack>
        </form>
      </Dialog>

      <Dialog
        isOpen={newRoleModalOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !creatingRole) setNewRoleModalOpen(false);
        }}
        width={460}
        purpose="form"
      >
        <form onSubmit={handleCreateJobRole}>
          <VStack gap={4}>
            <DialogHeader
              onOpenChange={(isOpen) => {
                if (!isOpen && !creatingRole) setNewRoleModalOpen(false);
              }}
              subtitle="Crea un cargo operativo o administrativo para asignar a colaboradores"
              title="Agregar Nuevo Puesto a la Lista"
            />

            <TextInput
              isRequired
              label="Nombre del puesto o rol"
              placeholder="Ej. Operador de Destilación, Soldador..."
              value={newRoleName}
              onChange={setNewRoleName}
              width="100%"
            />

            <Selector
              label="Nivel de acceso en el sistema"
              value={newRoleAccess}
              width="100%"
              options={[
                { value: "employee", label: "Operador (Solo terminal de marcaje)" },
                { value: "admin", label: "Administrador (Panel de control + terminal)" },
              ]}
              onChange={(val) => setNewRoleAccess(val as "employee" | "admin")}
            />

            <HStack gap={2} hAlign="end">
              <Button
                isDisabled={creatingRole}
                label="Cancelar"
                variant="secondary"
                onClick={() => setNewRoleModalOpen(false)}
              />
              <Button
                isLoading={creatingRole}
                label={creatingRole ? "Agregando..." : "Guardar en lista"}
                type="submit"
                variant="primary"
              />
            </HStack>
          </VStack>
        </form>
      </Dialog>

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
            ? `¿Deseas ${pendingStatusToggle.is_active ? "suspender" : "habilitar"} el acceso de ${pendingStatusToggle.full_name}?`
            : ""
        }
        confirmLabel={pendingStatusToggle?.is_active ? "Sí, desactivar" : "Sí, activar"}
        danger={Boolean(pendingStatusToggle?.is_active)}
        loading={applyingAction}
        onConfirm={confirmStatusChange}
        onCancel={() => setPendingStatusToggle(null)}
      />

      <Dialog
        isOpen={evidenceRecordId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEvidenceRecordId(null);
        }}
        width={560}
        purpose="info"
      >
        <VStack gap={4}>
          <DialogHeader
            title={`Evidencia de Marcaje #${evidenceRecordId ?? ""}`}
            onOpenChange={(isOpen) => {
              if (!isOpen) setEvidenceRecordId(null);
            }}
          />
          {evidenceRecordId !== null && (
            <div className="overflow-hidden rounded-xl bg-black p-2">
              <img
                src={api.evidenceUrl(evidenceRecordId)}
                alt={`Evidencia ${evidenceRecordId}`}
                className="mx-auto max-h-[65vh] rounded-lg object-contain"
              />
            </div>
          )}
        </VStack>
      </Dialog>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
