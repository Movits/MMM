import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
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
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    // V-03: REMOVIDO - não persistir dados de usuário no localStorage
    // Isso expunha nome, email, role e openId a XSS, extensões maliciosas e computadores compartilhados
    // Os dados de autenticação ficam apenas em memória (React state via tRPC cache)
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      // `error` é como quem consome distingue "não autenticada" (data null,
      // ou UNAUTHED_ERR_MSG) de "não deu para verificar" (banco de dados fora
      // do ar, servidor inacessível): auth.me lança nesse caso em vez de
      // devolver null, e a mensagem chega aqui em error.message. Quem trata
      // é o ProtectedRoute; aqui só se garante que o erro não se perde.
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

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    // A query falhou por outro motivo que não "sem sessão": a usuária pode
    // estar logada, só não deu para saber. Mandar para o login a expulsaria.
    if (meQuery.error && meQuery.error.message !== UNAUTHED_ERR_MSG) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    // Usar replace para navegação suave sem recarregar a página
    window.location.replace(redirectPath);
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    meQuery.error,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
