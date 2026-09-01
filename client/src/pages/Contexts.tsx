import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Search, X, MapPin, Calendar, Users, ChevronLeft,
  Edit2, Trash2, UserPlus, Image, Lock, Globe, Briefcase,
  Building2, Utensils, Landmark, Star, Handshake, FlaskConical,
  Store, FileText
} from "lucide-react";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";

// ─── Ícones por tipo ──────────────────────────────────────────────────────────
const TYPE_ICONS: Record<string, React.ReactNode> = {
  "congresso":           <Building2 size={18} />,
  "missao-empresarial":  <Briefcase size={18} />,
  "evento-internacional":<Globe size={18} />,
  "jantar":              <Utensils size={18} />,
  "embaixada":           <Landmark size={18} />,
  "reuniao-particular":  <Users size={18} />,
  "feira-internacional": <Store size={18} />,
  "cphi":                <FlaskConical size={18} />,
  "evento-mmm":          <Star size={18} />,
  "associacao-comercial":<Handshake size={18} />,
};

// ─── Tipos ───────────────────────────────────────────────────────────────────
type CtxType = { id: string; name: string; slug: string; colorToken?: string | null; iconName?: string | null };
type Ctx = {
  id: string; name: string; eventDate?: string | null; city?: string | null; country?: string | null;
  notes?: string | null; isCustom: boolean; typeName?: string; typeColor?: string; typeSlug?: string;
  contactCount: number;
};
type CtxDetail = Ctx & {
  links: Array<{ id: string; contactId: number; contactName?: string | null; eventDate?: string | null; city?: string | null; country?: string | null; notes?: string | null; relationshipType: string }>;
  participants: Array<{ id: string; name: string; company?: string | null; role?: string | null }>;
  media: Array<{ id: string; originalName: string; fileType: string; storagePath: string }>;
};

// ─── Formulário vazio ─────────────────────────────────────────────────────────
const emptyForm = () => ({ name: "", contextTypeId: "", eventDate: "", city: "", country: "", notes: "" });

// ─── Chip de tipo ─────────────────────────────────────────────────────────────
function TypeBadge({ name, color, slug }: { name?: string; color?: string; slug?: string }) {
  if (!name) return null;
  const icon = slug ? TYPE_ICONS[slug] : null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: (color ?? "#6B7280") + "20", color: color ?? "#6B7280", border: `1px solid ${(color ?? "#6B7280")}40` }}>
      {icon && <span className="opacity-80">{icon}</span>}
      {name}
    </span>
  );
}

// ─── Card de contexto ─────────────────────────────────────────────────────────
function ContextCard({ ctx, onClick }: { ctx: Ctx; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-amber-500/30 transition-all duration-200 cursor-pointer group flex items-start gap-3">
      {/* Ícone do tipo */}
      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: (ctx.typeColor ?? "#6B7280") + "20" }}>
        <span style={{ color: ctx.typeColor ?? "#6B7280" }}>
          {ctx.typeSlug ? (TYPE_ICONS[ctx.typeSlug] ?? <Calendar size={20} />) : <Calendar size={20} />}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-white truncate">{ctx.name}</p>
          <span className="text-xs text-white/35 flex items-center gap-1 flex-shrink-0">
            <Users size={10} /> {ctx.contactCount}
          </span>
        </div>
        {ctx.typeName && <TypeBadge name={ctx.typeName} color={ctx.typeColor} slug={ctx.typeSlug} />}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {ctx.eventDate && (
            <span className="flex items-center gap-1 text-xs text-white/35">
              <Calendar size={10} /> {new Date(ctx.eventDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          )}
          {(ctx.city || ctx.country) && (
            <span className="flex items-center gap-1 text-xs text-white/35">
              <MapPin size={10} /> {[ctx.city, ctx.country].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Formulário de criação/edição ─────────────────────────────────────────────
function ContextForm({ initial, types, onSave, onClose, loading }: {
  initial?: Partial<Ctx>;
  types: CtxType[];
  onSave: (data: ReturnType<typeof emptyForm>) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<ReturnType<typeof emptyForm>>({
    name:          initial?.name ?? "",
    contextTypeId: initial?.typeSlug ? (types.find(t => t.slug === initial.typeSlug)?.id ?? "") : "",
    eventDate:     initial?.eventDate ?? "",
    city:          initial?.city ?? "",
    country:       initial?.country ?? "",
    notes:         initial?.notes ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Se o formulário de edição abriu antes de o catálogo de tipos chegar, o tipo
  // nasce vazio — e salvar assim apagaria o tipo do contexto. Quando os tipos
  // chegam, o campo é re-derivado (sem atropelar uma escolha já feita).
  useEffect(() => {
    if (!form.contextTypeId && initial?.typeSlug && types.length > 0) {
      const idDoTipo = types.find(t => t.slug === initial.typeSlug)?.id;
      if (idDoTipo) setForm(p => (p.contextTypeId ? p : { ...p, contextTypeId: idDoTipo }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="font-bold text-white">{initial?.id ? "Editar Contexto" : "Novo Contexto"}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Nome *</label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} maxLength={100}
              placeholder="Ex: CPHI 2024, Roadshow Europa..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
            <p className="text-xs text-white/25 mt-1 text-right">{form.name.length}/100</p>
          </div>
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Tipo de Contexto</label>
            <select value={form.contextTypeId} onChange={e => set("contextTypeId", e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm focus:border-amber-500/50 focus:outline-none">
              <option className="bg-white text-[#2D3E50]" value="">Selecione um tipo...</option>
              {types.map(t => <option className="bg-white text-[#2D3E50]" key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Data do Evento</label>
              <Input type="date" value={form.eventDate} onChange={e => set("eventDate", e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                className="bg-white/5 border-white/10 text-white focus:border-amber-500/50" />
            </div>
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">País</label>
              <Input value={form.country} onChange={e => set("country", e.target.value)}
                placeholder="Brasil, EUA..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
            </div>
          </div>
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Cidade</label>
            <Input value={form.city} onChange={e => set("city", e.target.value)}
              placeholder="São Paulo, Madrid, Paris..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
          </div>
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Notas</label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              placeholder="Descreva o contexto, objetivos, impressões..."
              rows={3} className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50 resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <Button variant="ghost" onClick={onClose} className="text-white/50 hover:text-white/80">Cancelar</Button>
          <Button onClick={() => onSave(form)} disabled={loading || !form.name.trim()}
            className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold">
            {loading ? "Salvando..." : "✓ Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de vincular contato ────────────────────────────────────────────────
function LinkContactModal({ contextId, contextName, onClose, onLinked }: {
  contextId: string; contextName: string; onClose: () => void; onLinked: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<{ id: number; fullName: string } | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [relType, setRelType] = useState<"pessoal" | "profissional" | "ambos">("profissional");

  const debRef = { current: null as ReturnType<typeof setTimeout> | null };
  const handleSearch = (v: string) => {
    setSearch(v);
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setDebouncedSearch(v), 300);
  };

  const { data: contacts } = trpc.network.list.useQuery(
    { q: debouncedSearch || undefined, limit: 10 },
    { enabled: !!debouncedSearch }
  );

  const linkMut = trpc.contexts.linkContact.useMutation({
    onSuccess: () => { toast.success(`${selectedContact?.fullName} vinculada ao ${contextName}!`); onLinked(); onClose(); },
    onError: (e) => toast.error("Erro ao vincular: " + e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="font-bold text-white">Vincular Contato</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {!selectedContact ? (
            <>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <Input value={search} onChange={e => handleSearch(e.target.value)}
                  placeholder="Buscar contato por nome..."
                  className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50" />
              </div>
              {contacts?.data && contacts.data.length > 0 && (
                <div className="space-y-1">
                  {contacts.data.map(c => (
                    <button key={c.id} onClick={() => setSelectedContact({ id: c.id, fullName: c.fullName })}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm flex-shrink-0">
                        {c.fullName[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{c.fullName}</p>
                        {c.jobTitle && <p className="text-xs text-white/40">{c.jobTitle}{c.company ? ` · ${c.company}` : ""}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {debouncedSearch && !contacts?.data?.length && (
                <p className="text-sm text-white/40 text-center py-4">Nenhum contato encontrado.</p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="w-8 h-8 rounded-full bg-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm">
                  {selectedContact.fullName[0].toUpperCase()}
                </div>
                <p className="text-sm font-medium text-white flex-1">{selectedContact.fullName}</p>
                <button onClick={() => setSelectedContact(null)} className="text-white/40 hover:text-white/70"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Data do Encontro</label>
                  <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                    className="bg-white/5 border-white/10 text-white focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Cidade</label>
                  <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Madrid..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Tipo de Relacionamento</label>
                <div className="flex gap-2">
                  {(["pessoal", "profissional", "ambos"] as const).map(r => (
                    <button key={r} onClick={() => setRelType(r)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${relType === r ? "bg-amber-500 border-amber-500 text-[#060e1a]" : "bg-white/5 border-white/15 text-white/60 hover:border-white/30"}`}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Notas do Encontro</label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Observações sobre este encontro específico..."
                  rows={3} className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50 resize-none" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <Button variant="ghost" onClick={onClose} className="text-white/50 hover:text-white/80">Cancelar</Button>
          {selectedContact && (
            <Button onClick={() => linkMut.mutate({
              contextId, contactId: selectedContact.id,
              eventDate: eventDate || null, city: city || null,
              notes: notes || null, relationshipType: relType,
            })} disabled={linkMut.isPending}
              className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold">
              {linkMut.isPending ? "Vinculando..." : "Vincular"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detalhe do contexto ──────────────────────────────────────────────────────
function ContextDetail({ contextId, onEdit, onClose, onRefresh }: {
  contextId: string; onEdit: () => void; onClose: () => void; onRefresh: () => void;
}) {
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showParticipantForm, setShowParticipantForm] = useState(false);
  const [partName, setPartName] = useState(""); const [partCompany, setPartCompany] = useState(""); const [partRole, setPartRole] = useState("");

  const { data, isLoading, refetch } = trpc.contexts.get.useQuery({ id: contextId });
  const unlinkMut = trpc.contexts.unlinkContact.useMutation({
    onSuccess: () => { toast.success("Vínculo removido."); refetch(); },
  });
  const addPartMut = trpc.contexts.addParticipant.useMutation({
    onSuccess: () => { toast.success("Participante adicionado!"); setShowParticipantForm(false); setPartName(""); setPartCompany(""); setPartRole(""); refetch(); },
  });
  const deleteMut = trpc.contexts.delete.useMutation({
    onSuccess: () => { toast.success("Contexto excluído."); onClose(); onRefresh(); },
  });
  const uploadMut = trpc.contexts.uploadMedia.useMutation({
    onSuccess: () => { toast.success("Arquivo anexado!"); refetch(); },
    onError: err => toast.error(err.message || "Não foi possível anexar o arquivo."),
  });
  const deleteMediaMut = trpc.contexts.deleteMedia.useMutation({
    onSuccess: () => { toast.success("Arquivo removido."); refetch(); },
    onError: err => toast.error(err.message || "Não foi possível remover o arquivo."),
  });

  const TIPOS_DE_MIDIA = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    if (!(TIPOS_DE_MIDIA as readonly string[]).includes(file.type)) {
      toast.error("Formato não suportado: envie JPG, PNG, WebP ou PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Não foi possível ler o arquivo. Tente de novo.");
    reader.onload = () => {
      const conteudo = String(reader.result ?? "");
      if (!conteudo) {
        toast.error("Não foi possível ler o arquivo. Tente de novo.");
        return;
      }
      uploadMut.mutate({
        contextId,
        fileName: file.name,
        mimeType: file.type as (typeof TIPOS_DE_MIDIA)[number],
        dataBase64: conteudo,
      });
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-8 h-8 border-2 border-amber-500/40 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );
  if (!data) return null;
  const ctx = data as unknown as CtxDetail;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <button onClick={onClose} className="text-white/40 hover:text-white/70 flex items-center gap-1.5 text-sm">
            <ChevronLeft size={16} /> Contextos
          </button>
          {/* Contexto do catálogo (global) não é editável nem apagável — o
              backend recusaria e a tela só mostrava um erro sem explicação. */}
          {ctx.isCustom ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onEdit} variant="outline"
                className="border-white/20 text-white/60 hover:bg-white/8 bg-transparent">
                <Edit2 size={13} className="mr-1" /> Editar
              </Button>
              <Button size="sm" onClick={() => { if (confirm("Excluir este contexto?")) deleteMut.mutate({ id: contextId }); }}
                variant="outline" className="border-red-500/30 text-red-400/80 hover:bg-red-500/10 bg-transparent">
                <Trash2 size={13} />
              </Button>
            </div>
          ) : (
            <span className="text-xs text-white/30">Contexto do catálogo MMM</span>
          )}
        </div>

        {/* Info */}
        <div className="px-6 pt-5 pb-4">
          <h2 className="text-xl font-bold text-white mb-2">{ctx.name}</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {ctx.typeName && <TypeBadge name={ctx.typeName} color={ctx.typeColor} slug={ctx.typeSlug} />}
            {ctx.eventDate && (
              <span className="flex items-center gap-1 text-xs text-white/50">
                <Calendar size={11} /> {new Date(ctx.eventDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </span>
            )}
            {(ctx.city || ctx.country) && (
              <span className="flex items-center gap-1 text-xs text-white/50">
                <MapPin size={11} /> {[ctx.city, ctx.country].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          {ctx.notes && <p className="text-sm text-white/60 leading-relaxed">{ctx.notes}</p>}
        </div>

        {/* Participantes vinculados */}
        <div className="px-6 py-4 border-t border-white/8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/35 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={11} /> Contatos Vinculados ({ctx.links.length})
            </p>
            <button onClick={() => setShowLinkModal(true)}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
              <UserPlus size={12} /> Adicionar
            </button>
          </div>
          {ctx.links.length === 0 ? (
            <p className="text-sm text-white/30 py-2">Nenhum contato vinculado ainda.</p>
          ) : (
            <div className="space-y-2">
              {ctx.links.map(link => (
                <div key={link.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-xs">
                      {(link.contactName || "#").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm text-white">{link.contactName ?? `Contato #${link.contactId}`}</p>
                      <p className="text-xs text-white/40">{link.relationshipType}{link.city ? ` · ${link.city}` : ""}</p>
                    </div>
                  </div>
                  <button onClick={() => unlinkMut.mutate({ linkId: link.id })}
                    className="text-white/25 hover:text-red-400 transition-colors p-1">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Participantes avulsos */}
        <div className="px-6 py-4 border-t border-white/8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/35 uppercase tracking-wider">Outros Participantes ({ctx.participants.length})</p>
            <button onClick={() => setShowParticipantForm(v => !v)}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
              <Plus size={12} /> Adicionar
            </button>
          </div>
          {showParticipantForm && (
            <div className="space-y-2 mb-3 p-3 rounded-xl bg-white/5 border border-white/10">
              <Input value={partName} onChange={e => setPartName(e.target.value)} placeholder="Nome *"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={partCompany} onChange={e => setPartCompany(e.target.value)} placeholder="Empresa"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm" />
                <Input value={partRole} onChange={e => setPartRole(e.target.value)} placeholder="Cargo"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm" />
              </div>
              <Button size="sm" onClick={() => addPartMut.mutate({ contextId, name: partName, company: partCompany || null, role: partRole || null })}
                disabled={!partName.trim() || addPartMut.isPending}
                className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold w-full">
                {addPartMut.isPending ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
          )}
          {ctx.participants.length > 0 && (
            <div className="space-y-2">
              {ctx.participants.map(p => (
                <div key={p.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/5">
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 font-bold text-xs">
                    {p.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm text-white">{p.name}</p>
                    {(p.role || p.company) && <p className="text-xs text-white/40">{[p.role, p.company].filter(Boolean).join(" · ")}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fotos e documentos do encontro */}
        <div className="px-6 py-4 border-t border-white/8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/35 uppercase tracking-wider flex items-center gap-1.5">
              <Image size={11} /> Fotos e Documentos ({ctx.media.length})
            </p>
            <label className={`text-xs flex items-center gap-1 ${uploadMut.isPending ? "text-white/30" : "text-amber-400 hover:text-amber-300 cursor-pointer"}`}>
              <Plus size={12} /> {uploadMut.isPending ? "Enviando..." : "Anexar"}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden" disabled={uploadMut.isPending} onChange={handleUploadFile} />
            </label>
          </div>
          {ctx.media.length === 0 ? (
            <p className="text-sm text-white/30 py-1">Nenhum arquivo ainda. Anexe fotos do encontro ou documentos relacionados.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {ctx.media.map(m => (
                <div key={m.id} className="relative rounded-xl overflow-hidden bg-white/5 border border-white/10">
                  <a href={m.storagePath} target="_blank" rel="noopener noreferrer" className="block" title={m.originalName}>
                    {m.fileType.startsWith("image/") ? (
                      <img src={m.storagePath} alt={m.originalName} className="w-full h-20 object-cover" />
                    ) : (
                      <div className="w-full h-20 flex flex-col items-center justify-center gap-1 text-white/50 px-1">
                        <FileText size={18} />
                        <span className="text-[10px] truncate max-w-full">{m.originalName}</span>
                      </div>
                    )}
                  </a>
                  <button onClick={() => { if (confirm("Remover este arquivo?")) deleteMediaMut.mutate({ mediaId: m.id }); }}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white/60 hover:text-red-400 transition-colors">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLinkModal && (
        <LinkContactModal contextId={contextId} contextName={ctx.name}
          onClose={() => setShowLinkModal(false)} onLinked={() => refetch()} />
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Contexts() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editCtx, setEditCtx] = useState<Ctx | null>(null);
  const [viewCtxId, setViewCtxId] = useState<string | null>(null);

  const debRef = { current: null as ReturnType<typeof setTimeout> | null };
  const handleSearch = (v: string) => {
    setSearch(v);
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 300);
  };

  const { data: types } = trpc.contexts.listTypes.useQuery(undefined, { enabled: isAuthenticated });
  const { data, isLoading, refetch } = trpc.contexts.list.useQuery(
    { q: debouncedSearch || undefined, typeSlug: filterType || undefined, page, limit: 20 },
    { enabled: isAuthenticated }
  );

  const createMut = trpc.contexts.create.useMutation({
    onSuccess: () => { toast.success("Contexto criado!"); setShowForm(false); refetch(); },
    onError: (e) => toast.error("Erro: " + e.message),
  });
  const updateMut = trpc.contexts.update.useMutation({
    onSuccess: () => { toast.success("Contexto atualizado!"); setEditCtx(null); setShowForm(false); refetch(); },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const handleSave = (form: ReturnType<typeof emptyForm>) => {
    const payload = {
      name: form.name,
      contextTypeId: form.contextTypeId || null,
      eventDate: form.eventDate || null,
      city: form.city || null,
      country: form.country || null,
      notes: form.notes || null,
    };
    if (editCtx) updateMut.mutate({ id: editCtx.id, ...payload });
    else createMut.mutate(payload);
  };

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#060e1a]">
      <div className="w-8 h-8 border-2 border-amber-500/40 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return (
    <div className="min-h-screen flex items-center justify-center bg-[#060e1a] p-6">
      <div className="text-center">
        <Lock size={40} className="text-amber-500/60 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Área restrita</h2>
        <a href={getLoginUrl()} className="px-6 py-3 bg-amber-500 text-[#060e1a] font-bold rounded-xl hover:bg-amber-400 transition-colors inline-block mt-4">
          Entrar
        </a>
      </div>
    </div>
  );

  const ctxList: Ctx[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const typeList: CtxType[] = types ?? [];

  return (
    <div className="min-h-screen bg-[#060e1a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#060e1a]/95 backdrop-blur-sm border-b border-white/8 px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-white/40 hover:text-white/70 transition-colors">
              <ChevronLeft size={20} />
            </Link>
            <div>
              <h1 className="font-bold text-white text-lg leading-tight">Meus Contextos</h1>
              <p className="text-xs text-white/35">Onde e como conheceu cada contato</p>
            </div>
          </div>
          <Button onClick={() => { setEditCtx(null); setShowForm(true); }}
            className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold gap-1.5">
            <Plus size={16} /> Novo
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Busca */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <Input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar por nome ou notas..."
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50" />
          {search && (
            <button onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filtros por tipo */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => { setFilterType(""); setPage(1); }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${!filterType ? "bg-amber-500 border-amber-500 text-[#060e1a] font-bold" : "bg-white/5 border-white/20 text-white/60 hover:border-white/40"}`}>
            Todos
          </button>
          {typeList.map(t => (
            <button key={t.id} onClick={() => { setFilterType(filterType === t.slug ? "" : t.slug); setPage(1); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${filterType === t.slug ? "font-bold" : "bg-white/5 border-white/20 text-white/60 hover:border-white/40"}`}
              style={filterType === t.slug ? { background: (t.colorToken ?? "#F59E0B") + "30", borderColor: (t.colorToken ?? "#F59E0B") + "80", color: t.colorToken ?? "#F59E0B" } : {}}>
              {t.name}
            </button>
          ))}
        </div>

        {/* Contador */}
        {!isLoading && (
          <p className="text-xs text-white/30">{total === 0 ? "Nenhum contexto encontrado" : `${total} contexto${total !== 1 ? "s" : ""}`}</p>
        )}

        {/* Lista */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />)}</div>
        ) : ctxList.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <MapPin size={28} className="text-amber-500/50" />
            </div>
            <h3 className="text-white/60 font-medium mb-1">
              {debouncedSearch || filterType ? "Nenhum contexto encontrado" : "Nenhum contexto ainda"}
            </h3>
            <p className="text-white/30 text-sm mb-6">
              {debouncedSearch || filterType ? "Tente outros termos ou remova os filtros." : "Registre onde e como conheceu seus contatos estratégicos."}
            </p>
            {!debouncedSearch && !filterType && (
              <Button onClick={() => setShowForm(true)} className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold gap-1.5">
                <Plus size={16} /> Registrar primeiro encontro
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {ctxList.map(c => (
              <ContextCard key={c.id} ctx={c} onClick={() => setViewCtxId(c.id)} />
            ))}
          </div>
        )}

        {/* Paginação */}
        {total > 20 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="border-white/15 text-white/60 bg-transparent hover:bg-white/8">← Anterior</Button>
            <span className="text-xs text-white/40">Página {page} de {Math.ceil(total / 20)}</span>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}
              className="border-white/15 text-white/60 bg-transparent hover:bg-white/8">Próxima →</Button>
          </div>
        )}
      </div>

      {/* Modais */}
      {(showForm || editCtx) && (
        <ContextForm
          initial={editCtx ?? undefined}
          types={typeList}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditCtx(null); }}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      {viewCtxId && (
        <ContextDetail
          contextId={viewCtxId}
          onEdit={() => {
            const found = ctxList.find(c => c.id === viewCtxId);
            if (found) { setEditCtx(found); setShowForm(true); setViewCtxId(null); }
          }}
          onClose={() => setViewCtxId(null)}
          onRefresh={() => refetch()}
        />
      )}
    </div>
  );
}
