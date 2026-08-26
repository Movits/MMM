import { useAuth } from "@/_core/hooks/useAuth";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { AlertTriangle, Clock } from "lucide-react";
import { useCallback, useState } from "react";
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
  const { isAuthenticated, logout } = useAuth();
  const [warningShown, setWarningShown] = useState(false);

  const handleWarning = useCallback((remainingSeconds: number) => {
    if (warningShown) return;
    setWarningShown(true);

    const mins = Math.ceil(remainingSeconds / 60);
    toast.warning(
      `⏰ Sessão expirando em ${mins} minuto${mins > 1 ? 's' : ''}`,
      {
        description: "Mova o mouse ou pressione uma tecla para permanecer conectado.",
        duration: 60000,
        icon: <Clock className="w-4 h-4" />,
        action: {
          label: "Continuar conectado",
          onClick: () => setWarningShown(false),
        },
      }
    );
  }, [warningShown]);

  const handleTimeout = useCallback(async () => {
    toast.error("🔒 Sessão encerrada por inatividade", {
      description: "Por segurança, você foi desconectado após 30 minutos sem atividade. Faça login novamente para continuar.",
      duration: 12000,
      icon: <AlertTriangle className="w-4 h-4" />,
    });

    try {
      await logout();
    } catch {
      // Forçar redirecionamento mesmo se o logout falhar
      window.location.href = "/";
    }
  }, [logout]);

  useInactivityTimeout({
    warningMs: 25 * 60 * 1000, // Aviso aos 25 minutos
    timeoutMs: 30 * 60 * 1000, // Logout aos 30 minutos
    onWarning: handleWarning,
    onTimeout: handleTimeout,
    enabled: isAuthenticated,
  });

  return <>{children}</>;
}
