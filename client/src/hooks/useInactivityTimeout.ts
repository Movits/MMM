import { useEffect, useRef, useCallback } from "react";

interface UseInactivityTimeoutOptions {
  /** Tempo em ms antes do aviso (padrão: 25 minutos) */
  warningMs?: number;
  /** Tempo em ms antes do logout automático (padrão: 30 minutos) */
  timeoutMs?: number;
  /** Callback chamado quando o aviso é exibido */
  onWarning?: (remainingSeconds: number) => void;
  /** Callback chamado quando o logout automático é acionado */
  onTimeout: () => void;
  /** Se false, o hook não faz nada (ex: usuário não autenticado) */
  enabled?: boolean;
}

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keypress",
  "scroll",
  "touchstart",
  "click",
  "keydown",
];

/**
 * Hook de segurança: auto-logout após período de inatividade.
 * Protege contra acesso não autorizado em computadores compartilhados
 * ou quando o usuário esquece a sessão aberta.
 */
export function useInactivityTimeout({
  warningMs = 25 * 60 * 1000, // 25 minutos
  timeoutMs = 30 * 60 * 1000, // 30 minutos
  onWarning,
  onTimeout,
  enabled = true,
}: UseInactivityTimeoutOptions) {
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
  }, []);

  const resetTimers = useCallback(() => {
    if (!enabled) return;

    clearTimers();
    lastActivityRef.current = Date.now();

    // Aviso antes do logout
    warningTimerRef.current = setTimeout(() => {
      const remaining = Math.ceil((timeoutMs - warningMs) / 1000);
      onWarning?.(remaining);
    }, warningMs);

    // Logout automático
    logoutTimerRef.current = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  }, [enabled, clearTimers, warningMs, timeoutMs, onWarning, onTimeout]);

  useEffect(() => {
    if (!enabled) return;

    // Iniciar timers
    resetTimers();

    // Registrar eventos de atividade
    const handleActivity = () => resetTimers();
    ACTIVITY_EVENTS.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Verificar visibilidade da página (tab em foco)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Verificar se o timeout já passou enquanto a tab estava oculta
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= timeoutMs) {
          onTimeout();
        } else {
          resetTimers();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, resetTimers, clearTimers, timeoutMs, onTimeout]);

  return {
    /** Resetar manualmente o timer de inatividade */
    resetTimer: resetTimers,
    /** Tempo desde a última atividade em ms */
    getIdleTime: () => Date.now() - lastActivityRef.current,
  };
}
