import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FTSBadge } from "./Opportunities";
import {
  ArrowLeft, Eye, Star, Bookmark, BookmarkCheck, Globe,
  Briefcase, DollarSign, Users, Package, TrendingUp,
  FileText, ShieldCheck, AlertTriangle, AlertCircle, XCircle,
  Clock, MessageSquare, ChevronRight, Lock
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  offer: "Oferta",
  demand: "Demanda",
  investment: "Investimento",
  partnership: "Parceria",
  distribution: "Distribuição",
  other: "Outro",
};

const COMPLIANCE_INFO: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; desc: string }> = {
  green: {
    icon: <ShieldCheck size={16} />,
    label: "Confiável",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.1)",
    desc: "Esta oportunidade passou pela análise de compliance da IA e apresenta indicadores de alta confiabilidade.",
  },
  yellow: {
    icon: <AlertTriangle size={16} />,
    label: "Atenção",
    color: "#eab308",
    bg: "rgba(234,179,8,0.1)",
    desc: "A IA identificou pontos de atenção. Verifique a documentação antes de prosseguir.",
  },
  orange: {
    icon: <AlertCircle size={16} />,
    label: "Suspeita",
    color: "#f97316",
    bg: "rgba(249,115,22,0.1)",
    desc: "A IA identificou indicadores suspeitos. Proceda com cautela e solicite documentação adicional.",
  },
  red: {
    icon: <XCircle size={16} />,
    label: "Bloqueada",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.1)",
    desc: "Esta oportunidade foi bloqueada pela análise de compliance. Não é possível demonstrar interesse.",
  },
  pending: {
    icon: <Clock size={16} />,
    label: "Analisando",
    color: "#9ca3af",
    bg: "rgba(107,114,128,0.1)",
    desc: "A análise de compliance ainda está em andamento.",
  },
};

export default function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isGold = user?.role === "gold" || user?.role === "admin" || user?.role === "president";
  const [showInterestForm, setShowInterestForm] = useState(false);
  const [interestMessage, setInterestMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [showNDAModal, setShowNDAModal] = useState(false);
  const [ndaMessage, setNdaMessage] = useState("");

  const { data: rawData, isLoading, error } = trpc.opportunities.get.useQuery({ id: Number(id) });
  const data = rawData as any;

  const expressInterest = trpc.opportunities.expressInterest.useMutation({
    onSuccess: () => {
      toast.success("Interesse demonstrado! A publicadora foi notificada.");
      setShowInterestForm(false);
      setInterestMessage("");
    },
    onError: (err) => toast.error(err.message),
  });

  const openDealRoom = trpc.dealRoom.openRoom.useMutation({
    onSuccess: (res) => {
      setShowNDAModal(false);
      toast.success(res.isNew ? "Deal Room criado! Assine o NDA para ativar a sala." : "Você já tem um Deal Room para esta oportunidade.");
      navigate(`/deal-room/${res.roomId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleSave = trpc.opportunities.toggleSave.useMutation({
    onSuccess: (res: any) => {
      setSaved(res.saved);
      toast.success(res.saved ? "Salvo nos favoritos!" : "Removido dos favoritos");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent text-white">
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48 bg-white/10" />
          <Skeleton className="h-6 w-full bg-white/10" />
          <Skeleton className="h-4 w-3/4 bg-white/10" />
          <Skeleton className="h-32 w-full bg-white/10" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-transparent text-white flex items-center justify-center">
        <div className="text-center">
          <Lock size={40} className="text-white/20 mx-auto mb-4" />
          <p className="text-white/60 text-sm">{error?.message ?? "Oportunidade não encontrada"}</p>
          <Link href="/opportunities">
            <Button size="sm" variant="outline" className="mt-4 border-white/20 text-white/60">
              Voltar
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const opp = data;
  const compliance = COMPLIANCE_INFO[opp.complianceLevel ?? "pending"];
  const canInterest = opp.complianceLevel !== "red" && opp.status === "active";

  return (
    <div className="min-h-screen bg-transparent text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#060E1A]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/opportunities">
            <button className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm">
              <ArrowLeft size={16} />
              Oportunidades
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleSave.mutate({ opportunityId: opp.id })}
              className={`p-2 rounded-lg border transition-colors ${saved ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-white/10 text-white/40 hover:text-white"}`}
            >
              {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Banner de status para a criadora */}
        {opp.status === "pending" && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-start gap-3">
            <span className="text-amber-400 text-lg mt-0.5">⏳</span>
            <div>
              <p className="text-amber-300 font-semibold text-sm">Aguardando validação</p>
              <p className="text-amber-200/70 text-xs mt-0.5">Sua oportunidade está em análise pelas membras Ouro. Apenas você pode visualizá-la até ser aprovada.</p>
            </div>
          </div>
        )}
        {opp.status === "rejected" && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 flex items-start gap-3">
            <span className="text-red-400 text-lg mt-0.5">❌</span>
            <div>
              <p className="text-red-300 font-semibold text-sm">Oportunidade rejeitada</p>
              <p className="text-red-200/70 text-xs mt-0.5">Esta oportunidade foi rejeitada pelas membras Ouro e não está visível para outras membras.</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conteúdo principal */}
          <div className="lg:col-span-2 space-y-6">
            {/* Título e tipo */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">
                  {TYPE_LABELS[opp.type] ?? opp.type}
                </Badge>
                {opp.sector && (
                  <Badge variant="outline" className="border-white/15 text-white/50 bg-transparent text-xs">
                    {opp.sector}
                  </Badge>
                )}
                {opp.isConfidential && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                    ★ Exclusivo Ouro
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl font-bold text-white leading-tight mb-2">{opp.title}</h1>
              <div className="flex items-center gap-4 text-xs text-white/40">
                <span className="flex items-center gap-1"><Eye size={11} />{Number(opp.viewCount ?? 0)} visualizações</span>
                <span className="flex items-center gap-1"><Star size={11} />{Number(opp.interestCount ?? 0)} interesses</span>
                {opp.country && <span className="flex items-center gap-1"><Globe size={11} />{opp.country}</span>}
              </div>
            </div>

            {/* Descrição */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="text-white font-semibold text-sm mb-3">Descrição</h2>
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{opp.description}</p>
            </div>

            {/* Tags */}
            {opp.tags && Array.isArray(opp.tags) && opp.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(opp.tags as string[]).map((tag, i) => (
                  <Badge key={i} variant="outline" className="border-white/15 text-white/50 bg-transparent text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Documentos sugeridos pela IA */}
            {opp.suggestedDocuments && Array.isArray(opp.suggestedDocuments) && opp.suggestedDocuments.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <FileText size={14} className="text-amber-400" />
                  Documentos recomendados pela IA
                </h2>
                <ul className="space-y-2">
                  {(opp.suggestedDocuments as string[]).map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 text-white/60 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400/50 flex-shrink-0" />
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Documentos anexados */}
            {opp.documents && opp.documents.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <FileText size={14} className="text-amber-400" />
                  Documentos ({opp.documents.length})
                </h2>
                <div className="space-y-2">
                  {opp.documents.map((doc: any) => (
                    <a
                      key={doc.id}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
                    >
                      <FileText size={14} className="text-amber-400 flex-shrink-0" />
                      <span className="text-white/70 text-sm flex-1 truncate group-hover:text-white transition-colors">{doc.name}</span>
                      {doc.isConfidential && !isGold && (
                        <Lock size={12} className="text-amber-400/50" />
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Formulário de interesse */}
            {showInterestForm && (
              <div className="bg-white/5 border border-amber-500/20 rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-3">Mensagem de interesse (opcional)</h2>
                <Textarea
                  placeholder="Apresente-se brevemente e explique por que esta oportunidade é relevante para você..."
                  value={interestMessage}
                  onChange={(e) => setInterestMessage(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none"
                  rows={4}
                  maxLength={500}
                />
                <p className="text-white/30 text-xs mt-1 text-right">{interestMessage.length}/500</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={() => expressInterest.mutate({ opportunityId: opp.id, message: interestMessage || undefined })}
                    disabled={expressInterest.isPending}
                    className="bg-amber-500 hover:bg-amber-400 text-black font-semibold"
                  >
                    {expressInterest.isPending ? "Enviando..." : "Confirmar interesse"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowInterestForm(false)}
                    className="border-white/20 text-white/60"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* FTS Card */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
                Nota de confiança
              </h3>
              <div className="flex flex-col items-center gap-3">
                <FTSBadge
                  score={opp.frauenTrustScore ?? 0}
                  level={opp.complianceLevel ?? "pending"}
                  size="lg"
                />
                <div
                  className="w-full rounded-xl p-3 text-center"
                  style={{ background: compliance.bg, border: `1px solid ${compliance.color}30` }}
                >
                  <div className="flex items-center justify-center gap-1.5 mb-1" style={{ color: compliance.color }}>
                    {compliance.icon as React.ReactNode}
                    <span className="font-semibold text-sm">{compliance.label}</span>
                  </div>
                  <p className="text-white/50 text-xs leading-relaxed">{compliance.desc}</p>
                </div>
                {opp.complianceExplanation && (
                  <div className="text-white/40 text-xs leading-relaxed space-y-2">
                    {opp.complianceExplanation.split('\n\n').map((block: string, i: number) => (
                      <p key={i} className="leading-relaxed">
                        {block.split('**').map((part: string, j: number) =>
                          j % 2 === 1
                            ? <strong key={j} className="text-white/60 font-semibold">{part}</strong>
                            : <span key={j}>{part}</span>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Ação principal — Demonstrar Interesse abre Deal Room */}
            {canInterest && (
              <div className="bg-white/5 border border-amber-500/20 rounded-2xl p-5">
                <h3 className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Lock size={12} /> Deal Room Privado
                </h3>
                <p className="text-white/50 text-xs mb-4 leading-relaxed">
                  Ao demonstrar interesse, você e a publicadora assinarão um <strong className="text-amber-400">Termo de Confidencialidade (NDA)</strong> e uma sala de negociação privada será aberta entre vocês.
                </p>
                <Button
                  className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold"
                  onClick={() => setShowNDAModal(true)}
                >
                  <Star size={14} className="mr-1.5" />
                  Demonstrar Interesse
                </Button>
              </div>
            )}

            {opp.complianceLevel === "red" && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-red-400 mb-2">
                  <XCircle size={14} />
                  <span className="text-sm font-semibold">Oportunidade bloqueada</span>
                </div>
                <p className="text-red-400/60 text-xs leading-relaxed">
                  Esta oportunidade foi bloqueada pela análise de compliance. Não é possível demonstrar interesse.
                </p>
              </div>
            )}

            {/* Informações */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Informações</h3>
              {[
                { label: "Tipo", value: TYPE_LABELS[opp.type] ?? opp.type },
                { label: "Setor", value: opp.sector ?? "-" },
                { label: "País", value: opp.country ?? "-" },
                { label: "Região", value: opp.region ?? "-" },
                { label: "Status", value: opp.status === "active" ? "✅ Ativa" : opp.status === "pending" ? "⏳ Pendente" : opp.status },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-white/40">{item.label}</span>
                  <span className="text-white/70">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal NDA */}
      {showNDAModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="bg-[#1a1a2e] border border-amber-500/30 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Lock size={18} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">Termo de Confidencialidade</h2>
                <p className="text-white/40 text-xs">NDA com aceite digital obrigatório</p>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4 max-h-64 overflow-y-auto text-xs text-white/60 leading-relaxed space-y-3">
              <p className="text-amber-400 font-semibold text-sm">TERMO DE CONFIDENCIALIDADE E NÃO DIVULGAÇÃO (NDA)</p>
              <p>Ao aceitar este termo, as partes envolvidas (“Divulgadora” e “Receptora”) concordam em manter sigilo absoluto sobre todas as informações compartilhadas no contexto desta negociação, incluindo dados financeiros, estratégicos, operacionais e comerciais.</p>
              <p><strong className="text-white/80">1. Obrigação de Sigilo:</strong> As partes se comprometem a não divulgar, reproduzir ou utilizar as informações confidenciais para fins alheios à negociação em curso, sob pena das sanções previstas em lei.</p>
              <p><strong className="text-white/80">2. Cláusula Anti-Bypass (Antiburla):</strong> As partes se comprometem expressamente a não realizar qualquer transação, acordo ou negócio decorrente deste contato fora do ecossistema MMM, reconhecendo a obrigatoriedade do pagamento da <strong className="text-amber-400">taxa de sucesso (success fee)</strong> sobre quaisquer negócios fechados que tenham se originado desta conexão.</p>
              <p><strong className="text-white/80">3. Vigência:</strong> Este acordo tem validade de 24 (vinte e quatro) meses a partir da data de aceite digital.</p>
              <p><strong className="text-white/80">4. Aceite Digital:</strong> O clique no botão “Aceitar e Abrir Deal Room” constitui aceite digital válido e juridicamente vinculante, com registro de data, hora e identidade das partes.</p>
              <p className="text-white/40 text-xs border-t border-white/10 pt-3">Oportunidade: <strong className="text-white/60">{opp.title}</strong> • Data: {new Date().toLocaleDateString("pt-BR")} • Usuária: {user?.name}</p>
            </div>

            <div className="mb-4">
              <label className="text-white/60 text-xs mb-1.5 block">Mensagem de apresentação (opcional)</label>
              <textarea
                value={ndaMessage}
                onChange={(e) => setNdaMessage(e.target.value)}
                placeholder="Apresente-se brevemente e explique por que esta oportunidade é relevante para você..."
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs placeholder:text-white/30 resize-none focus:outline-none focus:border-amber-500/40"
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="flex gap-3">
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold"
                onClick={() => openDealRoom.mutate({ opportunityId: opp.id, message: ndaMessage || undefined })}
                disabled={openDealRoom.isPending}
              >
                {openDealRoom.isPending ? "Abrindo..." : "🔐 Aceitar e Abrir Deal Room"}
              </Button>
              <Button
                variant="outline"
                className="border-white/20 text-white/60 bg-transparent"
                onClick={() => setShowNDAModal(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
