import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, KeyRound, Loader2, Eye, EyeOff, AlertTriangle } from "lucide-react";

export default function ResetPassword() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Extrair token da URL: /reset-password?token=xxx
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
  }, []);

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      setError("");
      // Redirecionar para login após 3 segundos
      setTimeout(() => setLocation("/login"), 3000);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch", "As senhas não coincidem."));
      return;
    }
    if (!token) {
      setError(t("auth.invalidToken", "Token inválido. Use o link enviado por e-mail."));
      return;
    }
    resetMutation.mutate({ token, newPassword });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-border/50 shadow-2xl">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <p className="font-semibold">{t("auth.invalidTokenTitle", "Link inválido")}</p>
            <p className="text-sm text-muted-foreground">
              {t("auth.invalidTokenDesc", "Este link de recuperação é inválido ou expirou. Solicite um novo.")}
            </p>
            <Link href="/forgot-password">
              <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                {t("auth.requestNewLink", "Solicitar novo link")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      {/* Background decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <span className="text-3xl font-black tracking-tight cursor-pointer">
              <span className="text-foreground">MMM</span>
              <span className="text-amber-500">OS</span>
            </span>
          </Link>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-amber-500" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {t("auth.resetPasswordTitle", "Redefinir senha")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("auth.resetPasswordSubtitle", "Escolha uma nova senha segura para sua conta.")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {success ? (
              <div className="text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-foreground mb-1">
                    {t("auth.resetPasswordSuccessTitle", "Senha redefinida!")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("auth.resetPasswordSuccessDesc", "Sua senha foi atualizada com sucesso. Você será redirecionada para o login em instantes.")}
                  </p>
                </div>
                <Link href="/login">
                  <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                    {t("auth.goToLogin", "Ir para o login")}
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="newPassword">
                    {t("auth.newPassword", "Nova senha")}
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("auth.passwordPlaceholder", "Mínimo 8 caracteres")}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      autoFocus
                      className="bg-background/50 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">
                    {t("auth.confirmPassword", "Confirmar nova senha")}
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? "text" : "password"}
                      placeholder={t("auth.confirmPasswordPlaceholder", "Repita a nova senha")}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className="bg-background/50 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Indicador de força da senha */}
                {newPassword.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => {
                        const strength = Math.min(
                          Math.floor(newPassword.length / 4) +
                          (newPassword.match(/[A-Z]/) ? 1 : 0) +
                          (newPassword.match(/[0-9]/) ? 1 : 0) +
                          (newPassword.match(/[^A-Za-z0-9]/) ? 1 : 0),
                          4
                        );
                        return (
                          <div
                            key={level}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              level <= strength
                                ? strength <= 1 ? "bg-red-500"
                                  : strength <= 2 ? "bg-orange-500"
                                  : strength <= 3 ? "bg-yellow-500"
                                  : "bg-green-500"
                                : "bg-muted"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {newPassword.length < 8
                        ? t("auth.passwordTooShort", "Mínimo 8 caracteres")
                        : t("auth.passwordStrengthHint", "Use letras maiúsculas, números e símbolos para uma senha mais forte")}
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("auth.saving", "Salvando...")}
                    </>
                  ) : (
                    t("auth.resetPasswordButton", "Redefinir senha")
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
