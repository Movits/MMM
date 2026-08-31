import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check, History, Lightbulb, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/AppHeader";
import { SmartMatchConsent } from "@/components/SmartMatchConsent";
import { analisarTermo } from "@shared/direcao-do-termo";

type EntryKind = "asset" | "need";

type ItemDoMatch = { slug: string; label: string; category?: string | null };

/**
 * O texto do selo. "Tag exata" deixou de descrever a realidade quando a regra da
 * direção passou a casar "Exportar vinho" com "Importar vinho": o objeto é o
 * mesmo, mas as tags são visivelmente diferentes, e chamar isso de tag exata é
 * dizer à usuária uma coisa que a linha de baixo desmente.
 */
export function seloDoMatch(match: { matchType: string; matchedAssets: ItemDoMatch[]; matchedNeeds: ItemDoMatch[] }) {
  if (match.matchType === "mutual") return "↔ Conexão mútua";
  if (match.matchType === "category") return "Mesma categoria";
  if (match.matchType !== "exact") return "Significados parecidos";

  const porDirecaoOposta = match.matchedAssets.some(ativo =>
    match.matchedNeeds.some(necessidade => {
      const a = analisarTermo(ativo.label);
      const n = analisarTermo(necessidade.label);
      return a.objeto === n.objeto && a.direcao !== "neutro" && n.direcao !== "neutro" && a.direcao !== n.direcao;
    }));

  return porDirecaoOposta ? "Oferta e procura" : "Tag exata";
}

export default function IntelligentMatches() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  // Etapa 11: sem o termo aceito, o servidor recusa o cruzamento. A tela pergunta
  // antes de bater na porta fechada, para não mostrar erro onde cabe um convite.
  const { data: consent, isLoading: loadingConsent, isError: consentFalhou } = trpc.consent.status.useQuery({ type: "termo_smart_match" });
  const authorized = consent?.accepted ?? false;
  const [verHistorico, setVerHistorico] = useState(false);
  const { data: historico = [] } = trpc.consent.history.useQuery(undefined, { enabled: authorized });
  const { data: matches = [], isLoading } = trpc.intelligentMatches.list.useQuery(undefined, { enabled: authorized });
  const { data: contacts = [] } = trpc.intelligentMatches.contacts.useQuery(undefined, { enabled: authorized });
  const revoke = trpc.consent.revoke.useMutation({
    onSuccess: () => { utils.consent.status.invalidate(); toast.success("Autorização revogada. O cruzamento foi desligado."); },
    onError: error => toast.error(error.message || "Não foi possível revogar."),
  });
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
    utils.intelligentMatches.contacts.invalidate();
    setTagLabel(""); setCategory("");
    toast.success(kind === "asset" ? "Pronto! Salvamos a oferta e atualizamos as sugestões." : "Pronto! Salvamos a necessidade e atualizamos as sugestões.");
  }
  /**
   * Trocar de aba limpa o que foi digitado, mas mantém o contato escolhido.
   *
   * As duas abas dividiam todo o estado: trocar não mexia em nada na tela além
   * da pílula, e as duas viravam a mesma coisa aos olhos de quem usava. Limpar
   * o texto é o sinal visível de que a troca aconteceu. O contato fica porque
   * registrar o que alguém possui e logo depois o que procura é o caminho
   * normal — apagá-lo obrigaria a escolher de novo a cada troca.
   */
  function trocarModo(novo: EntryKind) {
    if (novo === kind) return;
    setKind(novo);
    setTagLabel("");
    setCategory("");
  }

  const contatoEscolhido = contacts.find(c => String(c.id) === contactId);
  const jaRegistrados = contatoEscolhido ? (kind === "asset" ? contatoEscolhido.possui : contatoEscolhido.procura) : [];

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
        {authorized && <button disabled={recalculate.isPending} onClick={() => recalculate.mutate()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f5a623] px-5 py-3 font-bold text-[#08121f] disabled:opacity-50"><RefreshCw size={18} className={recalculate.isPending ? "animate-spin" : ""}/> Atualizar sugestões</button>}
      </div>
      {/*
        Falha ao carregar o status NÃO pode virar tela de aceite. Sem isto,
        `authorized` caía para false e a página oferecia o botão de autorizar a
        quem já tinha autorizado — sobre um termo em branco, porque o texto
        também não carregou. O aceite gravava normalmente se a rede voltasse
        antes do clique: prova de concordância com um texto que a usuária nunca
        viu, que é o oposto do que a etapa 11 existe para produzir.
      */}
      {loadingConsent ? <p className="py-24 text-center text-white/45">Carregando…</p>
      : consentFalhou ? <div className="rounded-3xl border border-white/15 px-6 py-16 text-center">
          <p className="text-white/70">Não foi possível carregar o termo de autorização.</p>
          <p className="mt-2 text-sm text-white/40">Sua autorização, se já existia, continua valendo. Tente de novo daqui a pouco.</p>
          <button onClick={() => utils.consent.status.invalidate()} className="mt-5 rounded-xl border border-amber-300/50 px-5 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-300/10">
            Tentar de novo
          </button>
        </div>
      : !authorized ? <SmartMatchConsent onAccepted={() => utils.consent.status.invalidate()}/> : <>
      <section className="mb-7 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5"><div className="flex gap-3"><Lightbulb className="mt-0.5 shrink-0 text-amber-300" size={20}/><p className="text-sm leading-6 text-amber-100/80">Anote o que cada contato tem a oferecer e o que está procurando. O MMM compara essas informações e sugere quem pode ajudar quem.</p></div></section>
      {/*
        O modo (possui / procura) decide o que o botão Adicionar faz, e modo
        escondido é armadilha: quem não percebe em qual está grava a informação
        no lado errado, e o cruzamento passa a casar coisa que não existe. Por
        isso o modo aparece em três lugares que mudam juntos — a aba, a frase
        acima do formulário e o texto do botão — e a lista do que já está
        registrado muda junto, que é o que faz as duas abas terem conteúdo
        diferente de verdade.
      */}
      <section className={`mb-8 rounded-2xl border p-5 transition-colors ${kind === "asset" ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-sky-300/30 bg-sky-300/[0.04]"}`}>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => trocarModo("asset")}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${kind === "asset" ? "bg-emerald-400 font-bold text-[#08121f]" : "border border-white/15 text-white/65 hover:border-white/30"}`}
          >
            O que possui
          </button>
          <button
            type="button"
            onClick={() => trocarModo("need")}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${kind === "need" ? "bg-sky-300 font-bold text-[#08121f]" : "border border-white/15 text-white/65 hover:border-white/30"}`}
          >
            O que procura
          </button>
        </div>

        <p className="mb-3 text-sm text-white/55">
          {contatoEscolhido
            ? <>Registrando o que <strong className="text-white/85">{contatoEscolhido.fullName}</strong>{" "}
                <strong className={kind === "asset" ? "text-emerald-300" : "text-sky-300"}>
                  {kind === "asset" ? "tem a oferecer" : "está procurando"}
                </strong>.</>
            : <>Escolha um contato para registrar o que ele{" "}
                <strong className={kind === "asset" ? "text-emerald-300" : "text-sky-300"}>
                  {kind === "asset" ? "tem a oferecer" : "está procurando"}
                </strong>.</>}
        </p>

        <form onSubmit={submitEntry} className="grid gap-3 md:grid-cols-4">
          <select
            value={contactId}
            onChange={event => setContactId(event.target.value)}
            className="rounded-xl border border-white/15 bg-[#0b1725] px-3 py-3 text-white"
          >
            <option className="bg-white text-[#2D3E50]" value="">Selecione um contato</option>
            {contacts.map(contact => (
              <option className="bg-white text-[#2D3E50]" key={contact.id} value={contact.id}>
                {contact.fullName}{contact.company ? ` (${contact.company})` : ""}
              </option>
            ))}
          </select>
          <input
            value={tagLabel}
            onChange={event => setTagLabel(event.target.value)}
            placeholder={kind === "asset" ? "Ex.: Armazenagem refrigerada" : "Ex.: Compradores no exterior"}
            className={`rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none ${kind === "asset" ? "focus:border-emerald-400" : "focus:border-sky-300"}`}
          />
          <input
            value={category}
            onChange={event => setCategory(event.target.value)}
            placeholder="Categoria opcional"
            className={`rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none ${kind === "asset" ? "focus:border-emerald-400" : "focus:border-sky-300"}`}
          />
          <button
            disabled={createAsset.isPending || createNeed.isPending}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-bold text-[#08121f] transition-colors disabled:opacity-50 ${kind === "asset" ? "bg-emerald-400 hover:bg-emerald-300" : "bg-sky-300 hover:bg-sky-200"}`}
          >
            <Plus size={17}/> {kind === "asset" ? "Adicionar ao que possui" : "Adicionar ao que procura"}
          </button>
        </form>

        {contatoEscolhido && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="mb-2 text-xs text-white/40">
              {contatoEscolhido.fullName} {kind === "asset" ? "já oferece" : "já procura"}:
            </p>
            {jaRegistrados.length === 0 ? (
              <p className="text-xs text-white/35">
                Nada registrado ainda {kind === "asset" ? "no que possui" : "no que procura"}.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {jaRegistrados.map(item => (
                  <li
                    key={item.id}
                    className={`rounded-full border px-3 py-1 text-xs ${kind === "asset" ? "border-emerald-400/30 text-emerald-200/80" : "border-sky-300/30 text-sky-200/80"}`}
                  >
                    {item.label}{item.category ? <span className="text-white/35"> · {item.category}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      {isLoading ? <p className="py-16 text-center text-white/45">Carregando oportunidades…</p> : !matches.length ? <div className="rounded-3xl border border-dashed border-white/15 px-6 py-20 text-center"><Sparkles className="mx-auto mb-4 text-amber-300" size={34}/><h2 className="text-xl font-semibold">Nenhuma oportunidade ainda</h2><p className="mt-2 text-white/45">Cadastre acima o que um contato oferece e o que outro procura. As sugestões de conexão vão aparecer aqui.</p></div> : <div className="grid gap-4">{matches.map(match => <article key={match.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="flex flex-col justify-between gap-4 md:flex-row"><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-300 px-3 py-1 text-sm font-bold text-[#08121f]">{match.matchScore}% de compatibilidade</span><span className={`rounded-full px-3 py-1 text-xs ${match.matchType === "mutual" ? "border border-emerald-400/50 bg-emerald-400/10 font-semibold text-emerald-300" : "border border-white/15 text-white/60"}`}>{seloDoMatch(match)}</span></div><h2 className="text-lg font-semibold">{match.contactA?.name ?? "Contato A"} <span className="text-white/35">→</span> {match.contactB?.name ?? "Contato B"}</h2><p className="mt-2 text-sm text-white/65">{match.reasonText}</p><p className="mt-3 text-xs text-white/40">Oferece: {match.matchedAssets.map(item => item.label).join(", ")} · Procura: {match.matchedNeeds.map(item => item.label).join(", ")}</p></div>{match.status === "pending" || match.status === "viewed" ? <div className="flex shrink-0 flex-wrap gap-2 self-start"><button onClick={() => updateStatus.mutate({ id: match.id, status: "accepted" })} className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-bold text-[#08121f]"><Check size={15} className="mr-1 inline"/> Aceitar</button><button onClick={() => updateStatus.mutate({ id: match.id, status: "dismissed" })} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/65"><X size={15} className="mr-1 inline"/> Dispensar</button></div> : <span className="text-sm text-white/45">{match.status === "accepted" ? "Conexão aceita" : "Dispensada"}</span>}</div></article>)}</div>}
      {!consent?.pendingText && (
        <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm text-white/55">
            O Cruzamento Inteligente está autorizado por você{consent?.acceptedAt ? ` desde ${new Date(consent.acceptedAt).toLocaleDateString()}` : ""}.
          </p>
          <button
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({ type: "termo_smart_match" })}
            className="mt-3 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 transition-colors hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
          >
            Revogar autorização
          </button>
          <p className="mt-2 text-xs text-white/35">
            Desliga só o cruzamento. Contatos, oportunidades e reuniões continuam funcionando.
          </p>

          {/*
            O registro é metade do sentido de guardar consentimento: revogar
            preenche a data e nunca apaga a linha, justamente para que o
            histórico mostre que houve autorização no período em que os dados
            foram usados. Guardar essa prova e não mostrá-la a quem ela protege
            deixava o trabalho pela metade.
          */}
          {historico.length > 0 && (
            <div className="mt-5 border-t border-white/10 pt-4">
              <button
                onClick={() => setVerHistorico(!verHistorico)}
                className="flex items-center gap-1.5 text-xs text-white/45 transition-colors hover:text-white/70"
              >
                <History size={13}/>
                {verHistorico ? "Ocultar" : "Ver"} o registro das autorizações ({historico.length})
              </button>

              {verHistorico && (
                <ul className="mt-3 space-y-2">
                  {historico.map(registro => {
                    // Três situações, não duas. Uma autorização de versão
                    // anterior nunca foi revogada — `revoke` só mexe na versão
                    // vigente — mas também não autoriza nada: `hasValidConsent`
                    // exige a versão vigente. Chamá-la de "ativa" dizia à
                    // usuária que ela mantém autorizações vivas que não existem,
                    // num registro que ela não tem como corrigir pela tela.
                    const vigente = registro.version === consent?.document?.version;
                    const situacao = registro.revokedAt ? "revogada" : vigente ? "ativa" : "substituída";
                    const cor = situacao === "ativa" ? "text-emerald-300/70" : "text-white/35";
                    return (
                    <li key={registro.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-white/45">
                      <span className={cor}>{situacao}</span>
                      <span className="text-white/55">versão {registro.version}</span>
                      <span>aceita em {new Date(registro.grantedAt).toLocaleString()}</span>
                      {registro.revokedAt && <span>· revogada em {new Date(registro.revokedAt).toLocaleString()}</span>}
                      {situacao === "substituída" && <span>· o termo mudou depois disso</span>}
                    </li>
                  );})}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      </>}
    </div>
  </main></>;
}
