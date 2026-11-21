import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Glasses,
  HardHat,
  Image as ImageIcon,
  LayoutDashboard,
  Lock,
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
  Box,
  distanceToSimilarity,
  ENROLL_MAX_SAMPLE_SPREAD,
  ensureFaceModelsLoaded,
  extractDescriptorFromImageFile,
  FACE_MATCH_THRESHOLD,
  INSTANT_MATCH_THRESHOLD,
  matchFaceDescriptor,
  maxPairwiseDistance,
  profileDistance,
  sampleTorsoHeadSignature,
} from "../lib/faceBiometrics";
import { Toast, ToastData } from "../components/ui/Toast";
import { ThemeSwitcher } from "../components/ui/ThemeSwitcher";

interface Props {
  user: User | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onUserUpdated?: (user: User) => void;
  onSwitchToAdmin?: () => void;
}

type KioskStage =
  | "LOADING_MODELS"
  | "SEARCHING_FACE"
  | "READY_1STEP"
  | "PHASE2_EQUIPPING"
  | "SUBMITTING";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REQUIRED_MATCH_FRAMES = 2;
const UNKNOWN_FRAMES_BEFORE_REJECT = 4;
const ENROLL_TARGET_SAMPLES = 4;
const ENROLL_MIN_SAMPLES = 3;

export function CameraScanner({
  user,
  onOpenAuth,
  onLogout,
  onUserUpdated,
  onSwitchToAdmin,
}: Props) {
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
  const [equipCountdown, setEquipCountdown] = useState<number>(15);

  const [submitting, setSubmitting] = useState(false);
  const [scanError, setScanError] = useState("");
  const [lastResult, setLastResult] = useState<MarcajeRecord | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollMode, setEnrollMode] = useState<"camera" | "photo">("camera");
  const [enrollTargetUserId, setEnrollTargetUserId] = useState<number>(user?.id ?? 0);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollPhotoFile, setEnrollPhotoFile] = useState<File | null>(null);
  const [enrollPhotoPreview, setEnrollPhotoPreview] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [justEnrolledSelf, setJustEnrolledSelf] = useState(false);

  const stageRef = useRef<KioskStage>("LOADING_MODELS");
  const lowOccupancyFramesRef = useRef<number>(0);
  const phase2DeadlineRef = useRef<number>(0);
  const matchStreakRef = useRef<{ id: number | null; distances: number[] }>({ id: null, distances: [] });
  const unknownFramesRef = useRef<number>(0);

  const identifiedProfileRef = useRef<BiometricProfile | null>(null);
  identifiedProfileRef.current = identifiedProfile;
  stageRef.current = stage;

  const isAdmin = user?.role === "admin";
  const needsInitialEnrollment = Boolean(user && !user.has_face_enrolled);
  const activeZone = zones.find((z) => z.id === selectedZoneId) || zones[0] || null;
  const requiresTwoPhase = Boolean(activeZone && (activeZone.require_mask || activeZone.require_glasses));

  const loadData = async () => {
    try {
      const [zonesRes, kioskCfg, dirRes] = await Promise.all([
        api.getZones(),
        api.getKioskConfig().catch(() => ({ active_zone_id: null, active_zone: null })),
        api.getBiometricDirectory(),
      ]);
      setZones(zonesRes);
      if (selectedZoneId === null) {
        setSelectedZoneId(kioskCfg.active_zone_id ?? zonesRes[0]?.id ?? null);
      }
      setBiometricDir(dirRes);

      if (user?.role === "admin") {
        const usersList = await api.getAdminUsers().catch(() => []);
        setAllUsers(usersList);
      }
    } catch {
      // Silencioso en carga inicial
    }
  };

  const resetBiometricCycle = (reason?: string, isAlert = false) => {
    lowOccupancyFramesRef.current = 0;
    matchStreakRef.current = { id: null, distances: [] };
    unknownFramesRef.current = 0;
    setIdentifiedProfile(null);
    setIdentifiedSimilarity(null);

    if (reason) {
      setPillTone(isAlert ? "red" : "neutral");
      setStatusPill(reason);
    } else {
      setPillTone("neutral");
      setStatusPill("Ubica tu rostro descubierto dentro del marco");
    }
    setStage(modelsReady ? "SEARCHING_FACE" : "LOADING_MODELS");
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (user) {
      setEnrollTargetUserId(user.id);
      if (!user.has_face_enrolled) {
        setEnrollMode("camera");
        setEnrollOpen(true);
      }
    } else {
      setJustEnrolledSelf(false);
    }
  }, [user?.id, user?.has_face_enrolled]);

  useEffect(() => {
    loadData();
    let stream: MediaStream | null = null;

    ensureFaceModelsLoaded()
      .then(() => {
        setModelsReady(true);
        setStage("SEARCHING_FACE");
        setStatusPill("Ubica tu rostro descubierto dentro del marco");
        setPillTone("neutral");
      })
      .catch(() => {
        setStatusPill("Modo cámara estándar activo");
      });

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
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
  }, [user?.id]);

  useEffect(() => {
    if (enrollOpen && enrollMode === "camera" && enrollVideoRef.current && mediaStreamRef.current) {
      enrollVideoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [enrollOpen, enrollMode]);

  useEffect(() => {
    if (!cameraReady || !modelsReady || enrollOpen) return;

    let cancelled = false;
    let timerId: number | null = null;

    const scheduleNext = (delayMs: number) => {
      if (!cancelled) {
        timerId = window.setTimeout(runLoop, delayMs);
      }
    };

    const runLoop = async () => {
      if (cancelled || !videoRef.current) return;
      if (document.hidden) {
        scheduleNext(1000);
        return;
      }

      const currentStage = stageRef.current;
      if (currentStage === "SUBMITTING" || currentStage === "LOADING_MODELS") {
        scheduleNext(600);
        return;
      }

      try {
        if (currentStage === "PHASE2_EQUIPPING") {
          const remaining = Math.max(0, Math.ceil((phase2DeadlineRef.current - Date.now()) / 1000));
          setEquipCountdown(remaining);

          if (remaining <= 0) {
            resetBiometricCycle("Tiempo agotado · Vuelve a identificarte", true);
            scheduleNext(650);
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
            scheduleNext(700);
            return;
          }

          if (trackingCanvasRef.current) {
            const sig = sampleTorsoHeadSignature(videoRef.current, trackingCanvasRef.current);
            if (sig.occupancy < 0.05) {
              lowOccupancyFramesRef.current += 1;
              if (lowOccupancyFramesRef.current >= 5) {
                resetBiometricCycle("Saliste del cuadro · Reiniciando...", true);
                scheduleNext(650);
                return;
              }
            } else {
              lowOccupancyFramesRef.current = 0;
            }
          }

          setPillTone("amber");
          setStatusPill(`Colócate tu EPP (${remaining}s) y pulsa Entrada`);
          scheduleNext(750);
          return;
        }

        if (currentStage === "READY_1STEP") {
          const currentIdentified = identifiedProfileRef.current;
          const liveCheck = await analyzeVideoFaces(videoRef.current, true, true);
          if (liveCheck.faceCount > 1) {
            resetBiometricCycle("Alerta: Múltiples personas en cuadro", true);
          } else if (liveCheck.faceCount === 0 || !liveCheck.primaryFace) {
            lowOccupancyFramesRef.current += 1;
            if (lowOccupancyFramesRef.current >= 2) {
              resetBiometricCycle("Rostro fuera de cuadro · Ubica tu rostro");
            }
          } else if (
            currentIdentified &&
            liveCheck.primaryFace.descriptor.length === 128 &&
            profileDistance(liveCheck.primaryFace.descriptor, currentIdentified) >
              FACE_MATCH_THRESHOLD + 0.03
          ) {
            resetBiometricCycle("Cambio de persona detectado · Re-identificando...", true);
          } else {
            lowOccupancyFramesRef.current = 0;
          }
          scheduleNext(550);
          return;
        }

        if (biometricDir.length === 0) {
          setPillTone("amber");
          setStatusPill("Sin perfiles faciales · Registra un rostro en Admin / Registro");
          scheduleNext(1200);
          return;
        }

        const res = await analyzeVideoFaces(videoRef.current, true, true);
        if (cancelled) return;

        if (res.faceCount === 0 || !res.primaryFace) {
          matchStreakRef.current = { id: null, distances: [] };
          unknownFramesRef.current = 0;
          setPillTone("neutral");
          setStatusPill("Ubica tu rostro descubierto dentro del marco");
          setStage("SEARCHING_FACE");
          scheduleNext(550);
          return;
        }

        if (res.faceCount > 1) {
          matchStreakRef.current = { id: null, distances: [] };
          setPillTone("red");
          setStatusPill("Solo una persona frente al quiosco");
          scheduleNext(650);
          return;
        }

        const { descriptor, quality } = res.primaryFace;
        if (!quality.ok) {
          matchStreakRef.current = { id: null, distances: [] };
          setPillTone("amber");
          setStatusPill(quality.reason || "Mira de frente a la cámara");
          scheduleNext(550);
          return;
        }

        if (descriptor.length !== 128) {
          scheduleNext(500);
          return;
        }

        const match = matchFaceDescriptor(descriptor, biometricDir);
        if (!match) {
          matchStreakRef.current = { id: null, distances: [] };
          unknownFramesRef.current += 1;
          if (unknownFramesRef.current >= UNKNOWN_FRAMES_BEFORE_REJECT) {
            setPillTone("red");
            setStatusPill("Rostro no reconocido · Regístrate en Admin / Registro");
            unknownFramesRef.current = 0;
          } else {
            setPillTone("amber");
            setStatusPill("Analizando rostro...");
          }
          scheduleNext(550);
          return;
        }

        unknownFramesRef.current = 0;
        const streak = matchStreakRef.current;
        if (streak.id === match.profile.id) {
          streak.distances.push(match.distance);
        } else {
          matchStreakRef.current = { id: match.profile.id, distances: [match.distance] };
        }

        const isInstant = match.distance <= INSTANT_MATCH_THRESHOLD;
        const confirmedFrames = matchStreakRef.current.distances.length;
        if (!isInstant && confirmedFrames < REQUIRED_MATCH_FRAMES) {
          setPillTone("amber");
          setStatusPill("Confirmando identidad...");
          scheduleNext(450);
          return;
        }

        const distances = matchStreakRef.current.distances;
        const avgDistance = distances.reduce((acc, d) => acc + d, 0) / distances.length;

        setIdentifiedProfile(match.profile);
        setIdentifiedSimilarity(distanceToSimilarity(avgDistance));
        lowOccupancyFramesRef.current = 0;

        if (requiresTwoPhase) {
          phase2DeadlineRef.current = Date.now() + 15000;
          setEquipCountdown(15);
          setStage("PHASE2_EQUIPPING");
          setPillTone("amber");
          setStatusPill(`Hola, ${match.profile.full_name.split(" ")[0]} · Colócate tu EPP`);
        } else {
          setStage("READY_1STEP");
          setPillTone("green");
          setStatusPill(`Identificado: ${match.profile.full_name}`);
        }
        scheduleNext(750);
      } catch {
        scheduleNext(700);
      }
    };

    scheduleNext(350);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
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
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
    );
  };

  const handleMarkAttendance = async (eventType: "ENTRY" | "EXIT") => {
    if (!cameraReady) return;

    if (!identifiedProfile && !user && modelsReady) {
      setToast({
        type: "error",
        title: "Identificación requerida",
        message: "Mira a la cámara sin mascarilla para que el sistema reconozca tu rostro.",
      });
      return;
    }

    setSubmitting(true);
    setStage("SUBMITTING");
    setScanError("");
    setPillTone("neutral");
    setStatusPill("Analizando EPP y registrando...");

    try {
      let faceBox: Box | undefined;
      let bridgeBox: Box | undefined;
      if (modelsReady && videoRef.current) {
        const needDescriptorCheck = Boolean(identifiedProfile && !requiresTwoPhase);
        const faceNow = await analyzeVideoFaces(videoRef.current, true, needDescriptorCheck);

        if (faceNow.faceCount === 0 || !faceNow.primaryFace) {
          throw new Error("No se detectó ningún rostro frente a la cámara. Ubícate en el marco e inténtalo de nuevo.");
        }
        if (faceNow.faceCount > 1) {
          throw new Error("Se detectó más de una persona en cámara. Solo una persona puede marcar a la vez.");
        }
        if (
          needDescriptorCheck &&
          identifiedProfile &&
          faceNow.primaryFace.descriptor.length === 128 &&
          profileDistance(faceNow.primaryFace.descriptor, identifiedProfile) >
            FACE_MATCH_THRESHOLD + 0.03
        ) {
          throw new Error("El rostro en cámara no coincide con el perfil identificado. Vuelve a mirar de frente.");
        }

        faceBox = faceNow.primaryFace.box;
        bridgeBox = faceNow.primaryFace.bridgeBox;
      }

      const blobs: Blob[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = await grabSingleFrame();
        if (frame) blobs.push(frame);
        if (i < 2) await sleep(180);
      }

      const result = await api.scanFrames(blobs, "live", {
        zoneId: activeZone?.id,
        eventType,
        recognizedUserId: identifiedProfile?.id,
        faceSimilarity: identifiedSimilarity ?? undefined,
        clientLivenessVerified: Boolean(identifiedProfile),
        faceBox,
        bridgeBox,
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
    if (!user) return;
    setEnrolling(true);

    try {
      let descriptorToSave: number[] = [];
      let samplesToSave: number[][] = [];

      if (enrollMode === "photo") {
        if (!enrollPhotoFile) {
          throw new Error("Selecciona una fotografía frontal primero.");
        }
        descriptorToSave = await extractDescriptorFromImageFile(enrollPhotoFile);
        samplesToSave = [descriptorToSave];
      } else {
        const sourceVideo = enrollVideoRef.current || videoRef.current;
        if (!sourceVideo || !cameraReady) {
          throw new Error("La cámara no está disponible. Usa la pestaña 'Desde fotografía'.");
        }
        const collected: number[][] = [];
        let lastQualityIssue = "";
        for (let i = 0; i < 12 && collected.length < ENROLL_TARGET_SAMPLES; i++) {
          const res = await analyzeVideoFaces(sourceVideo, true, true);
          if (res.faceCount > 1) {
            throw new Error("Hay más de una persona en cámara. Enrola a una sola persona a la vez.");
          }
          if (res.faceCount === 1 && res.primaryFace) {
            if (res.primaryFace.quality.ok) {
              collected.push(res.primaryFace.descriptor);
            } else {
              lastQualityIssue = res.primaryFace.quality.reason || "";
            }
          }
          await sleep(220);
        }

        if (collected.length < ENROLL_MIN_SAMPLES) {
          throw new Error(
            lastQualityIssue
              ? `No se pudo capturar un rostro claro: ${lastQualityIssue.toLowerCase()}.`
              : "Poca iluminación o rostro fuera de foco. Enciende una luz o usa la pestaña 'Desde fotografía'."
          );
        }
        if (maxPairwiseDistance(collected) > ENROLL_MAX_SAMPLE_SPREAD) {
          throw new Error(
            "Las capturas no fueron consistentes (te moviste o cambió la luz). Quédate quieto mirando a la cámara e inténtalo de nuevo."
          );
        }
        descriptorToSave = averageDescriptors(collected);
        samplesToSave = collected;
      }

      const targetId = user.role === "admin" ? enrollTargetUserId : user.id;
      const saved = await api.enrollFace({
        user_id: targetId,
        employee_code: enrollCode.trim() || undefined,
        face_descriptor: descriptorToSave,
        face_samples: samplesToSave,
      });

      if (targetId === user.id) {
        onUserUpdated?.({ ...user, has_face_enrolled: true });
        setJustEnrolledSelf(true);
      }

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
    <div
      style={{ backgroundColor: "var(--color-background-body)" }}
      className="flex min-h-screen flex-col"
    >
      <header
        style={{
          backgroundColor: "var(--color-background-surface)",
          borderColor: "var(--color-border-subtle)",
        }}
        className="border-b"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-2">
            <HStack gap={3} vAlign="center">
              <div
                style={{
                  backgroundColor: "var(--color-background-muted)",
                  borderColor: "var(--color-border-subtle)",
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
              >
                <ScanFace className="h-5 w-5" />
              </div>
              <VStack gap={0}>
                <Heading level={3}>Terminal Biométrica EPP</Heading>
                <Text type="supporting">
                  {user
                    ? `Sesión: ${user.full_name}`
                    : `Quiosco Activo · ${biometricDir.length} ${
                        biometricDir.length === 1 ? "rostro" : "rostros"
                      }`}
                </Text>
              </VStack>
            </HStack>

            <div className="shrink-0">
              <Badge
                variant="neutral"
                icon={<Clock className="h-3 w-3" />}
                label={
                  <Text hasTabularNumbers type="code">
                    {clockText}
                  </Text>
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
            <ThemeSwitcher />

            {user ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  label="Enrolar Rostro"
                  variant="secondary"
                  size="sm"
                  icon={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setEnrollTargetUserId(user.id);
                    setEnrollMode("camera");
                    setEnrollOpen(true);
                  }}
                />
                {isAdmin && onSwitchToAdmin && (
                  <Button
                    label="Panel Admin"
                    variant="secondary"
                    size="sm"
                    icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                    onClick={onSwitchToAdmin}
                  />
                )}
                <Button
                  label="Modo Quiosco"
                  variant="ghost"
                  size="sm"
                  icon={<LogOut className="h-3.5 w-3.5" />}
                  onClick={onLogout}
                />
              </div>
            ) : (
              <Button
                label="Admin / Registro"
                variant="secondary"
                size="sm"
                icon={<Lock className="h-3.5 w-3.5" />}
                onClick={onOpenAuth}
              />
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-7">
        {needsInitialEnrollment && (
          <div className="mb-4">
            <Banner
              status="warning"
              title="Registro biométrico inicial requerido"
              description="Registra tu rostro una sola vez para poder marcar automáticamente sin iniciar sesión."
            />
          </div>
        )}

        {justEnrolledSelf && user && !isAdmin && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <Banner
                status="success"
                title="Rostro guardado correctamente"
                description="Ya puedes probar tu marcaje o volver al Modo Quiosco."
              />
            </div>
            <Button
              label="Finalizar y volver a Quiosco"
              variant="primary"
              size="sm"
              onClick={onLogout}
            />
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <Card padding={4}>
              <VStack gap={4}>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex-1">
                    {isAdmin ? (
                      <Selector
                        label="Área operativa (vista Admin)"
                        size="md"
                        width="100%"
                        startIcon={<MapPin className="h-4 w-4" />}
                        options={zoneOptions}
                        value={selectedZoneId !== null ? String(selectedZoneId) : undefined}
                        onChange={(val) => {
                          setSelectedZoneId(Number(val));
                          resetBiometricCycle();
                        }}
                      />
                    ) : (
                      <VStack gap={0.5}>
                        <Text type="supporting">Área configurada en esta terminal</Text>
                        <HStack gap={2} vAlign="center">
                          <MapPin className="h-4 w-4 shrink-0" />
                          <Heading level={3}>{activeZone?.name || "Planta General"}</Heading>
                        </HStack>
                      </VStack>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Badge
                      variant={requiresTwoPhase ? "yellow" : "green"}
                      label={requiresTwoPhase ? "2 Fases (Rostro → EPP)" : "1 Paso Simultáneo"}
                    />
                  </div>
                </div>

                <VStack gap={1.5}>
                  <Text type="supporting">EPP obligatorio en esta zona:</Text>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {requiredItems.length > 0 ? (
                      requiredItems.map(({ label, icon: Icon }) => (
                        <Badge
                          key={label}
                          variant="neutral"
                          icon={<Icon className="h-3.5 w-3.5" />}
                          label={label}
                        />
                      ))
                    ) : (
                      <Badge label="Solo presencia" variant="green" />
                    )}
                  </div>
                </VStack>

                <div
                  style={{
                    backgroundColor: "var(--color-background-muted)",
                    borderColor: "var(--color-border-subtle)",
                  }}
                  className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        pillTone === "green"
                          ? "bg-emerald-500"
                          : pillTone === "amber"
                          ? "animate-pulse bg-amber-500"
                          : pillTone === "red"
                          ? "bg-rose-500"
                          : "bg-neutral-400"
                      }`}
                    />
                    <Text maxLines={2} type="label">
                      {statusPill}
                    </Text>
                  </div>
                  {stage === "PHASE2_EQUIPPING" && (
                    <div className="shrink-0">
                      <Badge label={`${equipCountdown}s`} variant="warning" />
                    </div>
                  )}
                </div>

                <div
                  style={{ borderColor: "var(--color-border-subtle)" }}
                  className="relative aspect-square w-full overflow-hidden rounded-2xl border bg-black sm:aspect-[4/3]"
                >
                  {cameraError ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white">
                      <Camera className="mb-3 h-9 w-9 opacity-60" />
                      <p className="max-w-xs text-sm text-neutral-300">{cameraError}</p>
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

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                    <div
                      className={`relative h-48 w-40 rounded-[28px] transition-colors duration-200 sm:h-60 sm:w-48 ${frameBorderStyles}`}
                    >
                      <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-[26px] border-l-[3px] border-t-[3px] border-white/90" />
                      <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-[26px] border-r-[3px] border-t-[3px] border-white/90" />
                      <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-[26px] border-b-[3px] border-l-[3px] border-white/90" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-[26px] border-b-[3px] border-r-[3px] border-white/90" />
                    </div>
                  </div>

                  {identifiedProfile && (
                    <div
                      style={{
                        backgroundColor: "rgba(18, 18, 18, 0.9)",
                        borderColor: "rgba(255, 255, 255, 0.14)",
                      }}
                      className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-white shadow-lg"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <UserCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                        <div className="min-w-0">
                          <p style={{ color: "#ffffff" }} className="truncate text-sm font-semibold">
                            {identifiedProfile.full_name}
                          </p>
                          <p style={{ color: "#d4d4d8" }} className="truncate text-xs">
                            {identifiedProfile.job_title}
                            {identifiedSimilarity
                              ? ` · ${(identifiedSimilarity * 100).toFixed(0)}% coincidencia`
                              : ""}
                          </p>
                        </div>
                      </div>
                      {stage === "PHASE2_EQUIPPING" && (
                        <div className="shrink-0">
                          <Badge label={`${equipCountdown}s`} variant="warning" />
                        </div>
                      )}
                    </div>
                  )}

                  <canvas ref={canvasRef} className="hidden" />
                  <canvas ref={trackingCanvasRef} className="hidden" />
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    label="Reiniciar lectura"
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={() => resetBiometricCycle()}
                  />

                  <div className="shrink-0">
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
                </div>
              </VStack>
            </Card>

            {scanError && (
              <div className="mt-4">
                <Banner description={scanError} status="error" title="Marcaje no completado" />
              </div>
            )}
          </div>

          <div className="lg:col-span-5">
            <Card padding={4}>
              <VStack gap={4}>
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Heading level={3}>Resultado de Validación</Heading>
                  {lastResult && (
                    <Badge
                      label={`IA ${(lastResult.confidence * 100).toFixed(0)}%`}
                      variant="neutral"
                    />
                  )}
                </HStack>

                <Divider />

                {!lastResult ? (
                  <div className="flex flex-col items-center justify-center py-7 text-center">
                    <div
                      style={{
                        backgroundColor: "var(--color-background-muted)",
                        borderColor: "var(--color-border-subtle)",
                      }}
                      className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border"
                    >
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <VStack gap={1.5} hAlign="center">
                      <Text type="label">Terminal lista para escaneo</Text>
                      <div className="text-center">
                        <Text type="supporting">
                          1. Mira a la cámara sin mascarilla para identificarte.
                          <br />
                          2. Colócate el EPP requerido y pulsa Registrar Entrada.
                        </Text>
                      </div>
                    </VStack>
                  </div>
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

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                        <div
                          key={cell.sub}
                          style={{
                            backgroundColor: "var(--color-background-muted)",
                            borderColor: "var(--color-border-subtle)",
                          }}
                          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                        >
                          <VStack gap={0}>
                            <Text type="supporting">{cell.sub}</Text>
                            <Text maxLines={1} type="label">
                              {cell.label}
                            </Text>
                          </VStack>
                          {cell.ok ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
                          )}
                        </div>
                      ))}
                    </div>
                  </VStack>
                )}
              </VStack>
            </Card>
          </div>
        </div>
      </main>

      {user && (
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
                onOpenChange={(isOpen) => {
                  if (!isOpen && !enrolling) closeEnrollModal();
                }}
                subtitle={
                  needsInitialEnrollment
                    ? `Hola ${user.full_name}, captura tu rostro una sola vez para completar tu registro`
                    : "Captura el rostro descubierto para reconocimiento facial automático"
                }
                title="Registrar Perfil Biométrico"
              />

              <SegmentedControl
                label="Método de captura biométrica"
                layout="fill"
                value={enrollMode}
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-white/90">
                    Rostro descubierto, de frente y quieto ~2 s al guardar
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
                  hasSearch
                  label="Colaborador a registrar"
                  options={userOptions}
                  value={String(enrollTargetUserId)}
                  width="100%"
                  onChange={(val) => setEnrollTargetUserId(Number(val))}
                />
              )}

              <TextInput
                isOptional
                label="Código o carné de empleado"
                placeholder="Ej. 2500587"
                value={enrollCode}
                onChange={setEnrollCode}
                width="100%"
              />

              <HStack gap={2} hAlign="end">
                <Button
                  isDisabled={enrolling}
                  label="Cancelar"
                  onClick={closeEnrollModal}
                  variant="secondary"
                />
                <Button
                  isLoading={enrolling}
                  label={enrolling ? "Procesando rostro..." : "Guardar Perfil"}
                  type="submit"
                  variant="primary"
                />
              </HStack>
            </VStack>
          </form>
        </Dialog>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
