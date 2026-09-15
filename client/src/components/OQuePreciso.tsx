import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { AssistenteDeTexto } from "@/components/AssistenteDeTexto";
import {
  CATEGORIAS_O_QUE_PRECISO,
  LIMITE_DA_DESCRICAO,
  LIMITE_DE_DEMANDAS,
  LIMITE_DE_DEMANDAS_POR_CATEGORIA,
  LIMITE_DO_CAMPO,
  MINIMO_DA_DESCRICAO,
  categoriaDoQuePreciso,
  categoriasPendentes,
  demandaEmBranco,
  demandaValida,
  ehCategoriaOQuePreciso,
  lerDemandas,
  novoIdDeDemanda,
  type CategoriaOQuePreciso,
  type DefinicaoDoCampo,
  type DemandaDetalhada,
} from "@shared/o-que-preciso";

/**
 * "O que preciso — Demandas e necessidades" (pedido do Rosber, 14/09 21:24): os
 * 17 cartões e, ao marcar um, a segunda camada com a pergunta e os campos
 * daquela categoria. Uma categoria aberta por vez (nunca todos os campos de
 * uma vez), várias demandas por categoria, cada uma guardada separada.
 *
 * O componente só edita o valor; quem valida o avanço (Onboarding) ou o salvar
 * (Perfil) usa `categoriasPendentes` de shared/o-que-preciso.ts, a mesma regra
 * que o servidor aplica. Nenhum texto desta tela diz "match" (Rosber, 21:34).
 */

export type ValorDoQuePreciso = { categorias: string[]; demandas: DemandaDetalhada[] };

type Variante = "onboarding" | "perfil";

// O Onboarding usa o cobre da marca; o Perfil, o âmbar das seções dele. O resto
// (bordas, fundos, tipografia) é o mesmo dos cartões que já existiam nas duas telas.
const TEMAS: Record<Variante, { cartaoAtivo: string; check: string; pilulaAtiva: string; foco: string; painel: string; botao: string; link: string }> = {
  onboarding: {
    cartaoAtivo: "bg-[#c98f70]/15 border-[#c98f70]/60 text-[#c98f70] shadow-sm shadow-[#c98f70]/10",
    check: "text-[#c98f70]",
    pilulaAtiva: "bg-[#c98f70] border-[#c98f70] text-[#151312] font-bold",
    foco: "focus:border-[#c98f70]/60",
    painel: "border-[#c98f70]/30 bg-[#c98f70]/5",
    botao: "bg-[#c98f70] hover:bg-[#b07a5c] text-[#151312]",
    link: "text-[#c98f70] hover:text-[#efcba8]",
  },
  perfil: {
    cartaoAtivo: "bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm shadow-amber-500/10",
    check: "text-amber-400",
    pilulaAtiva: "bg-amber-500 border-amber-500 text-black font-bold",
    foco: "focus:border-amber-500/50",
    painel: "border-amber-500/30 bg-amber-500/5",
    botao: "bg-amber-500 hover:bg-amber-400 text-black",
    link: "text-amber-400 hover:text-amber-300",
  },
};

const camposDa = (categoria: CategoriaOQuePreciso) => categoria.campos as readonly DefinicaoDoCampo[];

function useRotulos() {
  const { t } = useTranslation();
  return {
    t,
    titulo: (chave: string) => t(`oQuePreciso.categorias.${chave}.titulo`, { defaultValue: categoriaDoQuePreciso(chave)?.titulo ?? chave }),
    legado: (chave: string) => t(`oQuePreciso.legado.${chave}`, { defaultValue: chave }),
    opcao: (categoria: string, valor: string) => t(`oQuePreciso.opcoes.${categoria}.${valor}`, { defaultValue: valor }),
    campo: (rotulo: string) => t(`oQuePreciso.campos.${rotulo}`),
  };
}

/** Os dados estruturados preenchidos, já traduzidos, para o resumo de uma demanda. */
function useQualificadores() {
  const { t, opcao, campo } = useRotulos();
  return (demanda: DemandaDetalhada): string[] => {
    const categoria = categoriaDoQuePreciso(demanda.category);
    if (!categoria) return [];
    const saida: string[] = [];
    for (const definicao of camposDa(categoria)) {
      if (definicao.tipo === "descricao") continue;
      if (definicao.tipo === "simNao") {
        if (demanda.exclusivity) saida.push(`${campo(definicao.rotulo)}: ${t(demanda.exclusivity === "sim" ? "oQuePreciso.sim" : "oQuePreciso.nao")}`);
        continue;
      }
      const valor = (demanda[definicao.campo] ?? "").trim();
      if (!valor) continue;
      if (definicao.tipo === "opcoes") saida.push(definicao.rotulo ? `${campo(definicao.rotulo)}: ${opcao(demanda.category, valor)}` : opcao(demanda.category, valor));
      else saida.push(`${campo(definicao.rotulo)}: ${valor}`);
    }
    return saida;
  };
}

function Pilula({ selecionada, onClick, rotulo, tema }: { selecionada: boolean; onClick: () => void; rotulo: string; tema: Variante }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selecionada}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 active:scale-95 ${selecionada
        ? TEMAS[tema].pilulaAtiva
        : "bg-white/5 border-white/20 text-white/70 hover:border-white/40 hover:text-white"}`}>
      {rotulo}
    </button>
  );
}

function FormularioDaDemanda({ demanda, categoria, numero, tema, onAlterar, onRemover }: {
  demanda: DemandaDetalhada; categoria: CategoriaOQuePreciso; numero: number; tema: Variante;
  onAlterar: (proxima: DemandaDetalhada) => void; onRemover: () => void;
}) {
  const { t, opcao, campo } = useRotulos();
  const base = useId();
  const emBranco = demandaEmBranco(demanda);

  const alterar = (nome: keyof DemandaDetalhada, valor: string | undefined) => {
    const proxima = { ...demanda } as Record<string, unknown>;
    if (valor === undefined || valor === "") delete proxima[nome];
    else proxima[nome] = valor;
    onAlterar(proxima as DemandaDetalhada);
  };

  const classeDoCampo = `w-full bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none ${TEMAS[tema].foco} focus:bg-white/8 transition-all duration-200 text-sm`;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/50">{t("oQuePreciso.demandaN", { n: numero })}</p>
        <button type="button" onClick={onRemover} className="flex items-center gap-1 text-xs text-white/40 hover:text-red-300 transition-colors">
          <Trash2 size={12} /> {t("oQuePreciso.remover")}
        </button>
      </div>

      {camposDa(categoria).map(definicao => {
        const id = `${base}-${definicao.campo}`;
        if (definicao.tipo === "opcoes") {
          const escolhida = demanda[definicao.campo] ?? "";
          return (
            <div key={definicao.campo}>
              {definicao.rotulo && <p className="block text-sm font-medium text-white/70 mb-2">{campo(definicao.rotulo)}</p>}
              <div className="flex flex-wrap gap-2" role="group" aria-label={definicao.rotulo ? campo(definicao.rotulo) : t(`oQuePreciso.categorias.${categoria.chave}.pergunta`)}>
                {definicao.opcoes.map(item => (
                  <Pilula key={item.chave} tema={tema} rotulo={opcao(categoria.chave, item.chave)} selecionada={escolhida === item.chave}
                    onClick={() => alterar(definicao.campo, escolhida === item.chave ? undefined : item.chave)} />
                ))}
              </div>
              {definicao.obrigatorio && !escolhida && !emBranco && (
                <p className="text-xs text-red-400/80 mt-1.5">{t("oQuePreciso.servicoObrigatorio")}</p>
              )}
            </div>
          );
        }
        if (definicao.tipo === "simNao") {
          return (
            <div key={definicao.campo}>
              <p className="block text-sm font-medium text-white/70 mb-2">{campo(definicao.rotulo)}</p>
              <div className="flex gap-2" role="group" aria-label={campo(definicao.rotulo)}>
                {(["sim", "nao"] as const).map(valor => (
                  <Pilula key={valor} tema={tema} rotulo={t(`oQuePreciso.${valor}`)} selecionada={demanda.exclusivity === valor}
                    onClick={() => alterar("exclusivity", demanda.exclusivity === valor ? undefined : valor)} />
                ))}
              </div>
            </div>
          );
        }
        if (definicao.tipo === "descricao") {
          const valor = demanda.description ?? "";
          const passou = valor.length > LIMITE_DA_DESCRICAO;
          const curta = !emBranco && valor.trim().length < MINIMO_DA_DESCRICAO;
          return (
            <div key={definicao.campo}>
              <label htmlFor={id} className="block text-sm font-medium text-white/70 mb-2">
                {campo(definicao.rotulo)}<span className={TEMAS[tema].check}> *</span>
              </label>
              <textarea id={id} value={valor} rows={3} onChange={e => alterar("description", e.target.value)}
                placeholder={t(`oQuePreciso.categorias.${categoria.chave}.exemplo`)}
                aria-invalid={passou || curta || undefined}
                className={`${classeDoCampo} resize-none ${passou ? "border-red-400/60" : ""}`} />
              <AssistenteDeTexto valor={valor} onChange={novo => alterar("description", novo)} />
              <div className="flex items-start justify-between gap-3 mt-1">
                {curta ? <p className="text-xs text-red-400/80">{t("oQuePreciso.descricaoCurta", { minimo: MINIMO_DA_DESCRICAO })}</p> : <span />}
                <span className={`text-[11px] tabular-nums shrink-0 ${passou ? "text-red-400" : "text-white/25"}`}>
                  {t("assistenteTexto.contador", { atual: valor.length, maximo: LIMITE_DA_DESCRICAO })}
                </span>
              </div>
              {passou && <p className="text-xs text-red-400/80 mt-1">{t("assistenteTexto.textoLongo", { maximo: LIMITE_DA_DESCRICAO })}</p>}
            </div>
          );
        }
        return (
          <div key={definicao.campo}>
            <label htmlFor={id} className="block text-sm font-medium text-white/70 mb-2">{campo(definicao.rotulo)}</label>
            <input id={id} type="text" value={demanda[definicao.campo] ?? ""} maxLength={LIMITE_DO_CAMPO}
              onChange={e => alterar(definicao.campo, e.target.value)} className={classeDoCampo} />
          </div>
        );
      })}
    </div>
  );
}

function ResumoDaDemanda({ demanda, numero, onEditar, onRemover }: {
  demanda: DemandaDetalhada; numero: number; onEditar: () => void; onRemover: () => void;
}) {
  const { t } = useRotulos();
  const qualificadores = useQualificadores();
  const valida = demandaValida(demanda);
  return (
    <div className={`rounded-xl border px-4 py-3 ${valida ? "border-white/10 bg-white/[0.03]" : "border-red-400/40 bg-red-500/5"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{t("oQuePreciso.demandaN", { n: numero })}</p>
          <p className="text-sm text-white/80 mt-0.5 break-words">{demanda.description?.trim() || "—"}</p>
          {qualificadores(demanda).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {qualificadores(demanda).map(item => (
                <span key={item} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/55">{item}</span>
              ))}
            </div>
          )}
          {!valida && <p className="text-xs text-red-400/80 mt-1.5">{t("oQuePreciso.categoriaSemDemanda")}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={onEditar} className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors">
            <Pencil size={12} /> {t("oQuePreciso.editar")}
          </button>
          <button type="button" onClick={onRemover} aria-label={`${t("oQuePreciso.remover")} ${t("oQuePreciso.demandaN", { n: numero })}`}
            className="flex items-center gap-1 text-xs text-white/40 hover:text-red-300 transition-colors">
            <Trash2 size={12} /> {t("oQuePreciso.remover")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Os cartões + a segunda camada. `toleradas`: categorias que o perfil já tinha
 * gravadas sem detalhamento (Perfil); ficam marcadas sem travar o salvar.
 */
export function EditorDoQuePreciso({ valor, onChange, variante = "onboarding", toleradas = [] }: {
  valor: ValorDoQuePreciso;
  onChange: (proximo: ValorDoQuePreciso) => void;
  variante?: Variante;
  toleradas?: readonly string[];
}) {
  const { t, titulo, legado } = useRotulos();
  const tema = TEMAS[variante];
  const [categoriaAberta, setCategoriaAberta] = useState<string | null>(null);
  const [demandaAberta, setDemandaAberta] = useState<string | null>(null);
  const { categorias, demandas } = valor;

  const daCategoria = (chave: string) => demandas.filter(demanda => demanda.category === chave);
  const pendentes = categoriasPendentes(categorias, demandas, toleradas);
  const legadas = categorias.filter(chave => !ehCategoriaOQuePreciso(chave));
  const detalhadas = demandas.filter(demanda => categorias.includes(demanda.category) && demandaValida(demanda)).length;
  const noLimiteTotal = demandas.length >= LIMITE_DE_DEMANDAS;

  const novaDemanda = (chave: string): DemandaDetalhada => ({ id: novoIdDeDemanda(), category: chave as DemandaDetalhada["category"] });

  // Fechar tira as demandas em branco daquela categoria (a recém-aberta que ninguém tocou).
  const semBrancas = (lista: DemandaDetalhada[], chave: string) => lista.filter(demanda => demanda.category !== chave || !demandaEmBranco(demanda));

  const fecharPainel = () => {
    if (categoriaAberta) onChange({ categorias, demandas: semBrancas(demandas, categoriaAberta) });
    setCategoriaAberta(null);
    setDemandaAberta(null);
  };

  const clicarCategoria = (chave: string) => {
    const base = categoriaAberta && categoriaAberta !== chave ? semBrancas(demandas, categoriaAberta) : demandas;
    if (categoriaAberta === chave) { fecharPainel(); return; }
    const existentes = base.filter(demanda => demanda.category === chave);
    const proximasCategorias = categorias.includes(chave) ? categorias : [...categorias, chave];
    if (existentes.length === 0 && !noLimiteTotal) {
      const nova = novaDemanda(chave);
      onChange({ categorias: proximasCategorias, demandas: [...base, nova] });
      setDemandaAberta(nova.id);
    } else {
      onChange({ categorias: proximasCategorias, demandas: base });
      setDemandaAberta(existentes.find(demanda => !demandaValida(demanda))?.id ?? null);
    }
    setCategoriaAberta(chave);
  };

  const desmarcar = (chave: string) => {
    onChange({ categorias: categorias.filter(item => item !== chave), demandas: demandas.filter(demanda => demanda.category !== chave) });
    setCategoriaAberta(null);
    setDemandaAberta(null);
  };

  const adicionar = (chave: string) => {
    const nova = novaDemanda(chave);
    onChange({ categorias, demandas: [...semBrancas(demandas, chave), nova] });
    setDemandaAberta(nova.id);
  };

  // O ditado ("Gravar áudio") pode chegar depois de o formulário da demanda sair
  // da tela, com a pessoa já em outra categoria: a troca parte do valor ATUAL,
  // senão desfaria o que ela marcou enquanto o áudio era transcrito.
  const valorAtual = useRef(valor);
  valorAtual.current = valor;
  const alterarDemanda = (proxima: DemandaDetalhada) => {
    const atual = valorAtual.current;
    onChange({ categorias: atual.categorias, demandas: atual.demandas.map(demanda => (demanda.id === proxima.id ? proxima : demanda)) });
  };

  const removerDemanda = (id: string) => {
    onChange({ categorias, demandas: demandas.filter(demanda => demanda.id !== id) });
    if (demandaAberta === id) setDemandaAberta(null);
  };

  const painel = (categoria: CategoriaOQuePreciso) => {
    const lista = daCategoria(categoria.chave);
    const noLimite = lista.length >= LIMITE_DE_DEMANDAS_POR_CATEGORIA || noLimiteTotal;
    const pendente = pendentes.includes(categoria.chave);
    const tolerada = !pendente && toleradas.includes(categoria.chave) && lista.every(demanda => demandaEmBranco(demanda));
    return (
      <div key={`painel-${categoria.chave}`} role="region" aria-label={titulo(categoria.chave)}
        className={`sm:col-span-2 rounded-2xl border p-4 sm:p-5 space-y-4 ${tema.painel}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{categoria.emoji} {titulo(categoria.chave)}</p>
            {/* Em "Outra necessidade" a pergunta é o próprio rótulo do campo: não se repete. */}
            {categoria.chave !== "outra_necessidade" && (
              <p className="text-base font-bold text-white mt-1">{t(`oQuePreciso.categorias.${categoria.chave}.pergunta`)}</p>
            )}
            {categoria.chave === "conexoes_institucionais" && (
              <p className="text-xs text-white/40 mt-1">{t("oQuePreciso.institucionalAviso")}</p>
            )}
          </div>
          <button type="button" onClick={fecharPainel} aria-label={t("oQuePreciso.concluir")}
            className="shrink-0 rounded-lg p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        {lista.map((demanda, indice) => demandaAberta === demanda.id ? (
          <FormularioDaDemanda key={demanda.id} demanda={demanda} categoria={categoria} numero={indice + 1} tema={variante}
            onAlterar={alterarDemanda} onRemover={() => removerDemanda(demanda.id)} />
        ) : (
          <ResumoDaDemanda key={demanda.id} demanda={demanda} numero={indice + 1}
            onEditar={() => setDemandaAberta(demanda.id)} onRemover={() => removerDemanda(demanda.id)} />
        ))}

        {pendente && <p className="text-xs text-red-400/80">{t("oQuePreciso.categoriaSemDemanda")}</p>}
        {tolerada && <p className="text-xs text-white/40">{t("oQuePreciso.categoriaAntigaSemDetalhe")}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => adicionar(categoria.chave)} disabled={noLimite}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tema.link}`}>
            <Plus size={14} /> {t("oQuePreciso.adicionarDemanda")}
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => desmarcar(categoria.chave)} className="text-xs text-white/40 hover:text-red-300 transition-colors">
              {t("oQuePreciso.desmarcarCategoria")}
            </button>
            <button type="button" onClick={fecharPainel}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 active:scale-95 ${tema.botao}`}>
              {t("oQuePreciso.concluir")}
            </button>
          </div>
        </div>
        {noLimite && (
          <p className="text-xs text-white/40">
            {noLimiteTotal ? t("oQuePreciso.limiteTotal", { maximo: LIMITE_DE_DEMANDAS }) : t("oQuePreciso.limiteDaCategoria", { maximo: LIMITE_DE_DEMANDAS_POR_CATEGORIA })}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* `grid-flow-row-dense`: o painel ocupa a linha inteira logo depois do cartão
          clicado, e o cartão vizinho sobe para o lado dele em vez de deixar buraco. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 grid-flow-row-dense">
        {CATEGORIAS_O_QUE_PRECISO.map(categoria => {
          const selecionada = categorias.includes(categoria.chave);
          const aberta = categoriaAberta === categoria.chave;
          const quantas = daCategoria(categoria.chave).filter(demanda => demandaValida(demanda)).length;
          const cartao = (
            <button key={categoria.chave} type="button" onClick={() => clicarCategoria(categoria.chave)}
              aria-pressed={selecionada} aria-expanded={aberta}
              className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border text-left text-sm font-medium transition-all duration-200 active:scale-95 ${selecionada
                ? tema.cartaoAtivo
                : "bg-white/3 border-white/10 text-white/50 hover:border-white/25 hover:text-white/75 hover:bg-white/6"}`}>
              <span className="text-base leading-none mt-0.5">{categoria.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block">{titulo(categoria.chave)}</span>
                <span className="block text-xs font-normal text-white/40 mt-0.5">{t(`oQuePreciso.categorias.${categoria.chave}.descricao`)}</span>
              </span>
              {selecionada && (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {quantas > 0 && <span className={`text-[11px] font-bold tabular-nums ${tema.check}`} aria-label={t("oQuePreciso.demandasDetalhadas", { n: quantas })}>{quantas}</span>}
                  <CheckCircle size={13} className={tema.check} />
                </span>
              )}
            </button>
          );
          return aberta ? [cartao, painel(categoria)] : cartao;
        })}
      </div>

      {legadas.length > 0 && (
        <div>
          <p className="text-xs text-white/40 mb-2">{t("oQuePreciso.categoriasAnteriores")}</p>
          <div className="flex flex-wrap gap-2">
            {legadas.map(chave => (
              <span key={chave} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/8 border border-blue-500/20 text-xs text-blue-300/80">
                {legado(chave)}
                <button type="button" onClick={() => onChange({ categorias: categorias.filter(item => item !== chave), demandas })}
                  aria-label={`${t("oQuePreciso.remover")} ${legado(chave)}`} className="text-blue-300/60 hover:text-red-300">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {categorias.length > 0 && (
        <div className="mt-4 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
          <p className="text-xs text-blue-400/70 font-medium">
            ◈ {categorias.length} {categorias.length === 1 ? t("onboarding.misc.demandSelected") : t("onboarding.misc.demandsSelected")}
            {detalhadas > 0 && <span className="text-blue-300/50"> · {t("oQuePreciso.demandasDetalhadas", { n: detalhadas })}</span>}
          </p>
        </div>
      )}

      {pendentes.length > 0 && (
        <p role="alert" className="text-xs text-red-400/80">
          {t("oQuePreciso.faltaDetalhar", { categorias: pendentes.map(titulo).join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Leitura (Perfil fora da edição): as categorias marcadas, cada uma com as demandas detalhadas; chave antiga com o rótulo dela. */
export function DemandasDoPerfil({ whatINeed, whatINeedDetails }: { whatINeed: unknown; whatINeedDetails: unknown }) {
  const { t, titulo, legado } = useRotulos();
  const qualificadores = useQualificadores();
  const categorias = Array.isArray(whatINeed) ? whatINeed.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  const demandas = lerDemandas(whatINeedDetails).filter(demanda => demandaValida(demanda));
  const novas = CATEGORIAS_O_QUE_PRECISO.filter(categoria => categorias.includes(categoria.chave));
  const legadas = categorias.filter(chave => !ehCategoriaOQuePreciso(chave));

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {novas.map(categoria => {
          const lista = demandas.filter(demanda => demanda.category === categoria.chave);
          return (
            <div key={categoria.chave} className="px-3.5 py-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
              <div className="flex items-center gap-2.5">
                <span className="text-base">{categoria.emoji}</span>
                <span className="text-sm text-blue-300/80 font-medium">{titulo(categoria.chave)}</span>
                <CheckCircle size={13} className="text-blue-400 ml-auto" />
              </div>
              {lista.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {lista.map(demanda => (
                    <li key={demanda.id} className="text-xs text-white/60">
                      <p className="break-words">{demanda.description}</p>
                      {qualificadores(demanda).length > 0 && (
                        <p className="text-white/35 mt-0.5">{qualificadores(demanda).join(" · ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-white/30">{t("oQuePreciso.semDemandaDetalhada")}</p>
              )}
            </div>
          );
        })}
        {legadas.map(chave => (
          <div key={chave} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
            <span className="text-sm text-blue-300/80 font-medium">{legado(chave)}</span>
            <CheckCircle size={13} className="text-blue-400 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
