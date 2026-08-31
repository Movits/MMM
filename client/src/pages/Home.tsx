import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n";
import { trpc } from "@/lib/trpc";
import {
  Briefcase, HandCoins, GraduationCap, Handshake, Rocket, Lightbulb,
  Lock, ShieldCheck, BadgeCheck, KeyRound,
  UserRound, BrainCircuit, Zap, Sparkles, ArrowRight, ChevronDown, Star, Send,
} from "lucide-react";

// Imagem do hero (gerada localmente — client/public/images)
const HERO_IMG = "/images/hero-women.svg";

// Animated counter hook
function useCounter(target: number, duration = 2000, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return count;
}

// Intersection observer hook
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Rótulo de seção minimalista
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <span className="h-px w-8 bg-[#f5a623]/40" />
      <span className="text-[#f5a623] text-xs font-bold uppercase tracking-[0.25em]">{children}</span>
      <span className="h-px w-8 bg-[#f5a623]/40" />
    </div>
  );
}

// Language Selector Component
function LanguageSelector() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors duration-200 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
      >
        <span className="text-base">{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-[#0a1424]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden min-w-[170px] p-1.5"
            style={{ animation: "fadeInDown 0.2s cubic-bezier(0.23,1,0.32,1) both" }}>
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 text-sm rounded-xl transition-colors duration-150 text-left
                  ${lang.code === i18n.language
                    ? "bg-[#f5a623]/15 text-[#f5a623]"
                    : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span>{lang.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────
// Respostas fixas: abrir uma pergunta não pode custar uma chamada de IA nem
// depender dela estar no ar. A caixa "Pergunte à IA" continua logo abaixo
// para dúvidas fora desta lista.
const FAQ_ITEMS = [
  {
    q: "Quais são os níveis de membro da plataforma?",
    a: "São três: Bronze, Prata e Ouro. Toda conta nova começa no Bronze e já pode montar a base de contatos, participar de reuniões e explorar as oportunidades públicas. O Prata vem com a verificação de identidade. O Ouro é o nível de maior confiança e abre as oportunidades confidenciais.",
  },
  {
    q: "Como funciona o NDA na Deal Room?",
    a: "Antes de qualquer conversa dentro da Deal Room, as duas partes assinam um acordo de confidencialidade dentro da própria plataforma. A sala só é liberada depois das duas assinaturas, e tudo que for trocado ali fica protegido pelo acordo.",
  },
  {
    q: "Como funciona o processo de Deal Room?",
    a: "Você demonstra interesse em uma oportunidade e, quando a outra parte aceita, a plataforma cria uma sala privada para vocês duas. Lá dentro ficam o chat e os documentos do negócio, tudo condicionado ao NDA assinado. A ideia é sair da conversa solta e ir para um espaço com regra clara.",
  },
  {
    q: "O que é o nível Ouro e como consigo?",
    a: "O Ouro identifica as usuárias de maior confiança da rede. Quem tem o selo enxerga também as oportunidades confidenciais e vê quem demonstrou interesse nas suas publicações. A concessão passa pela governança da plataforma, que considera a verificação de identidade e a participação na comunidade.",
  },
  {
    q: "Quais oportunidades posso encontrar na plataforma?",
    a: "De vários tipos: ofertas de produtos e serviços, demandas de quem procura fornecedor, busca de investimento, parcerias comerciais e canais de distribuição. Todas passam por uma análise de compliance no momento da publicação e por validação da moderação antes de ficarem públicas.",
  },
  {
    q: "Como a IA faz o match entre perfis e oportunidades?",
    a: "O sistema compara os perfis em dimensões como especialidade, setor, objetivos, localização, valores e capacidade de investimento, e calcula um índice de compatibilidade. Para as conexões mais fortes, a IA escreve uma explicação de por que aquela parceria faz sentido, para você decidir com contexto.",
  },
];

function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [customQ, setCustomQ] = useState("");
  const [customAnswer, setCustomAnswer] = useState("");
  const [customLoading, setCustomLoading] = useState(false);
  const faqMutation = trpc.faq.ask.useMutation();

  const handleToggle = (idx: number) => {
    setOpenIdx(openIdx === idx ? null : idx);
  };

  const handleCustom = async () => {
    if (!customQ.trim()) return;
    setCustomLoading(true);
    setCustomAnswer("");
    try {
      const res = await faqMutation.mutateAsync({ question: customQ });
      setCustomAnswer(typeof res.answer === 'string' ? res.answer : String(res.answer));
    } catch { setCustomAnswer("Não foi possível processar sua pergunta. Tente novamente."); }
    setCustomLoading(false);
  };

  return (
    <section id="faq" className="py-28 relative">
      <div className="relative container mx-auto px-6 max-w-3xl">
        <div className="text-center mb-14">
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
            Tire suas <span className="text-[#f5a623]">dúvidas</span>
          </h2>
          <p className="text-white/40 text-lg">As respostas para as perguntas mais comuns. E se a sua não estiver aqui, pergunte à IA logo abaixo.</p>
        </div>

        {/* Perguntas pré-definidas */}
        <div className="space-y-2.5 mb-8">
          {FAQ_ITEMS.map((item, idx) => (
            <div key={idx} className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden transition-all duration-200 hover:border-white/15">
              <button
                onClick={() => handleToggle(idx)}
                className="w-full flex items-center justify-between px-6 py-4 text-left"
              >
                <span className="text-white/90 font-medium text-sm md:text-base">{item.q}</span>
                <span className={`text-[#f5a623] text-xl font-bold transition-transform duration-200 flex-shrink-0 ml-4 ${openIdx === idx ? 'rotate-45' : ''}`}>+</span>
              </button>
              {openIdx === idx && (
                <div className="px-6 pb-5">
                  <p className="text-white/60 text-sm leading-relaxed whitespace-pre-line">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Campo de pergunta personalizada */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6">
          <p className="text-white/50 text-sm mb-3 font-medium">Tem outra dúvida? Pergunte à IA:</p>
          <div className="flex gap-3">
            <input
              type="text"
              value={customQ}
              onChange={e => setCustomQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustom()}
              placeholder="Ex: Como funciona a verificação de identidade?"
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/25 outline-none focus:border-[#f5a623]/50 transition-colors"
            />
            <button
              onClick={handleCustom}
              disabled={customLoading || !customQ.trim()}
              className="bg-[#f5a623] hover:bg-[#e09520] disabled:opacity-40 text-[#060e1a] font-bold px-5 py-2.5 rounded-xl text-sm transition-all duration-200 active:scale-95 flex-shrink-0 flex items-center gap-2"
            >
              {customLoading ? (
                <div className="w-4 h-4 border-2 border-[#060e1a]/40 border-t-[#060e1a] rounded-full animate-spin" />
              ) : <><Send className="w-3.5 h-3.5" /> Perguntar</>}
            </button>
          </div>
          {customAnswer && (
            <div className="mt-4 p-4 bg-[#f5a623]/[0.04] border border-[#f5a623]/15 rounded-xl">
              <p className="text-white/75 text-sm leading-relaxed whitespace-pre-line">{customAnswer}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { ref: statsRef, inView: statsInView } = useInView();
  const { ref: stepsRef, inView: stepsInView } = useInView();
  const { ref: oppsRef, inView: oppsInView } = useInView();

  // Números reais da plataforma — nunca valores fictícios.
  const { data: stats } = trpc.stats.platform.useQuery();
  const users = useCounter(stats?.users ?? 0, 1600, statsInView && !!stats);
  const opps = useCounter(stats?.opportunities ?? 0, 1600, statsInView && !!stats);
  const countries = useCounter(stats?.countries ?? 0, 1400, statsInView && !!stats);
  const connections = useCounter(stats?.connections ?? 0, 1600, statsInView && !!stats);

  const [activeStep, setActiveStep] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };
  useEffect(() => {
    if (!stepsInView) return;
    const interval = setInterval(() => setActiveStep(p => (p + 1) % 3), 2500);
    return () => clearInterval(interval);
  }, [stepsInView]);

  const steps = [
    { num: "01", Icon: UserRound, title: t("steps.step1.title"), desc: t("steps.step1.desc") },
    { num: "02", Icon: BrainCircuit, title: t("steps.step2.title"), desc: t("steps.step2.desc") },
    { num: "03", Icon: Zap, title: t("steps.step3.title"), desc: t("steps.step3.desc") },
  ];

  const opportunityTypes = [
    { Icon: Briefcase, key: "society" },
    { Icon: HandCoins, key: "investment" },
    { Icon: GraduationCap, key: "mentorship" },
    { Icon: Handshake, key: "partnership" },
    { Icon: Rocket, key: "projects" },
    { Icon: Lightbulb, key: "jobs" },
  ];

  return (
    <div className="min-h-screen bg-[#060b14] text-white overflow-x-hidden antialiased">
      {/* ─── NAVBAR ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.05] bg-[#060b14]/80 backdrop-blur-2xl">
        <div className="flex items-center justify-between px-6 md:px-12 py-3.5">
          <div className="flex items-center gap-2.5">
            <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="text-xl font-extrabold tracking-tight cursor-pointer" aria-label="Voltar ao topo">
              <span className="text-white">MMM</span><span className="text-[#f5a623]">OS</span>
            </a>
            <span className="text-[10px] uppercase tracking-wider bg-[#f5a623]/10 text-[#f5a623] border border-[#f5a623]/20 px-2 py-0.5 rounded-full font-semibold">{t("nav.beta")}</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-white/50">
            <button onClick={() => scrollTo('como-funciona')} className="hover:text-white transition-colors duration-200 cursor-pointer bg-transparent border-none">{t("nav.howItWorks")}</button>
            <button onClick={() => scrollTo('oportunidades')} className="hover:text-white transition-colors duration-200 cursor-pointer bg-transparent border-none">{t("nav.opportunities")}</button>
            <button onClick={() => scrollTo('seguranca')} className="hover:text-white transition-colors duration-200 cursor-pointer bg-transparent border-none">{t("nav.security")}</button>
          </div>
          {/* Mobile hamburger button */}
          <button
            className="md:hidden flex flex-col justify-center items-center w-10 h-10 gap-1.5 bg-transparent border-none cursor-pointer z-50"
            onClick={() => setMobileMenuOpen(o => !o)}
            aria-label="Menu"
          >
            <span className={`block w-6 h-0.5 bg-white transition-all duration-300 origin-center ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-6 h-0.5 bg-white transition-all duration-300 ${mobileMenuOpen ? 'opacity-0 scale-x-0' : ''}`} />
            <span className={`block w-6 h-0.5 bg-white transition-all duration-300 origin-center ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
          <div className="hidden md:flex items-center gap-3">
            <LanguageSelector />
            {isAuthenticated ? (
              <Link href="/dashboard">
                <button className="bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-5 py-2 rounded-xl text-sm transition-all duration-200 active:scale-95">
                  {t("nav.myDashboard")}
                </button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-white/50 hover:text-white transition-colors duration-200">{t("nav.login")}</Link>
                <Link href="/register">
                  <button className="bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-5 py-2 rounded-xl text-sm transition-all duration-200 active:scale-95">
                    {t("nav.startFree")}
                  </button>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ─── MOBILE MENU OVERLAY ─── */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-all duration-300 ${mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(6,11,20,0.97)', backdropFilter: 'blur(16px)' }}
      >
        <div className={`flex flex-col items-center justify-center h-full gap-8 transition-all duration-300 ${mobileMenuOpen ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
          <button onClick={() => scrollTo('como-funciona')} className="text-2xl font-bold text-white hover:text-[#f5a623] transition-colors duration-200 bg-transparent border-none cursor-pointer">{t("nav.howItWorks")}</button>
          <button onClick={() => scrollTo('oportunidades')} className="text-2xl font-bold text-white hover:text-[#f5a623] transition-colors duration-200 bg-transparent border-none cursor-pointer">{t("nav.opportunities")}</button>
          <button onClick={() => scrollTo('seguranca')} className="text-2xl font-bold text-white hover:text-[#f5a623] transition-colors duration-200 bg-transparent border-none cursor-pointer">{t("nav.security")}</button>
          <LanguageSelector />
          <div className="w-16 h-px bg-white/15 my-2" />
          {isAuthenticated ? (
            <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)}>
              <button className="bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-8 py-3 rounded-xl text-lg transition-all duration-200 active:scale-95">
                {t("nav.myDashboard")}
              </button>
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                <span className="text-xl text-white/60 hover:text-white transition-colors duration-200">{t("nav.login")}</span>
              </Link>
              <Link href="/register" onClick={() => setMobileMenuOpen(false)}>
                <button className="bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-8 py-3 rounded-xl text-lg transition-all duration-200 active:scale-95">
                  {t("nav.startFree")}
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-24 pb-16">
        {/* glow sutil */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 45% at 75% 40%, rgba(245,166,35,0.07) 0%, transparent 70%)" }} />

        <div className="relative z-10 container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-14 items-center max-w-6xl mx-auto">
            {/* Texto */}
            <div>
              <div className="inline-flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] rounded-full px-4 py-1.5 mb-8 text-xs text-white/60 font-medium"
                style={{ animation: "fadeInDown 0.8s cubic-bezier(0.23,1,0.32,1) both" }}>
                <span className="w-1.5 h-1.5 bg-[#f5a623] rounded-full animate-pulse" />
                {t("hero.badge")}
              </div>

              <h1 className="text-4xl md:text-6xl font-extrabold leading-[1.05] mb-6 tracking-tight"
                style={{ animation: "fadeInUp 0.9s cubic-bezier(0.23,1,0.32,1) 0.1s both" }}>
                <span className="text-white">{t("hero.headline1")} </span>
                <span className="text-[#f5a623]">{t("hero.headline2")}</span>
                <br />
                <span className="text-white">{t("hero.headline3")} </span>
                <span className="text-white/30">{t("hero.headline4")}</span>
              </h1>

              <p className="text-base md:text-lg text-white/45 max-w-xl mb-10 leading-relaxed"
                style={{ animation: "fadeInUp 0.9s cubic-bezier(0.23,1,0.32,1) 0.2s both" }}>
                {t("hero.subtitle")}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-14"
                style={{ animation: "fadeInUp 0.9s cubic-bezier(0.23,1,0.32,1) 0.3s both" }}>
                <Link href={isAuthenticated ? "/dashboard" : "/register"}>
                  <button className="group w-full sm:w-auto bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-7 py-3.5 rounded-2xl text-base transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-2">
                    {t("hero.cta")}
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                </Link>
                <button
                  onClick={() => scrollTo('como-funciona')}
                  className="w-full sm:w-auto border border-white/10 hover:border-white/25 text-white/60 hover:text-white px-7 py-3.5 rounded-2xl text-base transition-all duration-200"
                >
                  {t("hero.ctaSecondary")}
                </button>
              </div>

              {/* Stats minimalistas */}
              <div ref={statsRef} className="flex flex-wrap gap-x-10 gap-y-6"
                style={{ animation: "fadeInUp 0.9s cubic-bezier(0.23,1,0.32,1) 0.4s both" }}>
                {[
                  { value: users.toLocaleString(), label: t("stats.users") },
                  { value: opps.toLocaleString(), label: t("stats.opportunities") },
                  { value: connections.toLocaleString(), label: t("stats.connections") },
                  { value: countries.toLocaleString(), label: "Países representados" },
                ].map((s, i) => (
                  <div key={i}>
                    <div className="text-2xl font-extrabold text-white tracking-tight">{s.value}</div>
                    <div className="text-xs text-white/35 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Imagem */}
            <div className="relative" style={{ animation: "fadeInUp 1s cubic-bezier(0.23,1,0.32,1) 0.25s both" }}>
              <div className="absolute -inset-6 bg-[#f5a623]/[0.06] rounded-[2.5rem] blur-3xl pointer-events-none" />
              <div className="relative rounded-3xl overflow-hidden border border-white/[0.08] shadow-2xl shadow-black/50">
                <img src={HERO_IMG} alt="Três mulheres executivas de terno diante de uma metrópole"
                  className="w-full h-auto block" />
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(180deg, transparent 60%, rgba(6,11,20,0.5) 100%)" }} />
              </div>
              {/* badge flutuante */}
              <div className="absolute -bottom-5 -left-5 bg-[#0a1424]/95 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-4 shadow-xl shadow-black/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#f5a623]/10 border border-[#f5a623]/25 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-[#f5a623]" />
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm leading-none">Match por IA</div>
                    <div className="text-white/40 text-[11px] mt-1.5">Análise em seis critérios</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── COMO FUNCIONA ─── */}
      <section id="como-funciona" className="py-28 relative border-t border-white/[0.04]">
        <div className="relative container mx-auto px-6">
          <div ref={stepsRef} className="text-center mb-16">
            <SectionLabel>{t("steps.title")}</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white">
              {t("steps.subtitle")}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {steps.map((step, i) => (
              <div key={i}
                style={{
                  opacity: stepsInView ? 1 : 0,
                  transform: stepsInView ? "translateY(0)" : "translateY(40px)",
                  transition: `all 0.7s cubic-bezier(0.23,1,0.32,1) ${i * 0.15}s`,
                }}>
                <div className={`relative h-full p-8 rounded-3xl border transition-all duration-300 cursor-default ${activeStep === i
                  ? "bg-[#f5a623]/[0.05] border-[#f5a623]/30"
                  : "bg-white/[0.02] border-white/[0.06] hover:border-white/15"
                  }`}>
                  <div className="flex items-center justify-between mb-6">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-colors duration-300 ${activeStep === i ? "bg-[#f5a623]/15 border-[#f5a623]/30" : "bg-white/[0.03] border-white/[0.07]"}`}>
                      <step.Icon className={`w-5 h-5 transition-colors duration-300 ${activeStep === i ? "text-[#f5a623]" : "text-white/50"}`} />
                    </div>
                    <span className="text-white/15 font-extrabold text-sm tracking-widest">{step.num}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2.5">{step.title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── MOTOR DE IA ─── */}
      <section className="py-28 relative border-t border-white/[0.04]">
        <div className="relative container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
            {/* Mock de match minimalista */}
            <div className="relative">
              <div className="absolute -inset-4 bg-[#f5a623]/[0.05] rounded-[2rem] blur-2xl pointer-events-none" />
              <div className="relative bg-white/[0.02] border border-white/[0.07] rounded-3xl p-7">
                <div className="flex items-center justify-between mb-7">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#f5a623] to-[#ffd166] flex items-center justify-center text-[#060e1a] font-extrabold text-sm">AM</div>
                    <div className="w-8 h-px bg-gradient-to-r from-[#f5a623]/60 to-transparent" />
                    <div className="w-11 h-11 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/70 font-extrabold text-sm">CR</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#f5a623] font-extrabold text-2xl leading-none">94%</div>
                    <div className="text-white/30 text-[10px] uppercase tracking-wider mt-1">{t("testimonials.match")}</div>
                  </div>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-white/25 mb-5">Exemplo ilustrativo</div>
                {[
                  { label: t("aiEngine.dim1"), pct: 92 },
                  { label: t("aiEngine.dim2"), pct: 88 },
                  { label: t("aiEngine.dim3"), pct: 95 },
                  { label: t("aiEngine.dim4"), pct: 79 },
                ].map((item, i) => (
                  <div key={i} className="mb-4 last:mb-0">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-white/50">{item.label}</span>
                      <span className="text-[#f5a623] font-bold">{item.pct}%</span>
                    </div>
                    <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#f5a623] to-[#ffd166] rounded-full transition-all duration-1000"
                        style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="h-px w-8 bg-[#f5a623]/40" />
                <span className="text-[#f5a623] text-xs font-bold uppercase tracking-[0.25em]">{t("aiEngine.label")}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-5">
                {t("aiEngine.title")}
              </h2>
              <p className="text-white/40 leading-relaxed">
                {t("aiEngine.desc")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── TIPOS DE OPORTUNIDADE ─── */}
      <section id="oportunidades" className="py-28 relative border-t border-white/[0.04]">
        <div className="relative container mx-auto px-6">
          <div ref={oppsRef} className="relative text-center mb-16">
            <SectionLabel>{t("nav.opportunities")}</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white">
              {t("opportunities.title")}
            </h2>
            <p className="text-white/40 mt-4 max-w-xl mx-auto">{t("opportunities.subtitle")}</p>
          </div>
          <div className="relative grid grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {opportunityTypes.map((opp, i) => (
              <div key={i}
                className="group p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] hover:border-[#f5a623]/30 hover:bg-[#f5a623]/[0.03] transition-all duration-300 cursor-default"
                style={{
                  opacity: oppsInView ? 1 : 0,
                  transform: oppsInView ? "scale(1)" : "scale(0.95)",
                  transition: `all 0.6s cubic-bezier(0.23,1,0.32,1) ${i * 0.08}s`,
                }}>
                <div className="w-11 h-11 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mb-4 group-hover:border-[#f5a623]/30 transition-colors duration-300">
                  <opp.Icon className="w-5 h-5 text-white/50 group-hover:text-[#f5a623] transition-colors duration-300" />
                </div>
                <div className="font-bold text-white mb-1 text-sm">
                  {t(`opportunities.${opp.key}.label`)}
                </div>
                <div className="text-xs text-white/35 leading-relaxed">
                  {t(`opportunities.${opp.key}.desc`)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SEGURANÇA ─── */}
      <section id="seguranca" className="py-28 relative border-t border-white/[0.04]">
        <div className="relative container mx-auto px-6">
          <div className="max-w-4xl mx-auto text-center">
            <SectionLabel>{t("nav.security")}</SectionLabel>
            <h2 className="text-4xl font-extrabold text-white mb-2">
              {t("security.title")}
            </h2>
            <p className="text-[#f5a623] text-lg font-semibold mb-12">{t("security.subtitle")}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { Icon: Lock, label: t("security.encryption.title"), desc: t("security.encryption.desc") },
                { Icon: ShieldCheck, label: t("security.rateLimit.title"), desc: t("security.rateLimit.desc") },
                { Icon: BadgeCheck, label: t("security.verification.title"), desc: t("security.verification.desc") },
                { Icon: KeyRound, label: t("security.control.title"), desc: t("security.control.desc") },
              ].map((item, i) => (
                <div key={i} className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] text-center hover:border-white/15 transition-colors duration-300">
                  <div className="w-10 h-10 mx-auto rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mb-3">
                    <item.Icon className="w-4.5 h-4.5 text-[#f5a623]" />
                  </div>
                  <div className="font-bold text-white text-sm">{item.label}</div>
                  <div className="text-xs text-white/35 mt-1.5 leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── GOVERNANÇA: BRONZE / PRATA / OURO ─── */}
      <section id="governanca" className="py-28 relative border-t border-white/[0.04]">
        <div className="relative container mx-auto px-6">
          <div className="max-w-4xl mx-auto text-center mb-14">
            <SectionLabel>{t("governance.label")}</SectionLabel>
            <h2 className="text-4xl font-extrabold text-white mb-4">
              {t("governance.title1")}{" "}
              <span className="text-[#f5a623]">{t("governance.title2")}</span>
            </h2>
            <p className="text-white/40 text-lg">
              {t("governance.subtitle")}
            </p>
            <div className="flex justify-center gap-10 mt-8">
              <div className="text-center">
                <div className="text-2xl font-extrabold" style={{ color: "#cd7f32" }}>{stats?.bronze ?? 0}</div>
                <div className="text-xs text-white/35 mt-1">Bronze</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-slate-300">{stats?.silver ?? 0}</div>
                <div className="text-xs text-white/35 mt-1">Prata</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-amber-400">{stats?.gold ?? 0}</div>
                <div className="text-xs text-white/35 mt-1">Ouro</div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {/* BRONZE */}
            <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/[0.06] transition-all duration-300 hover:border-[#cd7f32]/30">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5 border" style={{ background: "rgba(205,127,50,0.08)", borderColor: "rgba(205,127,50,0.25)" }}>
                <BadgeCheck className="w-5 h-5" style={{ color: "#cd7f32" }} />
              </div>
              <h3 className="text-lg font-extrabold mb-3" style={{ color: "#cd7f32" }}>{t("governance.bronze.title")}</h3>
              <p className="text-white/40 text-sm leading-relaxed mb-5">
                {t("governance.bronze.desc")}
              </p>
              <div className="text-xs border-t border-white/[0.06] pt-4 text-white/30">
                {t("governance.bronze.access")}
              </div>
            </div>

            {/* PRATA */}
            <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all duration-300">
              <div className="w-11 h-11 rounded-2xl bg-slate-500/10 border border-slate-400/25 flex items-center justify-center mb-5">
                <ShieldCheck className="w-5 h-5 text-slate-300" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-200 mb-3">{t("governance.silver.title")}</h3>
              <p className="text-white/40 text-sm leading-relaxed mb-5">
                {t("governance.silver.desc")}
              </p>
              <div className="text-xs text-white/30 border-t border-white/[0.06] pt-4">
                {t("governance.silver.access")}
              </div>
            </div>

            {/* OURO */}
            <div className="p-8 rounded-3xl bg-[#f5a623]/[0.04] border border-[#f5a623]/25 hover:border-[#f5a623]/45 transition-all duration-300 relative">
              <div className="absolute top-5 right-5 text-[10px] uppercase tracking-wider font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-full border border-amber-400/25">
                {t("governance.gold.badge")}
              </div>
              <div className="w-11 h-11 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mb-5">
                <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              </div>
              <h3 className="text-lg font-extrabold text-amber-300 mb-3">{t("governance.gold.title")}</h3>
              <p className="text-white/40 text-sm leading-relaxed mb-5">
                {t("governance.gold.desc")}
              </p>
              <div className="text-xs text-amber-400/50 border-t border-amber-400/15 pt-4">
                {t("governance.gold.access")}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA FINAL ─── */}
      <section className="py-28 relative border-t border-white/[0.04] overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 55% 60% at 50% 100%, rgba(245,166,35,0.08) 0%, transparent 70%)" }} />
        <div className="relative container mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-3 tracking-tight">
            {t("cta.title")}
          </h2>
          <p className="text-2xl md:text-3xl font-extrabold text-[#f5a623] mb-10">
            {t("cta.subtitle")}
          </p>
          <Link href={isAuthenticated ? "/dashboard" : "/register"}>
            <button className="group bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-bold px-9 py-4 rounded-2xl text-lg transition-all duration-200 active:scale-[0.97] inline-flex items-center gap-2.5">
              {t("cta.button")}
              <ArrowRight className="w-5 h-5 transition-transform duration-200 group-hover:translate-x-1" />
            </button>
          </Link>
        </div>
      </section>

      {/* ─── FAQ COM IA ─── */}
      <FAQSection />

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/[0.05] py-10">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-white/25 text-sm">
          <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="font-extrabold cursor-pointer" aria-label="Voltar ao topo">
            <span className="text-white/70">MMM</span><span className="text-[#f5a623]">OS</span>
          </a>
          <div className="text-center">
            <div className="text-white/40 text-xs mb-1">{t("footer.tagline")}</div>
            <div>© 2026 MMM OS. {t("footer.rights")}</div>
          </div>
          <div className="flex gap-6">
            {/* O link de contato volta quando houver e-mail ou WhatsApp
                institucional definido pela cliente. */}
            <Link href="/privacidade" className="hover:text-white/60 transition-colors">{t("footer.privacy")}</Link>
            <Link href="/termos" className="hover:text-white/60 transition-colors">{t("footer.terms")}</Link>
          </div>
        </div>
      </footer>

      {/* ─── GLOBAL ANIMATIONS ─── */}
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
