import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, ArrowLeft, Mail, Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const forgotMutation = trpc.auth.forgotPassword.useMutation({
    onSuccess: () => {
      setSent(true);
      setError("");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    forgotMutation.mutate({ email });
  };

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
            <BrandLogo variante="lockup" className="w-44 mx-auto cursor-pointer" />
          </Link>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Mail className="w-6 h-6 text-amber-500" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {t("auth.forgotPasswordTitle", "Esqueci minha senha")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("auth.forgotPasswordSubtitle", "Informe seu e-mail cadastrado para receber o link de redefinição.")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              /* ---- ESTADO: e-mail enviado ---- */
              <div className="space-y-5 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-foreground">{t("auth.forgotPasswordSentTitle", "Verifique seu e-mail")}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Se o e-mail existir em nossa base, você receberá instruções em breve. Verifique também a pasta de spam.
                  </p>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 text-left space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Informações importantes</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• O link expira em <strong className="text-foreground">1 hora</strong></li>
                    <li>• Pode ser usado <strong className="text-foreground">apenas uma vez</strong></li>
                    <li>• Se não receber, verifique a pasta de spam</li>
                  </ul>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => { setSent(false); setEmail(""); }}
                >
                  {t("auth.forgotPasswordTryAgain", "Tentar com outro e-mail")}
                </Button>
              </div>
            ) : (
              /* ---- ESTADO: formulário ---- */
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">
                    {t("auth.email", "E-mail cadastrado")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="bg-background/50"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  disabled={forgotMutation.isPending}
                >
                  {forgotMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("auth.sending", "Enviando...")}
                    </>
                  ) : (
                    t("auth.forgotPasswordButton", "Enviar link de recuperação")
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  {t("auth.forgotPasswordNote", "Se o e-mail estiver cadastrado, você receberá o link em instantes.")}
                </p>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  {t("auth.backToLogin", "Voltar para o login")}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
