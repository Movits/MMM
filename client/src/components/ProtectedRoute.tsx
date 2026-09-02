import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  /** Exige nível Ouro (gold/president/admin) para acessar */
  requireGold?: boolean;
  /** Exige pelo menos nível Prata ou Bronze para acessar oportunidades */
  requireOpportunities?: boolean;
  /** Rota para redirecionar se não autenticado. Padrão: URL de login */
  redirectTo?: string;
}

// Hierarquia de acesso
const isGoldOrAbove = (role?: string) =>
  role === "gold" || role === "president" || role === "admin";

const canAccessOpportunities = (role?: string) =>
  role === "bronze" || role === "silver" || role === "gold" || role === "president" || role === "admin";

/**
 * V-07: Guard de rota que protege páginas que requerem autenticação.
 * Redireciona para login se não autenticado, ou para 404 se não autorizado.
 * Impede que o bundle da página seja executado antes da verificação de auth.
 *
 * "Não autenticada" é a query auth.me devolver null ou UNAUTHED_ERR_MSG.
 * Qualquer OUTRO erro dela (banco de dados fora do ar, servidor inacessível)
 * não diz nada sobre a sessão: a usuária pode estar logada, só não deu para
 * verificar. Nesse caso a guarda NÃO manda para o login; mostra o motivo e um
 * botão para tentar de novo. Antes, a queda do banco expulsava todo mundo.
 */
export default function ProtectedRoute({
  children,
  requireAdmin = false,
  requireGold = false,
  requireOpportunities = false,
  redirectTo,
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, error, refresh } = useAuth();
  const [tentandoDeNovo, setTentandoDeNovo] = useState(false);

  const verificacaoFalhou =
    !isAuthenticated && error != null && error.message !== UNAUTHED_ERR_MSG;

  useEffect(() => {
    if (loading) return;

    // Sem veredito sobre a sessão não há para onde mandar: fica na tela de erro.
    if (verificacaoFalhou) return;

    if (!isAuthenticated) {
      window.location.href = redirectTo ?? getLoginUrl();
      return;
    }

    if (requireAdmin && user?.role !== "admin") {
      window.location.href = "/404";
      return;
    }

    if (requireGold && !isGoldOrAbove(user?.role)) {
      window.location.href = "/dashboard";
      return;
    }

    if (requireOpportunities && !canAccessOpportunities(user?.role)) {
      window.location.href = "/dashboard";
    }
  }, [loading, isAuthenticated, verificacaoFalhou, requireAdmin, requireGold, requireOpportunities, user, redirectTo]);

  // Mostrar spinner enquanto verifica autenticação
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A1F3F]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
          <p className="text-sm text-gray-400">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  // A verificação falhou por causa do servidor, não da sessão: sem redirecionar.
  if (verificacaoFalhou) {
    const tentarDeNovo = async () => {
      setTentandoDeNovo(true);
      try {
        await refresh();
      } finally {
        setTentandoDeNovo(false);
      }
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A1F3F] p-4">
        <div role="alert" className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
          <h1 className="text-lg font-semibold text-[#0A1F3F]">Não foi possível verificar seu acesso</h1>
          <p className="mt-2 text-sm text-gray-600">{error.message}</p>
          <button
            type="button"
            onClick={tentarDeNovo}
            disabled={tentandoDeNovo}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-medium text-[#0A1F3F] hover:bg-[#c9a430] disabled:opacity-60"
          >
            {tentandoDeNovo && <Loader2 className="w-4 h-4 animate-spin" />}
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  // Não renderizar conteúdo se não autenticado (evita flash de conteúdo)
  if (!isAuthenticated) {
    return null;
  }

  // Não renderizar se requer admin e usuário não é admin
  if (requireAdmin && user?.role !== "admin") {
    return null;
  }

  // Não renderizar se requer Ouro e usuário não tem nível suficiente
  if (requireGold && !isGoldOrAbove(user?.role)) {
    return null;
  }

  // Não renderizar se requer acesso a oportunidades e usuário não tem nível suficiente
  if (requireOpportunities && !canAccessOpportunities(user?.role)) {
    return null;
  }

  return <>{children}</>;
}
