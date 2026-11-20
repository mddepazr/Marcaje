import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
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
  X,
  XCircle,
} from "lucide-react";
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

  // Conectar stream de cámara al visor dentro del modal cuando esté abierto
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
          throw new Error("La cámara no está disponible. Usa la pestaña 'Desde Fotografía'.");
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
            "Poca iluminación o rostro fuera de foco. Enciende una luz o usa la pestaña 'Desde Fotografía'."
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

  const pillStyles = {
    neutral: "border-white/15 bg-slate-950/80 text-slate-200",
    amber: "border-amber-400/50 bg-amber-950/90 text-amber-200",
    green: "border-emerald-400/50 bg-emerald-950/90 text-emerald-200",
    red: "border-rose-500/60 bg-rose-950/90 text-rose-200",
  }[pillTone];

  const frameBorderStyles =
    stage === "PHASE2_EQUIPPING"
      ? "border-2 border-dashed border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.25)]"
      : identifiedProfile
      ? "border-2 border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.28)]"
      : pillTone === "red"
      ? "border-2 border-rose-500/80 shadow-[0_0_25px_rgba(244,63,94,0.25)]"
      : "border border-white/25";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
        {/* Top Bar Compacta y Limpia */}
        <header className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-800/90 bg-slate-900/75 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/20">
              <ScanFace className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
                  Terminal Biométrica EPP
                </h1>
                <span className="hidden items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] font-medium text-indigo-300 sm:inline-flex">
                  <Clock className="h-3 w-3" />
                  {clockText}
                </span>
              </div>
              <p className="truncate text-[11px] text-slate-400">
                {user.full_name} ·{" "}
                <span className="text-emerald-400">
                  {biometricDir.length} {biometricDir.length === 1 ? "rostro activo" : "rostros activos"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setEnrollMode("camera");
                setEnrollOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/25"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Enrolar Rostro</span>
              <span className="sm:hidden">Rostro</span>
            </button>

            {user.role === "admin" && onSwitchToAdmin && (
              <button
                onClick={onSwitchToAdmin}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30 transition hover:bg-indigo-500/25"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Panel Admin</span>
                <span className="sm:hidden">Admin</span>
              </button>
            )}

            <button
              onClick={onLogout}
              title="Cerrar sesión"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-800/80 px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Grid Principal */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna Izquierda: Quiosco Interactivo */}
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-slate-800/90 bg-slate-900/90 shadow-2xl">
              {/* Cabecera del Quiosco: Selector de Área + EPP Exigido */}
              <div className="border-b border-slate-800/80 bg-slate-900 px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-indigo-400" />
                    <select
                      value={selectedZoneId ?? ""}
                      onChange={(e) => {
                        setSelectedZoneId(Number(e.target.value));
                        resetBiometricCycle();
                      }}
                      className="rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                    >
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      requiresTwoPhase
                        ? "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/25"
                        : "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/25"
                    }`}
                  >
                    {requiresTwoPhase ? "Modo 2 Fases (Rostro → EPP)" : "Validación Simultánea"}
                  </span>
                </div>

                {/* Pills de EPP requerido */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-400">Exige:</span>
                  {requiredItems.length > 0 ? (
                    requiredItems.map(({ label, icon: Icon }) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-inset ring-white/5"
                      >
                        <Icon className="h-3 w-3 text-indigo-400" />
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-emerald-400">Solo presencia</span>
                  )}
                </div>
              </div>

              {/* Visor de Cámara */}
              <div className="p-4 sm:p-5">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-white/10">
                  {cameraError ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
                      <Camera className="mb-2 h-8 w-8 text-slate-600" />
                      <p>{cameraError}</p>
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
                      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md ${pillStyles}`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          pillTone === "green"
                            ? "bg-emerald-400"
                            : pillTone === "amber"
                            ? "animate-pulse bg-amber-400"
                            : pillTone === "red"
                            ? "bg-rose-400"
                            : "bg-indigo-400"
                        }`}
                      />
                      <span className="truncate">{statusPill}</span>
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
                    <div className="absolute inset-x-3 bottom-3.5 flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-slate-950/90 px-4 py-2.5 shadow-xl backdrop-blur-md">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                          <UserCheck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-white">
                            {identifiedProfile.full_name}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {identifiedProfile.job_title}
                            {identifiedSimilarity
                              ? ` · ${(identifiedSimilarity * 100).toFixed(0)}% coincidencia`
                              : ""}
                          </p>
                        </div>
                      </div>
                      {stage === "PHASE2_EQUIPPING" && (
                        <span className="ml-2 shrink-0 rounded-xl bg-amber-500/20 px-2.5 py-1 font-mono text-xs font-bold text-amber-300 ring-1 ring-inset ring-amber-500/30">
                          {equipCountdown}s
                        </span>
                      )}
                    </div>
                  )}

                  <canvas ref={canvasRef} className="hidden" />
                  <canvas ref={trackingCanvasRef} className="hidden" />
                </div>

                {/* Botones Principales Entrada / Salida */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!cameraReady || submitting}
                    onClick={() => handleMarkAttendance("ENTRY")}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-500 hover:to-blue-500 active:scale-[0.99] disabled:opacity-50"
                  >
                    <LogIn className="h-4 w-4" />
                    {submitting ? "Verificando..." : "Entrada"}
                  </button>

                  <button
                    type="button"
                    disabled={!cameraReady || submitting}
                    onClick={() => handleMarkAttendance("EXIT")}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-slate-700/90 bg-slate-800/90 py-3.5 text-sm font-bold text-slate-100 transition hover:border-amber-500/50 hover:bg-slate-800 active:scale-[0.99] disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4 text-amber-400" />
                    Salida
                  </button>
                </div>

                {/* Acciones Secundarias */}
                <div className="mt-3 flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => resetBiometricCycle()}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reiniciar lectura
                  </button>

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500/50 hover:text-white disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5 text-indigo-400" />
                      Probar con Foto
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {scanError && (
              <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{scanError}</span>
              </div>
            )}
          </div>

          {/* Columna Derecha: Resultado Compacto en Cuadrícula 2x3 */}
          <div className="lg:col-span-5">
            <div className="rounded-3xl border border-slate-800/90 bg-slate-900/90 p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Resultado de Validación
                </h2>
                {lastResult && (
                  <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-slate-300">
                    IA {(lastResult.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              {!lastResult ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800/80 text-slate-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-semibold text-slate-300">
                    Terminal lista para escaneo
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                    1. Mira a la cámara sin mascarilla para identificarte.
                    <br />
                    2. Colócate el EPP requerido sin salir del marco y presiona{" "}
                    <span className="font-semibold text-slate-300">Entrada</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Banner Principal de Estado */}
                  <div
                    className={`rounded-2xl border p-4 ${
                      lastResult.is_compliant
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-rose-500/30 bg-rose-500/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {lastResult.is_compliant ? (
                        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                      ) : (
                        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-rose-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-sm font-bold ${
                              lastResult.is_compliant ? "text-emerald-300" : "text-rose-300"
                            }`}
                          >
                            {lastResult.is_compliant
                              ? `${lastResult.event_type === "EXIT" ? "Salida" : "Entrada"} Autorizada`
                              : "Acceso Rechazado"}
                          </p>
                          <span className="rounded-md bg-slate-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                            {lastResult.event_type === "EXIT" ? "Salida" : "Entrada"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-semibold text-white">
                          {lastResult.user_full_name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {lastResult.zone_name} ·{" "}
                          {new Date(lastResult.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        {!lastResult.is_compliant &&
                          lastResult.missing_items &&
                          lastResult.missing_items.length > 0 && (
                            <div className="mt-2 rounded-lg bg-rose-950/70 px-2.5 py-1.5 text-[11px] font-medium text-rose-200">
                              Falta: {lastResult.missing_items.join(", ")}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>

                  {/* Cuadrícula Compacta 2x3 de Verificaciones */}
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
                      <div
                        key={cell.sub}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                          cell.ok
                            ? "border-emerald-500/25 bg-emerald-500/5"
                            : "border-slate-800 bg-slate-950/60"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {cell.sub}
                          </p>
                          <p
                            className={`truncate text-xs font-semibold ${
                              cell.ok ? "text-emerald-300" : "text-slate-400"
                            }`}
                          >
                            {cell.label}
                          </p>
                        </div>
                        {cell.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-rose-400/80" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bitácora Reciente */}
        <div className="mt-6 rounded-3xl border border-slate-800/90 bg-slate-900/90 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white">Bitácora Reciente de Terminal</h2>
            </div>
            <span className="text-xs text-slate-500">{history.length} registros</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 pr-3">Fecha / Hora</th>
                  <th className="py-2.5 px-3">Colaborador</th>
                  <th className="py-2.5 px-3">Área</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Resultado</th>
                  <th className="py-2.5 pl-3 text-right">EPP Detectado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      Aún no hay marcajes registrados.
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
                      <tr key={item.id} className="hover:bg-slate-800/35">
                        <td className="whitespace-nowrap py-3 pr-3 text-slate-300">
                          {new Date(item.created_at).toLocaleString([], {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-3 font-semibold text-white">
                          {item.user_full_name}
                        </td>
                        <td className="py-3 px-3 text-indigo-300">{item.zone_name}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              item.event_type === "EXIT"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-sky-500/15 text-sky-300"
                            }`}
                          >
                            {item.event_type === "EXIT" ? "Salida" : "Entrada"}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              item.is_compliant
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-rose-500/15 text-rose-300"
                            }`}
                          >
                            {item.is_compliant ? "Aprobado" : "Rechazado"}
                          </span>
                        </td>
                        <td className="py-3 pl-3 text-right text-slate-400">
                          {detectedTags.length > 0 ? detectedTags.join(" · ") : "Ninguno"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Enrolamiento Biométrico con Cámara Integrada + Subida de Foto */}
      {enrollOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleEnrollFaceSubmit}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <ScanFace className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Registrar Perfil Biométrico</h3>
              </div>
              <button
                type="button"
                onClick={closeEnrollModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-xs">
              {/* Selector de método: Cámara en vivo o Foto de galería */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setEnrollMode("camera")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                    enrollMode === "camera"
                      ? "bg-slate-800 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Cámara en vivo
                </button>
                <button
                  type="button"
                  onClick={() => setEnrollMode("photo")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                    enrollMode === "photo"
                      ? "bg-slate-800 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Desde fotografía
                </button>
              </div>

              {enrollMode === "camera" ? (
                <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-white/10">
                  <video
                    ref={enrollVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full -scale-x-100 object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-36 w-28 rounded-full border-2 border-dashed border-emerald-400/75" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
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
                    className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-4 text-center transition hover:border-emerald-500/50"
                  >
                    {enrollPhotoPreview ? (
                      <img
                        src={enrollPhotoPreview}
                        alt="Vista previa rostro"
                        className="h-32 w-32 rounded-2xl object-cover ring-2 ring-emerald-500/40"
                      />
                    ) : (
                      <>
                        <Upload className="mb-1.5 h-6 w-6 text-emerald-400" />
                        <span className="font-semibold text-slate-200">
                          Seleccionar foto frontal del colaborador
                        </span>
                        <span className="mt-0.5 text-[11px] text-slate-500">
                          JPG, PNG o WEBP · Sin mascarilla ni lentes oscuros
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {user.role === "admin" && allUsers.length > 0 && (
                <div>
                  <label className="mb-1 block font-medium text-slate-300">
                    Colaborador a registrar
                  </label>
                  <select
                    value={enrollTargetUserId}
                    onChange={(e) => setEnrollTargetUserId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block font-medium text-slate-300">
                  Código / Carné de empleado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej. 2500587"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/60 px-5 py-3.5">
              <button
                type="button"
                onClick={closeEnrollModal}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enrolling}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-50"
              >
                {enrolling ? "Procesando rostro..." : "Guardar Perfil"}
              </button>
            </div>
          </form>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
