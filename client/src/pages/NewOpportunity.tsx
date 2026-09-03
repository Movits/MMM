import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FTSBadge } from "./Opportunities";
import { sortOptionsAlphabetically, sortTextAlphabetically } from "@shared/option-sorting";
import {
  ArrowLeft, Sparkles, ShieldCheck, AlertTriangle, AlertCircle,
  XCircle, Clock, CheckCircle, Lock, Globe, Tag, X, FileText,
  HelpCircle, AlertOctagon, Loader2, ChevronRight
} from "lucide-react";

export default function NewOpportunity() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();

  const SECTORS = [
    t("newOpportunity.sectorTecnologia"), t("newOpportunity.sectorSaude"), t("newOpportunity.sectorEducacao"),
    t("newOpportunity.sectorFinancas"), t("newOpportunity.sectorAgronegocio"),
    t("newOpportunity.sectorEnergia"), t("newOpportunity.sectorVarejo"), t("newOpportunity.sectorImobiliario"),
    t("newOpportunity.sectorIndustria"), t("newOpportunity.sectorServicos"),
    t("newOpportunity.sectorModa"), t("newOpportunity.sectorAlimentacao"), t("newOpportunity.sectorTurismo"),
    t("newOpportunity.sectorLogistica"), t("newOpportunity.sectorJuridico"),
    t("newOpportunity.sectorCommodities"), t("newOpportunity.sectorExportacao"), t("newOpportunity.sectorImportacao"),
    t("newOpportunity.sectorInfraestrutura"),
    t("newOpportunity.sectorFarmaceutico"), t("newOpportunity.sectorConsultoria"), t("newOpportunity.sectorMarketing"),
    t("newOpportunity.sectorBelezaCosmeticos"),
  ];

  const COUNTRIES = [
    { code: "BR", name: t("newOpportunity.countryBrasil") }, { code: "PT", name: t("newOpportunity.countryPortugal") },
    { code: "US", name: t("newOpportunity.countryEstadosUnidos") }, { code: "AR", name: t("newOpportunity.countryArgentina") },
    { code: "CL", name: t("newOpportunity.countryChile") }, { code: "CO", name: t("newOpportunity.countryColombia") },
    { code: "MX", name: t("newOpportunity.countryMexico") }, { code: "ES", name: t("newOpportunity.countryEspanha") },
    { code: "FR", name: t("newOpportunity.countryFranca") }, { code: "DE", name: t("newOpportunity.countryAlemanha") },
    { code: "GB", name: t("newOpportunity.countryReinoUnido") }, { code: "IT", name: t("newOpportunity.countryItalia") },
    { code: "JP", name: t("newOpportunity.countryJapao") }, { code: "CN", name: t("newOpportunity.countryChina") },
    { code: "IN", name: t("newOpportunity.countryIndia") }, { code: "ZA", name: t("newOpportunity.countryAfricaDoSul") },
    { code: "NG", name: t("newOpportunity.countryNigeria") }, { code: "AE", name: t("newOpportunity.countryEmiradosArabes") },
  ];

  const COMPLIANCE_COLORS = {
    green:   { label: t("newOpportunity.complianceGreenLabel"),   color: "#22c55e", icon: <ShieldCheck size={14} />, bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-400"  },
    yellow:  { label: t("newOpportunity.complianceYellowLabel"),  color: "#eab308", icon: <AlertTriangle size={14} />, bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400" },
    orange:  { label: t("newOpportunity.complianceOrangeLabel"),  color: "#f97316", icon: <AlertCircle size={14} />, bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400" },
    red:     { label: t("newOpportunity.complianceRedLabel"),     color: "#ef4444", icon: <XCircle size={14} />, bg: "bg-red-500/10",    border: "border-red-500/30",    text: "text-red-400"    },
    pending: { label: t("newOpportunity.compliancePendingLabel"), color: "#9ca3af", icon: <Clock size={14} />, bg: "bg-gray-500/10",   border: "border-gray-500/30",   text: "text-gray-400"   },
  };

  const RISK_COLORS = {
    low:    { label: t("newOpportunity.riskLowLabel"),    color: "#22c55e", icon: <ShieldCheck size={12} /> },
    medium: { label: t("newOpportunity.riskMediumLabel"), color: "#eab308", icon: <AlertTriangle size={12} /> },
    high:   { label: t("newOpportunity.riskHighLabel"),   color: "#ef4444", icon: <AlertOctagon size={12} /> },
  };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [isConfidential, setIsConfidential] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  // Estado da análise prévia (Item 4.1)
  const [preAnalysis, setPreAnalysis] = useState<{
    dynamicQuestion: string;
    suggestedDocuments: string[];
    documentJustifications: string[];
    riskLevel: "low" | "medium" | "high";
    riskSummary: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resultado final após publicação
  const [aiResult, setAiResult] = useState<{
    complianceLevel: "green" | "yellow" | "orange" | "red" | "pending";
    complianceExplanation: string;
    suggestedDocuments: string[];
    frauenTrustScore: number;
    status: string;
  } | null>(null);

  // Mutation de análise prévia (Item 4.1)
  const analyzeForComplianceMutation = trpc.opportunities.analyzeForCompliance.useMutation({
    onSuccess: (data) => {
      setPreAnalysis(data as any);
      setIsAnalyzing(false);
    },
    onError: () => setIsAnalyzing(false),
  });

  // Disparar análise prévia quando título + descrição + tipo estiverem preenchidos
  useEffect(() => {
    if (analyzeDebounceRef.current) clearTimeout(analyzeDebounceRef.current);
    if (title.length >= 10 && description.length >= 30 && type) {
      setIsAnalyzing(true);
      analyzeDebounceRef.current = setTimeout(() => {
        analyzeForComplianceMutation.mutate({
          title: title.trim(),
          description: description.trim(),
          type: type as any,
          sector: sector || undefined,
        });
      }, 1500); // debounce 1.5s
    } else {
      setPreAnalysis(null);
      setIsAnalyzing(false);
    }
    return () => { if (analyzeDebounceRef.current) clearTimeout(analyzeDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, type, sector]);

  const createMutation = trpc.opportunities.create.useMutation({
    onSuccess: (result) => {
      setAiResult({
        complianceLevel: result.complianceLevel as any,
        complianceExplanation: result.complianceExplanation ?? "",
        suggestedDocuments: result.suggestedDocuments as string[] ?? [],
        frauenTrustScore: 50,
        status: result.status,
      });
      if (result.complianceLevel === "red") {
        toast.error(t("newOpportunity.toastRejected"));
      } else if (result.status === "pending") {
        // Toda oportunidade nasce em análise; dizer "publicada" fazia parecer
        // que ela tinha sumido, porque a lista pública só mostra as aprovadas.
        toast.success(t("newOpportunity.toastPendingTitle"), {
          description: t("newOpportunity.toastPendingDescription"),
        });
        setTimeout(() => navigate(`/opportunities`), 2200);
      } else {
        toast.success(t("newOpportunity.receivedMessage"));
        setTimeout(() => navigate(`/opportunities`), 1500);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Sugestões simples por tipo, para reduzir tag inventada e vocabulário
  // fragmentado (tudo minúsculo, mesmo formato que handleAddTag grava).
  const SUGGESTED_TAGS: Record<string, string[]> = {
    offer: [t("newOpportunity.tagSuggestionProduto"), t("newOpportunity.tagSuggestionServico"), t("newOpportunity.tagSuggestionConsultoria"), t("newOpportunity.tagSuggestionExportacao")],
    demand: [t("newOpportunity.tagSuggestionFornecedor"), t("newOpportunity.tagSuggestionOrcamento"), t("newOpportunity.tagSuggestionPrazoCurto"), t("newOpportunity.tagSuggestionRecorrente")],
    investment: [t("newOpportunity.tagSuggestionAporte"), t("newOpportunity.tagSuggestionSociedade"), t("newOpportunity.tagSuggestionExpansao"), t("newOpportunity.tagSuggestionCapitalGiro")],
    partnership: [t("newOpportunity.tagSuggestionParceria"), t("newOpportunity.tagSuggestionCoBranding"), t("newOpportunity.tagSuggestionDistribuicao"), t("newOpportunity.tagSuggestionRepresentacao")],
    distribution: [t("newOpportunity.tagSuggestionLogistica"), t("newOpportunity.tagSuggestionRevenda"), t("newOpportunity.tagSuggestionAtacado"), t("newOpportunity.tagSuggestionVarejo")],
    other: [t("newOpportunity.tagSuggestionNetworking"), t("newOpportunity.tagSuggestionMentoria"), t("newOpportunity.tagSuggestionEvento"), t("newOpportunity.tagSuggestionProjetoSocial")],
  };
  const suggestedForType = (SUGGESTED_TAGS[type] ?? [])
    .concat(sector ? [sector.toLowerCase()] : [])
    .filter(s => !tags.includes(s))
    .slice(0, 5);

  const handleAddTag = () => {
    const newTag = tagInput.trim().toLowerCase();
    if (newTag && !tags.includes(newTag) && tags.length < 10) {
      setTags([...tags, newTag]);
      setTagInput("");
    }
  };

  const handleSubmit = () => {
    if (!title.trim() || title.length < 10) return toast.error(t("newOpportunity.toastTitleTooShort"));
    if (!description.trim() || description.length < 30) return toast.error(t("newOpportunity.toastDescriptionTooShort"));
    if (!type) return toast.error(t("newOpportunity.toastSelectType"));

    createMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      type: type as any,
      sector: sector || undefined,
      country: country || undefined,
      tags,
      isConfidential,
    });
  };

  const isLoading = createMutation.isPending;
  const compliance = aiResult ? COMPLIANCE_COLORS[aiResult.complianceLevel] : null;
  const risk = preAnalysis ? RISK_COLORS[preAnalysis.riskLevel] : null;

  return (
    <div className="min-h-screen bg-transparent text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#060E1A]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/opportunities")} className="text-white/50 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">{t("newOpportunity.pageTitle")}</h1>
              <p className="text-white/40 text-xs">{t("newOpportunity.pageSubtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-amber-400/70">
            <Sparkles size={12} />
            <span>{t("newOpportunity.securityBadge")}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Formulário ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Título */}
            <div>
              <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.titleLabel")}</label>
              <Input
                placeholder={t("newOpportunity.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50"
              />
              <p className="text-white/25 text-xs mt-1 text-right">{title.length}/300</p>
            </div>

            {/* Tipo */}
            <div>
              <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.typeLabel")}</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder={t("newOpportunity.typePlaceholder")} />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1628] border-white/10 text-white">
                  <SelectItem value="offer">{t("newOpportunity.typeOfferOption")}</SelectItem>
                  <SelectItem value="demand">{t("newOpportunity.typeDemandOption")}</SelectItem>
                  <SelectItem value="investment">{t("newOpportunity.typeInvestmentOption")}</SelectItem>
                  <SelectItem value="partnership">{t("newOpportunity.typePartnershipOption")}</SelectItem>
                  <SelectItem value="distribution">{t("newOpportunity.typeDistributionOption")}</SelectItem>
                  <SelectItem value="other">{t("newOpportunity.typeOtherOption")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.descriptionLabel")}</label>
              <Textarea
                placeholder={t("newOpportunity.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                rows={8}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50 resize-none"
              />
              <p className="text-white/25 text-xs mt-1 text-right">{description.length}/5000</p>
            </div>

            {/* ── ANÁLISE PRÉVIA IA (Item 4.1) ── */}
            {(isAnalyzing || preAnalysis) && !aiResult && (
              <div className="rounded-2xl border overflow-hidden transition-all duration-300"
                style={{ borderColor: preAnalysis ? `${RISK_COLORS[preAnalysis.riskLevel].color}40` : "#ffffff20" }}>
                {/* Header do painel */}
                <div className="px-4 py-3 flex items-center gap-2"
                  style={{ background: preAnalysis ? `${RISK_COLORS[preAnalysis.riskLevel].color}12` : "rgba(255,255,255,0.04)" }}>
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={14} className="text-amber-400 animate-spin" />
                      <span className="text-amber-400 text-xs font-semibold">{t("newOpportunity.analyzingSecurity")}</span>
                    </>
                  ) : risk ? (
                    <>
                      <span style={{ color: risk.color }}>{risk.icon}</span>
                      <span className="text-xs font-semibold" style={{ color: risk.color }}>
                        {t("newOpportunity.previewAnalysisLabel", { label: risk.label })}
                      </span>
                    </>
                  ) : null}
                </div>

                {preAnalysis && (
                  <div className="p-4 space-y-4 bg-white/2">
                    {/* Pergunta dinâmica */}
                    <div className="flex items-start gap-2.5">
                      <HelpCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">{t("newOpportunity.aiQuestionLabel")}</p>
                        <p className="text-white/80 text-sm leading-relaxed">{preAnalysis.dynamicQuestion}</p>
                      </div>
                    </div>

                    {/* Resumo de risco */}
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={14} className="text-white/30 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">{t("newOpportunity.riskAnalysisLabel")}</p>
                        <p className="text-white/60 text-xs leading-relaxed">{preAnalysis.riskSummary}</p>
                      </div>
                    </div>

                    {/* Documentos sugeridos */}
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <FileText size={13} className="text-amber-400" />
                        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                          {t("newOpportunity.recommendedDocsLabel")}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {preAnalysis.suggestedDocuments.map((doc, i) => (
                          <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/4 border border-white/8">
                            <ChevronRight size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-white/80 text-xs font-medium">{doc}</p>
                              {preAnalysis.documentJustifications[i] && (
                                <p className="text-white/40 text-xs mt-0.5">{preAnalysis.documentJustifications[i]}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-white/30 text-xs mt-2.5 italic">
                        {t("newOpportunity.saveDocsNote")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Setor e País */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.sectorFieldLabel")}</label>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder={t("newOpportunity.selectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1628] border-white/10 max-h-60 text-white">
                    {sortTextAlphabetically(SECTORS).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.countryFieldLabel")}</label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder={t("newOpportunity.selectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1628] border-white/10 max-h-60 text-white">
                    {sortOptionsAlphabetically(COUNTRIES.map(country => ({ ...country, label: country.name }))).map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t("newOpportunity.tagsLabel")}</label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder={t("newOpportunity.tagInputPlaceholder")}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 h-9 text-sm"
                />
                <Button size="sm" variant="outline" onClick={handleAddTag}
                  disabled={!tagInput.trim() || tags.length >= 10}
                  className="border-white/20 text-white/60 hover:text-white">
                  <Tag size={14} />
                </Button>
              </div>
              {suggestedForType.length > 0 && tags.length < 10 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-white/30 text-xs">{t("newOpportunity.tagSuggestionsLabel")}</span>
                  {suggestedForType.map((sug) => (
                    <button key={sug} type="button"
                      className="text-xs px-2 py-0.5 rounded-full border border-white/15 text-white/50 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
                      onClick={() => setTags([...tags, sug])}>
                      + {sug}
                    </button>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline"
                      className="border-amber-500/30 text-amber-300 bg-amber-500/10 text-xs gap-1 cursor-pointer hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300 transition-colors"
                      onClick={() => setTags(tags.filter((tg) => tg !== tag))}>
                      #{tag} <X size={10} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Confidencial */}
            <div
              className={`p-4 rounded-xl border cursor-pointer transition-all ${isConfidential ? "border-amber-500/40 bg-amber-500/10" : "border-white/10 bg-white/5 hover:border-white/20"}`}
              onClick={() => setIsConfidential(!isConfidential)}>
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isConfidential ? "border-amber-500 bg-amber-500" : "border-white/30"}`}>
                  {isConfidential && <CheckCircle size={12} className="text-black" />}
                </div>
                <div>
                  <p className="text-white text-sm font-medium flex items-center gap-1.5">
                    <Lock size={13} className="text-amber-400" />
                    {t("newOpportunity.confidentialLabel")}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5">{t("newOpportunity.confidentialDescription")}</p>
                </div>
              </div>
            </div>

            {/* Botão de publicar */}
            <Button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 text-base gap-2"
              onClick={handleSubmit}
              disabled={isLoading}>
              {isLoading ? (
                <><div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />{t("newOpportunity.submittingLabel")}</>
              ) : (
                <><Sparkles size={16} />{t("newOpportunity.submitButton")}</>
              )}
            </Button>

            {isLoading && (
              <div className="text-center">
                <p className="text-amber-400/60 text-xs animate-pulse">
                  {t("newOpportunity.submittingNote")}
                </p>
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-4">
            {/* Como funciona */}
            {!aiResult && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Sparkles size={12} className="text-amber-400" />
                  {t("newOpportunity.howItWorksTitle")}
                </h3>
                <div className="space-y-3 text-xs text-white/50 leading-relaxed">
                  <p>{t("newOpportunity.howItWorksIntroPrefix")} <strong className="text-white/70">{t("newOpportunity.howItWorksIntroBold")}</strong> {t("newOpportunity.howItWorksIntroSuffix")}</p>
                  <div className="space-y-2">
                    {[
                      { step: "1", text: t("newOpportunity.step1Text"), color: "#f97316" },
                      { step: "2", text: t("newOpportunity.step2Text"), color: "#eab308" },
                      { step: "3", text: t("newOpportunity.step3Text"), color: "#22c55e" },
                      { step: "4", text: t("newOpportunity.step4Text"), color: "#3b82f6" },
                    ].map((item) => (
                      <div key={item.step} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                          style={{ background: `${item.color}30`, color: item.color }}>
                          {item.step}
                        </span>
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Escala de confiabilidade */}
            {!aiResult && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">{t("newOpportunity.reliabilityScaleTitle")}</h3>
                <div className="space-y-2">
                  {[
                    { color: "#22c55e", label: t("newOpportunity.scaleGreenLabel"), desc: t("newOpportunity.scaleGreenDesc") },
                    { color: "#eab308", label: t("newOpportunity.scaleYellowLabel"), desc: t("newOpportunity.scaleYellowDesc") },
                    { color: "#f97316", label: t("newOpportunity.scaleOrangeLabel"), desc: t("newOpportunity.scaleOrangeDesc") },
                    { color: "#ef4444", label: t("newOpportunity.scaleRedLabel"), desc: t("newOpportunity.scaleRedDesc") },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="font-medium" style={{ color: item.color }}>{item.label}</span>
                      <span className="text-white/40">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resultado final após publicação */}
            {aiResult && compliance && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">{t("newOpportunity.resultTitle")}</h3>
                <div className="flex flex-col items-center gap-3">
                  <FTSBadge score={aiResult.frauenTrustScore} level={aiResult.complianceLevel} size="lg" />
                  <div className={`w-full rounded-xl p-3 text-center ${compliance.bg} border ${compliance.border}`}>
                    <div className={`flex items-center justify-center gap-1.5 mb-1 ${compliance.text}`}>
                      {compliance.icon}
                      <span className="font-semibold text-sm">{compliance.label}</span>
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">{aiResult.complianceExplanation}</p>
                  </div>
                </div>

                {aiResult.suggestedDocuments.length > 0 && (
                  <div className="mt-4">
                    <p className="text-white/40 text-xs font-semibold mb-2">{t("newOpportunity.suggestedDocsLabel")}</p>
                    <ul className="space-y-1">
                      {aiResult.suggestedDocuments.map((doc, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-white/50">
                          <div className="w-1 h-1 rounded-full bg-amber-400/50 mt-1.5 flex-shrink-0" />
                          {doc}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.complianceLevel !== "red" && (
                  <div className="mt-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                    <div className="flex items-center gap-1.5 text-green-400 text-xs">
                      <CheckCircle size={12} />
                      <span>{t("newOpportunity.receivedMessage")}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Diretrizes */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">{t("newOpportunity.guidelinesTitle")}</h3>
              <div className="space-y-2 text-xs text-white/40 leading-relaxed">
                {[
                  { icon: "✅", text: t("newOpportunity.guideline1") },
                  { icon: "✅", text: t("newOpportunity.guideline2") },
                  { icon: "❌", text: t("newOpportunity.guideline3") },
                  { icon: "❌", text: t("newOpportunity.guideline4") },
                  { icon: "❌", text: t("newOpportunity.guideline5") },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span>{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
