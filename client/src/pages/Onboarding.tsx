import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CheckCircle } from "lucide-react";
import { normalizePrimarySpecialties, togglePrimarySpecialty } from "@shared/specialties";
import { formatCnpj, isValidCnpj } from "@shared/business-registration";
import { sortOptionsAlphabetically, sortTextAlphabetically } from "@shared/option-sorting";

const ONBOARDING_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410557659/M2AGtkvDSSG3DSYigzCwJn/mmm-onboarding-bg-mcfimdUuePtBJ9UjkHJM2G.webp";
const AI_BRAIN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410557659/M2AGtkvDSSG3DSYigzCwJn/mmm-ai-brain-R4DfF6UJK4ZAyunzXxH2AV.webp";

// ─── Tags "O que tenho" ───────────────────────────────────────────────────────
const WHAT_I_HAVE_OPTIONS = [
  { id: "industria", label: "Indústria", icon: "🏭" },
  { id: "fazenda", label: "Fazenda / Agro", icon: "🌾" },
  { id: "laboratorio", label: "Laboratório", icon: "🔬" },
  { id: "tecnologia", label: "Tecnologia", icon: "💻" },
  { id: "investidores", label: "Rede de Investidores", icon: "💰" },
  { id: "acesso_governamental", label: "Acesso Governamental", icon: "🏛️" },
  { id: "commodities", label: "Commodities", icon: "📦" },
  { id: "licencas", label: "Licenças & Certificações", icon: "📋" },
  { id: "imoveis", label: "Imóveis", icon: "🏢" },
  { id: "logistica", label: "Logística", icon: "🚚" },
  { id: "canais_comerciais", label: "Canais Comerciais", icon: "🤝" },
];

// ─── Tags "O que preciso" ─────────────────────────────────────────────────────
const WHAT_I_NEED_OPTIONS = [
  { id: "fornecedores", label: "Fornecedores", icon: "🏪" },
  { id: "investidores", label: "Investidores", icon: "💸" },
  { id: "compradores", label: "Compradores", icon: "🛒" },
  { id: "distribuidores", label: "Distribuidores", icon: "📤" },
  { id: "parceiros", label: "Parceiros Estratégicos", icon: "🤝" },
  { id: "tecnologia", label: "Tecnologia", icon: "⚙️" },
  { id: "financiamento", label: "Financiamento", icon: "🏦" },
  { id: "licencas", label: "Licenças & Aprovações", icon: "✅" },
  { id: "consultoria", label: "Consultoria", icon: "💡" },
];

const INTEREST_SECTORS = [
  "Tecnologia", "Saúde", "Educação", "Finanças", "Agronegócio",
  "Energia", "Varejo", "Imobiliário", "Indústria", "Serviços",
  "Moda", "Alimentação", "Turismo", "Logística", "Jurídico",
  "Beleza & Cosméticos", "Exportação", "Importação", "Infraestrutura",
  "Commodities", "Farmacêutico", "Consultoria", "Marketing",
];

interface FormData {
  displayName: string; age: number | null; city: string; country: string; bio: string;
  primarySpecialty: string; primarySpecialties: string[]; customSpecialty: string; secondarySpecialties: string[]; experienceYears: number | null;
  educationLevel: string; currentRole: string; currentCompany: string;
  seekingTypes: string[]; shortTermGoal: string; longTermGoal: string;
  sector: string; businessInterests: string[]; preferredCompanySize: string;
  openToRemote: boolean; availableForTravel: boolean;
  incomeRange: string; investmentCapacity: string; lookingForInvestment: boolean;
  workStyle: string; values: string[]; languages: string[];
  gender: "" | "male" | "female" | "prefer_not_to_say";
  personType: "" | "individual" | "legal_entity" | "mei";
  companySize: "" | "mei" | "micro" | "small" | "medium" | "large";
  companyCnpj: string;
  customSector: string;
  currentResources: string;
  // Novos campos v2
  company: string; jobTitle: string; activityArea: string;
  institutionalNetwork: string; interestSectors: string[];
  whatIHave: string[]; whatINeed: string[];
}

const INITIAL: FormData = {
  displayName: "", age: null, city: "", country: "BR", bio: "",
  primarySpecialty: "", primarySpecialties: [], customSpecialty: "", secondarySpecialties: [], experienceYears: null,
  educationLevel: "", currentRole: "", currentCompany: "",
  seekingTypes: [], shortTermGoal: "", longTermGoal: "",
  sector: "", businessInterests: [], preferredCompanySize: "",
  openToRemote: false, availableForTravel: false,
  incomeRange: "", investmentCapacity: "none", lookingForInvestment: false,
  workStyle: "", values: [], languages: [],
  gender: "",
  personType: "", companySize: "", companyCnpj: "",
  customSector: "",
  currentResources: "",
  // Novos campos v2
  company: "", jobTitle: "", activityArea: "",
  institutionalNetwork: "", interestSectors: [],
  whatIHave: [], whatINeed: [],
};

// ─── Componentes reutilizáveis ────────────────────────────────────────────────
function CardOption({ selected, onClick, icon, label, desc }: {
  selected: boolean; onClick: () => void; icon: string; label: string; desc?: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`group relative p-4 rounded-xl border text-left transition-all duration-200 active:scale-95 ${selected
        ? "bg-[#f5a623]/15 border-[#f5a623] shadow-lg shadow-[#f5a623]/10"
        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/30"}`}>
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-[#f5a623] rounded-full flex items-center justify-center">
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#060e1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
      <div className="text-2xl mb-2">{icon}</div>
      <div className={`font-semibold text-sm ${selected ? "text-[#f5a623]" : "text-white"}`}>{label}</div>
      {desc && <div className="text-xs text-white/40 mt-0.5">{desc}</div>}
    </button>
  );
}

function TagOption({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 active:scale-95 ${selected
        ? "bg-[#f5a623] border-[#f5a623] text-[#060e1a] font-bold"
        : "bg-white/5 border-white/20 text-white/70 hover:border-white/40 hover:text-white"}`}>
      {label}
    </button>
  );
}

function TagButton({ icon, label, selected, onClick }: {
  icon: string; label: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 active:scale-95 ${
        selected
          ? "bg-[#f5a623]/15 border-[#f5a623]/60 text-[#f5a623] shadow-sm shadow-[#f5a623]/10"
          : "bg-white/3 border-white/10 text-white/50 hover:border-white/25 hover:text-white/75 hover:bg-white/6"
      }`}>
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
      {selected && <CheckCircle size={13} className="text-[#f5a623] ml-auto" />}
    </button>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text", hint, min, max, list, required }: {
  label: string; value: string | number; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; min?: number; max?: number; list?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}{required && <span className="text-[#f5a623]"> *</span>}</label>
      <input type={type} value={value ?? ""} min={min} max={max} list={list}
        inputMode={type === "number" ? "numeric" : undefined}
        onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#f5a623]/60 focus:bg-white/8 transition-all duration-200 text-sm"/>
      {hint && <p className="text-xs text-white/30 mt-1">{hint}</p>}
    </div>
  );
}

function TextareaInput({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#f5a623]/60 focus:bg-white/8 transition-all duration-200 text-sm resize-none"/>
      {hint && <p className="text-xs text-white/30 mt-1">{hint}</p>}
    </div>
  );
}

function SelectInput({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#0d1b2a] border border-white/15 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#f5a623]/60 transition-all duration-200 text-sm">
        <option value="">{placeholder || "..."}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [visible, setVisible] = useState(true);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const municipiosRef = useRef<string[] | null>(null);
  const prefilled = useRef(false);

  // Pre-preenche com o que ja existe: o nome dado no cadastro (users.name) e,
  // num re-onboarding, o perfil salvo. Antes o formulario abria vazio e pedia
  // o nome de novo.
  const profileQuery = trpc.profile.get.useQuery(undefined, { staleTime: 60_000 });
  useEffect(() => {
    if (prefilled.current || !profileQuery.data) return;
    const { user, profile } = profileQuery.data as { user?: { name?: string | null } | null; profile?: Partial<FormData> & { displayName?: string | null; city?: string | null; country?: string | null } | null };
    prefilled.current = true;
    setForm(prev => ({
      ...prev,
      displayName: prev.displayName || profile?.displayName || user?.name || "",
      city: prev.city || profile?.city || "",
      country: profile?.country || prev.country,
    }));
  }, [profileQuery.data]);

  // Sugestoes de cidade (IBGE) so quando o pais e o Brasil: filtra em memoria
  // a partir de 2 letras, ignorando acento, e mostra no maximo 50 opcoes para
  // o datalist nao travar em mobile.
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  useEffect(() => {
    if (form.country !== "BR" || form.city.trim().length < 2) { setCityOptions([]); return; }
    let alive = true;
    const filtrar = (lista: string[]) => {
      const q = norm(form.city.trim());
      if (alive) setCityOptions(lista.filter(m => norm(m).startsWith(q)).slice(0, 50));
    };
    if (municipiosRef.current) filtrar(municipiosRef.current);
    else import("@/data/municipios-br.json").then(mod => {
      municipiosRef.current = mod.default as string[];
      filtrar(municipiosRef.current);
    }).catch(() => {});
    return () => { alive = false; };
  }, [form.city, form.country]);

  // O banco guarda a CHAVE (estavel entre idiomas); o rotulo e so exibicao.
  // Antes era gravado o texto traduzido, e usuarias de idiomas diferentes
  // nunca davam match entre si.
  const SPECIALTIES = [
    { key: "tech", icon: "💻" }, { key: "finance", icon: "📈" },
    { key: "design", icon: "🎨" }, { key: "marketing", icon: "📣" },
    { key: "legal", icon: "⚖️" }, { key: "engineering", icon: "🏗️" },
    { key: "health", icon: "🏥" }, { key: "education", icon: "🎓" },
    { key: "sustainability", icon: "🌱" }, { key: "retail", icon: "🏪" },
    { key: "gastronomy", icon: "🍽️" }, { key: "startups", icon: "🚀" },
  ].map(o => ({ ...o, label: t("onboarding.specialties." + o.key) }));

  // Lista enxugada a partir do QA de 30/08: "Advisor" e "Mentora" eram o
  // mesmo papel, "Socia estrategica" e "Parceira comercial" se sobrepunham, e
  // "Ser mentora" e oferta, nao busca -- virou a pergunta propria logo abaixo.
  const SEEKING_TYPES = [
    { key: "strategic_partner", icon: "🤝" },
    { key: "investor", icon: "💰" },
    { key: "mentor", icon: "🎓" },
    { key: "team", icon: "👥" },
    { key: "job", icon: "💼" },
  ].map(o => ({ ...o, label: t("onboarding.seeking." + o.key), desc: t("onboarding.seeking." + o.key + "_desc") }));

  const SECTORS = [
    "agribusiness", "construction", "education", "energy", "entertainment",
    "financial", "government", "industry", "logistics", "health",
    "technology", "telecom", "tourism", "retail", "other",
  ].map(key => ({ key, label: t("onboarding.sectors." + key) }));
  const OTHER_SECTOR_LABEL = t("onboarding.sectors.other");

  const COMPANY_SIZES = [
    { value: "micro", label: t("onboarding.companySize.micro"), icon: "🌱" },
    { value: "small", label: t("onboarding.companySize.small"), icon: "🏠" },
    { value: "medium", label: t("onboarding.companySize.medium"), icon: "🏢" },
    { value: "large", label: t("onboarding.companySize.large"), icon: "🏙️" },
    { value: "any", label: t("onboarding.companySize.any"), icon: "🌍" },
  ];

  const INCOME_RANGES = [
    { value: "under_3k", label: t("onboarding.income.under_3k"), icon: "🌱" },
    { value: "3k_7k", label: t("onboarding.income.3k_7k"), icon: "📈" },
    { value: "7k_15k", label: t("onboarding.income.7k_15k"), icon: "💼" },
    { value: "15k_30k", label: t("onboarding.income.15k_30k"), icon: "🏆" },
    { value: "30k_plus", label: t("onboarding.income.30k_plus"), icon: "👑" },
  ];

  const INVESTMENT_CAPACITIES = [
    { value: "none", label: t("onboarding.investment.none") },
    { value: "under_10k", label: t("onboarding.investment.under_10k") },
    { value: "10k_50k", label: t("onboarding.investment.10k_50k") },
    { value: "50k_200k", label: t("onboarding.investment.50k_200k") },
    { value: "200k_plus", label: t("onboarding.investment.200k_plus") },
  ];

  const WORK_STYLES = [
    { value: "remote", label: t("onboarding.workStyle.remote"), icon: "🏠" },
    { value: "hybrid", label: t("onboarding.workStyle.hybrid"), icon: "🔄" },
    { value: "onsite", label: t("onboarding.workStyle.onsite"), icon: "🏢" },
    { value: "flexible", label: t("onboarding.workStyle.flexible"), icon: "🌊" },
  ];

  const VALUES_OPTIONS = [
    "innovation", "social_impact", "autonomy", "fast_growth", "stability",
    "purpose", "collaboration", "results", "diversity", "transparency",
    "sustainability", "technical_excellence",
  ].map(key => ({ key, label: t("onboarding.values." + key) }));

  const LANGUAGES_LIST_I18N = [
    "portuguese", "english", "spanish", "french", "german",
    "mandarin", "japanese", "arabic", "italian",
  ].map(key => ({ key, label: t("onboarding.languages." + key) }));

  const EDUCATION_LEVELS = [
    { value: "high_school", label: t("onboarding.education.high_school") },
    { value: "technical", label: t("onboarding.education.technical") },
    { value: "bachelor", label: t("onboarding.education.bachelor") },
    { value: "postgrad", label: t("onboarding.education.postgrad") },
    { value: "master", label: t("onboarding.education.master") },
    { value: "phd", label: t("onboarding.education.phd") },
    { value: "mba", label: t("onboarding.education.mba") },
  ];

  const COUNTRIES = [
    { value: "BR", label: t("onboarding.countries.brazil") },
    { value: "PT", label: t("onboarding.countries.portugal") },
    { value: "US", label: t("onboarding.countries.usa") },
    { value: "AR", label: t("onboarding.countries.argentina") },
    { value: "CL", label: t("onboarding.countries.chile") },
    { value: "MX", label: t("onboarding.countries.mexico") },
    { value: "CO", label: t("onboarding.countries.colombia") },
    { value: "DE", label: t("onboarding.countries.germany") },
    { value: "FR", label: t("onboarding.countries.france") },
    { value: "GB", label: t("onboarding.countries.uk") },
    { value: "ES", label: t("onboarding.countries.spain") },
    { value: "IT", label: t("onboarding.countries.italy") },
    { value: "JP", label: t("onboarding.countries.japan") },
    { value: "CN", label: t("onboarding.countries.china") },
    { value: "IN", label: t("onboarding.countries.india") },
    { value: "AE", label: t("onboarding.countries.uae") },
    { value: "XX", label: t("onboarding.countries.other") },
  ];

  const AI_ANALYSIS_ITEMS = [
    t("onboarding.aiAnalysis.specialty"), t("onboarding.aiAnalysis.goals"),
    t("onboarding.aiAnalysis.income"), t("onboarding.aiAnalysis.location"),
    t("onboarding.aiAnalysis.values"), t("onboarding.aiAnalysis.sectors"),
  ];

  // 8 etapas: Vida & Valores foi integrada a “O que você busca”.
  const STEPS = [
    { id: 1, title: t("onboarding.steps.s1_title"), subtitle: t("onboarding.steps.s1_sub"), icon: "👤" },
    { id: 2, title: t("onboarding.steps.s2_title"), subtitle: t("onboarding.steps.s2_sub"), icon: "⚡" },
    { id: 3, title: t("onboarding.steps.s3_title"), subtitle: t("onboarding.steps.s3_sub"), icon: "🎯" },
    { id: 4, title: t("onboarding.steps.s4_title"), subtitle: t("onboarding.steps.s4_sub"), icon: "🌐" },
    { id: 5, title: t("onboarding.steps.s7_title"), subtitle: t("onboarding.steps.s7_sub"), icon: "🏢" },
    { id: 6, title: t("onboarding.steps.s8_title"), subtitle: t("onboarding.steps.s8_sub"), icon: "✦" },
    { id: 7, title: t("onboarding.steps.s9_title"), subtitle: t("onboarding.steps.s9_sub"), icon: "◈" },
    { id: 8, title: t("onboarding.steps.s6_title"), subtitle: t("onboarding.steps.s6_sub"), icon: "🚀" },
  ];

  const saveOnboarding = trpc.profile.completeOnboarding.useMutation({
    onSuccess: () => {
      toast.success(t("onboarding.successMsg"));
      navigate("/dashboard");
    },
    onError: (err: { message: string }) => {
      toast.error(t("onboarding.errorMsg") + " " + (err.message || ""));
    },
  });

  const set = (key: keyof FormData, value: unknown) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleArray = (key: keyof FormData, value: string) => {
    const arr = (form[key] as string[]) || [];
    set(key, arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]);
  };

  const goTo = (next: number) => {
    const dir = next > step ? "forward" : "back";
    setAnimDir(dir);
    setVisible(false);
    setTimeout(() => { setStep(next); setVisible(true); }, 220);
  };

  const canProceed = () => {
    if (step === 1) return form.displayName.trim().length >= 2 && form.city.trim().length >= 2;
    if (step === 2) {
      const temEspecialidade = form.primarySpecialties.length > 0 || form.customSpecialty.trim().length > 0;
      // Quem se declara MEI ou pessoa juridica tem CNPJ por definicao (A7).
      const precisaCnpj = form.personType === "mei" || form.personType === "legal_entity";
      const cnpjOk = !precisaCnpj || isValidCnpj(form.companyCnpj);
      return temEspecialidade && cnpjOk;
    }
    if (step === 3) return form.seekingTypes.length > 0 && form.incomeRange.length > 0 && form.workStyle.length > 0;
    if (step === 4) return form.sector.length > 0;
    // Etapas profissionais e de ativos são opcionais — sempre pode avançar
    return true;
  };

  const handleSubmit = () => {
    const selectedSpecialties = normalizePrimarySpecialties(form.primarySpecialties, form.customSpecialty);
    saveOnboarding.mutate({
      displayName: form.displayName, age: form.age ?? undefined, city: form.city, country: form.country, bio: form.bio,
      primarySpecialty: selectedSpecialties[0], secondarySpecialties: selectedSpecialties.slice(1),
      experienceYears: form.experienceYears ?? undefined,
      educationLevel: form.educationLevel as "high_school" | "bachelor" | "master" | "phd" | "other" | undefined,
      currentRole: form.currentRole, currentCompany: form.currentCompany,
      // seekingTypes nunca era enviado: o campo alimenta a dimensao "objetivos",
      // que vale 30% do score de match, e ficava vazio para todo mundo.
      seekingTypes: form.seekingTypes,
      sector: form.sector === OTHER_SECTOR_LABEL && form.customSector.trim() ? form.customSector.trim() : form.sector,
      businessInterests: form.businessInterests,
      preferredCompanySize: form.preferredCompanySize as "startup" | "small" | "medium" | "large" | "any" | undefined,
      openToRemote: form.openToRemote, availableForTravel: form.availableForTravel,
      incomeRange: form.incomeRange as "under_3k" | "3k_7k" | "7k_15k" | "15k_30k" | "30k_plus",
      investmentCapacity: form.investmentCapacity as "none" | "under_10k" | "10k_50k" | "50k_200k" | "200k_plus" | undefined,
      lookingForInvestment: form.lookingForInvestment,
      gender: form.gender || undefined,
      personType: form.personType || undefined,
      companySize: form.personType === "mei" ? "mei" : form.companySize || undefined,
      companyCnpj: form.personType !== "individual" ? form.companyCnpj || undefined : undefined,
      currentResources: form.currentResources || undefined,
      workStyle: form.workStyle as "remote" | "hybrid" | "onsite" | "flexible" | undefined,
      values: form.values, languages: form.languages,
      // Novos campos v2
      company: form.company || undefined,
      jobTitle: form.jobTitle || undefined,
      activityArea: form.activityArea || undefined,
      institutionalNetwork: form.institutionalNetwork || undefined,
      interestSectors: form.interestSectors.length > 0 ? form.interestSectors : undefined,
      whatIHave: form.whatIHave.length > 0 ? form.whatIHave : undefined,
      whatINeed: form.whatINeed.length > 0 ? form.whatINeed : undefined,
    });
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-transparent flex">
      {/* LEFT PANEL */}
      <div className="hidden lg:flex flex-col w-80 xl:w-96 bg-[#0a1628] border-r border-white/5 p-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img src={ONBOARDING_BG} alt="" className="w-full h-full object-cover"/>
        </div>
        <div className="relative z-10 mb-12">
          <span className="text-2xl font-black"><span className="text-white">MMM</span><span className="text-[#f5a623]">OS</span></span>
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto">
          {STEPS.map((s) => {
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <div key={s.id} className="flex items-start gap-4 mb-5">
                <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${isDone ? "bg-[#f5a623] text-[#060e1a]" : isActive ? "bg-[#f5a623]/20 border-2 border-[#f5a623] text-[#f5a623]" : "bg-white/5 border border-white/15 text-white/30"}`}>
                  {isDone ? "✓" : s.icon}
                </div>
                <div className={`transition-all duration-300 ${isActive ? "opacity-100" : isDone ? "opacity-70" : "opacity-30"}`}>
                  <div className={`font-semibold text-sm ${isActive ? "text-white" : "text-white/60"}`}>{s.title}</div>
                  <div className="text-xs text-white/40">{s.subtitle}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="relative z-10 mt-8 flex justify-center">
          <img src={AI_BRAIN} alt="AI" className="w-32 h-32 object-contain opacity-60"
            style={{ filter: "drop-shadow(0 0 20px rgba(245,166,35,0.3))", animation: "pulse-glow 3s ease-in-out infinite" }}/>
        </div>
        <p className="relative z-10 text-center text-xs text-white/30 mt-4">
          {t("onboarding.subtitle")}
        </p>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex flex-col">
        <div className="h-1 bg-white/5">
          <div className="h-full bg-gradient-to-r from-[#f5a623] to-[#ffd166] transition-all duration-500 ease-out" style={{ width: `${progress}%` }}/>
        </div>
        <div className="lg:hidden flex items-center justify-between px-6 py-4 border-b border-white/5">
          <span className="text-2xl font-black"><span className="text-white">MMM</span><span className="text-[#f5a623]">OS</span></span>
          <span className="text-sm text-white/40">{step} / {STEPS.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-10"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateX(0)" : animDir === "forward" ? "translateX(30px)" : "translateX(-30px)",
              transition: "opacity 0.22s ease, transform 0.22s cubic-bezier(0.23,1,0.32,1)",
            }}>

            <div className="mb-8">
              <div className="text-4xl mb-3">{STEPS[step - 1].icon}</div>
              <h1 className="text-3xl font-black text-white">{STEPS[step - 1].title}</h1>
              <p className="text-white/50 mt-1">{STEPS[step - 1].subtitle}</p>
            </div>

            {/* STEP 1 — Dados pessoais */}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                {(() => {
                  const labels = [t("onboarding.fields.displayName"), t("onboarding.fields.city"), t("profile.gender.label"), t("onboarding.fields.age"), t("onboarding.fields.bio")];
                  return <>
                    <div>
                      <TextInput label={t("onboarding.fields.age")} value={form.age ?? ""} type="number" min={16} max={120}
                        onChange={v => set("age", v ? parseInt(v) : null)}
                        placeholder={t("onboarding.fields.agePlaceholder")} hint={t("onboarding.fields.ageHint")}/>
                    </div>
                    <div>
                      <TextareaInput label={t("onboarding.fields.bio")} value={form.bio} onChange={v => set("bio", v)}
                        placeholder={t("onboarding.fields.bioPlaceholder")} hint={t("onboarding.fields.bioHint")}/>
                    </div>
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <TextInput label={t("onboarding.fields.city")} value={form.city} list={form.country === "BR" ? "cidades-br" : undefined}
                            onChange={v => set("city", v.replace(/\s\([A-Z]{2}\)$/, ""))}
                            placeholder={t("onboarding.fields.cityPlaceholder")}/>
                          {form.country === "BR" && (
                            <datalist id="cidades-br">
                              {cityOptions.map(m => <option key={m} value={m}/>)}
                            </datalist>
                          )}
                        </div>
                        <SelectInput label={t("onboarding.fields.country")} value={form.country} onChange={v => set("country", v)}
                          options={sortOptionsAlphabetically(COUNTRIES, i18n.language)} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                      </div>
                    </div>
                    <div>
                      <SelectInput label={t("profile.gender.label")} value={form.gender} onChange={v => set("gender", v as FormData["gender"])}
                        options={sortOptionsAlphabetically([
                          { value: "male", label: t("profile.gender.male") },
                          { value: "female", label: t("profile.gender.female") },
                          { value: "prefer_not_to_say", label: t("profile.gender.preferNotToSay") },
                        ], i18n.language)} placeholder={t("profile.gender.placeholder")}/>
                    </div>
                    <div>
                      <TextInput label={t("onboarding.fields.displayName")} value={form.displayName} onChange={v => set("displayName", v)}
                        placeholder={t("onboarding.fields.displayNamePlaceholder")} hint={t("onboarding.fields.displayNameHint")}/>
                    </div>
                  </>;
                })()}
              </div>
            )}

            {/* STEP 2 — Especialidade */}
            {step === 2 && (
              <div className="flex flex-col gap-6">
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.primarySpecialty")} <span className="text-white/30 font-normal">{t("onboarding.fields.specialtySelectionCount", { count: form.primarySpecialties.length + (form.customSpecialty.trim() ? 1 : 0) })}</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {sortOptionsAlphabetically(SPECIALTIES, i18n.language).map(s => (
                      <CardOption key={s.key} selected={form.primarySpecialties.includes(s.key)}
                        onClick={() => set("primarySpecialties", togglePrimarySpecialty(form.primarySpecialties, s.key))}
                        icon={s.icon} label={s.label}/>
                    ))}
                  </div>
                </div>
                <div >
                  <TextInput label={t("onboarding.fields.customSpecialty")} value={form.customSpecialty}
                    onChange={value => set("customSpecialty", value)}
                    placeholder={t("onboarding.fields.customSpecialtyPlaceholder")}
                    hint={t("onboarding.fields.customSpecialtyHint")}/>
                </div>
                <div className="rounded-2xl border border-[#f5a623]/25 bg-[#f5a623]/5 p-5 space-y-4">
                  <div>
                    <h2 className="text-white font-semibold text-base">{t("profile.business.personType")}</h2>
                    <p className="text-xs text-white/45 mt-1">{t("profile.business.cnpjHint")}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {sortOptionsAlphabetically([
                      { value: "individual", label: t("profile.business.individual"), icon: "👤" },
                      { value: "legal_entity", label: t("profile.business.legalEntity"), icon: "🏢" },
                      { value: "mei", label: t("profile.business.mei"), icon: "🌱" },
                    ], i18n.language).map(option => (
                      <CardOption key={option.value} selected={form.personType === option.value}
                        onClick={() => {
                          set("personType", option.value);
                          set("companySize", option.value === "mei" ? "mei" : "");
                          if (option.value === "individual") set("companyCnpj", "");
                        }} icon={option.icon} label={option.label}/>
                    ))}
                  </div>
                  {(form.personType === "legal_entity" || form.personType === "mei") && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <SelectInput label={t("profile.business.companySize")} value={form.companySize}
                        onChange={value => set("companySize", value as FormData["companySize"])}
                        options={form.personType === "mei"
                          ? [{ value: "mei", label: t("profile.business.sizeMei") }]
                          : sortOptionsAlphabetically([
                              { value: "micro", label: t("profile.business.sizeMicro") },
                              { value: "small", label: t("profile.business.sizeSmall") },
                              { value: "medium", label: t("profile.business.sizeMedium") },
                              { value: "large", label: t("profile.business.sizeLarge") },
                            ], i18n.language)} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                      <TextInput label={t("profile.business.cnpj")} required value={form.companyCnpj}
                        onChange={value => set("companyCnpj", formatCnpj(value))}
                        placeholder={t("profile.business.cnpjPlaceholder")} hint={t("profile.business.cnpjHint")}/>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <TextInput label={t("onboarding.fields.currentRole")} value={form.currentRole} onChange={v => set("currentRole", v)}
                    placeholder={t("onboarding.fields.currentRolePlaceholder")}/>
                  <TextInput label={t("onboarding.fields.currentCompany")} value={form.currentCompany} onChange={v => set("currentCompany", v)}
                    placeholder={t("onboarding.fields.currentCompanyPlaceholder")}/>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <TextInput label={t("onboarding.fields.experienceYears")} value={form.experienceYears ?? ""} type="number" min={0} max={60}
                    onChange={v => set("experienceYears", v ? Math.max(0, parseInt(v)) : null)} placeholder={t("onboarding.fields.experienceYearsPlaceholder")}/>
                  <SelectInput label={t("onboarding.fields.educationLevel")} value={form.educationLevel}
                    onChange={v => set("educationLevel", v)} options={EDUCATION_LEVELS}
                    placeholder={t("onboarding.fields.selectPlaceholder")}/>
                </div>
              </div>
            )}

            {/* STEP 3 — O que busca */}
            {step === 3 && (
              <div className="flex flex-col gap-6">
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.seekingTypes")} <span className="text-white/30 font-normal">{t("onboarding.fields.selectAll")}</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sortOptionsAlphabetically(SEEKING_TYPES, i18n.language).map(s => (
                      <CardOption key={s.key} selected={form.seekingTypes.includes(s.key)}
                        onClick={() => toggleArray("seekingTypes", s.key)} icon={s.icon} label={s.label} desc={s.desc}/>
                    ))}
                  </div>
                  <button type="button" onClick={() => toggleArray("seekingTypes", "be_mentor")}
                    className={"mt-3 w-full p-4 rounded-xl border text-left transition-all duration-200 " + (form.seekingTypes.includes("be_mentor") ? "bg-[#f5a623]/15 border-[#f5a623]" : "bg-white/5 border-white/10")}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🤲</span>
                      <div>
                        <div className={"font-semibold text-sm " + (form.seekingTypes.includes("be_mentor") ? "text-[#f5a623]" : "text-white")}>{t("onboarding.seeking.be_mentor")}</div>
                        <div className="text-xs text-white/40">{t("onboarding.seeking.be_mentor_desc")}</div>
                      </div>
                    </div>
                  </button>
                </div>
                {/* Metas de curto/longo prazo ficam ocultas por enquanto: não
                    existem colunas para elas e o texto digitado era descartado
                    em silêncio. Voltam quando o schema ganhar os campos
                    (tarefa de consolidação do cadastro). */}
                <div>
                  <TextareaInput label={t("onboarding.fields.currentResources")} value={form.currentResources} onChange={v => set("currentResources", v)}
                    placeholder={t("onboarding.fields.currentResourcesPlaceholder")} hint={t("onboarding.fields.currentResourcesHint")}/>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-6">
                  <div>
                    <h2 className="text-white font-semibold">{t("onboarding.steps.s5_title")}</h2>
                    <p className="text-xs text-white/40 mt-1">{t("onboarding.steps.s5_sub")}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.incomeRange")}</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {INCOME_RANGES.map(r => (
                        <CardOption key={r.value} selected={form.incomeRange === r.value}
                          onClick={() => set("incomeRange", r.value)} icon={r.icon} label={r.label}/>
                      ))}
                    </div>
                    <p className="text-xs text-white/25 mt-2">🔒 {t("onboarding.fields.incomePrivacy")}</p>
                  </div>
                  <SelectInput label={t("onboarding.fields.investmentCapacity")} value={form.investmentCapacity}
                    onChange={v => set("investmentCapacity", v)} options={INVESTMENT_CAPACITIES}
                    placeholder={t("onboarding.fields.selectPlaceholder")}/>
                  <button type="button" onClick={() => set("lookingForInvestment", !form.lookingForInvestment)}
                    className={`w-full p-4 rounded-xl border text-left transition-all duration-200 ${form.lookingForInvestment ? "bg-[#f5a623]/15 border-[#f5a623]" : "bg-white/5 border-white/10"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">💰</span>
                      <div>
                        <div className={`font-semibold text-sm ${form.lookingForInvestment ? "text-[#f5a623]" : "text-white"}`}>{t("onboarding.fields.lookingForInvestment")}</div>
                        <div className="text-xs text-white/40">{t("onboarding.fields.lookingForInvestmentDesc")}</div>
                      </div>
                    </div>
                  </button>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.workStyle")}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {sortOptionsAlphabetically(WORK_STYLES, i18n.language).map(w => (
                        <CardOption key={w.value} selected={form.workStyle === w.value}
                          onClick={() => set("workStyle", w.value)} icon={w.icon} label={w.label}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.values")} <span className="text-white/30 font-normal">{t("onboarding.fields.upTo4")}</span></label>
                    <div className="flex flex-wrap gap-2">
                      {sortOptionsAlphabetically(VALUES_OPTIONS, i18n.language).map(v => (
                        <TagOption key={v.key} selected={form.values.includes(v.key)}
                          onClick={() => {
                            if (form.values.includes(v.key)) toggleArray("values", v.key);
                            else if (form.values.length < 4) toggleArray("values", v.key);
                            else toast.error(t("onboarding.maxValues"));
                          }} label={v.label}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.languages")}</label>
                    <div className="flex flex-wrap gap-2">
                      {sortOptionsAlphabetically(LANGUAGES_LIST_I18N, i18n.language).map(l => (
                        <TagOption key={l.key} selected={form.languages.includes(l.key)} onClick={() => toggleArray("languages", l.key)} label={l.label}/>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4 — Setor e mercado */}
            {step === 4 && (
              <div className="flex flex-col gap-6">
                <div>
                  <SelectInput label={t("onboarding.fields.sector")} value={form.sector} onChange={v => set("sector", v)}
                    options={sortOptionsAlphabetically(SECTORS.map(s => ({ value: s.label, label: s.label })), i18n.language)} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                  {form.sector === OTHER_SECTOR_LABEL && (
                    <div className="mt-3">
                      <TextInput label={t("onboarding.fields.customSpecialty")} value={form.customSector}
                        onChange={v => set("customSector", v)}
                        placeholder={t("onboarding.fields.customSpecialtyPlaceholder")}/>
                    </div>
                  )}
                </div>
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.businessInterests")} <span className="text-white/30 font-normal">{t("onboarding.fields.upTo4")}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {sortOptionsAlphabetically(SECTORS.filter(s => s.label !== form.sector && s.key !== "other"), i18n.language).map(s => (
                      <TagOption key={s.key} selected={form.businessInterests.includes(s.key)}
                        onClick={() => { if (form.businessInterests.includes(s.key) || form.businessInterests.length < 4) toggleArray("businessInterests", s.key); }}
                        label={s.label}/>
                    ))}
                  </div>
                </div>
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.preferredCompanySize")}</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {COMPANY_SIZES.map(c => (
                      <CardOption key={c.value} selected={form.preferredCompanySize === c.value}
                        onClick={() => set("preferredCompanySize", c.value)} icon={c.icon} label={c.label}/>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button type="button" onClick={() => set("openToRemote", !form.openToRemote)}
                    className={`p-4 rounded-xl border text-left transition-all duration-200 ${form.openToRemote ? "bg-[#f5a623]/15 border-[#f5a623] text-[#f5a623]" : "bg-white/5 border-white/10 text-white/60"}`}>
                    <div className="text-2xl mb-2">🌐</div>
                    <div className="font-semibold text-sm">{t("onboarding.fields.openToRemote")}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t("onboarding.fields.openToRemoteDesc")}</div>
                  </button>
                  <button type="button" onClick={() => set("availableForTravel", !form.availableForTravel)}
                    className={`p-4 rounded-xl border text-left transition-all duration-200 ${form.availableForTravel ? "bg-[#f5a623]/15 border-[#f5a623] text-[#f5a623]" : "bg-white/5 border-white/10 text-white/60"}`}>
                    <div className="text-2xl mb-2">✈️</div>
                    <div className="font-semibold text-sm">{t("onboarding.fields.availableForTravel")}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t("onboarding.fields.availableForTravelDesc")}</div>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5 — Rede institucional (os demais campos repetiam os steps 2 e 4) */}
            {step === 5 && (
              <div className="flex flex-col gap-5">
                <p className="text-white/40 text-sm -mt-4 mb-2">
                  {t("onboarding.misc.step6_hint")} <span className="text-white/25">{t("onboarding.misc.optional")}</span>
                </p>
                <TextInput label={t("onboarding.misc.institutionalNetwork")} value={form.institutionalNetwork} onChange={v => set("institutionalNetwork", v)}
                  placeholder={t("onboarding.misc.institutionalNetworkPlaceholder")}/>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-5">
                <p className="text-white/40 text-sm -mt-4 mb-2">
                  {t("onboarding.misc.step7_hint")} <span className="text-white/25">{t("onboarding.misc.optional")}</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {sortOptionsAlphabetically(WHAT_I_HAVE_OPTIONS, i18n.language).map(opt => (
                    <TagButton
                      key={opt.id}
                      icon={opt.icon}
                      label={opt.label}
                      selected={form.whatIHave.includes(opt.id)}
                      onClick={() => toggleArray("whatIHave", opt.id)}
                    />
                  ))}
                </div>
                {form.whatIHave.length > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-[#f5a623]/8 border border-[#f5a623]/20">
                    <p className="text-xs text-[#f5a623]/70 font-medium">
                      ✦ {form.whatIHave.length} {form.whatIHave.length === 1 ? t("onboarding.misc.assetSelected") : t("onboarding.misc.assetsSelected")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 7 — O QUE PRECISO */}
            {step === 7 && (
              <div className="space-y-5">
                <p className="text-white/40 text-sm -mt-4 mb-2">
                  {t("onboarding.misc.step8_hint")} <span className="text-white/25">{t("onboarding.misc.optional")}</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {sortOptionsAlphabetically(WHAT_I_NEED_OPTIONS, i18n.language).map(opt => (
                    <TagButton
                      key={opt.id}
                      icon={opt.icon}
                      label={opt.label}
                      selected={form.whatINeed.includes(opt.id)}
                      onClick={() => toggleArray("whatINeed", opt.id)}
                    />
                  ))}
                </div>
                {form.whatINeed.length > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
                    <p className="text-xs text-blue-400/70 font-medium">
                      ◈ {form.whatINeed.length} {form.whatINeed.length === 1 ? t("onboarding.misc.demandSelected") : t("onboarding.misc.demandsSelected")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 8 — Revisão final */}
            {step === 8 && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: t("onboarding.review.name"), value: form.displayName, icon: "👤" },
                    { label: t("onboarding.review.location"), value: `${form.city}, ${form.country}`, icon: "📍" },
                    ...(form.gender ? [{ label: t("profile.gender.label"), value: t(`profile.gender.${form.gender}`), icon: "⚥" }] : []),
                    { label: t("onboarding.review.specialty"), value: normalizePrimarySpecialties(form.primarySpecialties, form.customSpecialty).map(k => t("onboarding.specialties." + k, { defaultValue: k })).join(", "), icon: "⚡" },
                    { label: t("onboarding.misc.company"), value: form.company || form.currentCompany || "—", icon: "🏢" },
                    { label: t("onboarding.review.seeking"), value: form.seekingTypes.slice(0, 2).map(k => t("onboarding.seeking." + k, { defaultValue: k })).join(", ") + (form.seekingTypes.length > 2 ? "..." : ""), icon: "🎯" },
                    ...(form.currentResources ? [{ label: t("onboarding.fields.currentResources"), value: form.currentResources, icon: "✦" }] : []),
                    { label: t("onboarding.review.sector"), value: form.sector, icon: "🌐" },
                    ...(form.personType ? [{ label: t("profile.business.personType"), value: t(`profile.business.${form.personType === "legal_entity" ? "legalEntity" : form.personType}`), icon: "🏢" }] : []),
                  ].map((item, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{item.icon}</span>
                        <span className="text-xs text-white/40">{item.label}</span>
                      </div>
                      <div className="text-sm font-medium text-white truncate">{item.value || "—"}</div>
                    </div>
                  ))}
                </div>

                {/* Resumo O que tenho / O que preciso */}
                {(form.whatIHave.length > 0 || form.whatINeed.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {form.whatIHave.length > 0 && (
                      <div className="p-3 rounded-xl bg-[#f5a623]/8 border border-[#f5a623]/20">
                        <p className="text-xs text-[#f5a623]/70 font-medium mb-1">✦ {t("onboarding.steps.s8_title")}</p>
                        <p className="text-xs text-white/50">{form.whatIHave.length} {form.whatIHave.length === 1 ? t("onboarding.misc.asset") : t("onboarding.misc.assets")} {form.whatIHave.length === 1 ? t("onboarding.misc.selected") : t("onboarding.misc.selectedPlural")}</p>
                      </div>
                    )}
                    {form.whatINeed.length > 0 && (
                      <div className="p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
                        <p className="text-xs text-blue-400/70 font-medium mb-1">◈ {t("onboarding.steps.s9_title")}</p>
                        <p className="text-xs text-white/50">{form.whatINeed.length} {form.whatINeed.length === 1 ? t("onboarding.misc.demand") : t("onboarding.misc.demands")} {form.whatINeed.length === 1 ? t("onboarding.misc.selectedF") : t("onboarding.misc.selectedFPlural")}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-5 rounded-xl bg-[#f5a623]/10 border border-[#f5a623]/30">
                  <div className="flex items-center gap-3 mb-3">
                    <img src={AI_BRAIN} alt="AI" className="w-8 h-8 object-contain"/>
                    <span className="font-bold text-[#f5a623] text-sm">{t("onboarding.aiAnalysis.title")}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-white/60">
                    {AI_ANALYSIS_ITEMS.map(item => (
                      <div key={item} className="flex items-center gap-2"><span className="text-[#f5a623]">✓</span> {item}</div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-white/30 text-center">🔒 {t("onboarding.dataPrivacy")}</p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-white/10">
              <button type="button" onClick={() => step > 1 ? goTo(step - 1) : navigate("/")}
                className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors duration-200">
                ← {step > 1 ? t("onboarding.nav.back") : t("onboarding.nav.home")}
              </button>
              <div className="flex items-center gap-2">
                {STEPS.map((_, i) => (
                  <div key={i} className={`rounded-full transition-all duration-300 ${i + 1 === step ? "w-6 h-2 bg-[#f5a623]" : i + 1 < step ? "w-2 h-2 bg-[#f5a623]/60" : "w-2 h-2 bg-white/15"}`}/>
                ))}
              </div>
              {step < STEPS.length ? (
                <button type="button" onClick={() => canProceed() && goTo(step + 1)} disabled={!canProceed()}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 active:scale-95 ${canProceed() ? "bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] shadow-lg shadow-[#f5a623]/20" : "bg-white/10 text-white/30 cursor-not-allowed"}`}>
                  {t("onboarding.nav.continue")} →
                </button>
              ) : (
                <button type="button" onClick={handleSubmit} disabled={saveOnboarding.isPending}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] transition-all duration-200 active:scale-95 shadow-lg shadow-[#f5a623]/20 disabled:opacity-60">
                  {saveOnboarding.isPending
                    ? <><span className="animate-spin">⏳</span> {t("onboarding.nav.analyzing")}</>
                    : <>🚀 {t("onboarding.nav.findMatches")}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-glow {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(245,166,35,0.3)); }
          50% { filter: drop-shadow(0 0 40px rgba(245,166,35,0.6)); }
        }
      `}</style>
    </div>
  );
}
