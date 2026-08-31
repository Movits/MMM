import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check, Lightbulb, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/AppHeader";

type EntryKind = "asset" | "need";

export default function IntelligentMatches() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: matches = [], isLoading } = trpc.intelligentMatches.list.useQuery();
  const { data: contacts = [] } = trpc.intelligentMatches.contacts.useQuery();
  const [kind, setKind] = useState<EntryKind>("asset");
  const [contactId, setContactId] = useState("");
  const [tagLabel, setTagLabel] = useState("");
  const [category, setCategory] = useState("");
  const recalculate = trpc.intelligentMatches.recalculate.useMutation({
    onSuccess: result => { utils.intelligentMatches.list.invalidate(); toast.success(`${result.total} oportunidade(s) analisada(s).`); },
    onError: error => toast.error(error.message || "Não foi possível atualizar os matches."),
  });
  const createAsset = trpc.intelligentMatches.addAsset.useMutation({ onSuccess: refresh });
  const createNeed = trpc.intelligentMatches.addNeed.useMutation({ onSuccess: refresh });
  const updateStatus = trpc.intelligentMatches.updateStatus.useMutation({ onSuccess: () => utils.intelligentMatches.list.invalidate() });

  function refresh() {
    utils.intelligentMatches.list.invalidate();
    setTagLabel(""); setCategory("");
    toast.success(kind === "asset" ? "Pronto! Salvamos a oferta e atualizamos as sugestões." : "Pronto! Salvamos a necessidade e atualizamos as sugestões.");
  }
  function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!contactId || !tagLabel.trim()) return toast.error("Escolha o contato e descreva o item.");
    const input = { contactId: Number(contactId), tagLabel: tagLabel.trim(), category: category.trim() || undefined };
    if (kind === "asset") createAsset.mutate(input); else createNeed.mutate(input);
  }

  return <><AppHeader title="Conexões Inteligentes" backTo="/dashboard"/>
  <main className="min-h-screen bg-transparent px-4 py-8 text-white md:px-8">
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><p className="text-xs font-semibold tracking-wide text-amber-300">REDE PRIVADA</p><h1 className="mt-1 text-3xl font-bold md:text-4xl">Conexões Inteligentes</h1><p className="mt-2 max-w-2xl text-white/55">Encontre oportunidades de conexão entre os seus próprios contatos. Nada é compartilhado com outras usuárias.</p></div>
        <button disabled={recalculate.isPending} onClick={() => recalculate.mutate()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f5a623] px-5 py-3 font-bold text-[#08121f] disabled:opacity-50"><RefreshCw size={18} className={recalculate.isPending ? "animate-spin" : ""}/> Atualizar sugestões</button>
      </div>
      <section className="mb-7 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5"><div className="flex gap-3"><Lightbulb className="mt-0.5 shrink-0 text-amber-300" size={20}/><p className="text-sm leading-6 text-amber-100/80">Anote o que cada contato tem a oferecer e o que está procurando. O MMM compara essas informações e sugere quem pode ajudar quem.</p></div></section>
      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="mb-4 flex flex-wrap gap-2"><button onClick={() => setKind("asset")} className={`rounded-full px-4 py-2 text-sm ${kind === "asset" ? "bg-emerald-400 text-[#08121f] font-bold" : "border border-white/15 text-white/65"}`}>O que possui</button><button onClick={() => setKind("need")} className={`rounded-full px-4 py-2 text-sm ${kind === "need" ? "bg-sky-300 text-[#08121f] font-bold" : "border border-white/15 text-white/65"}`}>O que procura</button></div><form onSubmit={submitEntry} className="grid gap-3 md:grid-cols-4"><select value={contactId} onChange={event => setContactId(event.target.value)} className="rounded-xl border border-white/15 bg-[#0b1725] px-3 py-3 text-white"><option className="bg-white text-[#2D3E50]" value="">Selecione um contato</option>{contacts.map(contact => <option className="bg-white text-[#2D3E50]" key={contact.id} value={contact.id}>{contact.fullName}{contact.company ? ` (${contact.company})` : ""}</option>)}</select><input value={tagLabel} onChange={event => setTagLabel(event.target.value)} placeholder={kind === "asset" ? "Ex.: Investimento em mineração" : "Ex.: Fornecedores de minério"} className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none focus:border-amber-300"/><input value={category} onChange={event => setCategory(event.target.value)} placeholder="Categoria opcional" className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none focus:border-amber-300"/><button disabled={createAsset.isPending || createNeed.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/50 px-3 py-3 font-semibold text-amber-200 hover:bg-amber-300/10 disabled:opacity-50"><Plus size={17}/> Adicionar</button></form></section>
      {isLoading ? <p className="py-16 text-center text-white/45">Carregando oportunidades…</p> : !matches.length ? <div className="rounded-3xl border border-dashed border-white/15 px-6 py-20 text-center"><Sparkles className="mx-auto mb-4 text-amber-300" size={34}/><h2 className="text-xl font-semibold">Nenhuma oportunidade ainda</h2><p className="mt-2 text-white/45">Cadastre acima o que um contato oferece e o que outro procura. As sugestões de conexão vão aparecer aqui.</p></div> : <div className="grid gap-4">{matches.map(match => <article key={match.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="flex flex-col justify-between gap-4 md:flex-row"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-300 px-3 py-1 text-sm font-bold text-[#08121f]">{match.matchScore}% de compatibilidade</span><span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">{match.matchType === "exact" ? "Tag exata" : match.matchType === "category" ? "Mesma categoria" : "Significados parecidos"}</span></div><h2 className="text-lg font-semibold">{match.contactA?.name ?? "Contato A"} <span className="text-white/35">→</span> {match.contactB?.name ?? "Contato B"}</h2><p className="mt-2 text-sm text-white/65">{match.reasonText}</p><p className="mt-3 text-xs text-white/40">Oferece: {match.matchedAssets.map(item => item.label).join(", ")} · Procura: {match.matchedNeeds.map(item => item.label).join(", ")}</p></div>{match.status === "pending" || match.status === "viewed" ? <div className="flex shrink-0 flex-wrap gap-2 self-start"><button onClick={() => updateStatus.mutate({ id: match.id, status: "accepted" })} className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-bold text-[#08121f]"><Check size={15} className="mr-1 inline"/> Aceitar</button><button onClick={() => updateStatus.mutate({ id: match.id, status: "dismissed" })} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/65"><X size={15} className="mr-1 inline"/> Dispensar</button></div> : <span className="text-sm text-white/45">{match.status === "accepted" ? "Conexão aceita" : "Dispensada"}</span>}</div></article>)}</div>}
    </div>
  </main></>;
}
