import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, BrainCircuit, Database, ExternalLink, FileText, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/AppHeader";

const SUGGESTIONS = [
  "Quais contatos conheci em eventos de tecnologia?",
  "Quem pode me apresentar a investidoras?",
  "O que foi discutido nas minhas últimas reuniões?",
  "Quais conexões têm experiência em saúde?",
];

const typeLabel: Record<string, string> = { contact: "Contato", context: "Contexto", meeting: "Reunião" };

export default function Memory() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const { data: status, isLoading: loadingStatus } = trpc.memory.status.useQuery();
  const reindex = trpc.memory.reindex.useMutation({
    onSuccess: async (result) => {
      await utils.memory.status.invalidate();
      toast.success(`${result.indexed} memória(s) indexada(s).`);
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar a memória."),
  });
  const search = trpc.memory.search.useMutation({
    onError: error => toast.error(error.message || "Não foi possível realizar a busca."),
  });

  function submit(value = query) {
    const clean = value.trim();
    if (clean.length < 2) return toast.error("Escreva uma pergunta com pelo menos 2 caracteres.");
    setQuery(clean);
    search.mutate({ query: clean });
  }

  return <><AppHeader title="Memória IA" backTo="/dashboard"/>
  <main className="min-h-screen px-4 py-8 md:px-8 text-white bg-transparent">
    <div className="max-w-5xl mx-auto">
      <section className="rounded-3xl border border-amber-400/20 bg-[radial-gradient(circle_at_top_right,rgba(245,166,35,.15),transparent_38%),rgba(8,18,31,.82)] p-6 md:p-9 overflow-hidden relative">
        <div className="absolute -right-14 -top-14 h-52 w-52 rounded-full border border-amber-300/10" />
        <div className="relative"><p className="text-amber-300 text-xs font-bold tracking-[.18em]">MEMÓRIA INTELIGENTE</p><h1 className="text-3xl md:text-4xl font-bold mt-2">Pergunte à sua rede em linguagem natural</h1><p className="max-w-2xl mt-3 text-white/60">Encontre contatos, contextos e conversas privadas sem precisar lembrar palavras exatas. As respostas usam apenas o conteúdo da sua conta.</p>
          <div className="mt-7 flex flex-col md:flex-row gap-3"><div className="relative flex-1"><Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"/><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") submit(); }} placeholder="Ex.: Quem trabalha com energia renovável?" className="w-full rounded-xl border border-white/15 bg-[#07111d]/80 py-4 pl-12 pr-4 outline-none focus:border-amber-300"/></div><button onClick={() => submit()} disabled={search.isPending} className="rounded-xl bg-[#f5a623] px-6 py-4 font-bold text-[#08121f] disabled:opacity-60 inline-flex justify-center items-center gap-2">{search.isPending ? <Loader2 className="animate-spin" size={19}/> : <Sparkles size={19}/>}Buscar</button></div>
          <div className="mt-4 flex flex-wrap gap-2">{SUGGESTIONS.map(suggestion => <button key={suggestion} onClick={() => submit(suggestion)} className="rounded-full border border-white/15 bg-white/[.04] px-3 py-1.5 text-xs text-white/65 hover:border-amber-300/50 hover:text-amber-100">{suggestion}</button>)}</div>
        </div>
      </section>

      <section className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.035] p-4"><div className="flex items-center gap-3"><div className="grid place-items-center h-10 w-10 rounded-xl bg-amber-400/10 text-amber-300"><Database size={19}/></div><div><p className="text-sm font-semibold">Memória privada</p><p className="text-xs text-white/45">{loadingStatus ? "Verificando índice…" : `${status?.documents ?? 0} documento(s) indexado(s)`}{status?.lastIndexedAt ? ` · atualizado em ${new Date(status.lastIndexedAt).toLocaleDateString("pt-BR")}` : ""}</p></div></div><button onClick={() => reindex.mutate()} disabled={reindex.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-amber-200 hover:bg-amber-300/10 disabled:opacity-50">{reindex.isPending ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}Atualizar memória</button></section>

      {search.isPending && <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.035] p-10 text-center"><BrainCircuit className="mx-auto animate-pulse text-amber-300" size={34}/><h2 className="mt-4 font-semibold">Consultando sua memória privada…</h2><p className="mt-2 text-sm text-white/45">Buscando relações de significado em contatos, contextos e reuniões.</p></section>}
      {search.data && <section className="mt-6 space-y-5"><div className="rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-5"><div className="flex items-center gap-2 text-amber-300"><Sparkles size={18}/><h2 className="font-semibold">Resposta fundamentada</h2></div><p className="mt-3 whitespace-pre-wrap leading-7 text-white/85">{search.data.answer}</p></div><div><h2 className="text-lg font-semibold mb-3">Fontes privadas utilizadas</h2>{search.data.hits.length ? <div className="grid md:grid-cols-2 gap-3">{search.data.hits.map((hit, index) => <article key={hit.id} className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><div className="flex items-start justify-between gap-3"><div><span className="text-xs text-amber-300">[{index + 1}] {typeLabel[hit.sourceType] ?? hit.sourceType}</span><h3 className="font-semibold mt-1">{hit.title}</h3></div><span className="text-xs text-white/40">{Math.round(hit.score * 100)}% relevante</span></div><p className="mt-3 text-sm leading-6 text-white/55 line-clamp-4">{hit.content}</p>{typeof hit.metadata.href === "string" && <button onClick={() => navigate(hit.metadata.href as string)} className="mt-4 inline-flex items-center gap-1 text-sm text-amber-300 hover:text-amber-200">Abrir fonte <ExternalLink size={14}/></button>}</article>)}</div> : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45"><FileText className="mx-auto mb-3" size={25}/>Nenhuma fonte encontrada.</div>}</div></section>}
    </div>
  </main></>;
}
