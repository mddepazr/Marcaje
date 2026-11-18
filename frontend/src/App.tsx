import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, User } from "./lib/api";
import { CameraScanner } from "./features/CameraScanner";
import { AdminDashboard } from "./features/AdminDashboard";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"scanner" | "admin">("scanner");

  const [isRegister, setIsRegister] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setUser(u);
        setActiveView(u.role === "admin" ? "admin" : "scanner");
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAuthError("");
    try {
      const loggedUser = isRegister
        ? await api.register({ full_name: fullName, email, password })
        : await api.login({ email, password });
      setUser(loggedUser);
      setActiveView(loggedUser.role === "admin" ? "admin" : "scanner");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setActiveView("scanner");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Verificando sesión segura...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Control de Marcaje EPP</h1>
              <p className="text-xs text-slate-400">
                Verificación biométrica y equipo de seguridad
              </p>
            </div>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Nombre completo
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Correo electrónico
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Contraseña
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {authError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting
                ? "Procesando..."
                : isRegister
                ? "Crear cuenta e ingresar"
                : "Iniciar sesión"}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError("");
              }}
              className="text-xs text-slate-400 hover:text-indigo-400"
            >
              {isRegister
                ? "¿Ya tienes cuenta? Inicia sesión"
                : "¿No tienes cuenta? Regístrate aquí"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {user.role === "admin" && activeView === "admin" ? (
        <AdminDashboard
          user={user}
          onLogout={handleLogout}
          onSwitchToScanner={() => setActiveView("scanner")}
        />
      ) : (
        <CameraScanner
          user={user}
          onLogout={handleLogout}
          onSwitchToAdmin={user.role === "admin" ? () => setActiveView("admin") : undefined}
        />
      )}
    </div>
  );
}

export default App;
