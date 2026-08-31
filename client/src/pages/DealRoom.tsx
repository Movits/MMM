import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Lock, Shield, FileText, MessageSquare, Upload, ArrowLeft,
  Send, CheckCircle, Clock, AlertTriangle, Download, User
} from "lucide-react";

export default function DealRoom() {
  const { id } = useParams<{ id: string }>();
  const roomId = Number(id);
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"nda" | "chat" | "docs">("nda");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: room, isLoading, refetch: refetchRoom } = trpc.dealRoom.getRoom.useQuery(
    { roomId },
    { enabled: !!roomId && !isNaN(roomId) }
  );

  const { data: messages = [], refetch: refetchMessages } = trpc.dealRoom.getMessages.useQuery(
    { roomId },
    { enabled: !!room && room.status === "active", refetchInterval: 5000 }
  );

  const { data: documents = [], refetch: refetchDocs } = trpc.dealRoom.listDocuments.useQuery(
    { roomId },
    { enabled: !!room && room.status === "active" }
  );

  const acceptNDA = trpc.dealRoom.acceptNDA.useMutation({
    onSuccess: () => {
      toast.success("NDA assinado com sucesso!");
      refetchRoom();
    },
    onError: (err) => toast.error(err.message),
  });

  const sendMessage = trpc.dealRoom.sendMessage.useMutation({
    onSuccess: () => {
      setMessage("");
      refetchMessages();
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadDocument = trpc.dealRoom.uploadDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento enviado com sucesso!");
      refetchDocs();
      setUploading(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setUploading(false);
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (room?.status === "active") setActiveTab("chat");
  }, [room?.status]);

  const [isDragOver, setIsDragOver] = useState(false);

  const uploadFile = (file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error(`"${file.name}" é muito grande. Máximo 16MB.`);
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDocument.mutate({
        roomId,
        name: file.name,
        fileBase64: base64,
        mimeType: file.type,
        sizeBytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(uploadFile);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-white/40 text-sm">Carregando Deal Room...</div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/40 mb-4">Deal Room não encontrado ou acesso negado.</p>
          <Link href="/dashboard">
            <Button variant="outline" className="border-white/20 text-white/60 bg-transparent">
              <ArrowLeft size={14} className="mr-1.5" /> Voltar ao Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = room.ownerId === user?.id;
  const myNdaAccepted = isOwner ? room.ndaAcceptedByOwner : room.ndaAcceptedByInterested;
  const otherNdaAccepted = isOwner ? room.ndaAcceptedByInterested : room.ndaAcceptedByOwner;
  const otherParty = isOwner ? (room as any).interested : (room as any).owner;
  const opp = (room as any).opportunity;

  const statusColor = room.status === "active" ? "#22c55e" : room.status === "awaiting_nda" ? "#eab308" : "#9ca3af";
  const statusLabel = room.status === "active" ? "Ativa" : room.status === "awaiting_nda" ? "Aguardando NDA" : "Encerrada";

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d0d1a]/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <button className="text-white/40 hover:text-white transition-colors">
                <ArrowLeft size={18} />
              </button>
            </Link>
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Lock size={14} className="text-amber-400" />
            </div>
            <div>
              <h1 className="text-white font-semibold text-sm">Deal Room #{roomId}</h1>
              <p className="text-white/40 text-xs">{opp?.title || "Oportunidade"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
            <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Participantes */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: "Publicadora", person: (room as any).owner, accepted: room.ndaAcceptedByOwner, acceptedAt: room.ndaAcceptedByOwnerAt },
            { label: "Interessada", person: (room as any).interested, accepted: room.ndaAcceptedByInterested, acceptedAt: room.ndaAcceptedByInterestedAt },
          ].map((p, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/40 text-xs">{p.label}</p>
                <p className="text-white text-sm font-medium truncate">{p.person?.name || "-"}</p>
              </div>
              <div className="flex-shrink-0">
                {p.accepted ? (
                  <div className="flex items-center gap-1 text-green-400">
                    <CheckCircle size={14} />
                    <span className="text-xs">NDA ✓</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-amber-400/60">
                    <Clock size={14} />
                    <span className="text-xs">Aguardando</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white/5 rounded-xl p-1">
          {[
            { key: "nda", icon: <Shield size={14} />, label: "NDA & Governança" },
            { key: "chat", icon: <MessageSquare size={14} />, label: "Chat Privado", disabled: room.status !== "active" },
            { key: "docs", icon: <FileText size={14} />, label: "Documentos", disabled: room.status !== "active" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => !tab.disabled && setActiveTab(tab.key as any)}
              disabled={tab.disabled}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-amber-500 text-black"
                  : tab.disabled
                  ? "text-white/20 cursor-not-allowed"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.disabled && <Lock size={10} />}
            </button>
          ))}
        </div>

        {/* Tab: NDA */}
        {activeTab === "nda" && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-amber-500/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={18} className="text-amber-400" />
                <h2 className="text-white font-bold">Termo de Confidencialidade (NDA)</h2>
              </div>

              <div className="bg-black/30 border border-white/10 rounded-xl p-4 mb-5 text-xs text-white/60 leading-relaxed space-y-3 max-h-72 overflow-y-auto">
                <p className="text-amber-400 font-semibold text-sm">TERMO DE CONFIDENCIALIDADE E NÃO DIVULGAÇÃO (NDA)</p>
                <p>Ao aceitar este termo, as partes envolvidas ("Divulgadora" e "Receptora") concordam em manter sigilo absoluto sobre todas as informações compartilhadas no contexto desta negociação, incluindo dados financeiros, estratégicos, operacionais e comerciais.</p>
                <p><strong className="text-white/80">1. Obrigação de Sigilo:</strong> As partes se comprometem a não divulgar, reproduzir ou utilizar as informações confidenciais para fins alheios à negociação em curso, sob pena das sanções previstas em lei.</p>
                <p><strong className="text-white/80">2. Cláusula Anti-Bypass (Antiburla):</strong> As partes se comprometem expressamente a não realizar qualquer transação, acordo ou negócio decorrente deste contato fora do ecossistema MMM, reconhecendo a obrigatoriedade do pagamento da <strong className="text-amber-400">taxa de sucesso (success fee)</strong> sobre quaisquer negócios fechados que tenham se originado desta conexão.</p>
                <p><strong className="text-white/80">3. Vigência:</strong> Este acordo tem validade de 24 (vinte e quatro) meses a partir da data de aceite digital.</p>
                <p><strong className="text-white/80">4. Aceite Digital:</strong> O aceite nesta plataforma constitui aceite digital válido e juridicamente vinculante, com registro de data, hora e identidade das partes.</p>
                <p className="text-white/40 border-t border-white/10 pt-3">
                  Oportunidade: <strong className="text-white/60">{opp?.title}</strong><br />
                  Deal Room ID: #{roomId}<br />
                  Data de criação: {room.createdAt ? new Date(room.createdAt).toLocaleDateString("pt-BR") : "-"}
                </p>
              </div>

              {room.status === "active" ? (
                <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-green-400 font-semibold text-sm">NDA assinado por ambas as partes</p>
                    <p className="text-green-400/60 text-xs">A sala de negociação privada está ativa. Use as abas Chat e Documentos.</p>
                  </div>
                </div>
              ) : myNdaAccepted ? (
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <Clock size={20} className="text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-amber-400 font-semibold text-sm">Você já assinou o NDA</p>
                    <p className="text-amber-400/60 text-xs">Aguardando a outra parte assinar para ativar a sala.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {!otherNdaAccepted && (
                    <div className="flex items-center gap-2 text-white/40 text-xs">
                      <AlertTriangle size={12} />
                      <span>A outra parte ainda não assinou o NDA.</span>
                    </div>
                  )}
                  <Button
                    className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold"
                    onClick={() => acceptNDA.mutate({ roomId })}
                    disabled={acceptNDA.isPending}
                  >
                    {acceptNDA.isPending ? "Assinando..." : "🔐 Assinar NDA Digitalmente"}
                  </Button>
                  <p className="text-white/30 text-xs text-center">
                    Ao clicar, você confirma que leu e aceita todos os termos acima.
                  </p>
                </div>
              )}
            </div>

            {room.interestMessage && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white/40 text-xs mb-1">Mensagem de apresentação da interessada:</p>
                <p className="text-white/70 text-sm italic">"{room.interestMessage}"</p>
              </div>
            )}
          </div>
        )}

        {/* Tab: Chat */}
        {activeTab === "chat" && room.status === "active" && (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col" style={{ height: "500px" }}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <MessageSquare size={32} className="text-white/20 mx-auto mb-2" />
                    <p className="text-white/30 text-sm">Nenhuma mensagem ainda.</p>
                    <p className="text-white/20 text-xs">Seja a primeira a enviar uma mensagem nesta sala privada.</p>
                  </div>
                </div>
              ) : (
                messages.map((msg: any) => {
                  const isMine = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${
                          isMine
                            ? "bg-amber-500 text-black rounded-br-sm"
                            : "bg-white/10 text-white rounded-bl-sm"
                        }`}
                      >
                        <p>{msg.content}</p>
                        <p className={`text-xs mt-1 ${isMine ? "text-black/50" : "text-white/30"}`}>
                          {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-white/10 p-3 flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && message.trim()) {
                    e.preventDefault();
                    sendMessage.mutate({ roomId, content: message.trim() });
                  }
                }}
                placeholder="Digite sua mensagem confidencial..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-amber-500/40"
              />
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-400 text-black"
                onClick={() => message.trim() && sendMessage.mutate({ roomId, content: message.trim() })}
                disabled={!message.trim() || sendMessage.isPending}
              >
                <Send size={14} />
              </Button>
            </div>
          </div>
        )}

        {/* Tab: Documentos */}
        {activeTab === "docs" && room.status === "active" && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <FileText size={16} className="text-amber-400" />
                  Documentos Confidenciais
                </h3>
                <Button
                  size="sm"
                  className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload size={12} className="mr-1.5" />
                  {uploading ? "Enviando..." : "Anexar Arquivo"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.zip,.rar,.txt,.csv"
                  onChange={handleFileUpload}
                />
              </div>
              {/* Drag-and-drop area */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 mb-4 text-center cursor-pointer transition-all duration-200 ${
                  isDragOver
                    ? 'border-amber-400 bg-amber-400/10'
                    : 'border-white/10 hover:border-amber-400/40 hover:bg-white/5'
                }`}
              >
                <Upload size={20} className={`mx-auto mb-1.5 ${isDragOver ? 'text-amber-400' : 'text-white/30'}`} />
                <p className={`text-xs ${isDragOver ? 'text-amber-400' : 'text-white/30'}`}>
                  {isDragOver ? 'Solte para enviar' : 'Arraste arquivos aqui ou clique para selecionar'}
                </p>
                <p className="text-white/20 text-xs mt-0.5">PDF, Word, Excel, imagens, ZIP (máx. 16MB por arquivo)</p>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-8">
                  <FileText size={32} className="text-white/20 mx-auto mb-2" />
                  <p className="text-white/30 text-sm">Nenhum documento compartilhado ainda.</p>
                  <p className="text-white/20 text-xs mt-1">Envie documentos confidenciais com segurança.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                      <FileText size={16} className="text-amber-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{doc.name}</p>
                        <p className="text-white/40 text-xs">
                          {doc.uploadedBy === user?.id ? "Você" : otherParty?.name} •{" "}
                          {new Date(doc.createdAt).toLocaleDateString("pt-BR")}
                          {doc.sizeBytes && ` • ${(doc.sizeBytes / 1024).toFixed(0)} KB`}
                        </p>
                      </div>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="border-white/20 text-white/60 bg-transparent">
                          <Download size={12} />
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <Shield size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-400/70 text-xs leading-relaxed">
                Todos os documentos compartilhados nesta sala são protegidos pelo NDA assinado. O compartilhamento fora desta plataforma viola os termos acordados.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
