import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      // V-03: Limpar qualquer dado residual do localStorage ao fazer logout
      try {
        localStorage.removeItem("manus-runtime-user-info");
      } catch {
        // Ignorar erros de localStorage em ambientes restritos
      }
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
      // V-03: Garantir limpeza do localStorage mesmo em caso de erro
      try {
        localStorage.removeItem("manus-runtime-user-info");
      } catch {
        // Ignorar
      }
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    // V-03: REMOVIDO - não persistir dados de usuário no localStorage
    // Isso expunha nome, email, role e openId a XSS, extensões maliciosas e computadores compartilhados
    // Os dados de autenticação ficam apenas em memória (React state via tRPC cache)
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // V-03: Limpar dados residuais do localStorage na montagem do componente
  useEffect(() => {
    try {
      localStorage.removeItem("manus-runtime-user-info");
    } catch {
      // Ignorar
    }
  }, []);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    // Usar replace para navegação suave sem recarregar a página
    window.location.replace(redirectPath);
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
