import { useEffect, useState } from "react";
import { api, User } from "./lib/api";
import { AuthForm } from "./features/AuthForm";
import { CameraScanner } from "./features/CameraScanner";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        Verificando sesión segura...
      </div>
    );
  }

  if (!user) {
    return <AuthForm onSuccess={(u) => setUser(u)} />;
  }

  return <CameraScanner user={user} onLogout={handleLogout} />;
}
