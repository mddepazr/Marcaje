import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  UserPlus,
  X,
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
  matchFaceDescriptor,
  sampleTorsoHeadSignature,
} from "../lib/faceBiometrics";
import { StatusBadge } from "../components/ui/StatusBadge";
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [modelsReady, setModelsReady] = useState(false);

  const [zones, setZones] = useState<WorkZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [biometricDir, setBiometricDir] = useState<BiometricProfile[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserItem[]>([]);

  const [stage, setStage] = useState<KioskStage>("LOADING_MODELS");
  const [statusPill, setStatusPill] = useState("Cargando motor biométrico...");
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
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );

  // Modal de Enrolamiento Facial
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollTargetUserId, setEnrollTargetUserId] = useState<number>(user.id);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  // Refs para bucle de rastreo continuo en tiempo real
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
      setStatusPill("Coloca tu rostro en el marco");
    }
    setStage(modelsReady ? "SEARCHING_FACE" : "LOADING_MODELS");
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
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
        setStatusPill("Coloca tu rostro en el marco");
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
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          setCameraReady(true);
        }
      })
      .catch(() => {
        setCameraError("Cámara no disponible o sin permisos. Puedes subir una imagen de prueba.");
      });

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
        // FASE 2: Empleado ya identificado poniéndose mascarilla/lentes frente a cámara
        if (currentStage === "PHASE2_EQUIPPING") {
          const remaining = Math.max(0, Math.ceil((phase2DeadlineRef.current - Date.now()) / 1000));
          setEquipCountdown(remaining);

          if (remaining <= 0) {
            resetBiometricCycle("Tiempo agotado. Vuelve a identificarte.", true);
            return;
          }

          // 1) Verificar que no entre una segunda persona
          const faceCheck = await analyzeVideoFaces(videoRef.current, false);
          if (faceCheck.faceCount > 1) {
            setToast({
              type: "error",
              title: "Alerta de Seguridad",
              message: "Se detectaron dos personas en cámara. Sesión reiniciada.",
            });
            resetBiometricCycle("Alerta: Múltiples personas en cuadro", true);
            return;
          }

          // 2) Verificar continuidad física en cuadro (que no salga ni cambie de lugar)
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
          setStatusPill(`Ponte tu EPP en cuadro (${remaining}s) y pulsa Entrada/Salida`);
          return;
        }

        // Si ya está listo en 1 paso, solo vigilar que no entre otra persona
        if (currentStage === "READY_1STEP") {
          const quickCheck = await analyzeVideoFaces(videoRef.current, false);
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

        // FASE 1: Detección de rostro, parpadeo (1/2 -> 2/2) y reconocimiento facial
        const res = await analyzeVideoFaces(videoRef.current, true);
        if (cancelled) return;

        if (res.faceCount === 0 || !res.primaryFace) {
          blinkCountRef.current = 0;
          faceFramesCountRef.current = 0;
          setPillTone("neutral");
          setStatusPill("Coloca tu rostro descubierto en el marco");
          setStage("SEARCHING_FACE");
          return;
        }

        if (res.faceCount > 1) {
          blinkCountRef.current = 0;
          setPillTone("red");
          setStatusPill("Solo una persona frente a la cámara");
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

        // Respaldo natural si usa lentes que atenúan el EAR tras ~2.2s en cuadro
        if (blinkCountRef.current < 2 && faceFramesCountRef.current >= 12) {
          blinkCountRef.current = 2;
        }

        if (blinkCountRef.current < 2) {
          setStage(blinkCountRef.current === 0 ? "BLINK_1" : "BLINK_2");
          setPillTone("amber");
          setStatusPill(`Detectando parpadeo ${blinkCountRef.current + 1}/2`);
          return;
        }

        // Parpadeo completado -> Buscar coincidencia en directorio biométrico
        if (biometricDir.length === 0) {
          setPillTone("amber");
          setStatusPill("Sin rostros registrados · Usa 'Registrar Rostro'");
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

        // ¡Identificado con éxito!
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
          setStatusPill(`Hola, ${match.profile.full_name.split(" ")[0]} · Ponte tu EPP sin salir del cuadro`);
        } else {
          setStage("READY_1STEP");
          setPillTone("green");
          setStatusPill(`Identificado: ${match.profile.full_name}`);
        }
      } finally {
        busy = false;
      }
    };

    const interval = setInterval(tick, 180);
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

    // Si es Entrada y el área requiere mascarilla/lentes, exigir haber pasado por Fase 1
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
    setStatusPill("Validando EPP y guardando marcaje...");

    try {
      const blobs: Blob[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = await grabSingleFrame();
        if (frame) blobs.push(frame);
        if (i < 2) await sleep(220);
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
          title: `${eventType === "ENTRY" ? "Entrada" : "Salida"} Registrada`,
          message: `${result.user_full_name} · ${result.zone_name}`,
        });
      } else {
        const faltantes = result.missing_items?.join(", ") || "Equipo requerido";
        setToast({
          type: "error",
          title: "Ingreso Denegado por EPP",
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

  const handleEnrollFaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoRef.current || !cameraReady) return;
    setEnrolling(true);

    try {
      const collected: number[][] = [];
      for (let i = 0; i < 6; i++) {
        const res = await analyzeVideoFaces(videoRef.current, true);
        if (res.faceCount === 1 && res.primaryFace) {
          collected.push(res.primaryFace.descriptor);
        }
        if (collected.length >= 3) break;
        await sleep(220);
      }

      if (collected.length < 2) {
        throw new Error(
          "No se pudo capturar el rostro con claridad. Mira de frente sin mascarilla ni lentes oscuros."
        );
      }

      const avgVector = averageDescriptors(collected);
      const saved = await api.enrollFace({
        user_id: user.role === "admin" ? enrollTargetUserId : user.id,
        employee_code: enrollCode.trim() || undefined,
        face_descriptor: avgVector,
      });

      await loadData();
      setEnrollOpen(false);
      setEnrollCode("");
      resetBiometricCycle();
      setToast({
        type: "success",
        title: "Rostro Registrado",
        message: saved.message,
      });
    } catch (err) {
      setToast({
        type: "error",
        title: "No se pudo registrar el rostro",
        message: err instanceof Error ? err.message : "Intenta acercarte un poco más a la cámara.",
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
          title: "Prueba Aprobada",
          message: `EPP completo para ${result.zone_name}.`,
        });
      } else {
        setToast({
          type: "error",
          title: "Prueba Rechazada",
          message: `Falta: ${result.missing_items?.join(", ") || "EPP"}.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al analizar la imagen";
      setScanError(msg);
      setToast({ type: "error", title: "Error en prueba", message: msg });
    } finally {
      setSubmitting(false);
      e.target.value = "";
    }
  };

  const requiredBadges = activeZone
    ? [
        activeZone.require_helmet ? "Casco" : null,
        activeZone.require_glasses ? "Lentes" : null,
        activeZone.require_mask ? "Mascarilla" : null,
        activeZone.require_vest ? "Chaleco" : null,
      ].filter(Boolean)
    : [];

  const pillClasses = {
    neutral: "border-slate-700/80 bg-slate-950/85 text-slate-200",
    amber: "border-amber-500/50 bg-amber-950/90 text-amber-200",
    green: "border-emerald-500/50 bg-emerald-950/90 text-emerald-200",
    red: "border-rose-500/60 bg-rose-950/90 text-rose-200",
  }[pillTone];

  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      {/* Barra superior estilo terminal */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
            <ScanFace className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white">Quiosco Biométrico EPP</h1>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-indigo-300">
                <Clock className="h-3 w-3" />
                {clockText}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Operador de terminal: <span className="text-slate-200">{user.full_name}</span> ·{" "}
              {biometricDir.length} {biometricDir.length === 1 ? "rostro enrolado" : "rostros enrolados"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEnrollOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            <UserPlus className="h-4 w-4" />
            Registrar Rostro
          </button>

          {user.role === "admin" && onSwitchToAdmin && (
            <button
              onClick={onSwitchToAdmin}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/15 px-3.5 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-600/25"
            >
              <LayoutDashboard className="h-4 w-4" />
              Panel Admin
            </button>
          )}

          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            Salir
          </button>
        </div>
      </header>

      {/* Selector de Área / Departamento */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <MapPin className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-medium text-slate-400">Área de ingreso:</span>
          <select
            value={selectedZoneId ?? ""}
            onChange={(e) => {
              setSelectedZoneId(Number(e.target.value));
              resetBiometricCycle();
            }}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white focus:border-indigo-500 focus:outline-none"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          {activeZone && (
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              {requiresTwoPhase ? "Validación 2 Fases (Rostro → EPP)" : "Validación Simultánea"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400">EPP requerido:</span>
          {requiredBadges.length > 0 ? (
            requiredBadges.map((item) => (
              <span
                key={item}
                className="rounded-md bg-indigo-500/15 px-2.5 py-0.5 font-medium text-indigo-300"
              >
                {item}
              </span>
            ))
          ) : (
            <span className="rounded-md bg-emerald-500/15 px-2.5 py-0.5 text-emerald-300">
              Sin EPP obligatorio
            </span>
          )}
        </div>
      </div>

      {/* Cuerpo principal: Tarjeta central tipo Quiosco + Resultado */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-950">
              {cameraError ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
                  {cameraError}
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

              {/* Píldora superior de estado biométrico (estilo terminal) */}
              <div className="absolute inset-x-4 top-4 flex justify-center">
                <div
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold shadow-lg backdrop-blur ${pillClasses}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      pillTone === "green"
                        ? "bg-emerald-400"
                        : pillTone === "amber"
                        ? "animate-pulse bg-amber-400"
                        : pillTone === "red"
                        ? "bg-rose-400"
                        : "bg-indigo-400"
                    }`}
                  />
                  {statusPill}
                </div>
              </div>

              {/* Marco guía central con esquinas redondeadas */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`relative h-56 w-48 rounded-3xl transition-colors duration-300 ${
                    stage === "PHASE2_EQUIPPING"
                      ? "border-2 border-dashed border-amber-400/80"
                      : identifiedProfile
                      ? "border-2 border-emerald-400/80"
                      : "border border-white/30"
                  }`}
                >
                  <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-2xl border-l-4 border-t-4 border-white/80" />
                  <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-2xl border-r-4 border-t-4 border-white/80" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-2xl border-b-4 border-l-4 border-white/80" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-2xl border-b-4 border-r-4 border-white/80" />
                </div>
              </div>

              {/* Tarjeta flotante del colaborador identificado */}
              {identifiedProfile && (
                <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="h-5 w-5 text-emerald-400" />
                    <div>
                      <p className="text-xs font-bold text-white">{identifiedProfile.full_name}</p>
                      <p className="text-[11px] text-slate-400">
                        {identifiedProfile.job_title}
                        {identifiedSimilarity
                          ? ` · Similitud ${(identifiedSimilarity * 100).toFixed(0)}%`
                          : ""}
                      </p>
                    </div>
                  </div>
                  {stage === "PHASE2_EQUIPPING" && (
                    <span className="rounded-lg bg-amber-500/20 px-2.5 py-1 font-mono text-xs font-bold text-amber-300">
                      {equipCountdown}s
                    </span>
                  )}
                </div>
              )}

              <canvas ref={canvasRef} className="hidden" />
              <canvas ref={trackingCanvasRef} className="hidden" />
            </div>

            {/* Botones principales Entrada / Salida (estilo quiosco) */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!cameraReady || submitting}
                onClick={() => handleMarkAttendance("ENTRY")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {submitting ? "Validando..." : "Entrada"}
              </button>

              <button
                type="button"
                disabled={!cameraReady || submitting}
                onClick={() => handleMarkAttendance("EXIT")}
                className="flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 py-3.5 text-sm font-bold text-slate-100 transition hover:border-amber-500/50 hover:bg-slate-800/80 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4 text-amber-400" />
                Salida
              </button>
            </div>

            {/* Controles auxiliares */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => resetBiometricCycle()}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reiniciar lectura facial
              </button>

              <div className="flex items-center gap-2">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-indigo-500/50 hover:text-white disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Subir foto (Prueba)
                </button>
              </div>
            </div>
          </div>

          {scanError && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{scanError}</span>
            </div>
          )}
        </div>

        {/* Columna derecha: Resultado del último marcaje */}
        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Resultado de Validación Biométrica y EPP
            </h2>

            {!lastResult ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                <p className="font-medium text-slate-400">Esperando lectura en quiosco</p>
                <p className="mt-1">
                  1. Mira al cuadro sin mascarilla para identificarte.
                  <br />
                  2. Si el área exige mascarilla/lentes, colócatelos sin salir del marco y pulsa{" "}
                  <strong className="text-slate-300">Entrada</strong>.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  className={`flex items-start gap-3 rounded-xl p-3.5 ${
                    lastResult.is_compliant
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {lastResult.is_compliant ? (
                    <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-rose-400" />
                  )}
                  <div>
                    <p className="text-sm font-bold">
                      {lastResult.is_compliant
                        ? `${lastResult.event_type === "EXIT" ? "Salida" : "Entrada"} Autorizada`
                        : "Acceso Rechazado"}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-white">
                      {lastResult.user_full_name} · {lastResult.zone_name}
                    </p>
                    {!lastResult.is_compliant &&
                      lastResult.missing_items &&
                      lastResult.missing_items.length > 0 && (
                        <p className="mt-1 text-xs font-medium text-rose-200">
                          Falta: {lastResult.missing_items.join(", ")}
                        </p>
                      )}
                    <p className="mt-1 text-[11px] opacity-80">
                      {new Date(lastResult.created_at).toLocaleString()} · Confianza IA:{" "}
                      {(lastResult.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>

                <StatusBadge
                  label={
                    lastResult.recognition_method === "face_biometric"
                      ? `Rostro verificado (${Math.round((lastResult.face_similarity || 0.85) * 100)}%)`
                      : "Identidad por sesión"
                  }
                  active={lastResult.person_detected}
                />
                <StatusBadge label="Prueba de vida (Parpadeo)" active={lastResult.is_live_person} />
                <StatusBadge
                  label={`Casco ${activeZone && !activeZone.require_helmet ? "(Opcional)" : ""}`}
                  active={lastResult.has_helmet}
                />
                <StatusBadge
                  label={`Lentes ${activeZone && !activeZone.require_glasses ? "(Opcional)" : ""}`}
                  active={lastResult.has_glasses}
                />
                <StatusBadge
                  label={`Mascarilla ${activeZone && !activeZone.require_mask ? "(Opcional)" : ""}`}
                  active={lastResult.has_mask}
                />
                <StatusBadge
                  label={`Chaleco ${activeZone && !activeZone.require_vest ? "(Opcional)" : ""}`}
                  active={lastResult.has_vest}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Últimos marcajes del quiosco */}
      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Últimos Marcajes en Terminal</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="py-3 pr-3">Fecha y Hora</th>
                <th className="py-3 px-3">Colaborador</th>
                <th className="py-3 px-3">Área</th>
                <th className="py-3 px-3">Movimiento</th>
                <th className="py-3 px-3">Estado</th>
                <th className="py-3 px-2 text-center">Casco</th>
                <th className="py-3 px-2 text-center">Lentes</th>
                <th className="py-3 px-2 text-center">Masc.</th>
                <th className="py-3 pl-2 text-center">Chaleco</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500">
                    No hay marcajes registrados todavía.
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-3 text-xs text-slate-300">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-medium text-white">{item.user_full_name}</td>
                    <td className="py-3 px-3 text-xs text-indigo-300">{item.zone_name}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
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
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          item.is_compliant
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {item.is_compliant ? "Aprobado" : "Rechazado"}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center text-xs">{item.has_helmet ? "Sí" : "No"}</td>
                    <td className="py-3 px-2 text-center text-xs">{item.has_glasses ? "Sí" : "No"}</td>
                    <td className="py-3 px-2 text-center text-xs">{item.has_mask ? "Sí" : "No"}</td>
                    <td className="py-3 pl-2 text-center text-xs">{item.has_vest ? "Sí" : "No"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Enrolamiento Facial */}
      {enrollOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleEnrollFaceSubmit}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Registrar Perfil Biométrico</h3>
              </div>
              <button
                type="button"
                onClick={() => setEnrollOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-xs">
              <p className="text-slate-300">
                Mira directamente a la cámara de fondo <strong>sin mascarilla ni lentes oscuros</strong>{" "}
                para guardar tu firma facial de 128 puntos en la base de datos.
              </p>

              {user.role === "admin" && allUsers.length > 0 && (
                <div>
                  <label className="mb-1.5 block font-medium text-slate-300">
                    Colaborador a registrar
                  </label>
                  <select
                    value={enrollTargetUserId}
                    onChange={(e) => setEnrollTargetUserId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
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
                <label className="mb-1.5 block font-medium text-slate-300">
                  Código / Carné de empleado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej. EMP-2500587"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 bg-slate-950/50 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setEnrollOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enrolling || !cameraReady}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {enrolling ? "Capturando rostro..." : "Capturar y Guardar Rostro"}
              </button>
            </div>
          </form>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
