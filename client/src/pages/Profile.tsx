import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatCnpj, isValidCnpj, maskCnpj } from "@shared/business-registration";
import { sortOptionsAlphabetically, sortTextAlphabetically } from "@shared/option-sorting";
import {
  ArrowLeft, User, Briefcase, Globe, Link2, Edit2, Save,
  MapPin, Building, X, Plus, CheckCircle, Network, Tag,
  Shield, Star, Crown
} from "lucide-react";

// ─── Constantes ───────────────────────────────────────────────────────────────
const SECTORS = [
  "Tecnologia", "Saúde", "Educação", "Finanças", "Agronegócio",
  "Energia", "Varejo", "Imobiliário", "Indústria", "Serviços",
  "Moda", "Alimentação", "Turismo", "Logística", "Jurídico",
  "Beleza & Cosméticos", "Exportação", "Importação", "Infraestrutura",
  "Commodities", "Farmacêutico", "Consultoria", "Marketing",
];

const INTEREST_SECTORS = [
  "Tecnologia", "Saúde", "Educação", "Finanças", "Agronegócio",
  "Energia", "Varejo", "Imobiliário", "Indústria", "Serviços",
  "Moda", "Alimentação", "Turismo", "Logística", "Jurídico",
  "Beleza & Cosméticos", "Exportação", "Importação", "Infraestrutura",
  "Commodities", "Farmacêutico", "Consultoria", "Marketing",
];

const LANGUAGES_LIST = [
  "Português", "English", "Español", "Français", "Deutsch",
  "中文", "日本語", "العربية", "हिन्दी", "Русский",
];

const COUNTRIES = [
  { code: "BR", name: "Brasil" }, { code: "PT", name: "Portugal" },
  { code: "US", name: "Estados Unidos" }, { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" }, { code: "CO", name: "Colômbia" },
  { code: "MX", name: "México" }, { code: "ES", name: "Espanha" },
  { code: "FR", name: "França" }, { code: "DE", name: "Alemanha" },
  { code: "GB", name: "Reino Unido" }, { code: "IT", name: "Itália" },
  { code: "CN", name: "China" }, { code: "JP", name: "Japão" },
  { code: "IN", name: "Índia" }, { code: "ZA", name: "África do Sul" },
  { code: "NG", name: "Nigéria" }, { code: "AE", name: "Emirados Árabes" },
];

// Tags "O que tenho"
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

// Tags "O que preciso"
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

// ─── Componente de Tag Selecionável ───────────────────────────────────────────
function TagButton({
  icon, label, selected, onClick,
}: { icon: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 active:scale-95 ${
        selected
          ? "bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm shadow-amber-500/10"
          : "bg-white/3 border-white/10 text-white/50 hover:border-white/25 hover:text-white/75 hover:bg-white/6"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
      {selected && <CheckCircle size={13} className="text-amber-400 ml-auto" />}
    </button>
  );
}

// ─── Componente de Seção ──────────────────────────────────────────────────────
function Section({
  icon, title, subtitle, children,
}: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d1530] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            {icon}
          </div>
          <div>
            <h2 className="text-white font-bold text-base leading-tight">{title}</h2>
            <p className="text-white/40 text-xs mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.profile.get.useQuery();
  const profile = data?.profile;

  const [editing, setEditing] = useState(false);

  // Seção 1 — Quem sou
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("BR");
  const [gender, setGender] = useState<"" | "male" | "female" | "prefer_not_to_say">("");
  const [personType, setPersonType] = useState<"" | "individual" | "legal_entity" | "mei">("");
  const [companySize, setCompanySize] = useState<"" | "mei" | "micro" | "small" | "medium" | "large">("");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [activityArea, setActivityArea] = useState("");
  const [institutionalNetwork, setInstitutionalNetwork] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Seção 1 — tags de setores de interesse
  const [interestSectors, setInterestSectors] = useState<string[]>([]);

  // Seção 2 — O que tenho
  const [whatIHave, setWhatIHave] = useState<string[]>([]);

  // Seção 3 — O que preciso
  const [whatINeed, setWhatINeed] = useState<string[]>([]);

  const startEditing = () => {
    setDisplayName(profile?.displayName || user?.name || "");
    setBio(profile?.bio || "");
    setCompany((profile as any)?.company || "");
    setJobTitle((profile as any)?.jobTitle || "");
    setCity(profile?.city || "");
    setCountry(profile?.country || "BR");
    const savedGender = (profile as any)?.gender;
    setGender(savedGender === "male" || savedGender === "female" || savedGender === "prefer_not_to_say" ? savedGender : "");
    const savedPersonType = (profile as any)?.personType;
    setPersonType(savedPersonType === "individual" || savedPersonType === "legal_entity" || savedPersonType === "mei" ? savedPersonType : "");
    const savedCompanySize = (profile as any)?.companySize;
    setCompanySize(savedCompanySize === "mei" || savedCompanySize === "micro" || savedCompanySize === "small" || savedCompanySize === "medium" || savedCompanySize === "large" ? savedCompanySize : "");
    setCompanyCnpj((profile as any)?.companyCnpj || "");
    setActivityArea((profile as any)?.activityArea || "");
    setInstitutionalNetwork((profile as any)?.institutionalNetwork || "");
    setLinkedinUrl(profile?.linkedinUrl || "");
    setWebsiteUrl(profile?.websiteUrl || "");
    setInterestSectors(Array.isArray((profile as any)?.interestSectors) ? (profile as any).interestSectors : []);
    setWhatIHave(Array.isArray((profile as any)?.whatIHave) ? (profile as any).whatIHave : []);
    setWhatINeed(Array.isArray((profile as any)?.whatINeed) ? (profile as any).whatINeed : []);
    setEditing(true);
  };

  const updateMutation = trpc.profile.update.useMutation({
    onSuccess: () => {
      toast.success("Perfil atualizado com sucesso!");
      utils.profile.get.invalidate();
      setEditing(false);
    },
    onError: (err) => {
      // Erros de validação do zod chegam como JSON serializado; mostrar só a
      // primeira mensagem em vez do array cru.
      let msg = err.message;
      try { const issues = JSON.parse(err.message); if (Array.isArray(issues) && issues[0]?.message) msg = issues[0].message; } catch { /* mensagem simples */ }
      toast.error(msg);
    },
  });

  const handleSave = () => {
    if (companyCnpj && !isValidCnpj(companyCnpj)) {
      toast.error(t("profile.business.cnpjInvalid"));
      return;
    }
    updateMutation.mutate({
      displayName,
      bio,
      company,
      jobTitle,
      city,
      country,
      gender: gender || undefined,
      personType: personType || undefined,
      companySize: personType === "mei" ? "mei" : companySize || undefined,
      companyCnpj: personType !== "individual" ? companyCnpj || undefined : undefined,
      activityArea,
      institutionalNetwork,
      linkedinUrl,
      websiteUrl,
      interestSectors,
      whatIHave,
      whatINeed,
    });
  };

  const toggleTag = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(i => i !== id) : [...list, id]);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent text-white flex items-center justify-center">
        <div className="space-y-4 w-full max-w-2xl px-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 bg-white/5 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const profileWhatIHave = Array.isArray((profile as any)?.whatIHave) ? (profile as any).whatIHave as string[] : [];
  const profileWhatINeed = Array.isArray((profile as any)?.whatINeed) ? (profile as any).whatINeed as string[] : [];
  const profileInterestSectors = Array.isArray((profile as any)?.interestSectors) ? (profile as any).interestSectors as string[] : [];

  return (
    <div className="min-h-screen bg-transparent text-white">
      {/* Navbar */}
      <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between sticky top-0 z-40 bg-[#060e1a]/95 backdrop-blur-xl">
        <Link href="/dashboard">
          <span className="flex items-center gap-2 text-white/50 hover:text-white transition-colors cursor-pointer text-sm">
            <ArrowLeft size={16} />
            Voltar ao Dashboard
          </span>
        </Link>
        <Link href="/dashboard">
          <span className="text-xl font-black cursor-pointer">
            <span className="text-white">MMM</span><span className="text-[#f5a623]">OS</span>
          </span>
        </Link>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="text-white/40 hover:text-white/70">
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold gap-2">
              <Save size={14} />
              {updateMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={startEditing}
            className="bg-white/8 hover:bg-white/15 border border-white/15 text-white gap-2">
            <Edit2 size={14} />
            Editar perfil
          </Button>
        )}
      </nav>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5">

        {/* Header do perfil */}
        <div className="flex items-center gap-4 mb-2">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-[#060e1a] font-black text-2xl flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #f5a623, #ffd166)" }}>
              {(profile?.displayName || user?.name || "U")[0].toUpperCase()}
            </div>
            {/* Indicador de nível no avatar */}
            {user?.role === "president" && (
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-purple-500 border-2 border-[#060e1a] flex items-center justify-center">
                <Crown size={11} className="text-white" />
              </div>
            )}
            {user?.role === "gold" && (
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-amber-400 border-2 border-[#060e1a] flex items-center justify-center">
                <Star size={11} className="text-[#060e1a]" />
              </div>
            )}
            {user?.role === "silver" && (
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-400 border-2 border-[#060e1a] flex items-center justify-center">
                <Shield size={11} className="text-white" />
              </div>
            )}
            {user?.role === "bronze" && (
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full border-2 border-[#060e1a] flex items-center justify-center" style={{ background: "#cd7f32" }}>
                <Shield size={11} className="text-white" />
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-white font-bold text-xl">{profile?.displayName || user?.name}</h1>
              {/* Badge de nível */}
              {user?.role === "president" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  <Crown size={10} /> Ouro
                </span>
              )}
              {user?.role === "gold" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  <Star size={10} /> Ouro
                </span>
              )}
              {user?.role === "silver" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-400/15 text-slate-300 border border-slate-400/30">
                  <Shield size={10} /> Prata
                </span>
              )}
              {user?.role === "bronze" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border" style={{ background: "rgba(205,127,50,0.15)", color: "#cd7f32", borderColor: "rgba(205,127,50,0.3)" }}>
                  <Shield size={10} /> Bronze
                </span>
              )}
            </div>
            <p className="text-white/50 text-sm">{user?.email}</p>
            {(profile as any)?.jobTitle && (
              <p className="text-white/40 text-xs mt-0.5">
                {(profile as any).jobTitle}
                {(profile as any)?.company && ` · ${(profile as any).company}`}
              </p>
            )}
          </div>
        </div>

        {/* ── SEÇÃO 1: QUEM SOU ── */}
        <Section
          icon={<User size={16} />}
          title={t("profile.sections.whoIAmTitle")}
          subtitle={t("profile.sections.whoIAmSubtitle")}
        >
          {editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Nome de exibição</label>
                  <Input value={displayName} onChange={e => setDisplayName(e.target.value)}
                    placeholder="Como você quer ser chamada"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Empresa</label>
                  <Input value={company} onChange={e => setCompany(e.target.value)}
                    placeholder="Nome da sua empresa"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">{t("profile.business.personType")}</label>
                  <Select value={personType} onValueChange={value => {
                    const next = value as typeof personType;
                    setPersonType(next);
                    setCompanySize(next === "mei" ? "mei" : "");
                    if (next === "individual") setCompanyCnpj("");
                  }}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-amber-500/50"><SelectValue placeholder={t("profile.business.personTypePlaceholder")} /></SelectTrigger>
                    <SelectContent className="bg-[#0d1530] border-white/10 text-white">
                      {sortOptionsAlphabetically([
                        { value: "individual", label: t("profile.business.individual") },
                        { value: "legal_entity", label: t("profile.business.legalEntity") },
                        { value: "mei", label: t("profile.business.mei") },
                      ], i18n.language).map(option => (
                        <SelectItem key={option.value} value={option.value} className="text-white">{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Cargo</label>
                  <Input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                    placeholder="Ex: CEO, Diretora Comercial"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Área de Atuação</label>
                  <Input value={activityArea} onChange={e => setActivityArea(e.target.value)}
                    placeholder="Ex: Exportação, Tecnologia, Moda"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">País</label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-amber-500/50">
                      <SelectValue placeholder="Selecione o país" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1530] border-white/10 text-white">
                      {sortOptionsAlphabetically(COUNTRIES.map(country => ({ ...country, label: country.name })), i18n.language).map(c => (
                        <SelectItem key={c.code} value={c.code} className="text-white hover:bg-white/10 focus:bg-white/10">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Cidade</label>
                  <Input value={city} onChange={e => setCity(e.target.value)}
                    placeholder="Sua cidade"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">{t("profile.gender.label")}</label>
                  <Select value={gender} onValueChange={value => setGender(value as typeof gender)}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-amber-500/50">
                      <SelectValue placeholder={t("profile.gender.placeholder")} />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1530] border-white/10 text-white">
                      {sortOptionsAlphabetically([
                        { value: "male", label: t("profile.gender.male") },
                        { value: "female", label: t("profile.gender.female") },
                        { value: "prefer_not_to_say", label: t("profile.gender.preferNotToSay") },
                      ], i18n.language).map(option => (
                        <SelectItem key={option.value} value={option.value} className="text-white hover:bg-white/10 focus:bg-white/10">{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(personType === "legal_entity" || personType === "mei") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">{t("profile.business.companySize")}</label>
                    <Select value={companySize} onValueChange={value => setCompanySize(value as typeof companySize)}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-amber-500/50"><SelectValue placeholder={t("profile.business.companySizePlaceholder")} /></SelectTrigger>
                      <SelectContent className="bg-[#0d1530] border-white/10 text-white">
                        {personType === "mei" ? (
                          <SelectItem value="mei" className="text-white">{t("profile.business.sizeMei")}</SelectItem>
                        ) : (
                          sortOptionsAlphabetically([
                            { value: "micro", label: t("profile.business.sizeMicro") },
                            { value: "small", label: t("profile.business.sizeSmall") },
                            { value: "medium", label: t("profile.business.sizeMedium") },
                            { value: "large", label: t("profile.business.sizeLarge") },
                          ], i18n.language).map(option => (
                            <SelectItem key={option.value} value={option.value} className="text-white">{option.label}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">{t("profile.business.cnpj")}</label>
                    <Input value={formatCnpj(companyCnpj)} onChange={e => setCompanyCnpj(formatCnpj(e.target.value))}
                      placeholder={t("profile.business.cnpjPlaceholder")}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Rede Institucional</label>
                <Input value={institutionalNetwork} onChange={e => setInstitutionalNetwork(e.target.value)}
                  placeholder="Ex: Câmara de Comércio, Associação Setorial, Conselho Empresarial"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Sobre você</label>
                <Textarea value={bio} onChange={e => setBio(e.target.value)}
                  placeholder="Conte brevemente sobre sua trajetória e o que você representa no ecossistema..."
                  rows={3}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50 resize-none" />
              </div>

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">Setores de Interesse</label>
                <div className="flex flex-wrap gap-2">
                  {sortTextAlphabetically(INTEREST_SECTORS, i18n.language).map(s => (
                    <button key={s} type="button" onClick={() => toggleTag(interestSectors, setInterestSectors, s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                        interestSectors.includes(s)
                          ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                          : "bg-white/3 border-white/10 text-white/45 hover:border-white/25 hover:text-white/70"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">LinkedIn</label>
                  <Input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">Website</label>
                  <Input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)}
                    placeholder="https://..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {profile?.bio && (
                <p className="text-white/60 text-sm leading-relaxed">{profile.bio}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[(profile as any)?.company && { icon: <Building size={13} />, label: (profile as any).company },
                  (profile as any)?.jobTitle && { icon: <Briefcase size={13} />, label: (profile as any).jobTitle },
                  (profile as any)?.activityArea && { icon: <Tag size={13} />, label: (profile as any).activityArea },
                  (profile as any)?.personType && { icon: <Building size={13} />, label: t(`profile.business.${(profile as any).personType === "legal_entity" ? "legalEntity" : (profile as any).personType}`) },
                  (profile as any)?.companySize && { icon: <Building size={13} />, label: t(`profile.business.size${String((profile as any).companySize).charAt(0).toUpperCase()}${String((profile as any).companySize).slice(1)}`) },
                  (profile as any)?.companyCnpj && { icon: <Building size={13} />, label: `${t("profile.business.cnpj")}: ${maskCnpj((profile as any).companyCnpj)}` },
                  (profile?.city || profile?.country) && { icon: <MapPin size={13} />, label: [profile?.city, COUNTRIES.find(c => c.code === profile?.country)?.name].filter(Boolean).join(", ") },
                  (profile as any)?.gender && { icon: <User size={13} />, label: t(`profile.gender.${(profile as any).gender}`) },
                  (profile as any)?.institutionalNetwork && { icon: <Network size={13} />, label: (profile as any).institutionalNetwork },
                  profile?.linkedinUrl && { icon: <Link2 size={13} />, label: "LinkedIn", href: profile.linkedinUrl },
                  profile?.websiteUrl && { icon: <Globe size={13} />, label: "Website", href: profile.websiteUrl },
                ].filter(Boolean).map((item: any, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-white/55">
                    <span className="text-white/30">{item.icon}</span>
                    {item.href ? (
                      <a href={item.href} target="_blank" rel="noopener noreferrer" className="hover:text-amber-400 transition-colors truncate">{item.label}</a>
                    ) : (
                      <span className="truncate">{item.label}</span>
                    )}
                  </div>
                ))}
              </div>
              {profileInterestSectors.length > 0 && (
                <div>
                  <p className="text-xs text-white/30 uppercase tracking-wider mb-2">Setores de Interesse</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profileInterestSectors.map((s: string) => (
                      <span key={s} className="px-2.5 py-1 rounded-full bg-amber-500/8 border border-amber-500/20 text-xs text-amber-300/70">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {!profile?.bio && !(profile as any)?.company && !(profile as any)?.jobTitle && (
                <div className="text-center py-6">
                  <p className="text-white/30 text-sm">Nenhuma informação profissional ainda.</p>
                  <button onClick={startEditing} className="text-amber-400 text-sm mt-1 hover:text-amber-300 transition-colors">
                    Clique para editar →
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── SEÇÃO 2: O QUE TENHO ── */}
        <Section
          icon={<span className="text-sm">✦</span>}
          title={t("profile.sections.whatIHaveTitle")}
          subtitle={t("profile.sections.whatIHaveSubtitle")}
        >
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sortOptionsAlphabetically(WHAT_I_HAVE_OPTIONS, i18n.language).map(opt => (
                <TagButton
                  key={opt.id}
                  icon={opt.icon}
                  label={opt.label}
                  selected={whatIHave.includes(opt.id)}
                  onClick={() => toggleTag(whatIHave, setWhatIHave, opt.id)}
                />
              ))}
            </div>
          ) : (
            profileWhatIHave.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sortOptionsAlphabetically(WHAT_I_HAVE_OPTIONS.filter(o => profileWhatIHave.includes(o.id)), i18n.language).map(opt => (
                  <div key={opt.id} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
                    <span className="text-base">{opt.icon}</span>
                    <span className="text-sm text-amber-300/80 font-medium">{opt.label}</span>
                    <CheckCircle size={13} className="text-amber-400 ml-auto" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-white/30 text-sm">{t("profile.sections.noAssets")}</p>
                <button onClick={startEditing} className="text-amber-400 text-sm mt-1 hover:text-amber-300 transition-colors">
                  {t("profile.sections.clickToEdit")}
                </button>
              </div>
            )
          )}
        </Section>

        {/* ── SEÇÃO 3: O QUE PRECISO ── */}
        <Section
          icon={<span className="text-sm">◈</span>}
          title={t("profile.sections.whatINeedTitle")}
          subtitle={t("profile.sections.whatINeedSubtitle")}
        >
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sortOptionsAlphabetically(WHAT_I_NEED_OPTIONS, i18n.language).map(opt => (
                <TagButton
                  key={opt.id}
                  icon={opt.icon}
                  label={opt.label}
                  selected={whatINeed.includes(opt.id)}
                  onClick={() => toggleTag(whatINeed, setWhatINeed, opt.id)}
                />
              ))}
            </div>
          ) : (
            profileWhatINeed.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sortOptionsAlphabetically(WHAT_I_NEED_OPTIONS.filter(o => profileWhatINeed.includes(o.id)), i18n.language).map(opt => (
                  <div key={opt.id} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
                    <span className="text-base">{opt.icon}</span>
                    <span className="text-sm text-blue-300/80 font-medium">{opt.label}</span>
                    <CheckCircle size={13} className="text-blue-400 ml-auto" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-white/30 text-sm">{t("profile.sections.noDemands")}</p>
                <button onClick={startEditing} className="text-amber-400 text-sm mt-1 hover:text-amber-300 transition-colors">
                  {t("profile.sections.clickToEdit")}
                </button>
              </div>
            )
          )}
        </Section>

        {/* Botão de salvar no rodapé (mobile) */}
        {editing && (
          <div className="sticky bottom-4 flex gap-3 pt-2">
            <Button variant="ghost" onClick={() => setEditing(false)}
              className="flex-1 border border-white/10 text-white/50 hover:text-white hover:bg-white/5">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold gap-2">
              <Save size={14} />
              {updateMutation.isPending ? "Salvando..." : "Salvar perfil"}
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
