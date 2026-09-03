import { useAuth } from "@/_core/hooks/useAuth";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { AlertTriangle, Clock } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface InactivityGuardProps {
  children: React.ReactNode;
}

/**
 * Componente de segurança que monitora a inatividade do usuário.
 * Exibe aviso 5 minutos antes e faz logout automático após 30 minutos.
 * Protege contra acesso não autorizado em sessões esquecidas.
 */
export default function InactivityGuard({ children }: InactivityGuardProps) {
  const { t } = useTranslation();
  const { isAuthenticated, logout } = useAuth();
  const [warningShown, setWarningShown] = useState(false);

  const handleWarning = useCallback((remainingSeconds: number) => {
    if (warningShown) return;
    setWarningShown(true);

    const mins = Math.ceil(remainingSeconds / 60);
    toast.warning(
      t("inactivityGuard.warningTitle", { count: mins }),
      {
        description: t("inactivityGuard.warningDescription"),
        duration: 60000,
        icon: <Clock className="w-4 h-4" />,
        action: {
          label: t("inactivityGuard.continueButton"),
          onClick: () => setWarningShown(false),
        },
      }
    );
  }, [warningShown, t]);

  const handleTimeout = useCallback(async () => {
    toast.error(t("inactivityGuard.timeoutTitle"), {
      description: t("inactivityGuard.timeoutDescription"),
      duration: 12000,
      icon: <AlertTriangle className="w-4 h-4" />,
    });

    try {
      await logout();
    } catch {
      // Forçar redirecionamento mesmo se o logout falhar
      window.location.href = "/";
    }
  }, [logout, t]);

  useInactivityTimeout({
    warningMs: 25 * 60 * 1000, // Aviso aos 25 minutos
    timeoutMs: 30 * 60 * 1000, // Logout aos 30 minutos
    onWarning: handleWarning,
    onTimeout: handleTimeout,
    enabled: isAuthenticated,
  });

  return <>{children}</>;
}
