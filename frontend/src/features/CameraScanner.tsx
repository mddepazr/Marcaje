import { useEffect, useRef, useState } from "react";
import {
  Camera,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api, MarcajeRecord, MarcajeSettings, User } from "../lib/api";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Toast, ToastData } from "../components/ui/Toast";

interface Props {
  user: User;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CameraScanner({ user, onLogout, onSwitchToAdmin }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [livenessPrompt, setLivenessPrompt] = useState("");
  const [scanError, setScanError] = useState("");
  const [lastResult, setLastResult] = useState<MarcajeRecord | null>(null);
  const [history, setHistory] = useState<MarcajeRecord[]>([]);
  const [settings, setSettings] = useState<MarcajeSettings | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const loadData = async () => {
    try {
      const [records, cfg] = await Promise.all([api.getHistory(), api.getSettings()]);
      setHistory(records);
      setSettings(cfg);
    } catch {
      // Silencioso en carga inicial
    }
  };

  useEffect(() => {
    loadData();
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
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

  const notifyResult = (result: MarcajeRecord) => {
    if (result.is_compliant) {
      setToast({
        type: "success",
        title: "Marcaje Aprobado",
        message: "Cumples con todo el equipo de protección requerido.",
      });
    } else {
      const faltantes = result.missing_items?.join(", ") || "Equipo requerido";
      setToast({
        type: "error",
        title: "Marcaje Rechazado",
        message: `Falta: ${faltantes}.`,
      });
    }
  };

  const captureLiveSequence = async () => {
    setScanning(true);
    setScanError("");
    setLivenessPrompt("Prueba de vida: parpadea o gira ligeramente la cabeza...");

    try {
      const blobs: Blob[] = [];
      for (let i = 0; i < 3; i++) {
        const frame = await grabSingleFrame();
        if (frame) blobs.push(frame);
        if (i < 2) await sleep(550);
      }

      setLivenessPrompt("Analizando autenticidad y equipo de protección...");
      const result = await api.scanFrames(blobs, "live");
      setLastResult(result);
      notifyResult(result);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al analizar la captura en vivo";
      setScanError(msg);
      setToast({ type: "error", title: "Escaneo no completado", message: msg });
    } finally {
      setScanning(false);
      setLivenessPrompt("");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScanError("");
    try {
      const result = await api.scanFrames([file], "upload");
      setLastResult(result);
      notifyResult(result);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al analizar la imagen";
      setScanError(msg);
      setToast({ type: "error", title: "Error en análisis", message: msg });
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  };

  const requiredList = settings
    ? [
        settings.require_helmet ? "Casco" : null,
        settings.require_glasses ? "Lentes" : null,
        settings.require_mask ? "Mascarilla" : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
            <ScanFace className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-white">Terminal de Marcaje EPP</h1>
              <span className="rounded-md bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300">
                {user.job_title || (user.role === "admin" ? "Administrador" : "Operador")}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {user.full_name} ({user.email})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {user.role === "admin" && onSwitchToAdmin && (
            <button
              onClick={onSwitchToAdmin}
              className="flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-600/15 px-4 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-600/25"
            >
              <LayoutDashboard className="h-4 w-4" />
              Panel Administrador
            </button>
          )}

          <button
            onClick={onLogout}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </header>

      {settings && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <MapPin className="h-4 w-4 text-indigo-400" />
            <span>
              Zona activa: <strong className="text-white">{settings.zone_name}</strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">EPP obligatorio:</span>
            {requiredList.length > 0 ? (
              requiredList.map((item) => (
                <span
                  key={item}
                  className="rounded-md bg-indigo-500/15 px-2.5 py-0.5 font-medium text-indigo-300"
                >
                  {item}
                </span>
              ))
            ) : (
              <span className="rounded-md bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-300">
                Solo presencia (sin EPP obligatorio)
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
            <div className="relative aspect-video w-full bg-slate-950">
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

              {livenessPrompt && (
                <div className="absolute inset-x-4 bottom-4 rounded-xl border border-indigo-500/50 bg-slate-950/90 px-4 py-2.5 text-center text-xs font-semibold text-indigo-300 backdrop-blur">
                  {livenessPrompt}
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4">
              <div className="text-xs text-slate-400">
                Escaneo en vivo incluye verificación anti-fraude (3 fotogramas).
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
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
                  disabled={scanning}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-indigo-500/50 hover:text-white disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  Subir foto (Prueba)
                </button>

                <button
                  onClick={captureLiveSequence}
                  disabled={!cameraReady || scanning}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  {scanning ? "Verificando..." : "Escanear en Vivo"}
                </button>
              </div>
            </div>
          </div>

          {scanError && (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {scanError}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Resultado del Último Escaneo
            </h2>

            {!lastResult ? (
              <p className="text-sm text-slate-500">
                Aún no has realizado un escaneo en esta sesión.
              </p>
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
                      {lastResult.is_compliant ? "Marcaje Aprobado" : "Marcaje Rechazado"}
                    </p>
                    {!lastResult.is_compliant &&
                      lastResult.missing_items &&
                      lastResult.missing_items.length > 0 && (
                        <p className="mt-0.5 text-xs font-medium text-rose-200">
                          Falta: {lastResult.missing_items.join(", ")}
                        </p>
                      )}
                    <p className="mt-0.5 text-xs opacity-80">
                      Confianza: {(lastResult.confidence * 100).toFixed(1)}% ·{" "}
                      {lastResult.is_live_person ? "En vivo" : "Prueba"}
                    </p>
                  </div>
                </div>

                <StatusBadge label="Persona en cuadro" active={lastResult.person_detected} />
                <StatusBadge label="Prueba de vida (Real)" active={lastResult.is_live_person} />
                <StatusBadge
                  label={`Casco ${settings && !settings.require_helmet ? "(Opcional)" : ""}`}
                  active={lastResult.has_helmet}
                />
                <StatusBadge
                  label={`Lentes ${settings && !settings.require_glasses ? "(Opcional)" : ""}`}
                  active={lastResult.has_glasses}
                />
                <StatusBadge
                  label={`Mascarilla ${settings && !settings.require_mask ? "(Opcional)" : ""}`}
                  active={lastResult.has_mask}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Mi Historial de Marcajes</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="py-3 pr-4">Fecha y Hora</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Origen</th>
                <th className="py-3 px-4">Casco</th>
                <th className="py-3 px-4">Lentes</th>
                <th className="py-3 px-4">Mascarilla</th>
                <th className="py-3 pl-4">Confianza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No hay marcajes registrados todavía.
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-4 text-slate-300">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
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
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {item.is_live_person ? "En vivo" : "Prueba"}
                    </td>
                    <td className="py-3 px-4">{item.has_helmet ? "Sí" : "No"}</td>
                    <td className="py-3 px-4">{item.has_glasses ? "Sí" : "No"}</td>
                    <td className="py-3 px-4">{item.has_mask ? "Sí" : "No"}</td>
                    <td className="py-3 pl-4 text-slate-400">{(item.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
