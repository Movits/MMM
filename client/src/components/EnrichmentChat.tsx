import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Send, Check, Edit2, X, Sparkles, ChevronDown, ChevronUp, Clock } from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Suggestion = {
  id: string;
  fieldType: string;
  suggestedValue: string;
  confidence: number;
  displayLabel?: string;
  status: "pending" | "confirmed" | "edited" | "ignored" | "applied";
};

type Message = {
  id: string;
  role: "assistant" | "user";
  content: string;
  suggestions?: Suggestion[];
};

// ─── Labels amigáveis por field_type ─────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  phone: "📞 Telefone", whatsapp: "💬 WhatsApp", email: "📧 E-mail",
  company: "🏢 Empresa", job_title: "💼 Cargo", city: "📍 Cidade",
  country: "🌍 País", linkedin_url: "🔗 LinkedIn", instagram_handle: "📸 Instagram",
  asset_tag: "✨ Ativo", need_tag: "🎯 Necessidade", context_link: "📅 Contexto",
  relationship_type: "🤝 Relacionamento", notes: "📝 Notas",
};

// ─── Card de sugestão ─────────────────────────────────────────────────────────
// O cartão NÃO se esconde sozinho ao clicar: fica na tela até o servidor
// responder, e é o pai quem muda o status da sugestão (applied/ignored) no
// sucesso. Antes ele sumia antes da resposta; se a confirmação falhava, a
// conversa ficava sem cartão, sem campo de digitar e com o aviso "Confirme ou
// ignore..." apontando para nada.
function SuggestionCard({ suggestion, busy, onConfirm, onIgnore }: {
  suggestion: Suggestion;
  busy: boolean;
  onConfirm: (id: string, editedValue?: string) => void;
  onIgnore: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(suggestion.suggestedValue);

  const label = FIELD_LABELS[suggestion.fieldType] ?? suggestion.fieldType;
  const pct = Math.round(suggestion.confidence * 100);

  return (
    <div className="mt-2 p-3 rounded-xl bg-[#0a1628] border border-amber-500/20 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-amber-400 font-medium">{label}</span>
        <span className="text-xs text-white/30">{pct}% confiança</span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Input value={editValue} onChange={e => setEditValue(e.target.value)} maxLength={2000}
            className="bg-white/5 border-white/10 text-white text-sm h-8" />
          <Button size="sm" disabled={busy} onClick={() => onConfirm(suggestion.id, editValue)}
            className="w-full bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold h-8 text-xs">
            Salvar edição
          </Button>
        </div>
      ) : (
        <>
          <p className="text-white font-medium mb-2 truncate">{suggestion.suggestedValue}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => onConfirm(suggestion.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/25 transition-colors disabled:opacity-50">
              <Check size={12} /> Confirmar
            </button>
            <button disabled={busy} onClick={() => setEditing(true)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs font-medium hover:bg-blue-500/25 transition-colors disabled:opacity-50">
              <Edit2 size={12} /> Editar
            </button>
            <button disabled={busy} onClick={() => onIgnore(suggestion.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/40 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50">
              <X size={12} /> Ignorar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Bubble de mensagem ───────────────────────────────────────────────────────
function MessageBubble({ msg, busy, onConfirm, onIgnore }: {
  msg: Message;
  busy: boolean;
  onConfirm: (id: string, editedValue?: string) => void;
  onIgnore: (id: string) => void;
}) {
  const isAI = msg.role === "assistant";
  // Só o que ainda espera decisão vira cartão; o decidido some da tela.
  const pendentes = msg.suggestions?.filter(s => s.status === "pending") ?? [];
  return (
    <div className={`flex ${isAI ? "justify-start" : "justify-end"} mb-3`}>
      <div className={`max-w-[80%] ${isAI ? "" : "items-end"}`}>
        {isAI && (
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Sparkles size={10} className="text-amber-400" />
            </div>
            <span className="text-xs text-white/30">Assistente MMM</span>
          </div>
        )}
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isAI
            ? "bg-white/8 text-white rounded-tl-sm"
            : "bg-amber-500/20 text-white rounded-tr-sm border border-amber-500/20"
        }`}>
          {msg.content}
        </div>
        {isAI && pendentes.length > 0 && (
          <div className="mt-1 space-y-1">
            {pendentes.map(s => (
              <SuggestionCard key={s.id} suggestion={s} busy={busy} onConfirm={onConfirm} onIgnore={onIgnore} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Indicador "pensando" ─────────────────────────────────────────────────────
function ThinkingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%]">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Sparkles size={10} className="text-amber-400" />
          </div>
          <span className="text-xs text-white/30">Assistente MMM</span>
        </div>
        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white/8 flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Hidratação a partir do servidor ─────────────────────────────────────────
// enrichment.getMessages devolve, em cada mensagem, os cartões que ainda
// esperam decisão (status pending). Antes o map descartava isso e uma
// confirmação pendente era irrecuperável ao reabrir o detalhe do contato.
type MensagemDoServidor = { id: string; role: string; content: string; suggestions?: Suggestion[] };

function hidratarMensagens(rows: MensagemDoServidor[]): Message[] {
  return rows.map(m => ({
    id: m.id,
    role: m.role as "assistant" | "user",
    content: m.content,
    suggestions: m.suggestions?.filter(s => s.status === "pending"),
  }));
}

function temCartaoPendente(rows: MensagemDoServidor[]) {
  return rows.some(m => m.suggestions?.some(s => s.status === "pending"));
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function EnrichmentChat({ contactId, contactName }: { contactId: number; contactName: string }) {
  const [expanded, setExpanded] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledSuggestionIds = useRef(new Set<string>());
  const utils = trpc.useUtils();

  const { data: activeSession, isLoading: loadingSession } = trpc.enrichment.getActiveSession.useQuery(
    { contactId },
    { refetchOnWindowFocus: false }
  );

  // Carregar mensagens da sessão existente
  const { data: existingMessages } = trpc.enrichment.getMessages.useQuery(
    // 50 é o teto do servidor: o cartão pendente viaja junto da mensagem dele, e
    // uma janela curta demais o deixaria fora da tela numa sessão longa.
    { sessionId: sessionId ?? "", limit: 50 },
    { enabled: !!sessionId, refetchOnWindowFocus: false }
  );

  useEffect(() => {
    if (activeSession?.id && !sessionId) {
      setSessionId(activeSession.id);
    }
    if (activeSession?.status === "completed") {
      setIsComplete(true);
    }
  }, [activeSession, sessionId]);

  useEffect(() => {
    if (existingMessages && existingMessages.length > 0 && messages.length === 0) {
      setMessages(hidratarMensagens(existingMessages));
      setAwaitingConfirmation(temCartaoPendente(existingMessages));
    }
  }, [existingMessages, messages.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reidrata a conversa a partir do servidor, cartões pendentes inclusos.
  const recarregarConversa = async () => {
    if (!sessionId) return;
    try {
      const rows = await utils.enrichment.getMessages.fetch({ sessionId, limit: 50 });
      setMessages(hidratarMensagens(rows));
      setAwaitingConfirmation(temCartaoPendente(rows));
    } catch {
      toast.error("Não consegui recarregar a conversa. Feche e abra o contato de novo.");
    }
  };

  // Decisão registrada no servidor: o cartão sai da tela por aqui, nunca antes.
  const marcarSugestao = (suggestionId: string, status: Suggestion["status"]) => {
    setMessages(prev => prev.map(m => m.suggestions
      ? { ...m, suggestions: m.suggestions.map(s => s.id === suggestionId ? { ...s, status } : s) }
      : m));
  };

  const startMut = trpc.enrichment.startSession.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setMessages([{ id: data.firstMessageId, role: "assistant", content: data.firstQuestion }]);
    },
    onError: (e) => {
      if (e.message === "SESSION_ALREADY_ACTIVE") {
        toast.info("Sessão de enriquecimento já está ativa.");
      } else {
        toast.error("Erro ao iniciar enriquecimento: " + e.message);
      }
    },
  });

  const sendMut = trpc.enrichment.sendMessage.useMutation({
    onSuccess: (data) => {
      if (data.messageId && data.aiResponse) {
        const aiMsg: Message = {
          id: data.messageId,
          role: "assistant",
          content: data.aiResponse,
          suggestions: data.suggestions as Suggestion[],
        };
        setMessages(prev => prev.some(msg => msg.id === aiMsg.id) ? prev : [...prev, aiMsg]);
      }
      setAwaitingConfirmation(Boolean(data.awaitingConfirmation));
      if (data.sessionComplete) {
        setIsComplete(true);
        setCompletionSummary(data.completionSummary ?? null);
        setAwaitingConfirmation(false);
        void utils.enrichment.getActiveSession.invalidate({ contactId });
      }
    },
    onError: (e) => {
      // O servidor recusou porque há cartão esperando decisão (esta tela ou
      // outra aba perdeu o cartão): traz a conversa de volta com ele.
      if (e.message === "SUGGESTION_PENDING") {
        toast.info("Há uma sugestão esperando sua decisão. Confirme ou ignore para continuar.");
        void recarregarConversa();
        return;
      }
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Não consegui processar sua resposta agora. Tente novamente.",
      }]);
    },
  });

  const confirmMut = trpc.enrichment.confirmSuggestion.useMutation({
    onSuccess: (data, { suggestionId }) => {
      marcarSugestao(suggestionId, "applied");
      toast.success("Informação salva no perfil!");
      setAwaitingConfirmation(false);
      if (data.sessionComplete) {
        setIsComplete(true);
        setCompletionSummary("Cadastro enriquecido com sucesso!");
        void utils.enrichment.getActiveSession.invalidate({ contactId });
      } else if (data.nextQuestion && data.nextMessageId) {
        setMessages(prev => prev.some(msg => msg.id === data.nextMessageId)
          ? prev
          : [...prev, { id: data.nextMessageId, role: "assistant", content: data.nextQuestion }]);
      }
    },
    onError: (e, { suggestionId }) => {
      // Falhou: o cartão continua na tela e a decisão continua pendente.
      handledSuggestionIds.current.delete(suggestionId);
      setAwaitingConfirmation(true);
      // A frase do servidor só serve se for uma frase: a validação do zod também
      // é BAD_REQUEST, mas vem como JSON em inglês.
      const explicacao = e.data?.code === "BAD_REQUEST" && !e.message.trim().startsWith("[") ? e.message : null;
      toast.error(explicacao ?? "Erro ao salvar informação.");
    },
  });

  const ignoreMut = trpc.enrichment.ignoreSuggestion.useMutation({
    onSuccess: (data, { suggestionId }) => {
      marcarSugestao(suggestionId, "ignored");
      setAwaitingConfirmation(false);
      if (data.sessionComplete) {
        setIsComplete(true);
        setCompletionSummary("Cadastro enriquecido com sucesso!");
        void utils.enrichment.getActiveSession.invalidate({ contactId });
      } else if (data.nextQuestion && data.nextMessageId) {
        setMessages(prev => prev.some(msg => msg.id === data.nextMessageId)
          ? prev
          : [...prev, { id: data.nextMessageId, role: "assistant", content: data.nextQuestion }]);
      }
    },
    onError: (_e, { suggestionId }) => {
      handledSuggestionIds.current.delete(suggestionId);
      setAwaitingConfirmation(true);
      toast.error("Erro ao ignorar informação.");
    },
  });

  const completeMut = trpc.enrichment.completeSession.useMutation({
    onSuccess: () => { setIsComplete(true); toast.success("Enriquecimento concluído!"); },
  });

  const handleSend = () => {
    if (!input.trim() || !sessionId || sendMut.isPending || awaitingConfirmation || isComplete) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    sendMut.mutate({ sessionId, contactId, content: input.trim() });
    setInput("");
  };

  const handleStart = () => {
    startMut.mutate({ contactId });
  };

  const handleConfirm = (suggestionId: string, editedValue?: string) => {
    if (handledSuggestionIds.current.has(suggestionId) || confirmMut.isPending || ignoreMut.isPending) return;
    handledSuggestionIds.current.add(suggestionId);
    confirmMut.mutate({ suggestionId, editedValue });
  };

  const handleIgnore = (suggestionId: string) => {
    if (handledSuggestionIds.current.has(suggestionId) || confirmMut.isPending || ignoreMut.isPending) return;
    handledSuggestionIds.current.add(suggestionId);
    ignoreMut.mutate({ suggestionId });
  };

  // Não mostrar se não há sessão ativa e não está carregando
  if (loadingSession) return null;
  if (!activeSession && !sessionId) {
    return (
      <div className="border-t border-white/8 px-4 py-3">
        <button onClick={handleStart} disabled={startMut.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/15 transition-colors">
          <Sparkles size={14} />
          {startMut.isPending ? "Iniciando..." : "✨ Enriquecer cadastro com IA"}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-amber-500/20 bg-[#060e1a]/50">
      {/* Header do chat */}
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-amber-400" />
          <span className="text-xs font-medium text-amber-400">
            {isComplete ? "Enriquecimento concluído" : "Chat de Enriquecimento"}
          </span>
          {!isComplete && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        {expanded ? <ChevronDown size={14} className="text-white/30" /> : <ChevronUp size={14} className="text-white/30" />}
      </button>

      {expanded && (
        <>
          {/* Área de mensagens */}
          <div ref={scrollRef} className="px-4 py-2 max-h-64 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-xs text-white/30 text-center py-4">Iniciando conversa...</p>
            )}
            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg}
                busy={confirmMut.isPending || ignoreMut.isPending}
                onConfirm={handleConfirm}
                onIgnore={handleIgnore} />
            ))}
            {sendMut.isPending && <ThinkingIndicator />}

            {/* Resumo de conclusão */}
            {isComplete && completionSummary && (
              <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm text-green-300 mb-3">
                <p className="font-medium mb-1">✨ Cadastro enriquecido!</p>
                <p className="text-xs text-green-300/70">{completionSummary}</p>
              </div>
            )}
            {isComplete && !completionSummary && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/50 mb-3 flex items-center gap-2">
                <Clock size={13} /> Sessão concluída.
              </div>
            )}
          </div>

          {/* Input */}
          {!isComplete && !awaitingConfirmation && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Responda aqui..."
                disabled={sendMut.isPending}
                className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm h-9 focus:border-amber-500/50"
              />
              <Button size="sm" onClick={handleSend} disabled={!input.trim() || sendMut.isPending}
                className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] h-9 w-9 p-0 flex-shrink-0">
                <Send size={14} />
              </Button>
            </div>
          )}

          {!isComplete && awaitingConfirmation && (
            <p className="px-4 pb-3 text-xs text-amber-300/75">Confirme ou ignore a informação acima para continuar.</p>
          )}

          {/* Botão concluir */}
          {!isComplete && sessionId && messages.length >= 3 && (
            <div className="px-4 pb-3">
              <button onClick={() => completeMut.mutate({ sessionId })}
                className="text-xs text-white/30 hover:text-white/50 transition-colors">
                Concluir enriquecimento →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
