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
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
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
  const [kioskZoneId, setKioskZoneId] = useState<number | null>(null);
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [recordsViewMode, setRecordsViewMode] = useState<"grouped" | "table">("grouped");
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
  const [pendingFaceReset, setPendingFaceReset] = useState<"all_employees" | "all_including_admin" | AdminUserItem | null>(null);
  const [applyingAction, setApplyingAction] = useState(false);

  const loadAll = async (
    filter = statusFilter,
    query = search,
    zoneNameVal = zoneFilter,
    empVal = employeeFilter
  ) => {
    try {
      const uid = empVal !== "all" ? Number(empVal) : undefined;
      const [statsRes, zonesRes, kioskCfg, recRes, usersRes, rolesRes] = await Promise.all([
        api.getAdminStats(),
        api.getAdminZones(),
        api.getKioskConfig().catch(() => ({ active_zone_id: null, active_zone: null })),
        api.getAdminRecords(filter, query, zoneNameVal, uid),
        api.getAdminUsers(),
        api.getJobRoles(),
      ]);
      setStats(statsRes);
      setZones(zonesRes);
      setKioskZoneId(kioskCfg.active_zone_id ?? zonesRes.find((z) => z.is_active)?.id ?? null);
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

  const handleSelectKioskZone = async (newZoneId: number) => {
    try {
      const chosen = await api.setAdminKioskZone(newZoneId);
      setKioskZoneId(chosen.id);
      setToast({
        type: "success",
        title: "Terminal actualizada",
        message: `El quiosco ahora exige el EPP del área "${chosen.name}".`,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo cambiar el área del quiosco",
        message: err instanceof Error ? err.message : "Error inesperado.",
      });
    }
  };

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

  const handleFilterChange = async (
    newFilter: string,
    newSearch: string,
    newZone = zoneFilter,
    newEmployee = employeeFilter
  ) => {
    setStatusFilter(newFilter);
    setSearch(newSearch);
    setZoneFilter(newZone);
    setEmployeeFilter(newEmployee);
    try {
      const uid = newEmployee !== "all" ? Number(newEmployee) : undefined;
      const recRes = await api.getAdminRecords(newFilter, newSearch, newZone, uid);
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

  const confirmFaceReset = async () => {
    if (!pendingFaceReset) return;
    setApplyingAction(true);
    try {
      const res =
        pendingFaceReset === "all_including_admin"
          ? await api.resetAllFaces()
          : pendingFaceReset === "all_employees"
          ? await api.resetEmployeeFaces()
          : await api.resetUserFace(pendingFaceReset.id);
      setPendingFaceReset(null);
      await loadAll();
      setToast({
        type: "success",
        title: "Rostros eliminados",
        message: res.message,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo borrar el registro facial",
        message: err instanceof Error ? err.message : "Error inesperado.",
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

  // Agrupación de registros por Área y luego por Empleado
  const groupedByArea = records.reduce<
    Record<
      string,
      {
        zoneName: string;
        total: number;
        approved: number;
        employees: Record<
          number,
          {
            userId: number;
            userName: string;
            userEmail: string;
            items: AdminAttendanceRecord[];
          }
        >;
      }
    >
  >((acc, rec) => {
    if (!acc[rec.zone_name]) {
      acc[rec.zone_name] = {
        zoneName: rec.zone_name,
        total: 0,
        approved: 0,
        employees: {},
      };
    }
    acc[rec.zone_name].total += 1;
    if (rec.is_compliant) acc[rec.zone_name].approved += 1;

    if (!acc[rec.zone_name].employees[rec.user_id]) {
      acc[rec.zone_name].employees[rec.user_id] = {
        userId: rec.user_id,
        userName: rec.user_full_name,
        userEmail: rec.user_email,
        items: [],
      };
    }
    acc[rec.zone_name].employees[rec.user_id].items.push(rec);
    return acc;
  }, {});

  const activeZonesOnly = zones.filter((z) => z.is_active);
  const currentKioskZone = zones.find((z) => z.id === kioskZoneId) || activeZonesOnly[0] || null;

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
            <Tab label="Bitácora de Asistencia" value="records" />
            <Tab label="Áreas y Terminal" value="zones" />
            <Tab label="Personal" value="users" />
          </TabList>

          {activeTab === "records" && (
            <Card padding={5}>
              <VStack gap={5}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <VStack gap={0.5}>
                    <Heading level={3}>Bitácora Auditada por Área y Empleado</Heading>
                    <Text type="supporting">
                      Visible únicamente para administradores · Incluye evidencia fotográfica y
                      exportación CSV
                    </Text>
                  </VStack>

                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      label="Vista de bitácora"
                      value={recordsViewMode}
                      onChange={(val) => setRecordsViewMode(val as "grouped" | "table")}
                    >
                      <SegmentedControlItem label="Por Área / Empleado" value="grouped" />
                      <SegmentedControlItem label="Tabla general" value="table" />
                    </SegmentedControl>

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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Selector
                    label="Filtrar por Área"
                    size="sm"
                    value={zoneFilter || "all"}
                    width="100%"
                    options={[
                      { value: "all", label: "Todas las áreas" },
                      ...zones.map((z) => ({ value: z.name, label: z.name })),
                    ]}
                    onChange={(val) =>
                      handleFilterChange(
                        statusFilter,
                        search,
                        val === "all" ? "" : val,
                        employeeFilter
                      )
                    }
                  />

                  <Selector
                    hasSearch
                    label="Filtrar por Empleado"
                    size="sm"
                    value={employeeFilter}
                    width="100%"
                    options={[
                      { value: "all", label: "Todos los empleados" },
                      ...users.map((u) => ({ value: String(u.id), label: u.full_name })),
                    ]}
                    onChange={(val) =>
                      handleFilterChange(statusFilter, search, zoneFilter, val)
                    }
                  />

                  <Selector
                    label="Estado EPP"
                    size="sm"
                    value={statusFilter}
                    width="100%"
                    options={[
                      { value: "all", label: "Todos los estados" },
                      { value: "approved", label: "Solo Aprobados" },
                      { value: "rejected", label: "Solo Rechazados" },
                    ]}
                    onChange={(val) =>
                      handleFilterChange(val, search, zoneFilter, employeeFilter)
                    }
                  />

                  <TextInput
                    label="Búsqueda rápida"
                    type="search"
                    size="sm"
                    hasClear
                    startIcon={<Search className="h-3.5 w-3.5" />}
                    placeholder="Nombre o correo..."
                    value={search}
                    onChange={(val) =>
                      handleFilterChange(statusFilter, val, zoneFilter, employeeFilter)
                    }
                    width="100%"
                  />
                </div>

                {records.length === 0 ? (
                  <div className="py-8 text-center">
                    <Text type="supporting">No hay registros que coincidan con el filtro.</Text>
                  </div>
                ) : recordsViewMode === "grouped" ? (
                  <VStack gap={5}>
                    {Object.values(groupedByArea).map((areaGroup) => (
                      <div
                        key={areaGroup.zoneName}
                        style={{
                          backgroundColor: "var(--color-background-muted)",
                          borderColor: "var(--color-border-subtle)",
                        }}
                        className="rounded-2xl border p-4 sm:p-5"
                      >
                        <VStack gap={4}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <HStack gap={2} vAlign="center">
                              <MapPin className="h-4 w-4 shrink-0" />
                              <Heading level={3}>{areaGroup.zoneName}</Heading>
                            </HStack>
                            <HStack gap={2} vAlign="center">
                              <Badge
                                label={`${areaGroup.approved}/${areaGroup.total} aprobados`}
                                variant="green"
                              />
                              <Badge
                                label={`${Object.keys(areaGroup.employees).length} empleados`}
                                variant="neutral"
                              />
                            </HStack>
                          </div>

                          <Divider />

                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {Object.values(areaGroup.employees).map((empGroup) => (
                              <Card key={empGroup.userId} padding={4}>
                                <VStack gap={3}>
                                  <div className="flex items-start justify-between gap-2">
                                    <VStack gap={0.5}>
                                      <Text type="label">{empGroup.userName}</Text>
                                      <Text type="supporting">{empGroup.userEmail}</Text>
                                    </VStack>
                                    <Badge
                                      label={`${empGroup.items.length} marcajes`}
                                      variant="neutral"
                                    />
                                  </div>

                                  <div className="flex flex-col gap-2">
                                    {empGroup.items.map((rec) => {
                                      const eppList = [
                                        rec.has_helmet ? "Casco" : null,
                                        rec.has_glasses ? "Lentes" : null,
                                        rec.has_mask ? "Mascarilla" : null,
                                        rec.has_vest ? "Chaleco" : null,
                                      ].filter(Boolean);

                                      return (
                                        <div
                                          key={rec.id}
                                          style={{
                                            backgroundColor: "var(--color-background-muted)",
                                            borderColor: "var(--color-border-subtle)",
                                          }}
                                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
                                        >
                                          <VStack gap={0.5}>
                                            <HStack gap={1.5} vAlign="center">
                                              <Badge
                                                variant={
                                                  rec.event_type === "EXIT" ? "orange" : "blue"
                                                }
                                                label={
                                                  rec.event_type === "EXIT" ? "Salida" : "Entrada"
                                                }
                                              />
                                              <Badge
                                                variant={rec.is_compliant ? "success" : "error"}
                                                label={
                                                  rec.is_compliant ? "Aprobado" : "Rechazado"
                                                }
                                              />
                                              <Text hasTabularNumbers type="supporting">
                                                {new Date(rec.created_at).toLocaleString([], {
                                                  day: "2-digit",
                                                  month: "2-digit",
                                                  hour: "2-digit",
                                                  minute: "2-digit",
                                                })}
                                              </Text>
                                            </HStack>
                                            <Text type="supporting">
                                              EPP: {eppList.length > 0 ? eppList.join(", ") : "Ninguno"}
                                            </Text>
                                          </VStack>

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
                                      );
                                    })}
                                  </div>
                                </VStack>
                              </Card>
                            ))}
                          </div>
                        </VStack>
                      </div>
                    ))}
                  </VStack>
                ) : (
                  <div className="overflow-x-auto">
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
                )}
              </VStack>
            </Card>
          )}

          {activeTab === "zones" && (
            <VStack gap={5}>
              <Card padding={5}>
                <VStack gap={4}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <VStack gap={0.5}>
                      <Heading level={3}>Área Activa en Terminal de Marcaje</Heading>
                      <Text type="supporting">
                        Define qué área y qué equipo de protección obligatorio aplicará la terminal
                        pública a los colaboradores.
                      </Text>
                    </VStack>
                    {currentKioskZone && (
                      <Badge
                        variant="green"
                        label={`En uso: ${currentKioskZone.name}`}
                      />
                    )}
                  </div>

                  <div className="max-w-md">
                    <Selector
                      label="Área asignada al quiosco"
                      size="md"
                      width="100%"
                      startIcon={<MapPin className="h-4 w-4" />}
                      options={activeZonesOnly.map((z) => ({
                        value: String(z.id),
                        label: z.name,
                        description: z.description || undefined,
                      }))}
                      value={kioskZoneId !== null ? String(kioskZoneId) : undefined}
                      onChange={(val) => handleSelectKioskZone(Number(val))}
                    />
                  </div>
                </VStack>
              </Card>

              <Card padding={5}>
                <VStack gap={5}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <HStack gap={2} vAlign="center">
                      <MapPin className="h-5 w-5 shrink-0" />
                      <VStack gap={0.5}>
                        <Heading level={3}>Reglas de EPP por Área Operativa</Heading>
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

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Badge
                              variant={twoPhase ? "yellow" : "green"}
                              label={twoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                            />
                            {z.id === kioskZoneId && (
                              <Badge variant="blue" label="Activa en Quiosco" />
                            )}
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
                                  <HStack gap={2} vAlign="center">
                                    <Text type="label">{z.name}</Text>
                                    {z.id === kioskZoneId && (
                                      <Badge variant="blue" label="En Terminal" />
                                    )}
                                  </HStack>
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
            </VStack>
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

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      label="Borrar TODOS los rostros"
                      variant="secondary"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setPendingFaceReset("all_including_admin")}
                    />
                    <Button
                      label="Borrar solo empleados"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingFaceReset("all_employees")}
                    />
                    <Button
                      label="Nuevo puesto"
                      variant="primary"
                      size="sm"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setNewRoleModalOpen(true)}
                    />
                  </div>
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
                          <div className="flex flex-wrap items-center gap-2">
                            {u.has_face_enrolled && (
                              <Button
                                label="Borrar rostro"
                                size="sm"
                                variant="ghost"
                                onClick={() => setPendingFaceReset(u)}
                              />
                            )}
                            <Button
                              isDisabled={u.id === user.id}
                              label={u.is_active ? "Desactivar" : "Activar"}
                              size="sm"
                              variant="secondary"
                              onClick={() => setPendingStatusToggle(u)}
                            />
                          </div>
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
                              <div className="flex items-center justify-end gap-2">
                                {u.has_face_enrolled && (
                                  <Button
                                    label="Borrar rostro"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setPendingFaceReset(u)}
                                  />
                                )}
                                <Button
                                  isDisabled={u.id === user.id}
                                  label={u.is_active ? "Desactivar" : "Activar"}
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setPendingStatusToggle(u)}
                                />
                              </div>
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
        open={pendingFaceReset !== null}
        title="Borrar registro biométrico"
        message={
          pendingFaceReset === "all_including_admin"
            ? "¿Eliminar TODOS los registros faciales del sistema (incluyendo el del Administrador) para empezar desde cero?"
            : pendingFaceReset === "all_employees"
            ? "¿Eliminar los rostros registrados de todos los empleados y conservar únicamente el perfil facial del Administrador?"
            : pendingFaceReset
            ? `¿Eliminar el rostro registrado de ${pendingFaceReset.full_name}?`
            : ""
        }
        confirmLabel="Sí, borrar rostros"
        danger
        loading={applyingAction}
        onConfirm={confirmFaceReset}
        onCancel={() => setPendingFaceReset(null)}
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
