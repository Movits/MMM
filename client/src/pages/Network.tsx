import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EnrichmentChat } from "@/components/EnrichmentChat";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Search, X, Phone, Mail, Linkedin, Instagram,
  MapPin, Briefcase, Tag, Edit2, Trash2, ExternalLink,
  ChevronLeft, User, MessageCircle, Globe, FileText,
  Shield, Lock, Sparkles, History, RotateCcw, Calendar
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";

// ─── Tags de perfil predefinidas ─────────────────────────────────────────────
const PROFILE_TAGS = [
  "Empresária", "Investidora", "Diplomata", "Autoridade Pública",
  "Advogada", "Pesquisadora", "Fornecedora", "Compradora", "Executiva", "Outro"
];

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Contact = {
  id: number;
  fullName: string;
  photoUrl?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  instagram?: string | null;
  profileTags?: string[] | null;
  cardImageUrl?: string | null;
  notes?: string | null;
  enrichmentStatus?: string | null;
  createdAt: number;
  updatedAt: number;
};

// ─── Formulário vazio ─────────────────────────────────────────────────────────
const emptyForm = () => ({
  fullName: "", photoUrl: "", jobTitle: "", company: "",
  country: "", state: "", city: "",
  phone: "", whatsapp: "", email: "",
  linkedinUrl: "", instagram: "",
  profileTags: [] as string[],
  notes: "",
});

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, photoUrl, size = 48 }: { name: string; photoUrl?: string | null; size?: number }) {
  const initials = name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-br from-amber-500 to-amber-700"
      style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {initials || "?"}
    </div>
  );
}

// ─── Tag chip ─────────────────────────────────────────────────────────────────
function TagChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150 active:scale-95 ${
        selected
          ? "bg-amber-500 border-amber-500 text-[#060e1a] font-bold"
          : "bg-white/5 border-white/20 text-white/60 hover:border-white/40 hover:text-white"
      }`}>
      {label}
    </button>
  );
}

// ─── Card de contato na lista ─────────────────────────────────────────────────
function ContactCard({ contact, onView, onEdit, onDelete }: {
  contact: Contact;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-amber-500/30 transition-all duration-200 cursor-pointer group"
      onClick={onView}>
      <div className="flex items-start gap-3">
        <Avatar name={contact.fullName} photoUrl={contact.photoUrl} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-semibold text-white truncate">{contact.fullName}</p>
              {contact.enrichmentStatus === "active" && (
                <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs animate-pulse">
                  <Sparkles size={9} /> IA
                </span>
              )}
            </div>
            <button type="button"
              className="text-white/30 hover:text-white/70 transition-colors p-1 rounded-lg hover:bg-white/10 flex-shrink-0 z-10"
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}>
              <span className="text-lg leading-none">···</span>
            </button>
          </div>
          {contact.jobTitle && <p className="text-sm text-white/50 truncate">{contact.jobTitle}{contact.company ? ` · ${contact.company}` : ""}</p>}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {contact.country && (
              <span className="flex items-center gap-1 text-xs text-white/35">
                <MapPin size={10} />{contact.city ? `${contact.city}, ` : ""}{contact.country}
              </span>
            )}
            {contact.profileTags?.slice(0, 2).map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400/80 text-xs">{tag}</span>
            ))}
          </div>
        </div>
      </div>
      {/* Menu contextual */}
      {menuOpen && (
        <div className="absolute right-4 top-12 z-20 bg-[#0d1b2e] border border-white/15 rounded-xl shadow-2xl py-1 min-w-[140px]"
          onClick={e => e.stopPropagation()}>
          <button className="w-full px-4 py-2 text-sm text-white/70 hover:bg-white/8 text-left flex items-center gap-2"
            onClick={() => { setMenuOpen(false); onView(); }}>
            <User size={13} /> Ver perfil
          </button>
          <button className="w-full px-4 py-2 text-sm text-white/70 hover:bg-white/8 text-left flex items-center gap-2"
            onClick={() => { setMenuOpen(false); onEdit(); }}>
            <Edit2 size={13} /> Editar
          </button>
          <button className="w-full px-4 py-2 text-sm text-red-400/80 hover:bg-red-500/10 text-left flex items-center gap-2"
            onClick={() => { setMenuOpen(false); onDelete(); }}>
            <Trash2 size={13} /> Excluir
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Formulário multi-step ────────────────────────────────────────────────────
function ContactForm({ initial, onSave, onClose, loading }: {
  initial?: Partial<Contact>;
  onSave: (data: ReturnType<typeof emptyForm>) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<ReturnType<typeof emptyForm>>({
    fullName:    initial?.fullName    ?? "",
    photoUrl:    initial?.photoUrl    ?? "",
    jobTitle:    initial?.jobTitle    ?? "",
    company:     initial?.company     ?? "",
    country:     initial?.country     ?? "",
    state:       initial?.state       ?? "",
    city:        initial?.city        ?? "",
    phone:       initial?.phone       ?? "",
    whatsapp:    initial?.whatsapp    ?? "",
    email:       initial?.email       ?? "",
    linkedinUrl: initial?.linkedinUrl ?? "",
    instagram:   initial?.instagram   ?? "",
    profileTags: initial?.profileTags ?? [],
    notes:       initial?.notes       ?? "",
  });

  const set = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const toggleTag = (tag: string) => {
    set("profileTags", form.profileTags.includes(tag)
      ? form.profileTags.filter(t => t !== tag)
      : [...form.profileTags, tag]);
  };

  const STEPS = ["Informações Básicas", "Localização e Contato", "Digital e Perfil", "Cartão e Notas"];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-bold text-white">{initial?.id ? "Editar Contato" : "Novo Contato"}</h2>
            <p className="text-xs text-white/40 mt-0.5">Etapa {step} de {STEPS.length}: {STEPS[step - 1]}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/10">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${(step / STEPS.length) * 100}%` }} />
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Nome Completo *</label>
                <Input value={form.fullName} onChange={e => set("fullName", e.target.value)}
                  placeholder="Nome completo do contato"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Cargo</label>
                <Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)}
                  placeholder="Ex: CEO, Embaixadora, Diretora..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Empresa / Instituição</label>
                <Input value={form.company} onChange={e => set("company", e.target.value)}
                  placeholder="Nome da empresa ou instituição"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">País</label>
                  <Input value={form.country} onChange={e => set("country", e.target.value)}
                    placeholder="Brasil, EUA..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Estado</label>
                  <Input value={form.state} onChange={e => set("state", e.target.value)}
                    placeholder="SP, RJ..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Cidade</label>
                <Input value={form.city} onChange={e => set("city", e.target.value)}
                  placeholder="São Paulo, Rio de Janeiro..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Telefone</label>
                <Input value={form.phone} onChange={e => set("phone", e.target.value)}
                  placeholder="+55 11 9 9999-9999"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">WhatsApp</label>
                <Input value={form.whatsapp} onChange={e => set("whatsapp", e.target.value)}
                  placeholder="+55 11 9 9999-9999"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">E-mail</label>
                <Input value={form.email} onChange={e => set("email", e.target.value)}
                  placeholder="contato@empresa.com"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">LinkedIn URL</label>
                <Input value={form.linkedinUrl} onChange={e => set("linkedinUrl", e.target.value)}
                  placeholder="https://linkedin.com/in/nome"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Instagram</label>
                <Input value={form.instagram} onChange={e => set("instagram", e.target.value.replace(/^@/, ""))}
                  placeholder="@handle (sem @)"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-3 block">Perfil / Tags</label>
                <div className="flex flex-wrap gap-2">
                  {PROFILE_TAGS.map(tag => (
                    <TagChip key={tag} label={tag} selected={form.profileTags.includes(tag)} onClick={() => toggleTag(tag)} />
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">URL do Cartão de Visita</label>
                <Input value={form.photoUrl} onChange={e => set("photoUrl", e.target.value)}
                  placeholder="https://... (URL da imagem do cartão)"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50" />
                <p className="text-xs text-white/25 mt-1">Upload direto de arquivo disponível em breve (OCR automático)</p>
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Notas / Observações</label>
                <Textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                  placeholder="Como nos conhecemos, contexto, próximos passos..."
                  rows={5}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-amber-500/50 resize-none" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/2">
          <Button variant="ghost" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
            className="text-white/50 hover:text-white/80">
            {step === 1 ? "Cancelar" : "← Voltar"}
          </Button>
          {step < STEPS.length ? (
            <Button onClick={() => setStep(s => s + 1)}
              disabled={step === 1 && !form.fullName.trim()}
              className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold">
              Próximo →
            </Button>
          ) : (
            <Button onClick={() => onSave(form)} disabled={loading || !form.fullName.trim()}
              className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold">
              {loading ? "Salvando..." : "✓ Salvar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detalhe do contato ───────────────────────────────────────────────────────
function ContactDetail({ contact, onEdit, onClose }: {
  contact: Contact;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"info" | "history">("info");

  // Histórico de enriquecimento
  const { data: historyData } = trpc.enrichment.getHistory.useQuery(
    { contactId: contact.id, limit: 30 },
    { refetchOnWindowFocus: false }
  );

  // Contextos em que este contato apareceu (onde e como se conheceram)
  const { data: contextosDoContato } = trpc.contexts.listByContact.useQuery(
    { contactId: contact.id },
    { refetchOnWindowFocus: false }
  );

  const confirmMut = trpc.enrichment.confirmSuggestion.useMutation({
    onError: () => toast.error("Erro ao desfazer."),
  });
  const ignoreMut = trpc.enrichment.ignoreSuggestion.useMutation();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors flex items-center gap-1.5 text-sm">
            <ChevronLeft size={16} /> Minha Rede
          </button>
          <Button size="sm" onClick={onEdit} variant="outline"
            className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 bg-transparent">
            <Edit2 size={13} className="mr-1" /> Editar
          </Button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-white/8">
          <button onClick={() => setActiveTab("info")}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === "info" ? "text-amber-400 border-b-2 border-amber-400" : "text-white/40 hover:text-white/60"
            }`}>
            <User size={12} /> Perfil
          </button>
          <button onClick={() => setActiveTab("history")}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === "history" ? "text-amber-400 border-b-2 border-amber-400" : "text-white/40 hover:text-white/60"
            }`}>
            <History size={12} /> Histórico IA
            {historyData && historyData.total > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs">{historyData.total}</span>
            )}
          </button>
        </div>

        {activeTab === "info" && (<>
        {/* Perfil */}
        <div className="px-6 pt-6 pb-4 flex items-start gap-4">
          <Avatar name={contact.fullName} photoUrl={contact.photoUrl} size={72} />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white">{contact.fullName}</h2>
            {contact.jobTitle && <p className="text-sm text-white/60 mt-0.5">{contact.jobTitle}{contact.company ? ` · ${contact.company}` : ""}</p>}
            {(contact.city || contact.country) && (
              <p className="flex items-center gap-1 text-xs text-white/40 mt-1">
                <MapPin size={11} />{[contact.city, contact.state, contact.country].filter(Boolean).join(", ")}
              </p>
            )}
            {contact.profileTags && contact.profileTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {contact.profileTags.map(tag => (
                  <span key={tag} className="px-2.5 py-0.5 rounded-full bg-amber-500/12 border border-amber-500/25 text-amber-400/90 text-xs font-medium">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Comunicação */}
        {(contact.phone || contact.whatsapp || contact.email) && (
          <div className="px-6 py-4 border-t border-white/8">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Phone size={11} /> Comunicação</p>
            <div className="space-y-2">
              {contact.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Telefone</span>
                  <span className="text-sm text-white font-medium">{contact.phone}</span>
                </div>
              )}
              {contact.whatsapp && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">WhatsApp</span>
                  <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-green-400 font-medium flex items-center gap-1 hover:text-green-300">
                    {contact.whatsapp} <ExternalLink size={11} />
                  </a>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">E-mail</span>
                  <a href={`mailto:${contact.email}`}
                    className="text-sm text-amber-400 font-medium flex items-center gap-1 hover:text-amber-300">
                    {contact.email} <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Presença digital */}
        {(contact.linkedinUrl || contact.instagram) && (
          <div className="px-6 py-4 border-t border-white/8">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Globe size={11} /> Presença Digital</p>
            <div className="space-y-2">
              {contact.linkedinUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60 flex items-center gap-1.5"><Linkedin size={13} /> LinkedIn</span>
                  <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 font-medium flex items-center gap-1 hover:text-blue-300">
                    Abrir perfil <ExternalLink size={11} />
                  </a>
                </div>
              )}
              {contact.instagram && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60 flex items-center gap-1.5"><Instagram size={13} /> Instagram</span>
                  <a href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-pink-400 font-medium flex items-center gap-1 hover:text-pink-300">
                    @{contact.instagram} <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cartão de visita */}
        {contact.cardImageUrl && (
          <div className="px-6 py-4 border-t border-white/8">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5"><FileText size={11} /> Cartão de Visita</p>
            <img src={contact.cardImageUrl} alt="Cartão de visita" className="w-full rounded-xl border border-white/10 object-contain max-h-48" />
          </div>
        )}

        {/* Contextos — onde e como se conheceram (etapa 5) */}
        {contextosDoContato && contextosDoContato.length > 0 && (
          <div className="px-6 py-4 border-t border-white/8">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Calendar size={11} /> Contextos</p>
            <div className="space-y-2">
              {contextosDoContato.map(cc => (
                <div key={cc.linkId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white/70 truncate">{cc.name}</span>
                  <span className="text-xs text-white/35 flex-shrink-0">
                    {[cc.typeName, cc.city ?? cc.country].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notas */}
        {contact.notes && (
          <div className="px-6 py-4 border-t border-white/8">
            <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5"><FileText size={11} /> Notas</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed">{contact.notes}</p>
          </div>
        )}

        {/* Rodapé */}
        <div className="px-6 py-3 border-t border-white/8 bg-white/2">
          <p className="text-xs text-white/25">
            Adicionado em {new Date(contact.createdAt).toLocaleDateString("pt-BR")} · Atualizado em {new Date(contact.updatedAt).toLocaleDateString("pt-BR")}
          </p>
        </div>
        {/* Chat de Enriquecimento com IA */}
        <EnrichmentChat contactId={contact.id} contactName={contact.fullName} />
        </>)}

        {/* Aba Histórico IA */}
        {activeTab === "history" && (
          <div className="px-4 py-4">
            {!historyData || historyData.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles size={36} className="text-white/15 mb-3" />
                <p className="text-sm text-white/40">Nenhum enriquecimento via IA ainda.</p>
                <p className="text-xs text-white/25 mt-1">Abra a aba Perfil e inicie o chat de enriquecimento.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-white/35 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <History size={11} /> {historyData.total} alterações via IA
                </p>
                {historyData.data.map((item: any) => {
                  const fieldLabels: Record<string, string> = {
                    phone: "📞 Telefone", whatsapp: "💬 WhatsApp", email: "📧 E-mail",
                    company: "🏢 Empresa", job_title: "💼 Cargo", city: "📍 Cidade",
                    country: "🌍 País", linkedin_url: "🔗 LinkedIn", instagram_handle: "📸 Instagram",
                    asset_tag: "✨ Ativo", need_tag: "🎯 Necessidade", context_link: "📅 Contexto",
                    relationship_type: "🤝 Relacionamento",
                  };
                  const label = fieldLabels[item.fieldType] ?? item.fieldType;
                  const isUndone = item.status === "undone";
                  const isIgnored = item.status === "ignored";
                  return (
                    <div key={item.id} className={`p-3 rounded-xl border transition-colors ${
                      isUndone ? "bg-white/3 border-white/8 opacity-50" :
                      isIgnored ? "bg-white/3 border-white/8" :
                      "bg-white/5 border-white/10"
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-amber-400/80 font-medium">{label}</p>
                          <p className={`text-sm mt-0.5 ${isUndone ? "line-through text-white/30" : isIgnored ? "text-white/30 italic" : "text-white"}`}>
                            {isIgnored ? "(não preenchido)" : (item.appliedValue ?? item.suggestedValue)}
                          </p>
                          <p className="text-xs text-white/25 mt-1">
                            {isIgnored ? "IA perguntou → você ignorou" :
                             isUndone ? "Aplicado → desfeito" :
                             item.status === "edited" ? "IA sugeriu → você editou → aplicado" :
                             "IA sugeriu → você confirmou"}
                            {item.actionedAt && ` · ${new Date(item.actionedAt).toLocaleDateString("pt-BR")}`}
                          </p>
                        </div>
                        {!isIgnored && !isUndone && (
                          <button className="flex-shrink-0 p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Desfazer">
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Network() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [viewContact, setViewContact] = useState<Contact | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Debounce da busca
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };
  const handleSearch = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 300) as ReturnType<typeof setTimeout>;
  };

  const { data, isLoading, refetch } = trpc.network.list.useQuery(
    { q: debouncedSearch || undefined, tag: filterTag || undefined, page, limit: 20 },
    { enabled: isAuthenticated }
  );

  const createMut = trpc.network.create.useMutation({
    onSuccess: (data) => {
      toast.success("Contato adicionado!");
      setShowForm(false);
      refetch();
      // Iniciar enriquecimento automaticamente
      if (data?.id) {
        startEnrichMut.mutate({ contactId: data.id });
      }
    },
    onError: (e) => toast.error("Erro ao salvar: " + e.message),
  });
  const startEnrichMut = trpc.enrichment.startSession.useMutation({
    onSuccess: () => {
      toast.success("✨ Enriquecimento iniciado! Abra o contato para continuar.", { duration: 4000 });
      refetch();
    },
    onError: () => { /* silencioso — pode já existir sessão */ },
  });
  const updateMut = trpc.network.update.useMutation({
    onSuccess: () => { toast.success("Contato atualizado!"); setEditContact(null); refetch(); },
    onError: (e) => toast.error("Erro ao atualizar: " + e.message),
  });
  const deleteMut = trpc.network.delete.useMutation({
    onSuccess: () => { toast.success("Contato removido."); setDeleteId(null); refetch(); },
    onError: (e) => toast.error("Erro ao excluir: " + e.message),
  });

  const handleSave = (form: ReturnType<typeof emptyForm>) => {
    const payload = {
      fullName:    form.fullName,
      photoUrl:    form.photoUrl || null,
      jobTitle:    form.jobTitle || null,
      company:     form.company  || null,
      country:     form.country  || null,
      state:       form.state    || null,
      city:        form.city     || null,
      phone:       form.phone    || null,
      whatsapp:    form.whatsapp || null,
      email:       form.email    || null,
      linkedinUrl: form.linkedinUrl || null,
      instagram:   form.instagram   || null,
      profileTags: form.profileTags.length > 0 ? form.profileTags : null,
      notes:       form.notes    || null,
    };
    if (editContact) {
      updateMut.mutate({ id: editContact.id, ...payload });
    } else {
      createMut.mutate(payload);
    }
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
        <p className="text-white/50 mb-6">Faça login para acessar sua rede de contatos.</p>
        <a href={getLoginUrl()} className="px-6 py-3 bg-amber-500 text-[#060e1a] font-bold rounded-xl hover:bg-amber-400 transition-colors">
          Entrar
        </a>
      </div>
    </div>
  );

  const contacts: Contact[] = data?.data ?? [];
  const total = data?.total ?? 0;

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
              <h1 className="font-bold text-white text-lg leading-tight">Minha Rede</h1>
              <p className="text-xs text-white/35 flex items-center gap-1">
                <Shield size={10} /> Privado e criptografado
              </p>
            </div>
          </div>
          <Button onClick={() => { setEditContact(null); setShowForm(true); }}
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
            placeholder="Buscar por nome, empresa ou cargo..."
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50" />
          {search && (
            <button onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filtros por tag */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button onClick={() => { setFilterTag(""); setPage(1); }}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              !filterTag ? "bg-amber-500 border-amber-500 text-[#060e1a] font-bold" : "bg-white/5 border-white/20 text-white/60 hover:border-white/40"
            }`}>
            Todos
          </button>
          {PROFILE_TAGS.map(tag => (
            <button key={tag} onClick={() => { setFilterTag(tag === filterTag ? "" : tag); setPage(1); }}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                filterTag === tag ? "bg-amber-500 border-amber-500 text-[#060e1a] font-bold" : "bg-white/5 border-white/20 text-white/60 hover:border-white/40"
              }`}>
              {tag}
            </button>
          ))}
        </div>

        {/* Contador */}
        {!isLoading && (
          <p className="text-xs text-white/30">
            {total === 0 ? "Nenhum contato encontrado" : `${total} contato${total !== 1 ? "s" : ""}`}
            {(debouncedSearch || filterTag) ? " encontrado" + (total !== 1 ? "s" : "") : ""}
          </p>
        )}

        {/* Lista */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <User size={28} className="text-amber-500/50" />
            </div>
            <h3 className="text-white/60 font-medium mb-1">
              {debouncedSearch || filterTag ? "Nenhum contato encontrado" : "Sua rede está vazia"}
            </h3>
            <p className="text-white/30 text-sm mb-6">
              {debouncedSearch || filterTag
                ? "Tente outros termos de busca ou remova os filtros."
                : "Adicione seu primeiro contato estratégico."}
            </p>
            {!debouncedSearch && !filterTag && (
              <Button onClick={() => setShowForm(true)}
                className="bg-amber-500 hover:bg-amber-400 text-[#060e1a] font-bold gap-1.5">
                <Plus size={16} /> Adicionar contato
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {contacts.map(c => (
              <ContactCard key={c.id} contact={c}
                onView={() => setViewContact(c)}
                onEdit={() => { setEditContact(c); setShowForm(true); }}
                onDelete={() => setDeleteId(c.id)}
              />
            ))}
          </div>
        )}

        {/* Paginação */}
        {total > 20 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="border-white/15 text-white/60 bg-transparent hover:bg-white/8">
              ← Anterior
            </Button>
            <span className="text-xs text-white/40">Página {page} de {Math.ceil(total / 20)}</span>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}
              className="border-white/15 text-white/60 bg-transparent hover:bg-white/8">
              Próxima →
            </Button>
          </div>
        )}
      </div>

      {/* Modais */}
      {(showForm || editContact) && (
        <ContactForm
          initial={editContact ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditContact(null); }}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      {viewContact && (
        <ContactDetail
          contact={viewContact}
          onEdit={() => { setEditContact(viewContact); setViewContact(null); setShowForm(true); }}
          onClose={() => setViewContact(null)}
        />
      )}

      {/* Confirmação de exclusão */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0a1628] border border-white/15 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-white mb-2">Excluir contato?</h3>
            <p className="text-sm text-white/50 mb-6">Esta ação não pode ser desfeita. O contato será removido permanentemente da sua rede.</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDeleteId(null)} className="flex-1 border-white/15 text-white/60 bg-transparent hover:bg-white/8">
                Cancelar
              </Button>
              <Button onClick={() => deleteMut.mutate({ id: deleteId! })} disabled={deleteMut.isPending}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold">
                {deleteMut.isPending ? "Excluindo..." : "Excluir"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
