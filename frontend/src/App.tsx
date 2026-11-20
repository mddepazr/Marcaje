import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { api, User } from "./lib/api";
import { CameraScanner } from "./features/CameraScanner";
import { AdminDashboard } from "./features/AdminDashboard";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"scanner" | "admin">("scanner");

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = authMode === "register";

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
      <div
        style={{ backgroundColor: "var(--color-background-body)" }}
        className="flex min-h-screen items-center justify-center px-4"
      >
        <HStack gap={3} vAlign="center">
          <Spinner size="sm" />
          <Text type="supporting">Verificando sesión segura...</Text>
        </HStack>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{ backgroundColor: "var(--color-background-body)" }}
        className="flex min-h-screen items-center justify-center px-4 py-8"
      >
        <Card maxWidth={440} width="100%" padding={6} elevation="low">
          <VStack gap={5}>
            <HStack gap={3} vAlign="center">
              <div
                style={{
                  backgroundColor: "var(--color-background-muted)",
                  borderColor: "var(--color-border-subtle)",
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
              >
                <ShieldCheck className="h-5 w-5" />
              </div>
              <VStack gap={0.5}>
                <Heading level={2}>Control de Marcaje EPP</Heading>
                <Text type="supporting">
                  Verificación biométrica y cumplimiento de seguridad
                </Text>
              </VStack>
            </HStack>

            <SegmentedControl
              label="Modo de autenticación"
              value={authMode}
              layout="fill"
              onChange={(val) => {
                setAuthMode(val as "login" | "register");
                setAuthError("");
              }}
            >
              <SegmentedControlItem value="login" label="Iniciar sesión" />
              <SegmentedControlItem value="register" label="Crear cuenta" />
            </SegmentedControl>

            <Divider />

            <form onSubmit={handleAuthSubmit}>
              <VStack gap={4}>
                {isRegister && (
                  <TextInput
                    label="Nombre completo"
                    placeholder="Ej. Marcos de Páz"
                    value={fullName}
                    onChange={setFullName}
                    isRequired
                    width="100%"
                  />
                )}

                <TextInput
                  type="email"
                  label="Correo electrónico"
                  placeholder="colaborador@empresa.com"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                  isRequired
                  width="100%"
                />

                <TextInput
                  type="password"
                  label="Contraseña"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={setPassword}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  isRequired
                  width="100%"
                />

                {authError && (
                  <Banner
                    status="error"
                    title="No se pudo iniciar sesión"
                    description={authError}
                  />
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  width="100%"
                  isLoading={submitting}
                  label={isRegister ? "Crear cuenta e ingresar" : "Iniciar sesión"}
                />
              </VStack>
            </form>
          </VStack>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "var(--color-background-body)" }} className="min-h-screen">
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
