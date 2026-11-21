import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
import { ThemeSwitcher } from "./components/ui/ThemeSwitcher";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [activeView, setActiveView] = useState<"scanner" | "admin">("scanner");

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = authMode === "register";
  const passwordsMismatch =
    isRegister && confirmPassword.length > 0 && password !== confirmPassword;

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
    setAuthError("");

    if (isRegister) {
      if (password.length < 6) {
        setAuthError("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (password !== confirmPassword) {
        setAuthError("Las contraseñas no coinciden. Escríbelas de nuevo.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const loggedUser = isRegister
        ? await api.register({ full_name: fullName, email, password })
        : await api.login({ email, password });
      setUser(loggedUser);
      setShowAuthScreen(false);
      setFullName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
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
    setShowAuthScreen(false);
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
          <Text type="supporting">Iniciando terminal biométrica...</Text>
        </HStack>
      </div>
    );
  }

  if (!user && showAuthScreen) {
    return (
      <div
        style={{ backgroundColor: "var(--color-background-body)" }}
        className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:px-6"
      >
        <div className="mb-4 flex w-full max-w-[440px] items-center justify-between gap-2">
          <Button
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            label="Volver al Marcaje"
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowAuthScreen(false);
              setAuthError("");
            }}
          />
          <ThemeSwitcher />
        </div>

        <Card elevation="low" maxWidth={440} padding={6} width="100%">
          <VStack gap={5}>
            <HStack gap={3} vAlign="center">
              <div
                style={{
                  backgroundColor: "var(--color-background-muted)",
                  borderColor: "var(--color-border-subtle)",
                }}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border"
              >
                <ShieldCheck className="h-6 w-6" />
              </div>
              <VStack gap={1}>
                <Heading level={2}>Acceso y Registro</Heading>
                <Text type="supporting">
                  Administración del sistema o registro biométrico inicial
                </Text>
              </VStack>
            </HStack>

            <SegmentedControl
              label="Modo de autenticación"
              layout="fill"
              value={authMode}
              onChange={(val) => {
                setAuthMode(val as "login" | "register");
                setAuthError("");
                setConfirmPassword("");
              }}
            >
              <SegmentedControlItem label="Iniciar sesión" value="login" />
              <SegmentedControlItem label="Crear cuenta" value="register" />
            </SegmentedControl>

            <Divider />

            <form onSubmit={handleAuthSubmit}>
              <VStack gap={4}>
                {isRegister && (
                  <TextInput
                    isRequired
                    label="Nombre completo"
                    placeholder="Ej. Emily Morales"
                    value={fullName}
                    onChange={setFullName}
                    width="100%"
                  />
                )}

                <TextInput
                  autoComplete="email"
                  isRequired
                  label="Correo electrónico"
                  placeholder="colaborador@empresa.com"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  width="100%"
                />

                <TextInput
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  isRequired
                  label="Contraseña"
                  placeholder="Mínimo 6 caracteres"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  width="100%"
                />

                {isRegister && (
                  <VStack gap={1}>
                    <TextInput
                      autoComplete="new-password"
                      isRequired
                      label="Confirmar contraseña"
                      placeholder="Vuelve a escribir tu contraseña"
                      type="password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      width="100%"
                    />
                    {passwordsMismatch && (
                      <Text type="supporting">⚠ Las contraseñas no coinciden.</Text>
                    )}
                    {confirmPassword.length > 0 && !passwordsMismatch && (
                      <Text type="supporting">✓ Las contraseñas coinciden.</Text>
                    )}
                  </VStack>
                )}

                {authError && (
                  <Banner
                    description={authError}
                    status="error"
                    title={isRegister ? "No se pudo crear la cuenta" : "No se pudo iniciar sesión"}
                  />
                )}

                <Button
                  isDisabled={passwordsMismatch}
                  isLoading={submitting}
                  label={isRegister ? "Crear cuenta y registrar rostro" : "Iniciar sesión"}
                  size="lg"
                  type="submit"
                  variant="primary"
                  width="100%"
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
      {user?.role === "admin" && activeView === "admin" ? (
        <AdminDashboard
          user={user}
          onLogout={handleLogout}
          onSwitchToScanner={() => {
            api.me().then(setUser).catch(() => {});
            setActiveView("scanner");
          }}
        />
      ) : (
        <CameraScanner
          user={user}
          onOpenAuth={() => {
            setAuthMode("login");
            setShowAuthScreen(true);
          }}
          onLogout={handleLogout}
          onUserUpdated={(updated) => setUser(updated)}
          onSwitchToAdmin={user?.role === "admin" ? () => setActiveView("admin") : undefined}
        />
      )}
    </div>
  );
}

export default App;
