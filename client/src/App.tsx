import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./components/ProtectedRoute";
import InactivityGuard from "./components/InactivityGuard";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PageTransition } from "./components/PageTransition";
import { PrivacyPage, TermsPage } from "@/pages/LegalPage";

// Lazy loading de todas as páginas para melhor performance
const Home = lazy(() => import("./pages/Home"));
const OAuthError = lazy(() => import("./pages/OAuthError"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Opportunities = lazy(() => import("./pages/Opportunities"));
const OpportunityDetail = lazy(() => import("./pages/OpportunityDetail"));
const NewOpportunity = lazy(() => import("./pages/NewOpportunity"));
const Profile = lazy(() => import("./pages/Profile"));
const Connections = lazy(() => import("./pages/Connections"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const PresidentPanel = lazy(() => import("./pages/PresidentPanel"));
const DealRoom = lazy(() => import("./pages/DealRoom"));
const SIVCVerification = lazy(() => import("./pages/SIVCVerification"));
const Network = lazy(() => import("./pages/Network"));
const Contexts = lazy(() => import("./pages/Contexts"));
const Meetings = lazy(() => import("./pages/Meetings"));
const Memory = lazy(() => import("./pages/Memory"));
const IntelligentMatches = lazy(() => import("./pages/IntelligentMatches"));

// Skeleton de loading global
function PageLoader() {
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-amber-500/10 border-b-amber-400/50 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
        </div>
        <span className="text-amber-400/60 text-sm font-medium tracking-wide">
          <span className="text-white">MMM</span>
          <span className="text-amber-400">OS</span>
        </span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Rota pública - landing page */}
        <Route path={"/"} component={Home} />

        {/* Página de erro OAuth - domínio não autorizado */}
        <Route path={"/oauth-error"} component={OAuthError} />

        {/* Páginas legais: placeholders até os textos jurídicos da cliente */}
        <Route path={"/privacidade"} component={PrivacyPage} />
        <Route path={"/termos"} component={TermsPage} />

        {/* Autenticação própria */}
        <Route path={"/login"} component={Login} />
        <Route path={"/register"} component={Register} />
        <Route path={"/forgot-password"} component={ForgotPassword} />
        <Route path={"/reset-password"} component={ResetPassword} />

        {/* Rota de onboarding - protegida mas sem InactivityGuard */}
        <Route path={"/onboarding"}>
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        </Route>

        {/* Rotas protegidas com guard de autenticação */}
        <Route path={"/dashboard"}>
          <ProtectedRoute>
            <InactivityGuard>
              <Dashboard />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path={"/admin"}>
          <ProtectedRoute requireAdmin>
            <InactivityGuard>
              <AdminPanel />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Painel Ouro — acesso restrito a membras Ouro e Admin */}
        <Route path={"/president"}>
          <ProtectedRoute requireGold>
            <InactivityGuard>
              <PresidentPanel />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Rota de perfil */}
        <Route path="/profile">
          <ProtectedRoute>
            <InactivityGuard>
              <Profile />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Rotas de oportunidades — Prata e Bronze têm acesso */}
        <Route path="/opportunities/new">
          <ProtectedRoute requireOpportunities>
            <InactivityGuard>
              <NewOpportunity />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path="/opportunities/:id">
          <ProtectedRoute requireOpportunities>
            <InactivityGuard>
              <OpportunityDetail />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path="/opportunities">
          <ProtectedRoute requireOpportunities>
            <InactivityGuard>
              <Opportunities />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Conexões estratégicas — exclusivo para Ouro */}
        <Route path="/connections">
          <ProtectedRoute requireGold>
            <InactivityGuard>
              <Connections />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Deal Room — sala de negociação privada */}
        <Route path="/deal-room/:id">
          <ProtectedRoute>
            <InactivityGuard>
              <DealRoom />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* SIVC — Verificação de Identidade */}
        <Route path="/verification">
          <ProtectedRoute>
            <InactivityGuard>
              <SIVCVerification />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Minha Rede de Relacionamentos — Base Particular de Contatos */}
        <Route path="/network">
          <ProtectedRoute>
            <InactivityGuard>
              <Network />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Contextos — Onde e Como Conheceu */}
        <Route path="/contexts">
          <ProtectedRoute>
            <InactivityGuard>
              <Contexts />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        {/* Assistente de Reuniões — gravação e transcrição privada */}
        <Route path="/meetings">
          <ProtectedRoute>
            <InactivityGuard>
              <Meetings />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path="/memory">
          <ProtectedRoute>
            <InactivityGuard>
              <Memory />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path="/intelligent-matches">
          <ProtectedRoute>
            <InactivityGuard>
              <IntelligentMatches />
            </InactivityGuard>
          </ProtectedRoute>
        </Route>

        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          {/* abstract-bg aplica o fundo azul-escuro com formas retangulares em TODAS as páginas */}
          <div className="abstract-bg min-h-screen">
            <PageTransition>
              <Router />
            </PageTransition>
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
