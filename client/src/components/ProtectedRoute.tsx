import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

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
 */
export default function ProtectedRoute({
  children,
  requireAdmin = false,
  requireGold = false,
  requireOpportunities = false,
  redirectTo,
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (loading) return;

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
  }, [loading, isAuthenticated, requireAdmin, requireGold, requireOpportunities, user, redirectTo]);

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
