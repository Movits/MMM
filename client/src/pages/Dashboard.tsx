import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalMenu } from "@/components/AppHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Briefcase, ShieldCheck, Users, MapPin, Mic, Brain, Sparkles, Crown,
  Menu as MenuIcon, ChevronDown, LogOut,
} from "lucide-react";

// ─── Animated Score Ring ─────────────────────────────────────────────────────
function ScoreRing({ score, size = 64, animate = false }: { score: number; size?: number; animate?: boolean }) {
  const [displayed, setDisplayed] = useState(animate ? 0 : score);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (displayed / 100) * circ;
  const color = displayed >= 80 ? "#10b981" : displayed >= 60 ? "#f59e0b" : "#3b82f6";

  useEffect(() => {
    if (!animate) return;
    let start: number | null = null;
    const duration = 1200;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayed(Math.round(ease * score));
      if (p < 1) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [score, animate]);

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.05s linear, stroke 0.3s ease" }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px`, fill: color, fontSize: size * 0.22, fontWeight: "bold" }}>
        {displayed}%
      </text>
    </svg>
  );
}

// ─── Animated Score Bar ───────────────────────────────────────────────────────
function ScoreBar({ label, value, color = "#f59e0b", delay = 0 }: { label: string; value: number; color?: string; delay?: number }) {
  const [width, setWidth] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setWidth(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <div ref={ref}>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-white/50">{label}</span>
        <span style={{ color }} className="font-bold">{value}%</span>
      </div>
      <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color, transition: `width 0.9s cubic-bezier(0.23,1,0.32,1)` }} />
      </div>
    </div>
  );
}

// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedNumber({ value, suffix = "" }: { value: number | string; suffix?: string }) {
  const num = typeof value === "number" ? value : parseInt(String(value)) || 0;
  const [displayed, setDisplayed] = useState(0);
  const isString = typeof value === "string" && isNaN(parseInt(value));

  useEffect(() => {
    if (isString) return;
    let start: number | null = null;
    const duration = 800;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayed(Math.round(ease * num));
      if (p < 1) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [num, isString]);

  if (isString) return <>{value}</>;
  return <>{displayed}{suffix}</>;
}

// ─── Distribution Chart ───────────────────────────────────────────────────────
function DistributionChart({ data }: { data: number[] }) {
  const [animated, setAnimated] = useState(false);
  const max = Math.max(...data, 1);
  const labels = ["0–20", "20–40", "40–60", "60–80", "80+"];
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#3b82f6", "#10b981"];

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex items-end gap-3 h-24">
      {data.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
          <div className="text-xs font-bold" style={{ color: colors[i], opacity: v > 0 ? 1 : 0.3 }}>{v}</div>
          <div className="w-full rounded-t-lg relative overflow-hidden" style={{
            height: animated ? `${(v / max) * 72}px` : "0px",
            background: colors[i],
            opacity: v === 0 ? 0.15 : 1,
            transition: `height 0.7s cubic-bezier(0.23,1,0.32,1) ${i * 0.08}s`,
            minHeight: v > 0 ? "4px" : "0",
          }}>
            {v > 0 && (
              <div className="absolute inset-0 shimmer-bg opacity-30" />
            )}
          </div>
          <div className="text-xs text-white/30">{labels[i]}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Match Card ───────────────────────────────────────────────────────────────
// Mapeador de sinônimos de interesse: normaliza termos informais para rótulos amigáveis
const INTEREST_SYNONYMS: Record<string, string> = {
  // Moda / Vestuário
  roupas: "Moda", vestuario: "Moda", vestuário: "Moda", fashion: "Moda",
  clothing: "Moda", textil: "Moda", têxtil: "Moda", textile: "Moda",
  confeccao: "Moda", confecção: "Moda", apparel: "Moda",
  // Tecnologia
  tech: "Tecnologia", ti: "Tecnologia", software: "Tecnologia", startup: "Tecnologia",
  // Alimentação
  alimentos: "Alimentos & Bebidas", comida: "Alimentos & Bebidas", food: "Alimentos & Bebidas",
  bebidas: "Alimentos & Bebidas", agro: "Agronegócio", agronegocio: "Agronegócio",
  // Beleza
  beleza: "Beleza & Cosméticos", cosmeticos: "Beleza & Cosméticos", cosméticos: "Beleza & Cosméticos",
  beauty: "Beleza & Cosméticos",
  // Saúde
  saude: "Saúde", saúde: "Saúde", health: "Saúde", medico: "Saúde", médico: "Saúde",
  // Educação
  educacao: "Educação", educação: "Educação", education: "Educação",
  // Financeiro
  financeiro: "Finanças", financas: "Finanças", finanças: "Finanças", finance: "Finanças",
  investimento: "Investimento", investment: "Investimento",
  // Imobiliário
  imoveis: "Imobiliário", imóveis: "Imobiliário", imobiliario: "Imobiliário", real_estate: "Imobiliário",
};

function normalizeInterest(raw: string): string {
  const key = raw.toLowerCase().trim().replace(/\s+/g, "_");
  return INTEREST_SYNONYMS[key] || INTEREST_SYNONYMS[raw.toLowerCase().trim()] || raw;
}

// ─── Banner de Promoção Ouro ───
function GoldPromotionBanner({ userId }: { userId?: number }) {
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, {
    enabled: !!userId,
    staleTime: 30_000,
  });
  const markReadMutation = trpc.notifications.markAllRead.useMutation();

  const goldNotif = notificationsQuery.data?.find(
    (n: { type: string; isRead: boolean | null }) => n.type === "gold_granted" && !n.isRead
  );

  useEffect(() => {
    if (goldNotif && !dismissed) {
      const t = setTimeout(() => setShown(true), 500);
      return () => clearTimeout(t);
    }
  }, [goldNotif, dismissed]);

  if (!goldNotif || dismissed || !shown) return null;

  const handleDismiss = () => {
    setDismissed(true);
    markReadMutation.mutate();
  };

  return (
    <div className="relative overflow-hidden" style={{
      background: "linear-gradient(135deg, #92400e 0%, #78350f 40%, #451a03 100%)",
      borderBottom: "1px solid rgba(245,166,35,0.3)",
      animation: "slideDown 0.5s cubic-bezier(0.23,1,0.32,1)",
    }}>
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: "radial-gradient(circle at 20% 50%, #f5a623 0%, transparent 50%), radial-gradient(circle at 80% 50%, #ffd166 0%, transparent 50%)"
      }} />
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4 relative">
        <div className="text-3xl animate-bounce">⭐</div>
        <div className="flex-1">
          <div className="font-black text-amber-300 text-lg">Parabéns! Você recebeu o Selo Ouro!</div>
          <div className="text-amber-200/80 text-sm mt-0.5">{goldNotif.body || "Uma membra Ouro do MMM concedeu a você o Selo de Exclusividade Institucional Ouro."}</div>
        </div>
        <button onClick={handleDismiss}
          className="text-amber-300/60 hover:text-amber-300 transition-colors text-xl font-bold px-2 py-1 rounded"
          title="Fechar">
          ×
        </button>
      </div>
    </div>
  );
}

type MatchData = {
  matchId: number; matchedUserId: number | null; overallScore: number;
  specialtyScore: number | null; objectivesScore: number | null;
  incomeScore: number | null; locationScore: number | null; valuesScore: number | null;
  aiInsight: string | null; displayName: string | null; city: string | null;
  country: string | null; avatarUrl: string | null; bio: string | null;
  primarySpecialty: string | null; currentRole: string | null;
  currentCompany: string | null; seekingTypes: unknown; businessInterests: unknown; values: unknown;
  sector: string | null;
};

function MatchCard({ match, onInterest, onDismiss, index }: {
  match: MatchData; onInterest: (uid: number) => void;
  onDismiss: (mid: number) => void; index: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [entered, setEntered] = useState(false);
  const seekingTypes = Array.isArray(match.seekingTypes) ? match.seekingTypes as string[] : [];
  const businessInterests = Array.isArray(match.businessInterests) ? match.businessInterests as string[] : [];
  const values = Array.isArray(match.values) ? match.values as string[] : [];

  // Combina seekingTypes + businessInterests, normaliza sinônimos, remove duplicatas
  // Perfis novos guardam CHAVES (ex. "investor"); perfis antigos, o texto
  // traduzido. Traduz a chave quando houver tradução e cai no valor cru.
  const keyToLabel = (k: string) =>
    t("onboarding.seeking." + k, { defaultValue: t("onboarding.sectors." + k, { defaultValue: k }) });
  const allInterests = Array.from(new Set(
    [...seekingTypes, ...businessInterests].map(k => normalizeInterest(keyToLabel(k)))
  )).slice(0, 5);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), index * 80);
    return () => clearTimeout(t);
  }, [index]);

  const isTopMatch = match.overallScore >= 80;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0) scale(1)" : "translateY(20px) scale(0.97)",
        transition: `opacity 0.4s cubic-bezier(0.23,1,0.32,1), transform 0.4s cubic-bezier(0.23,1,0.32,1)`,
      }}
      className={`bg-[#0d1530] border rounded-2xl overflow-hidden transition-all duration-300 ${
        isTopMatch
          ? "border-emerald-500/30 shadow-lg shadow-emerald-500/5"
          : hovered ? "border-white/20" : "border-white/8"
      } ${hovered ? "shadow-xl shadow-black/30" : ""}`}>

      {isTopMatch && (
        <div className="h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0" />
      )}

      <div className="p-6">
        <div className="flex items-start gap-4 mb-4">
          {/* Avatar */}
          <div className={`relative w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center text-black font-black text-xl transition-transform duration-200 ${hovered ? "scale-105" : ""}`}
            style={{ background: "linear-gradient(135deg, #f5a623, #ffd166)" }}>
            {(match.displayName || "?")[0].toUpperCase()}
            {isTopMatch && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full flex items-center justify-center text-[9px] font-black text-black">★</div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-bold text-lg leading-tight">{match.displayName || "Usuário"}</h3>
              {isTopMatch && (
                <Badge className="bg-emerald-400/15 text-emerald-400 border-emerald-400/25 text-xs px-2 py-0.5">{t("dashboard.topMatch")}</Badge>
              )}
            </div>
            <div className="text-xs text-white/40 mt-0.5 flex items-center gap-1">
              <span className="text-[10px]">📍</span>
              {match.sector || match.primarySpecialty}
              {(match.sector || match.primarySpecialty) && (match.city) && " · "}
              {match.city}{match.country && `, ${match.country}`}
            </div>
          </div>

          <ScoreRing score={match.overallScore} size={64} animate={entered} />
        </div>

        {/* AI Insight */}
        {match.aiInsight && (
          <div className={`bg-[#f5a623]/8 border border-[#f5a623]/20 rounded-xl p-3 mb-4 text-sm text-white/65 leading-relaxed transition-all duration-300 ${hovered ? "border-[#f5a623]/35 bg-[#f5a623]/12" : ""}`}>
            <span className="text-[#f5a623] font-semibold">✦ IA: </span>{match.aiInsight}
          </div>
        )}

        {/* Interest tags — sinônimos normalizados */}
        {allInterests.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {allInterests.map((interest: string) => (
              <span key={interest} className="px-2.5 py-0.5 rounded-full bg-amber-500/8 border border-amber-500/20 text-xs text-amber-300/70 hover:border-amber-500/40 hover:text-amber-300 transition-colors">
                {interest}
              </span>
            ))}
          </div>
        )}

        {/* Expanded scores */}
        {expanded && (
          <div className="space-y-2.5 mb-4 pt-4 border-t border-white/5">
            <ScoreBar label="Objetivos" value={match.objectivesScore ?? 0} color="#f59e0b" delay={0} />
            <ScoreBar label="Especialidade" value={match.specialtyScore ?? 0} color="#3b82f6" delay={80} />
            <ScoreBar label="Valores" value={match.valuesScore ?? 0} color="#10b981" delay={160} />
            <ScoreBar label="Localização" value={match.locationScore ?? 0} color="#8b5cf6" delay={240} />
            <ScoreBar label="Renda" value={match.incomeScore ?? 0} color="#f97316" delay={320} />
            {values.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {values.map((v: string) => (
                  <span key={v} className="px-2.5 py-0.5 rounded-full bg-[#f5a623]/10 border border-[#f5a623]/20 text-xs text-[#f5a623]">{v}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => match.matchedUserId && onInterest(match.matchedUserId)}
            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95 shadow-md shadow-[#f5a623]/15">
            {t("dashboard.connect")}
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="px-3 py-2.5 rounded-xl text-xs font-medium border border-white/15 text-white/50 hover:border-white/30 hover:text-white transition-all duration-200">
            {expanded ? "▲" : "Scores"}
          </button>
          <button onClick={() => onDismiss(match.matchId)}
            className="px-3 py-2.5 rounded-xl text-white/25 hover:text-white/60 hover:bg-white/5 transition-all duration-200 text-sm">✕</button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon, index }: {
  label: string; value: number | string; color: string; icon: string; index: number;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), index * 80);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div style={{
      opacity: entered ? 1 : 0,
      transform: entered ? "translateY(0)" : "translateY(16px)",
      transition: "opacity 0.4s cubic-bezier(0.23,1,0.32,1), transform 0.4s cubic-bezier(0.23,1,0.32,1)",
    }}
      className="bg-[#0d1530] border border-white/8 rounded-xl p-4 hover:border-white/15 transition-colors duration-200 group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg">{icon}</span>
        <div className="w-1.5 h-1.5 rounded-full opacity-60" style={{ background: color }} />
      </div>
      <div className={`text-2xl font-black mb-1 transition-colors duration-300`} style={{ color }}>
        {entered ? <AnimatedNumber value={value} /> : "0"}
      </div>
      <div className="text-xs text-white/35">{label}</div>
    </div>
  );
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-[#0d1530] border border-white/8 rounded-2xl p-6 animate-pulse">
      <div className="flex gap-4 mb-4">
        <div className="w-14 h-14 rounded-full shimmer-bg" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 shimmer-bg rounded-lg w-3/4" />
          <div className="h-3 shimmer-bg rounded-lg w-1/2" />
          <div className="h-3 shimmer-bg rounded-lg w-2/3" />
        </div>
        <div className="w-16 h-16 rounded-full shimmer-bg" />
      </div>
      <div className="h-14 shimmer-bg rounded-xl mb-4" />
      <div className="flex gap-2">
        <div className="flex-1 h-10 shimmer-bg rounded-xl" />
        <div className="w-16 h-10 shimmer-bg rounded-xl" />
      </div>
    </div>
  );
}

// ─── Language Selector (mini) ────────────────────────────────────────────────
function LangSelectorMini() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5">
        <span>{current.flag}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><path d="M5 7L1 3h8L5 7z" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d1b2e] border border-white/20 rounded-xl shadow-2xl overflow-hidden min-w-[140px]">
            {LANGUAGES.map(lang => (
              <button key={lang.code}
                onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${
                  lang.code === i18n.language ? "bg-[#f5a623]/20 text-[#f5a623]" : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}>
                <span>{lang.flag}</span><span>{lang.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Recommended Opportunities ──────────────────────────────────────────────
function RecommendedOpportunities() {
  const { isAuthenticated } = useAuth();
  const recommendedQuery = trpc.matching.getRecommendedOpportunities.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60_000, // 5 min cache — LLM call is expensive
  });

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!recommendedQuery.isLoading) {
      const t = setTimeout(() => setEntered(true), 200);
      return () => clearTimeout(t);
    }
  }, [recommendedQuery.isLoading]);

  const COMPLIANCE_COLORS: Record<string, { border: string; badge: string; label: string }> = {
    green:   { border: "rgba(34,197,94,0.35)",  badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",  label: "Alta Confiabilidade" },
    yellow:  { border: "rgba(234,179,8,0.35)",  badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",    label: "Confiabilidade Média" },
    orange:  { border: "rgba(249,115,22,0.35)", badge: "bg-orange-500/15 text-orange-400 border-orange-500/25",    label: "Necessita Validação" },
    red:     { border: "rgba(239,68,68,0.35)",  badge: "bg-red-500/15 text-red-400 border-red-500/25",             label: "Baixa Confiabilidade" },
    pending: { border: "rgba(107,114,128,0.3)", badge: "bg-gray-500/15 text-gray-400 border-gray-500/25",          label: "Analisando" },
  };

  const TYPE_LABELS: Record<string, string> = {
    offer: "Oferta", demand: "Demanda", investment: "Investimento",
    partnership: "Parceria", distribution: "Distribuição", other: "Outro",
  };

  const getScoreColor = (score: number) =>
    score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#3b82f6";

  return (
    <div className="mt-10" style={{
      opacity: entered ? 1 : 0,
      transform: entered ? "translateY(0)" : "translateY(24px)",
      transition: "opacity 0.5s cubic-bezier(0.23,1,0.32,1), transform 0.5s cubic-bezier(0.23,1,0.32,1)",
    }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl"
          style={{ background: "linear-gradient(135deg, rgba(245,166,35,0.2), rgba(139,92,246,0.2))", border: "1px solid rgba(245,166,35,0.25)" }}>
          <span className="text-lg">✦</span>
        </div>
        <div>
          <h2 className="font-black text-white text-lg leading-tight">Oportunidades Recomendadas para Você</h2>
          <p className="text-xs text-white/35 mt-0.5">Selecionadas por IA com base no seu perfil e interesses</p>
        </div>
      </div>

      {/* Loading skeleton */}
      {recommendedQuery.isLoading && (
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-[#0d1530] border border-white/8 rounded-2xl p-5 animate-pulse">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 shimmer-bg rounded-lg w-3/4" />
                  <div className="h-3 shimmer-bg rounded-lg w-1/2" />
                </div>
                <div className="w-14 h-14 rounded-full shimmer-bg ml-3" />
              </div>
              <div className="h-12 shimmer-bg rounded-xl mb-3" />
              <div className="h-9 shimmer-bg rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {/* Erro da consulta: não é culpa do perfil da usuária */}
      {!recommendedQuery.isLoading && recommendedQuery.isError && (
        <div className="bg-[#0d1530] border border-white/8 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">📡</div>
          <p className="text-white/40 text-sm">Não foi possível carregar as recomendações agora. Tente novamente em instantes.</p>
          <button onClick={() => recommendedQuery.refetch()}
            className="mt-4 px-5 py-2 rounded-xl text-xs font-semibold border border-[#f5a623]/30 text-[#f5a623] hover:bg-[#f5a623]/8 transition-colors">
            Tentar de novo
          </button>
        </div>
      )}

      {/* Lista realmente vazia */}
      {!recommendedQuery.isLoading && !recommendedQuery.isError && (!recommendedQuery.data || recommendedQuery.data.length === 0) && (
        <div className="bg-[#0d1530] border border-white/8 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🔭</div>
          <p className="text-white/40 text-sm">Nenhuma recomendação por enquanto. Novas oportunidades publicadas na rede aparecem aqui.</p>
          <Link href="/opportunities">
            <button className="mt-4 px-5 py-2 rounded-xl text-xs font-semibold border border-[#f5a623]/30 text-[#f5a623] hover:bg-[#f5a623]/8 transition-colors">
              Explorar oportunidades
            </button>
          </Link>
        </div>
      )}

      {/* Recommendation cards */}
      {!recommendedQuery.isLoading && recommendedQuery.data && recommendedQuery.data.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {recommendedQuery.data.map((opp, i) => {
            const level = (opp.complianceLevel ?? "pending") as string;
            const compliance = COMPLIANCE_COLORS[level] ?? COMPLIANCE_COLORS.pending;
            const scoreColor = getScoreColor(opp.compatibilityScore);
            return (
              <div key={opp.id}
                style={{
                  opacity: entered ? 1 : 0,
                  transform: entered ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
                  transition: `opacity 0.4s cubic-bezier(0.23,1,0.32,1) ${i * 60}ms, transform 0.4s cubic-bezier(0.23,1,0.32,1) ${i * 60}ms`,
                  borderColor: compliance.border,
                }}
                className="bg-[#0d1530] border rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-black/30 transition-all duration-300 group">

                {/* Compliance top stripe */}
                <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${compliance.border.replace("0.35", "0.8")}, transparent)` }} />

                <div className="p-5">
                  {/* Header row */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-base leading-tight truncate group-hover:text-[#f5a623] transition-colors">
                        {opp.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {opp.sector && (
                          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/50">
                            {opp.sector}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/50">
                          {TYPE_LABELS[opp.type] ?? opp.type}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full border text-xs ${compliance.badge}`}>
                          {compliance.label}
                        </span>
                      </div>
                    </div>

                    {/* Compatibility score ring */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      <svg width={56} height={56} style={{ transform: "rotate(-90deg)" }}>
                        <circle cx={28} cy={28} r={22} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
                        <circle cx={28} cy={28} r={22} fill="none" stroke={scoreColor} strokeWidth={4}
                          strokeDasharray={`${(opp.compatibilityScore / 100) * (2 * Math.PI * 22)} ${2 * Math.PI * 22}`}
                          strokeLinecap="round"
                          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.23,1,0.32,1)" }} />
                        <text x={28} y={28} textAnchor="middle" dominantBaseline="central"
                          style={{ transform: "rotate(90deg)", transformOrigin: "28px 28px", fill: scoreColor, fontSize: 11, fontWeight: 700 }}>
                          {opp.compatibilityScore}%
                        </text>
                      </svg>
                      <span className="text-[9px] font-semibold" style={{ color: scoreColor }}>compatível</span>
                    </div>
                  </div>

                  {/* AI compatibility reason */}
                  <div className="bg-[#f5a623]/6 border border-[#f5a623]/18 rounded-xl p-3 mb-3 text-xs text-white/60 leading-relaxed group-hover:border-[#f5a623]/30 group-hover:bg-[#f5a623]/10 transition-all duration-300">
                    <span className="text-[#f5a623] font-semibold">✦ IA: </span>{opp.compatibilityReason}
                  </div>

                  {/* CTA */}
                  <Link href={`/opportunities/${opp.id}`}>
                    <button className="w-full py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-[#f5a623]/90 to-[#ffd166]/90 hover:from-[#f5a623] hover:to-[#ffd166] text-[#060e1a] transition-all duration-200 active:scale-95 shadow-md shadow-[#f5a623]/15">
                      Ver Oportunidade →
                    </button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Deal Rooms Tab ─────────────────────────────────────────────────────────
function DealRoomsTab() {
  const { isAuthenticated, user } = useAuth();
  const isGold = user?.role === "gold" || user?.role === "president" || user?.role === "admin";
  const [viewAll, setViewAll] = useState(false);

  const { data: rooms = [], isLoading } = trpc.dealRoom.listRooms.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });
  const { data: allRooms = [], isLoading: isLoadingAll } = trpc.dealRoom.listAllRooms.useQuery(undefined, {
    enabled: isAuthenticated && isGold && viewAll,
    refetchInterval: 30_000,
  });

  const displayRooms = (isGold && viewAll ? allRooms : rooms) as any[];
  const isLoadingDisplay = isGold && viewAll ? isLoadingAll : isLoading;

  if (isLoadingDisplay) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-[#0d1530] border border-white/8 rounded-2xl p-5 animate-pulse">
            <div className="h-4 bg-white/10 rounded w-1/3 mb-2" />
            <div className="h-3 bg-white/5 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle Ouro: Minhas Salas / Todas as Salas */}
      {isGold && (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setViewAll(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
              !viewAll ? "bg-amber-400/20 text-amber-300 border border-amber-400/30" : "text-white/40 hover:text-white/60"
            }`}
          >
            Minhas Salas
          </button>
          <button
            onClick={() => setViewAll(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
              viewAll ? "bg-amber-400/20 text-amber-300 border border-amber-400/30" : "text-white/40 hover:text-white/60"
            }`}
          >
            ⭐ Todas as Salas (Ouro)
          </button>
        </div>
      )}

      {displayRooms.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🔐</div>
          <h3 className="text-xl font-black mb-2">{viewAll ? "Nenhuma Deal Room na plataforma" : "Nenhum Deal Room ainda"}</h3>
          <p className="text-white/40 text-sm max-w-sm mx-auto mb-6">
            {viewAll ? "Ainda não há salas de negociação criadas na plataforma." : "Quando você demonstrar interesse em uma oportunidade, a sala de negociação privada aparecerá aqui."}
          </p>
          {!viewAll && (
            <Link href="/opportunities">
              <button className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95">
                Ver Oportunidades
              </button>
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="text-white/40 text-xs mb-2">
            {viewAll ? `${displayRooms.length} sala(s) na plataforma` : "Salas de negociação privadas com NDA ativo"}
          </p>
          {displayRooms.map((room: any) => {
            const statusColor = room.status === "active" ? "#22c55e" : room.status === "awaiting_nda" ? "#eab308" : "#9ca3af";
            const statusLabel = room.status === "active" ? "Ativa" : room.status === "awaiting_nda" ? "Aguardando NDA" : "Encerrada";
            return (
              <Link key={room.id} href={`/deal-room/${room.id}`}>
                <div className="bg-[#0d1530] border border-white/8 hover:border-amber-500/30 rounded-2xl p-5 cursor-pointer transition-all duration-200 hover:bg-[#0d1530]/80">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <span className="text-amber-400 text-xs">🔐</span>
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{room.opportunityTitle}</p>
                        <p className="text-white/40 text-xs">com {room.otherPartyName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
                      <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
                    </div>
                  </div>
                  {room.status === "awaiting_nda" && (
                    <p className="text-amber-400/60 text-xs mt-2">⚠️ Aguardando assinatura do NDA para ativar a sala</p>
                  )}
                </div>
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t } = useTranslation();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"matches" | "connections" | "dealrooms" | "profile">("matches");
  const [tabVisible, setTabVisible] = useState(true);

  const profileQuery = trpc.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const matchesQuery = trpc.matches.list.useQuery({ limit: 20 }, { enabled: isAuthenticated });
  const statsQuery = trpc.matches.list.useQuery({ limit: 50 }, { enabled: isAuthenticated, select: (data) => ({
    total: data.length,
    unseen: data.filter(m => !m.userSeen).length,
    highScore: data.filter(m => m.overallScore >= 80).length,
    avgScore: data.length > 0 ? Math.round(data.reduce((s, m) => s + m.overallScore, 0) / data.length) : 0,
    distribution: [0,1,2,3,4].map(b => data.filter(m => Math.min(4, Math.floor(m.overallScore / 20)) === b).length),
  }) });
  const connectionsQuery = trpc.connections.list.useQuery(undefined, { enabled: isAuthenticated });

  const dismissMutation = trpc.matches.dismiss.useMutation({
    onSuccess: () => { matchesQuery.refetch(); toast.success(t("dashboard.dismiss")); },
  });
  const interestMutation = trpc.connections.send.useMutation({
    onSuccess: () => { toast.success(t("dashboard.interestSent")); connectionsQuery.refetch(); },
    onError: (err) => toast.error(err.message || t("dashboard.interestError")),
  });
  const respondMutation = trpc.connections.respond.useMutation({
    onSuccess: (_, vars) => { toast.success(vars.accept ? t("dashboard.connectionAccepted") : t("dashboard.connectionDeclined")); connectionsQuery.refetch(); },
  });
  const regenerateMutation = trpc.matches.regenerate.useMutation({
    onSuccess: (data) => { toast.success(data.count > 0 ? t("dashboard.newMatches", { count: data.count }) : t("dashboard.analysisDone")); matchesQuery.refetch(); },
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => { logout(); navigate("/"); },
  });

  useEffect(() => {
    if (!loading && isAuthenticated && profileQuery.data === null) navigate("/onboarding");
  }, [loading, isAuthenticated, profileQuery.data, navigate]);

  const switchTab = (tab: typeof activeTab) => {
    if (tab === activeTab) return;
    setTabVisible(false);
    setTimeout(() => { setActiveTab(tab); setTabVisible(true); }, 180);
  };

  if (loading || profileQuery.isLoading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 border-2 border-[#f5a623]/20 border-t-[#f5a623] rounded-full animate-spin mx-auto mb-5" />
          <div className="text-white/50 text-sm font-medium">{t("dashboard.loading")}</div>
          <div className="text-white/20 text-xs mt-1">{t("dashboard.loadingDesc")}</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold mb-4 text-white">{t("dashboard.restricted")}</h2>
          <a href={getLoginUrl()}><Button className="bg-[#f5a623] text-[#060e1a] font-bold hover:bg-[#e09520]">{t("auth.login")}</Button></a>
        </div>
      </div>
    );
  }

  const stats = statsQuery.data;
  const matches = matchesQuery.data || [];
  const connections = connectionsQuery.data || [];
  const profileData = profileQuery.data;
  const profile = profileData?.profile;
  const pendingConnections = connections.filter((c) => c.status === "pending" && c.recipientId === user?.id);

  return (
    <div className="min-h-screen bg-transparent text-white">

      {/* ─── NAVBAR ─── */}
      <nav className="border-b border-white/[0.06] px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40 bg-[#060e1a]/90 backdrop-blur-2xl">
        {/* O logo levava para a landing e tirava a usuária do app sem querer. */}
        <Link href="/dashboard">
          <span className="text-xl font-black cursor-pointer tracking-tight">
            <span className="text-white">MMM</span><span className="text-[#f5a623]">OS</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {pendingConnections.length > 0 && (
            <button onClick={() => switchTab("connections")}
              className="text-xs text-[#f5a623] border border-[#f5a623]/30 px-3 py-1.5 rounded-full bg-[#f5a623]/5 hover:bg-[#f5a623]/10 transition-colors animate-pulse">
              {pendingConnections.length} pendente{pendingConnections.length > 1 ? "s" : ""}
            </button>
          )}

          <GlobalMenu />

          <NotificationBell />
          <LangSelectorMini />
          <Link href="/profile">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[#060e1a] font-black text-sm cursor-pointer hover:scale-105 transition-transform ring-2 ring-transparent hover:ring-[#f5a623]/40"
              style={{ background: "linear-gradient(135deg, #f5a623, #ffd166)" }} title="Meu Perfil">
              {(user?.name || "U")[0].toUpperCase()}
            </div>
          </Link>
        </div>
      </nav>

      {/* ─── BANNER PROMOÇÃO OURO ─── */}
      <GoldPromotionBanner userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* ─── HEADER ─── */}
        <div className="mb-8 animate-fade-in-up">
          <h1 className="text-3xl font-black mb-1">
            {t("dashboard.title")}, {profile?.displayName || user?.name || ""} 👋
          </h1>
          <p className="text-white/40">
            {stats?.unseen
              ? <><span className="text-[#f5a623] font-semibold">{stats.unseen} novo{stats.unseen > 1 ? 's' : ''} match{stats.unseen > 1 ? 'es' : ''}</span> esperando pela sua atenção</>
              : stats?.total && stats.total > 0
                ? `${stats.total} oportunidade${stats.total > 1 ? 's' : ''} compatível${stats.total > 1 ? 'is' : ''} encontrada${stats.total > 1 ? 's' : ''} para você`
                : 'Bem-vindo ao MMM OS — gere seus primeiros matches abaixo'}
          </p>
        </div>

        {/* ─── STATS ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: t("dashboard.matches"), value: stats?.total ?? 0, color: "#f5a623", icon: "🎯" },
            { label: t("dashboard.compatibility"), value: stats?.avgScore ?? 0, color: "#3b82f6", icon: "📊" },
            { label: t("dashboard.topMatches"), value: stats?.highScore ?? 0, color: "#10b981", icon: "⭐" },
            { label: t("dashboard.connections"), value: connections.filter(c => c.status === "accepted").length, color: "#8b5cf6", icon: "🤝" },
          ].map((s, i) => (
            <StatCard key={s.label} {...s} index={i} />
          ))}
        </div>

        {/* ─── TABS ─── */}
        <div className="flex gap-1 mb-6 bg-white/4 rounded-xl p-1 w-fit border border-white/5 flex-wrap">
          {(["matches", "connections", "dealrooms", "profile"] as const).map(tab => (
            <button key={tab} onClick={() => switchTab(tab as any)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab
                  ? "bg-[#f5a623] text-[#060e1a] font-bold shadow-md shadow-[#f5a623]/20"
                  : "text-white/45 hover:text-white hover:bg-white/5"
              }`}>
              {tab === "matches"
                ? `${t("dashboard.matches")}${matches.length > 0 ? ` (${matches.length})` : ""}`
                : tab === "connections"
                  ? `${t("dashboard.connections")}${connections.length > 0 ? ` (${connections.length})` : ""}`
                  : tab === "dealrooms"
                  ? "🔐 Deal Rooms"
                  : t("dashboard.profile")}
            </button>
          ))}
        </div>

        {/* ─── TAB CONTENT ─── */}
        <div style={{
          opacity: tabVisible ? 1 : 0,
          transform: tabVisible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.18s ease, transform 0.18s cubic-bezier(0.23,1,0.32,1)",
        }}>

          {/* TAB: MATCHES */}
          {activeTab === "matches" && (
            <div>
              {stats && stats.total > 0 && (
                <div className="bg-[#0d1530] border border-white/8 rounded-2xl p-6 mb-6 animate-fade-in-scale">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="font-bold text-white">{t("dashboard.distribution")}</h2>
                      <p className="text-xs text-white/35 mt-0.5">{t("dashboard.distributionDesc")}</p>
                    </div>
                    <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border border-white/15 text-white/50 hover:border-white/30 hover:text-white transition-all duration-200 disabled:opacity-40">
                      <span className={regenerateMutation.isPending ? "animate-spin" : ""}>↻</span>
                      {regenerateMutation.isPending ? t("dashboard.analyzing") : t("dashboard.regenerate")}
                    </button>
                  </div>
                  <DistributionChart data={stats.distribution} />
                </div>
              )}

              {matchesQuery.isLoading ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
                </div>
              ) : matches.length === 0 ? (
                <div className="text-center py-20 animate-fade-in-up">
                  <div className="text-6xl mb-5">🔍</div>
                  <h3 className="text-2xl font-black mb-2">{t("dashboard.noMatches")}</h3>
                  <p className="text-white/40 mb-8 max-w-sm mx-auto">{t("dashboard.noMatchesDesc")}</p>
                  <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}
                    className="px-8 py-3 rounded-xl font-bold bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95 shadow-lg shadow-[#f5a623]/20 disabled:opacity-60">
                    {regenerateMutation.isPending ? t("dashboard.analyzing") : t("dashboard.generateMatches")}
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {matches.map((match, i) => (
                    <MatchCard key={match.matchId} match={match} index={i}
                      onInterest={(uid) => interestMutation.mutate({ targetUserId: uid })}
                      onDismiss={(mid) => dismissMutation.mutate({ matchId: mid })} />
                  ))}
                </div>
              )}

              {/* ─── OPORTUNIDADES RECOMENDADAS ─── */}
              <RecommendedOpportunities />
            </div>
          )}

          {/* TAB: CONNECTIONS */}
          {activeTab === "connections" && (
            <div className="space-y-3">
              {connections.length === 0 ? (
                <div className="text-center py-20 animate-fade-in-up">
                  <div className="text-6xl mb-5">🤝</div>
                  <h3 className="text-2xl font-black mb-2">{t("dashboard.noMatches")}</h3>
                  <p className="text-white/40 mb-8 max-w-sm mx-auto">{t("dashboard.noMatchesDesc")}</p>
                  <button onClick={() => switchTab("matches")}
                    className="px-8 py-3 rounded-xl font-bold bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95">
                    {t("dashboard.matches")}
                  </button>
                </div>
              ) : connections.map((conn, i) => (
                <div key={conn.id}
                  style={{
                    opacity: 1,
                    animation: `fadeInScale 0.35s cubic-bezier(0.23,1,0.32,1) ${i * 0.06}s both`,
                  }}
                  className="bg-[#0d1530] border border-white/8 rounded-2xl p-5 flex items-center gap-4 hover:border-white/15 transition-colors duration-200">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-[#060e1a] font-black flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #f5a623, #ffd166)" }}>
                    {(conn.displayName || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{conn.displayName}</div>
                    <div className="text-sm text-white/40">{conn.primarySpecialty} · {conn.city}</div>
                    {conn.message && <div className="text-xs text-white/25 mt-1 truncate">"{conn.message}"</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {conn.status === "pending" && conn.recipientId === user?.id ? (
                      <>
                        <button onClick={() => respondMutation.mutate({ connectionId: conn.id, accept: true })}
                          className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-400 hover:bg-emerald-500 text-black transition-all duration-200 active:scale-95">
                          {t("dashboard.accept")}
                        </button>
                        <button onClick={() => respondMutation.mutate({ connectionId: conn.id, accept: false })}
                          className="px-4 py-2 rounded-xl text-xs font-medium border border-white/15 text-white/50 hover:border-white/30 hover:text-white transition-all duration-200">
                          {t("dashboard.decline")}
                        </button>
                      </>
                    ) : (
                      <Badge className={
                        conn.status === "accepted" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/25"
                          : conn.status === "pending" ? "bg-[#f5a623]/15 text-[#f5a623] border-[#f5a623]/25"
                            : "bg-white/8 text-white/35 border-white/15"
                      }>
                        {conn.status === "accepted" ? t("dashboard.connected") : conn.status === "pending" ? t("dashboard.pending") : t("dashboard.declined")}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: DEAL ROOMS */}
          {activeTab === "dealrooms" && (
            <DealRoomsTab />
          )}

          {/* TAB: PROFILE */}
          {activeTab === "profile" && (
            <div className="space-y-5">
              {profile ? (
                <>
                  <div className="bg-[#0d1530] border border-white/8 rounded-2xl p-6 animate-fade-in-scale">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-18 h-18 w-[72px] h-[72px] rounded-full flex items-center justify-center text-[#060e1a] font-black text-2xl flex-shrink-0"
                        style={{ background: "linear-gradient(135deg, #f5a623, #ffd166)" }}>
                        {(profile.displayName || "U")[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-black">{profile.displayName}</h2>
                        <div className="text-white/40 text-sm">{profile.currentRole}{profile.currentRole && profile.city && " · "}{profile.city}</div>
                        <div className="text-xs text-white/25 mt-0.5">{profile.primarySpecialty}</div>
                      </div>
                        <div className="text-right">
                        <div className="text-3xl font-black text-[#f5a623]">{profile.profileCompleteness}%</div>
                        <div className="text-xs text-white/35">{t("dashboard.profileComplete")}</div>
                      </div>
                    </div>

                    {/* Completeness bar */}
                    <div className="h-2 bg-white/8 rounded-full overflow-hidden mb-5">
                      <div className="h-full rounded-full relative overflow-hidden"
                        style={{ width: `${profile.profileCompleteness}%`, background: "linear-gradient(90deg, #f5a623, #ffd166)", transition: "width 1.2s cubic-bezier(0.23,1,0.32,1)" }}>
                        <div className="absolute inset-0 shimmer-bg opacity-40" />
                      </div>
                    </div>

                    {profile.bio && (
                      <p className="text-white/55 text-sm leading-relaxed mb-5 p-4 bg-white/3 rounded-xl border border-white/5">
                        "{profile.bio}"
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {[
                        { label: t("onboarding.specialty"), value: profile.primarySpecialty, icon: "⚡" },
                        { label: t("onboarding.sector"), value: profile.sector, icon: "🌐" },
                        { label: t("onboarding.experience"), value: profile.experienceYears ? `${profile.experienceYears} ${t("dashboard.years")}` : null, icon: "📅" },
                        { label: t("onboarding.workStyle"), value: profile.workStyle, icon: "💼" },
                      ].filter(f => f.value).map((field, i) => (
                        <div key={field.label}
                          style={{ animation: `fadeInScale 0.3s cubic-bezier(0.23,1,0.32,1) ${i * 0.07}s both` }}
                          className="bg-white/4 rounded-xl p-3 border border-white/5 hover:border-white/10 transition-colors">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-sm">{field.icon}</span>
                            <span className="text-xs text-white/30">{field.label}</span>
                          </div>
                          <div className="font-semibold text-sm">{field.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Link href="/onboarding" className="flex-1">
                      <button className="w-full py-3 px-4 rounded-xl font-medium text-sm border border-white/15 text-white/60 hover:border-white/30 hover:text-white transition-all duration-200">
                        ✏️ {t("dashboard.editProfile")}
                      </button>
                    </Link>
                    <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}
                      className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95 shadow-md shadow-[#f5a623]/15 disabled:opacity-60">
                      {regenerateMutation.isPending ? t("dashboard.analyzing") : t("dashboard.reanalyze")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-20 animate-fade-in-up">
                  <div className="text-6xl mb-5">👤</div>
                  <h3 className="text-2xl font-black mb-2">{t("dashboard.noProfile")}</h3>
                  <p className="text-white/40 mb-8">{t("dashboard.noProfileDesc")}</p>
                  <Link href="/onboarding">
                    <button className="px-8 py-3 rounded-xl font-bold bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95">
                      {t("dashboard.createProfile")}
                    </button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
