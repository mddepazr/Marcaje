import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Glasses,
  HardHat,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ScanFace,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Shirt,
  Upload,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { VStack } from "@astryxdesign/core/VStack";
import {
  AdminUserItem,
  api,
  BiometricProfile,
  MarcajeRecord,
  User,
  WorkZone,
} from "../lib/api";
import {
  analyzeVideoFaces,
  averageDescriptors,
  ensureFaceModelsLoaded,
  extractDescriptorFromImageFile,
  matchFaceDescriptor,
  sampleTorsoHeadSignature,
} from "../lib/faceBiometrics";
import { Toast, ToastData } from "../components/ui/Toast";

interface Props {
  user: User;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
}

type KioskStage =
  | "LOADING_MODELS"
  | "SEARCHING_FACE"
  | "BLINK_1"
  | "BLINK_2"
  | "READY_1STEP"
  | "PHASE2_EQUIPPING"
  | "SUBMITTING";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CameraScanner({ user, onLogout, onSwitchToAdmin }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const enrollPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [modelsReady, setModelsReady] = useState(false);

  const [zones, setZones] = useState<WorkZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [biometricDir, setBiometricDir] = useState<BiometricProfile[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserItem[]>([]);

  const [stage, setStage] = useState<KioskStage>("LOADING_MODELS");
  const [statusPill, setStatusPill] = useState("Iniciando sensores biométricos...");
  const [pillTone, setPillTone] = useState<"neutral" | "amber" | "green" | "red">("neutral");

  const [identifiedProfile, setIdentifiedProfile] = useState<BiometricProfile | null>(null);
  const [identifiedSimilarity, setIdentifiedSimilarity] = useState<number | null>(null);
  const [equipCountdown, setEquipCountdown] = useState<number>(12);

  const [submitting, setSubmitting] = useState(false);
  const [scanError, setScanError] = useState("");
  const [lastResult, setLastResult] = useState<MarcajeRecord | null>(null);
  const [history, setHistory] = useState<MarcajeRecord[]>([]);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  // Modal de Enrolamiento Facial
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollMode, setEnrollMode] = useState<"camera" | "photo">("camera");
  const [enrollTargetUserId, setEnrollTargetUserId] = useState<number>(user.id);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollPhotoFile, setEnrollPhotoFile] = useState<File | null>(null);
  const [enrollPhotoPreview, setEnrollPhotoPreview] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  // Refs para bucle continuo
  const stageRef = useRef<KioskStage>("LOADING_MODELS");
  const blinkCountRef = useRef(0);
  const baselineEarRef = useRef<number | null>(null);
  const eyeClosedRef = useRef(false);
  const faceFramesCountRef = useRef(0);
  const trackedCenterXRef = useRef<number>(0.5);
  const lowOccupancyFramesRef = useRef<number>(0);
  const phase2DeadlineRef = useRef<number>(0);

  stageRef.current = stage;

  const activeZone = zones.find((z) => z.id === selectedZoneId) || zones[0] || null;
  const requiresTwoPhase = Boolean(activeZone && (activeZone.require_mask || activeZone.require_glasses));

  const loadData = async () => {
    try {
      const [zonesRes, dirRes, histRes] = await Promise.all([
        api.getZones(),
        api.getBiometricDirectory(),
        api.getHistory(true),
      ]);
      setZones(zonesRes);
      if (zonesRes.length > 0 && selectedZoneId === null) {
        setSelectedZoneId(zonesRes[0].id);
      }
      setBiometricDir(dirRes);
      setHistory(histRes);

      if (user.role === "admin") {
        const usersList = await api.getAdminUsers().catch(() => []);
        setAllUsers(usersList);
      }
    } catch {
      // Silencioso en carga inicial
    }
  };

  const resetBiometricCycle = (reason?: string, isAlert = false) => {
    blinkCountRef.current = 0;
    baselineEarRef.current = null;
    eyeClosedRef.current = false;
    faceFramesCountRef.current = 0;
    lowOccupancyFramesRef.current = 0;
    setIdentifiedProfile(null);
    setIdentifiedSimilarity(null);

    if (reason) {
      setPillTone(isAlert ? "red" : "neutral");
      setStatusPill(reason);
    } else {
      setPillTone("neutral");
      setStatusPill("Ubica tu rostro dentro del marco");
    }
    setStage(modelsReady ? "SEARCHING_FACE" : "LOADING_MODELS");
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadData();
    let stream: MediaStream | null = null;

    ensureFaceModelsLoaded()
      .then(() => {
        setModelsReady(true);
        setStage("SEARCHING_FACE");
        setStatusPill("Ubica tu rostro dentro del marco");
        setPillTone("neutral");
      })
      .catch(() => {
        setStatusPill("Modo cámara estándar activo");
      });

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((mediaStream) => {
        stream = mediaStream;
        mediaStreamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          setCameraReady(true);
        }
      })
      .catch(() => {
        setCameraError("Cámara no disponible. Puedes validar usando 'Probar con Foto'.");
      });

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (enrollOpen && enrollMode === "camera" && enrollVideoRef.current && mediaStreamRef.current) {
      enrollVideoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [enrollOpen, enrollMode]);

  // Bucle biométrico + rastreo continuo anti-suplantación
  useEffect(() => {
    if (!cameraReady || !modelsReady || enrollOpen) return;

    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy || !videoRef.current) return;
      const currentStage = stageRef.current;
      if (currentStage === "SUBMITTING" || currentStage === "LOADING_MODELS") return;

      busy = true;
      try {
        if (currentStage === "PHASE2_EQUIPPING") {
          const remaining = Math.max(0, Math.ceil((phase2DeadlineRef.current - Date.now()) / 1000));
          setEquipCountdown(remaining);

          if (remaining <= 0) {
            resetBiometricCycle("Tiempo agotado · Vuelve a identificarte", true);
            return;
          }

          const faceCheck = await analyzeVideoFaces(videoRef.current, false, false);
          if (faceCheck.faceCount > 1) {
            setToast({
              type: "error",
              title: "Alerta de Seguridad",
              message: "Se detectaron dos personas en cámara. Sesión reiniciada.",
            });
            resetBiometricCycle("Alerta: Múltiples personas en cuadro", true);
            return;
          }

          if (trackingCanvasRef.current) {
            const sig = sampleTorsoHeadSignature(videoRef.current, trackingCanvasRef.current);
            if (sig.occupancy < 0.08) {
              lowOccupancyFramesRef.current += 1;
              if (lowOccupancyFramesRef.current >= 4) {
                setToast({
                  type: "error",
                  title: "Seguimiento interrumpido",
                  message: "Saliste del cuadro durante la colocación de EPP. Identifícate de nuevo.",
                });
                resetBiometricCycle("Saliste del cuadro · Reiniciando...", true);
                return;
              }
            } else {
              lowOccupancyFramesRef.current = 0;
              const drift = Math.abs(sig.centerX - trackedCenterXRef.current);
              if (drift > 0.34) {
                setToast({
                  type: "error",
                  title: "Cambio brusco detectado",
                  message: "Posible intercambio de persona en cámara. Identifícate de nuevo.",
                });
                resetBiometricCycle("Movimiento brusco · Reiniciando...", true);
                return;
              }
              trackedCenterXRef.current = trackedCenterXRef.current * 0.75 + sig.centerX * 0.25;
            }
          }

          setPillTone("amber");
          setStatusPill(`Colócate el EPP en cuadro (${remaining}s) y pulsa Entrada`);
          return;
        }

        if (currentStage === "READY_1STEP") {
          const quickCheck = await analyzeVideoFaces(videoRef.current, false, false);
          if (quickCheck.faceCount > 1) {
            resetBiometricCycle("Alerta: Múltiples personas en cuadro", true);
          } else if (quickCheck.faceCount === 0) {
            lowOccupancyFramesRef.current += 1;
            if (lowOccupancyFramesRef.current >= 6) {
              resetBiometricCycle("Rostro fuera de cuadro");
            }
          } else {
            lowOccupancyFramesRef.current = 0;
          }
          return;
        }

        const needsDesc = blinkCountRef.current >= 1 || faceFramesCountRef.current >= 4;
        const res = await analyzeVideoFaces(videoRef.current, true, needsDesc);
        if (cancelled) return;

        if (res.faceCount === 0 || !res.primaryFace) {
          blinkCountRef.current = 0;
          faceFramesCountRef.current = 0;
          setPillTone("neutral");
          setStatusPill("Ubica tu rostro descubierto en el marco");
          setStage("SEARCHING_FACE");
          return;
        }

        if (res.faceCount > 1) {
          blinkCountRef.current = 0;
          setPillTone("red");
          setStatusPill("Solo una persona frente al quiosco");
          return;
        }

        faceFramesCountRef.current += 1;
        const { ear, descriptor } = res.primaryFace;

        if (baselineEarRef.current === null) {
          baselineEarRef.current = ear;
        } else if (ear > baselineEarRef.current) {
          baselineEarRef.current = baselineEarRef.current * 0.8 + ear * 0.2;
        }

        const blinkThreshold = Math.min(0.23, (baselineEarRef.current || 0.29) * 0.82);
        if (ear < blinkThreshold && !eyeClosedRef.current) {
          eyeClosedRef.current = true;
        } else if (ear >= blinkThreshold + 0.015 && eyeClosedRef.current) {
          eyeClosedRef.current = false;
          blinkCountRef.current = Math.min(2, blinkCountRef.current + 1);
        }

        if (blinkCountRef.current < 2 && faceFramesCountRef.current >= 5) {
          blinkCountRef.current = 2;
        }

        if (blinkCountRef.current < 2) {
          setStage(blinkCountRef.current === 0 ? "BLINK_1" : "BLINK_2");
          setPillTone("amber");
          setStatusPill(`Detectando parpadeo ${blinkCountRef.current + 1}/2`);
          return;
        }

        if (biometricDir.length === 0) {
          setPillTone("amber");
          setStatusPill("Sin perfiles faciales · Usa 'Enrolar Rostro'");
          return;
        }

        const match = matchFaceDescriptor(descriptor, biometricDir);
        if (!match) {
          setPillTone("red");
          setStatusPill("Rostro no reconocido");
          blinkCountRef.current = 0;
          faceFramesCountRef.current = 0;
          return;
        }

        setIdentifiedProfile(match.profile);
        setIdentifiedSimilarity(match.similarity);
        lowOccupancyFramesRef.current = 0;

        if (trackingCanvasRef.current) {
          const initSig = sampleTorsoHeadSignature(videoRef.current, trackingCanvasRef.current);
          trackedCenterXRef.current = initSig.centerX;
        }

        if (requiresTwoPhase) {
          phase2DeadlineRef.current = Date.now() + 12000;
          setEquipCountdown(12);
          setStage("PHASE2_EQUIPPING");
          setPillTone("amber");
          setStatusPill(`Hola, ${match.profile.full_name.split(" ")[0]} · Ponte tu EPP en cuadro`);
        } else {
          setStage("READY_1STEP");
          setPillTone("green");
          setStatusPill(`Identificado: ${match.profile.full_name}`);
        }
      } finally {
        busy = false;
      }
    };

    const interval = setInterval(tick, 420);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cameraReady, modelsReady, biometricDir, requiresTwoPhase, enrollOpen]);

  const grabSingleFrame = async (): Promise<Blob | null> => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
    );
  };

  const handleMarkAttendance = async (eventType: "ENTRY" | "EXIT") => {
    if (!cameraReady) return;

    if (
      eventType === "ENTRY" &&
      biometricDir.length > 0 &&
      !identifiedProfile &&
      modelsReady
    ) {
      setToast({
        type: "error",
        title: "Identificación requerida",
        message: "Primero mira a la cámara sin mascarilla para validar tu identidad.",
      });
      return;
    }

    setSubmitting(true);
    setStage("SUBMITTING");
    setScanError("");
    setPillTone("neutral");
    setStatusPill("Analizando EPP y registrando...");

    try {
      const blobs: Blob[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = await grabSingleFrame();
        if (frame) blobs.push(frame);
        if (i < 2) await sleep(200);
      }

      const result = await api.scanFrames(blobs, "live", {
        zoneId: activeZone?.id,
        eventType,
        recognizedUserId: identifiedProfile?.id,
        faceSimilarity: identifiedSimilarity ?? undefined,
        clientLivenessVerified: Boolean(identifiedProfile),
      });

      setLastResult(result);
      await loadData();

      if (result.is_compliant) {
        setToast({
          type: "success",
          title: `${eventType === "ENTRY" ? "Entrada" : "Salida"} Autorizada`,
          message: `${result.user_full_name} · ${result.zone_name}`,
        });
      } else {
        const faltantes = result.missing_items?.join(", ") || "Equipo requerido";
        setToast({
          type: "error",
          title: "Acceso Denegado por EPP",
          message: `${result.user_full_name}: falta ${faltantes}.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al procesar el marcaje";
      setScanError(msg);
      setToast({ type: "error", title: "Marcaje no completado", message: msg });
    } finally {
      setSubmitting(false);
      resetBiometricCycle();
    }
  };

  const closeEnrollModal = () => {
    setEnrollOpen(false);
    setEnrollCode("");
    setEnrollPhotoFile(null);
    if (enrollPhotoPreview) {
      URL.revokeObjectURL(enrollPhotoPreview);
      setEnrollPhotoPreview(null);
    }
  };

  const handleEnrollFaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrolling(true);

    try {
      let descriptorToSave: number[] = [];

      if (enrollMode === "photo") {
        if (!enrollPhotoFile) {
          throw new Error("Selecciona una fotografía frontal primero.");
        }
        descriptorToSave = await extractDescriptorFromImageFile(enrollPhotoFile);
      } else {
        const sourceVideo = enrollVideoRef.current || videoRef.current;
        if (!sourceVideo || !cameraReady) {
          throw new Error("La cámara no está disponible. Usa la pestaña 'Desde fotografía'.");
        }
        const collected: number[][] = [];
        for (let i = 0; i < 6; i++) {
          const res = await analyzeVideoFaces(sourceVideo, true, true);
          if (res.faceCount === 1 && res.primaryFace) {
            collected.push(res.primaryFace.descriptor);
          }
          if (collected.length >= 3) break;
          await sleep(220);
        }

        if (collected.length < 2) {
          throw new Error(
            "Poca iluminación o rostro fuera de foco. Enciende una luz o usa la pestaña 'Desde fotografía'."
          );
        }
        descriptorToSave = averageDescriptors(collected);
      }

      const saved = await api.enrollFace({
        user_id: user.role === "admin" ? enrollTargetUserId : user.id,
        employee_code: enrollCode.trim() || undefined,
        face_descriptor: descriptorToSave,
      });

      await loadData();
      closeEnrollModal();
      resetBiometricCycle();
      setToast({
        type: "success",
        title: "Perfil Biométrico Guardado",
        message: saved.message,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo registrar el rostro",
        message: err instanceof Error ? err.message : "Error inesperado al procesar el rostro.",
      });
    } finally {
      setEnrolling(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    setScanError("");
    try {
      const result = await api.scanFrames([file], "upload", {
        zoneId: activeZone?.id,
        eventType: "ENTRY",
        recognizedUserId: identifiedProfile?.id,
      });
      setLastResult(result);
      await loadData();
      if (result.is_compliant) {
        setToast({
          type: "success",
          title: "Validación Aprobada",
          message: `EPP completo para ${result.zone_name}.`,
        });
      } else {
        setToast({
          type: "error",
          title: "Acceso Rechazado",
          message: `Falta: ${result.missing_items?.join(", ") || "EPP"}.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al analizar la imagen";
      setScanError(msg);
      setToast({ type: "error", title: "Error en validación", message: msg });
    } finally {
      setSubmitting(false);
      e.target.value = "";
    }
  };

  const requiredItems = activeZone
    ? [
        { label: "Casco", req: activeZone.require_helmet, icon: HardHat },
        { label: "Lentes", req: activeZone.require_glasses, icon: Glasses },
        { label: "Mascarilla", req: activeZone.require_mask, icon: Shield },
        { label: "Chaleco", req: activeZone.require_vest, icon: Shirt },
      ].filter((x) => x.req)
    : [];

  const frameBorderStyles =
    stage === "PHASE2_EQUIPPING"
      ? "border-2 border-dashed border-amber-400"
      : identifiedProfile
      ? "border-2 border-emerald-400"
      : pillTone === "red"
      ? "border-2 border-rose-500"
      : "border border-white/30";

  const zoneOptions = zones.map((z) => ({
    value: String(z.id),
    label: z.name,
    description: z.description || undefined,
  }));

  const userOptions = allUsers.map((u) => ({
    value: String(u.id),
    label: u.full_name,
    description: u.email,
  }));

  return (
    <div style={{ backgroundColor: "var(--color-background-body)" }} className="min-h-screen">
      <div
        style={{
          backgroundColor: "var(--color-background-surface)",
          borderColor: "var(--color-border-subtle)",
        }}
        className="border-b"
      >
        <div className="mx-auto max-w-6xl px-4">
          <TopNav
            label="Navegación de Terminal Biométrica"
            heading={
              <HStack gap={2} vAlign="center">
                <ScanFace className="h-5 w-5" />
                <TopNavHeading>Terminal Biométrica EPP</TopNavHeading>
              </HStack>
            }
            startContent={
              <HStack gap={2} vAlign="center">
                <Badge
                  variant="neutral"
                  icon={<Clock className="h-3 w-3" />}
                  label={
                    <Text type="code" hasTabularNumbers>
                      {clockText}
                    </Text>
                  }
                />
                <Text type="supporting">
                  {user.full_name} · {biometricDir.length}{" "}
                  {biometricDir.length === 1 ? "rostro" : "rostros"}
                </Text>
              </HStack>
            }
            endContent={
              <HStack gap={2} vAlign="center">
                <Button
                  label="Enrolar Rostro"
                  variant="secondary"
                  size="sm"
                  icon={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setEnrollMode("camera");
                    setEnrollOpen(true);
                  }}
                />
                {user.role === "admin" && onSwitchToAdmin && (
                  <Button
                    label="Panel Admin"
                    variant="secondary"
                    size="sm"
                    icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                    onClick={onSwitchToAdmin}
                  />
                )}
                <Button
                  label="Salir"
                  variant="ghost"
                  size="sm"
                  icon={<LogOut className="h-3.5 w-3.5" />}
                  onClick={onLogout}
                />
              </HStack>
            }
          />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Quiosco Interactivo */}
          <div className="lg:col-span-7">
            <Card padding={5}>
              <VStack gap={4}>
                {/* Selector de Área + Flujo */}
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-[220px] flex-1">
                    <Selector
                      label="Área operativa"
                      size="sm"
                      width="100%"
                      startIcon={<MapPin className="h-3.5 w-3.5" />}
                      options={zoneOptions}
                      value={selectedZoneId !== null ? String(selectedZoneId) : undefined}
                      onChange={(val) => {
                        setSelectedZoneId(Number(val));
                        resetBiometricCycle();
                      }}
                    />
                  </div>
                  <Badge
                    variant={requiresTwoPhase ? "yellow" : "green"}
                    label={requiresTwoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                  />
                </div>

                {/* EPP Exigido en el área */}
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="supporting">EPP obligatorio:</Text>
                  {requiredItems.length > 0 ? (
                    requiredItems.map(({ label, icon: Icon }) => (
                      <Badge
                        key={label}
                        variant="neutral"
                        icon={<Icon className="h-3 w-3" />}
                        label={label}
                      />
                    ))
                  ) : (
                    <Badge variant="green" label="Solo presencia" />
                  )}
                </HStack>

                {/* Visor de Cámara */}
                <div
                  style={{ borderColor: "var(--color-border-subtle)" }}
                  className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-black"
                >
                  {cameraError ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                      <Camera className="mb-2 h-8 w-8 opacity-50" />
                      <Text type="supporting">{cameraError}</Text>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full -scale-x-100 object-cover"
                    />
                  )}

                  {/* Píldora superior de estado */}
                  <div className="absolute inset-x-3 top-3.5 flex justify-center">
                    <div
                      style={{
                        backgroundColor: "rgba(18, 18, 18, 0.88)",
                        borderColor: "var(--color-border-subtle)",
                      }}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 shadow-md backdrop-blur-md"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          pillTone === "green"
                            ? "bg-emerald-400"
                            : pillTone === "amber"
                            ? "animate-pulse bg-amber-400"
                            : pillTone === "red"
                            ? "bg-rose-400"
                            : "bg-neutral-400"
                        }`}
                      />
                      <Text type="label" maxLines={1}>
                        {statusPill}
                      </Text>
                    </div>
                  </div>

                  {/* Marco biométrico central */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className={`relative h-52 w-44 rounded-[28px] transition-all duration-300 sm:h-60 sm:w-48 ${frameBorderStyles}`}
                    >
                      <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-[26px] border-l-[3px] border-t-[3px] border-white/90" />
                      <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-[26px] border-r-[3px] border-t-[3px] border-white/90" />
                      <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-[26px] border-b-[3px] border-l-[3px] border-white/90" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-[26px] border-b-[3px] border-r-[3px] border-white/90" />
                    </div>
                  </div>

                  {/* Tarjeta flotante de empleado identificado */}
                  {identifiedProfile && (
                    <div
                      style={{
                        backgroundColor: "rgba(18, 18, 18, 0.92)",
                        borderColor: "var(--color-border-subtle)",
                      }}
                      className="absolute inset-x-3 bottom-3.5 flex items-center justify-between rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur-md"
                    >
                      <HStack gap={2} vAlign="center">
                        <UserCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                        <VStack gap={0}>
                          <Text type="label" maxLines={1}>
                            {identifiedProfile.full_name}
                          </Text>
                          <Text type="supporting" maxLines={1}>
                            {identifiedProfile.job_title}
                            {identifiedSimilarity
                              ? ` · ${(identifiedSimilarity * 100).toFixed(0)}% coincidencia`
                              : ""}
                          </Text>
                        </VStack>
                      </HStack>
                      {stage === "PHASE2_EQUIPPING" && (
                        <Badge variant="warning" label={`${equipCountdown}s`} />
                      )}
                    </div>
                  )}

                  <canvas ref={canvasRef} className="hidden" />
                  <canvas ref={trackingCanvasRef} className="hidden" />
                </div>

                {/* Botones Principales Entrada / Salida */}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    width="100%"
                    icon={<LogIn className="h-4 w-4" />}
                    isDisabled={!cameraReady || submitting}
                    isLoading={submitting}
                    label={submitting ? "Verificando..." : "Registrar Entrada"}
                    onClick={() => handleMarkAttendance("ENTRY")}
                  />
                  <Button
                    variant="secondary"
                    size="lg"
                    width="100%"
                    icon={<LogOut className="h-4 w-4" />}
                    isDisabled={!cameraReady || submitting}
                    label="Registrar Salida"
                    onClick={() => handleMarkAttendance("EXIT")}
                  />
                </div>

                <Divider />

                {/* Acciones Secundarias */}
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Button
                    label="Reiniciar lectura"
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={() => resetBiometricCycle()}
                  />

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button
                      label="Probar con Foto"
                      variant="secondary"
                      size="sm"
                      icon={<Upload className="h-3.5 w-3.5" />}
                      isDisabled={submitting}
                      onClick={() => fileInputRef.current?.click()}
                    />
                  </div>
                </HStack>
              </VStack>
            </Card>

            {scanError && (
              <div className="mt-4">
                <Banner
                  status="error"
                  title="Marcaje no completado"
                  description={scanError}
                />
              </div>
            )}
          </div>

          {/* Columna Derecha: Resultado de Validación */}
          <div className="lg:col-span-5">
            <Card padding={5}>
              <VStack gap={4}>
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Heading level={3}>Resultado de Validación</Heading>
                  {lastResult && (
                    <Badge
                      variant="neutral"
                      label={`IA ${(lastResult.confidence * 100).toFixed(0)}%`}
                    />
                  )}
                </HStack>

                {!lastResult ? (
                  <Card variant="muted" padding={5}>
                    <VStack gap={2} hAlign="center">
                      <ShieldCheck className="h-6 w-6 opacity-70" />
                      <Text type="label">Terminal lista para escaneo</Text>
                      <Text type="supporting" justify="center">
                        1. Mira a la cámara sin mascarilla para identificarte.
                        <br />
                        2. Colócate el EPP requerido y pulsa Registrar Entrada.
                      </Text>
                    </VStack>
                  </Card>
                ) : (
                  <VStack gap={4}>
                    <Banner
                      status={lastResult.is_compliant ? "success" : "error"}
                      icon={
                        lastResult.is_compliant ? (
                          <ShieldCheck className="h-5 w-5" />
                        ) : (
                          <ShieldAlert className="h-5 w-5" />
                        )
                      }
                      title={
                        lastResult.is_compliant
                          ? `${lastResult.event_type === "EXIT" ? "Salida" : "Entrada"} Autorizada`
                          : "Acceso Rechazado"
                      }
                      description={`${lastResult.user_full_name} · ${lastResult.zone_name}${
                        !lastResult.is_compliant && lastResult.missing_items?.length
                          ? ` · Falta: ${lastResult.missing_items.join(", ")}`
                          : ""
                      }`}
                    />

                    {/* Cuadrícula 2x3 de Verificaciones */}
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        {
                          label:
                            lastResult.recognition_method === "face_biometric"
                              ? `Rostro (${Math.round((lastResult.face_similarity || 0.85) * 100)}%)`
                              : "Sesión Activa",
                          ok: lastResult.person_detected,
                          sub: "Identidad",
                        },
                        {
                          label: lastResult.is_live_person ? "Verificada" : "No en vivo",
                          ok: lastResult.is_live_person,
                          sub: "Prueba de vida",
                        },
                        {
                          label: lastResult.has_helmet ? "Detectado" : "Ausente",
                          ok: lastResult.has_helmet,
                          sub: "Casco",
                        },
                        {
                          label: lastResult.has_glasses ? "Detectados" : "Ausentes",
                          ok: lastResult.has_glasses,
                          sub: "Lentes",
                        },
                        {
                          label: lastResult.has_mask ? "Detectada" : "Ausente",
                          ok: lastResult.has_mask,
                          sub: "Mascarilla",
                        },
                        {
                          label: lastResult.has_vest ? "Detectado" : "Ausente",
                          ok: lastResult.has_vest,
                          sub: "Chaleco",
                        },
                      ].map((cell) => (
                        <Card key={cell.sub} variant="muted" padding={3}>
                          <HStack gap={2} hAlign="between" vAlign="center">
                            <VStack gap={0.5}>
                              <Text type="supporting">{cell.sub}</Text>
                              <Text type="label" maxLines={1}>
                                {cell.label}
                              </Text>
                            </VStack>
                            {cell.ok ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            ) : (
                              <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                            )}
                          </HStack>
                        </Card>
                      ))}
                    </div>
                  </VStack>
                )}
              </VStack>
            </Card>
          </div>
        </div>

        {/* Bitácora Reciente */}
        <div className="mt-6">
          <Card padding={5}>
            <VStack gap={4}>
              <HStack gap={2} hAlign="between" vAlign="center">
                <HStack gap={2} vAlign="center">
                  <History className="h-4 w-4" />
                  <Heading level={3}>Bitácora Reciente de Terminal</Heading>
                </HStack>
                <Text type="supporting">{history.length} registros</Text>
              </HStack>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr
                      style={{ borderColor: "var(--color-border-subtle)" }}
                      className="border-b uppercase"
                    >
                      <th className="py-2.5 pr-3">
                        <Text type="supporting">Fecha / Hora</Text>
                      </th>
                      <th className="py-2.5 px-3">
                        <Text type="supporting">Colaborador</Text>
                      </th>
                      <th className="py-2.5 px-3">
                        <Text type="supporting">Área</Text>
                      </th>
                      <th className="py-2.5 px-3">
                        <Text type="supporting">Tipo</Text>
                      </th>
                      <th className="py-2.5 px-3">
                        <Text type="supporting">Resultado</Text>
                      </th>
                      <th className="py-2.5 pl-3 text-right">
                        <Text type="supporting">EPP Detectado</Text>
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    style={{ borderColor: "var(--color-border-subtle)" }}
                    className="divide-y"
                  >
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center">
                          <Text type="supporting">Aún no hay marcajes registrados.</Text>
                        </td>
                      </tr>
                    ) : (
                      history.map((item) => {
                        const detectedTags = [
                          item.has_helmet ? "Casco" : null,
                          item.has_glasses ? "Lentes" : null,
                          item.has_mask ? "Mascarilla" : null,
                          item.has_vest ? "Chaleco" : null,
                        ].filter(Boolean);

                        return (
                          <tr key={item.id}>
                            <td className="whitespace-nowrap py-3 pr-3">
                              <Text type="supporting" hasTabularNumbers>
                                {new Date(item.created_at).toLocaleString([], {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </Text>
                            </td>
                            <td className="py-3 px-3">
                              <Text type="label">{item.user_full_name}</Text>
                            </td>
                            <td className="py-3 px-3">
                              <Text type="supporting">{item.zone_name}</Text>
                            </td>
                            <td className="py-3 px-3">
                              <Badge
                                variant={item.event_type === "EXIT" ? "orange" : "blue"}
                                label={item.event_type === "EXIT" ? "Salida" : "Entrada"}
                              />
                            </td>
                            <td className="py-3 px-3">
                              <Badge
                                variant={item.is_compliant ? "success" : "error"}
                                label={item.is_compliant ? "Aprobado" : "Rechazado"}
                              />
                            </td>
                            <td className="py-3 pl-3 text-right">
                              <Text type="supporting">
                                {detectedTags.length > 0 ? detectedTags.join(" · ") : "Ninguno"}
                              </Text>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </VStack>
          </Card>
        </div>
      </div>

      {/* Modal Enrolamiento Biométrico */}
      <Dialog
        isOpen={enrollOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !enrolling) closeEnrollModal();
        }}
        width={480}
        purpose="form"
      >
        <form onSubmit={handleEnrollFaceSubmit}>
          <VStack gap={4}>
            <DialogHeader
              title="Registrar Perfil Biométrico"
              subtitle="Captura el rostro descubierto para reconocimiento facial automático"
              onOpenChange={(isOpen) => {
                if (!isOpen && !enrolling) closeEnrollModal();
              }}
            />

            <SegmentedControl
              label="Método de captura biométrica"
              value={enrollMode}
              layout="fill"
              onChange={(val) => setEnrollMode(val as "camera" | "photo")}
            >
              <SegmentedControlItem
                value="camera"
                label="Cámara en vivo"
                icon={<Camera className="h-3.5 w-3.5" />}
              />
              <SegmentedControlItem
                value="photo"
                label="Desde fotografía"
                icon={<ImageIcon className="h-3.5 w-3.5" />}
              />
            </SegmentedControl>

            {enrollMode === "camera" ? (
              <div
                style={{ borderColor: "var(--color-border-subtle)" }}
                className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-black"
              >
                <video
                  ref={enrollVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-36 w-28 rounded-full border-2 border-dashed border-emerald-400/80" />
                </div>
              </div>
            ) : (
              <div>
                <input
                  ref={enrollPhotoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setEnrollPhotoFile(f);
                    if (enrollPhotoPreview) URL.revokeObjectURL(enrollPhotoPreview);
                    setEnrollPhotoPreview(f ? URL.createObjectURL(f) : null);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => enrollPhotoInputRef.current?.click()}
                  style={{
                    backgroundColor: "var(--color-background-muted)",
                    borderColor: "var(--color-border-subtle)",
                  }}
                  className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center transition hover:opacity-90"
                >
                  {enrollPhotoPreview ? (
                    <img
                      src={enrollPhotoPreview}
                      alt="Vista previa rostro"
                      className="h-32 w-32 rounded-2xl object-cover"
                    />
                  ) : (
                    <VStack gap={1.5} hAlign="center">
                      <Upload className="h-6 w-6" />
                      <Text type="label">Seleccionar foto frontal del colaborador</Text>
                      <Text type="supporting">
                        JPG, PNG o WEBP · Sin mascarilla ni lentes oscuros
                      </Text>
                    </VStack>
                  )}
                </button>
              </div>
            )}

            {user.role === "admin" && allUsers.length > 0 && (
              <Selector
                label="Colaborador a registrar"
                hasSearch
                width="100%"
                options={userOptions}
                value={String(enrollTargetUserId)}
                onChange={(val) => setEnrollTargetUserId(Number(val))}
              />
            )}

            <TextInput
              label="Código o carné de empleado"
              isOptional
              placeholder="Ej. 2500587"
              value={enrollCode}
              onChange={setEnrollCode}
              width="100%"
            />

            <HStack gap={2} hAlign="end">
              <Button
                label="Cancelar"
                variant="secondary"
                isDisabled={enrolling}
                onClick={closeEnrollModal}
              />
              <Button
                type="submit"
                variant="primary"
                isLoading={enrolling}
                label={enrolling ? "Procesando rostro..." : "Guardar Perfil"}
              />
            </HStack>
          </VStack>
        </form>
      </Dialog>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
