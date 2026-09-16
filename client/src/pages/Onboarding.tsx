import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { BrainCircuit, CheckCircle } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/BrandLogo";
import { cortarSemPartirEmoji, LIMITE_DA_BIO_NO_CADASTRO } from "@shared/apresentacao";
import { normalizePrimarySpecialties, togglePrimarySpecialty } from "@shared/specialties";
import { exigeCadastroEmpresarial, normalizarCadastroEmpresarial } from "@shared/business-registration";
import { sortOptionsAlphabetically, sortTextAlphabetically } from "@shared/option-sorting";
import { interesseEhDoSetor, setoresTraduzidos } from "@shared/setores";
import {
  CHAVE_OUTRA_NECESSIDADE,
  CHAVE_QUERO_MENTORAR,
  LIMITE_OUTRA_NECESSIDADE,
  OPCOES_O_QUE_BUSCA,
  outraNecessidadeValida,
} from "@shared/o-que-busca";
import { AssistenteDeTexto } from "@/components/AssistenteDeTexto";
import { EtapaTermoGeralDeUso } from "@/components/TermoGeralDeUso";
import { rotuloDaBusca } from "@/lib/interesses";
import { EditorDoQuePreciso } from "@/components/OQuePreciso";
import { categoriasPendentes, demandasParaGravar, type DemandaDetalhada } from "@shared/o-que-preciso";
import { PREFIXO_DO_RASCUNHO_DO_CADASTRO } from "@/_core/hooks/useAuth";

// Tetos do servidor (routers/profile.ts) para os campos livres: o ditado pode
// passar deles, e sem contador o erro só aparecia no último passo.
const LIMITE_BIO = LIMITE_DA_BIO_NO_CADASTRO;
const LIMITE_META = 2000;

/**
 * Última etapa: o Termo Geral de Uso (components/TermoGeralDeUso.tsx). É a
 * ÚNICA etapa de termos do cadastro: substituiu a antiga "Termos e Condições"
 * (contrato de comissão), porque o termo do Dr. Ronei já cobre intermediação e
 * remuneração nas cláusulas 12 a 15 (Rosber, 14/09 21:34).
 *
 * São 8 etapas desde 15/09: a etapa "Quem sou" existia só para a Rede
 * Institucional, e o Rosber a suprimiu no vídeo de 14/09 (21:15).
 */
const ETAPA_TERMO_GERAL = 8;
const TIPO_TERMO_GERAL = "termo_geral_de_uso" as const;


// ─── Tags "O que tenho" ───────────────────────────────────────────────────────
// Os rótulos continuam em pt-BR fixo (como sempre estiveram); só o "Outros"
// novo passa pelo i18n, com texto nos 10 idiomas.
const WHAT_I_HAVE_OPTIONS = [
  { id: "industria", label: "Indústria", icon: "🏭" },
  { id: "fazenda", label: "Fazenda / Agro", icon: "🌾" },
  { id: "laboratorio", label: "Laboratório", icon: "🔬" },
  { id: "tecnologia", label: "Tecnologia", icon: "💻" },
  { id: "investidores", label: "Rede de Investidores", icon: "💰" },
  { id: "acesso_governamental", label: "Acesso Governamental", icon: "🏛️" },
  { id: "commodities", label: "Matérias-primas (commodities)", icon: "📦" },
  { id: "licencas", label: "Licenças & Certificações", icon: "📋" },
  { id: "imoveis", label: "Imóveis", icon: "🏢" },
  { id: "logistica", label: "Logística", icon: "🚚" },
  { id: "canais_comerciais", label: "Canais Comerciais", icon: "🤝" },
];

/**
 * "Outros" em "O que tenho" (Rosber, 14/09 21:17: "a gente precisa inserir nesse
 * 'o que tenho' um botão 'outros', para a pessoa poder digitar"). Mesmo padrão
 * do "Outra necessidade" de "O que você busca": marcar abre um campo de texto
 * obrigatório, e o que a pessoa digitar vira UM ITEM de `whatIHave` — os motores
 * leem os itens como texto, então o ativo escrito à mão chega a eles como os
 * outros. A chave "outros" é só a porta do campo e NUNCA é gravada: ela não é
 * um ativo, e gravá-la faria o motor cruzar a palavra "outros".
 */
const CHAVE_OUTRO_ATIVO = "outros";
const MINIMO_DO_OUTRO_ATIVO = 3;
const LIMITE_DO_OUTRO_ATIVO = 200;

function outroAtivoValido(marcados: readonly string[], texto: string): boolean {
  if (!marcados.includes(CHAVE_OUTRO_ATIVO)) return true;
  const aparado = texto.trim();
  return aparado.length >= MINIMO_DO_OUTRO_ATIVO && aparado.length <= LIMITE_DO_OUTRO_ATIVO;
}

/** Os ativos que vão ao servidor: os marcados, sem a porta "outros", mais o texto livre. */
function ativosParaGravar(marcados: readonly string[], texto: string): string[] {
  const ativos = marcados.filter(id => id !== CHAVE_OUTRO_ATIVO);
  const aparado = texto.trim();
  if (marcados.includes(CHAVE_OUTRO_ATIVO) && aparado) ativos.push(aparado);
  return ativos;
}

// ─── Porte preferido da empresa ───────────────────────────────────────────────
// Rosber, 14/09 21:13: "ele dá a opção de qualquer tamanho, mas não deixa eu
// selecionar dois tamanhos específicos. Eu quero fazer só com média e pequena".
// A coluna `preferredCompanySize` é um varchar(50) que já guardava UM valor
// ("medium", "any"), então a lista é gravada no mesmo campo, separada por
// vírgula e na ordem canônica abaixo ("small,medium" cabe de sobra). Nenhum
// porte marcado é o "qualquer tamanho" de sempre, e continua sendo gravado como
// "any": é o vocabulário que o dado já tem.
const PORTES_DA_EMPRESA = ["micro", "small", "medium", "large"] as const;
const PORTE_QUALQUER = "any";

/** Leitura: aceita o formato antigo (um porte só, ou "any") e o novo (lista). */
function lerPortes(gravado: string | null | undefined): string[] {
  if (!gravado) return [];
  const escolhidos = gravado.split(",").map(p => p.trim()).filter(p => p && p !== PORTE_QUALQUER);
  return PORTES_DA_EMPRESA.filter(porte => escolhidos.includes(porte));
}

/** Escrita: a lista na ordem canônica, ou "any" quando nada foi marcado. */
function portesParaGravar(escolhidos: readonly string[]): string {
  const lista = PORTES_DA_EMPRESA.filter(porte => escolhidos.includes(porte));
  return lista.length > 0 ? lista.join(",") : PORTE_QUALQUER;
}

// ─── "O que preciso" ──────────────────────────────────────────────────────────
// As 17 categorias e a segunda camada de detalhamento (Rosber, 14/09 21:24) vivem
// em shared/o-que-preciso.ts e components/OQuePreciso.tsx, que o Perfil reusa.
// "Consultoria" saiu: genérica demais; "Especialistas / Serviços" no lugar.

interface FormData {
  // Campos SUPRIMIDOS do cadastro, com a mesma regra da idade (Rosber, 14/09
  // 20:31) — a coluna e o dado antigo continuam no banco, o servidor segue
  // aceitando cada um deles, e a tela só deixou de pedir:
  //   - idade (20:31);
  //   - estilo de trabalho, valores principais e idiomas (21:08: "não está
  //     dentro do escopo do projeto");
  //   - aberto a remoto e disponível para viagens (21:10: "está mais voltado
  //     para busca de empregos");
  //   - rede institucional, e com ela a etapa "Quem sou", que só tinha esse
  //     campo (21:15).
  displayName: string; city: string; country: string; bio: string;
  primarySpecialty: string; primarySpecialties: string[]; customSpecialty: string; secondarySpecialties: string[]; experienceYears: number | null;
  educationLevel: string;
  seekingTypes: string[]; seekingOtherNeed: string; shortTermGoal: string; longTermGoal: string;
  sector: string; businessInterests: string[];
  /** Vários portes ao mesmo tempo; vazio é "qualquer tamanho" (ver PORTES_DA_EMPRESA). */
  preferredCompanySizes: string[];
  incomeRange: string; investmentCapacity: string; lookingForInvestment: boolean;
  gender: "" | "male" | "female" | "prefer_not_to_say";
  personType: "" | "individual" | "legal_entity" | "mei" | "nonprofit";
  companySize: "" | "mei" | "micro" | "small" | "medium" | "large";
  companyCnpj: string;
  customSector: string;
  currentResources: string;
  // Novos campos v2
  company: string; jobTitle: string; activityArea: string;
  interestSectors: string[];
  /** As opções marcadas em "O que tenho"; "outros" é a porta do texto abaixo. */
  whatIHave: string[];
  /** O ativo escrito à mão em "Outros" (ver CHAVE_OUTRO_ATIVO). */
  whatIHaveOther: string;
  whatINeed: string[];
  /** As demandas detalhadas de "O que preciso", cada uma separada (whatINeedDetails). */
  whatINeedDetails: DemandaDetalhada[];
  // Termo Geral de Uso (única etapa de termos do cadastro): o id da VERSÃO que
  // estava na tela quando a caixa foi marcada, não um booleano. Se o
  // consent.status trocar a versão exibida (refetch ao voltar à etapa, ao
  // reconectar), a caixa aparece desmarcada e o envio trava: o aceite nunca vai
  // para uma versão que a pessoa não marcou.
  termoGeralAceitoId: string | null;
}

const INITIAL: FormData = {
  displayName: "", city: "", country: "BR", bio: "",
  primarySpecialty: "", primarySpecialties: [], customSpecialty: "", secondarySpecialties: [], experienceYears: null,
  educationLevel: "",
  seekingTypes: [], seekingOtherNeed: "", shortTermGoal: "", longTermGoal: "",
  sector: "", businessInterests: [], preferredCompanySizes: [],
  // Capacidade de investimento começa VAZIA ("Selecione..."): abrir em "none"
  // gravava "Sem capital disponível" em quem só passou pelo campo (reteste v4,
  // item 5). Segue opcional para avançar, e só vai no envio quando escolhida.
  incomeRange: "", investmentCapacity: "", lookingForInvestment: false,
  gender: "",
  personType: "", companySize: "", companyCnpj: "",
  customSector: "",
  currentResources: "",
  // Novos campos v2
  company: "", jobTitle: "", activityArea: "",
  interestSectors: [],
  whatIHave: [], whatIHaveOther: "", whatINeed: [], whatINeedDetails: [],
  termoGeralAceitoId: null,
};

// ─── Rascunho do cadastro ─────────────────────────────────────────────────────
// Sem versão publicada do Termo Geral o botão final trava (ver ETAPA_TERMO_GERAL)
// e fechar a aba perdia as 8 etapas preenchidas (lista do Nicolas na PR #135,
// janela C). O formulário fica em localStorage, numa chave por usuária, a cada
// mudança; volta ao abrir de novo e é apagado ao concluir com sucesso. Sem
// usuária conhecida nada é gravado: uma chave sem dona mostraria o cadastro de
// uma conta para outra no mesmo navegador. A caixa do Termo Geral fica de fora:
// o aceite é ato da sessão que conclui (e a versão exibida pode ter mudado).
//
// Privacidade (mesma razão da nota V-03 em _core/hooks/useAuth.ts, que tirou
// dado de usuária do localStorage): faixa de renda, capacidade de investimento
// e Número de Cadastro Empresarial NÃO entram no rascunho, a pessoa redigita;
// o rascunho leva `salvoEm` e vale 7 dias (sem data, ou vencido, é ignorado);
// sair da conta apaga todos os rascunhos (apagarRascunhosDoCadastro, no logout).
const CAMPOS_FORA_DO_RASCUNHO: ReadonlySet<keyof FormData> = new Set<keyof FormData>([
  "termoGeralAceitoId", "incomeRange", "investmentCapacity", "companyCnpj",
]);
const VALIDADE_DO_RASCUNHO_MS = 7 * 24 * 60 * 60 * 1000;

function chaveDoRascunhoDa(idDaUsuaria: number | string): string {
  return PREFIXO_DO_RASCUNHO_DO_CADASTRO + String(idDaUsuaria);
}

/** Lê o rascunho gravado; só entram os campos com a forma que o formulário
 *  espera, para um rascunho de versão antiga (ou adulterado) não quebrar a tela. */
function lerRascunho(chave: string): Partial<FormData> | null {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return null;
    const dados: unknown = JSON.parse(bruto);
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
    const { salvoEm } = dados as { salvoEm?: unknown };
    if (typeof salvoEm !== "number" || Date.now() - salvoEm > VALIDADE_DO_RASCUNHO_MS) return null;
    const rascunho: Partial<FormData> = {};
    for (const campo of Object.keys(INITIAL) as (keyof FormData)[]) {
      if (CAMPOS_FORA_DO_RASCUNHO.has(campo)) continue;
      const valor = (dados as Record<string, unknown>)[campo];
      const padrao = INITIAL[campo];
      const compativel = Array.isArray(padrao) ? Array.isArray(valor)
        : padrao === null ? valor === null || typeof valor === "number"
        : typeof valor === typeof padrao;
      if (compativel) (rascunho as Record<string, unknown>)[campo] = valor;
    }
    return rascunho;
  } catch {
    return null;
  }
}

function gravarRascunho(chave: string, form: FormData) {
  try {
    const rascunho: Record<string, unknown> = { salvoEm: Date.now() };
    for (const [campo, valor] of Object.entries(form)) {
      if (!CAMPOS_FORA_DO_RASCUNHO.has(campo as keyof FormData)) rascunho[campo] = valor;
    }
    window.localStorage.setItem(chave, JSON.stringify(rascunho));
  } catch {
    // Sem armazenamento (modo privado, cota cheia): o cadastro segue sem rascunho.
  }
}

function apagarRascunho(chave: string) {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    // Idem: nada a fazer sem armazenamento.
  }
}

// ─── Componentes reutilizáveis ────────────────────────────────────────────────
// CAIXA ALTA, onde vale (revisão de 15/09): o Rosber mandou em caixa alta os
// títulos das categorias das DUAS listas de seleção — "O que tenho" (TagButton
// abaixo) e "O que preciso" (components/OQuePreciso.tsx) —, e é só ali que ela
// fica, nas mesmas duas listas no cadastro e no Perfil. Na rodada anterior a
// caixa alta havia escorrido para os demais cartões (especialidade, tipo de
// pessoa, o que busca, renda, porte) e para o Perfil, e ficava inconsistente
// dentro da própria tela; estes voltaram à caixa normal.
//
// Onde ela existe, é por CSS (`uppercase`) e nunca reescrevendo o texto dos 10
// JSONs: árabe, chinês e japonês não têm caixa, `text-transform` simplesmente
// não os toca, e um rótulo gravado em maiúsculas estragaria os idiomas latinos
// sem fazer nada por esses três.
function CardOption({ selected, onClick, icon, label, desc }: {
  selected: boolean; onClick: () => void; icon: string; label: string; desc?: string;
}) {
  // `h-full` no cartão e `break-words` no rótulo: rótulo comprido
  // ("Microempreendedor Individual (MEI)") quebra DENTRO do cartão em vez de
  // transbordar para o vizinho, e a fileira fica com a mesma altura mesmo com
  // um cartão de duas linhas (reteste v4, item 10).
  return (
    <button type="button" onClick={onClick}
      className={`group relative h-full p-4 rounded-xl border text-left transition-all duration-200 active:scale-95 ${selected
        ? "bg-[#c98f70]/15 border-[#c98f70] shadow-lg shadow-[#c98f70]/10"
        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/30"}`}>
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-[#c98f70] rounded-full flex items-center justify-center">
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#151312" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
      <div className="text-2xl mb-2">{icon}</div>
      <div className={`font-semibold text-sm break-words ${selected ? "text-[#c98f70]" : "text-white"}`}>{label}</div>
      {desc && <div className="text-xs text-white/40 mt-0.5">{desc}</div>}
    </button>
  );
}

function TagOption({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 active:scale-95 ${selected
        ? "bg-[#c98f70] border-[#c98f70] text-[#151312] font-bold"
        : "bg-white/5 border-white/20 text-white/70 hover:border-white/40 hover:text-white"}`}>
      {label}
    </button>
  );
}

function TagButton({ icon, label, selected, onClick }: {
  icon: string; label: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 active:scale-95 ${
        selected
          ? "bg-[#c98f70]/15 border-[#c98f70]/60 text-[#c98f70] shadow-sm shadow-[#c98f70]/10"
          : "bg-white/3 border-white/10 text-white/50 hover:border-white/25 hover:text-white/75 hover:bg-white/6"
      }`}>
      <span className="text-base leading-none">{icon}</span>
      <span className="uppercase">{label}</span>
      {selected && <CheckCircle size={13} className="text-[#c98f70] ml-auto" />}
    </button>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text", hint, min, max, list, required }: {
  // `compondo`: o IME (japonês, chinês) ainda está montando o texto; quem
  // transforma o valor deve esperar o fim da composição, que chama de novo.
  label: string; value: string | number; onChange: (v: string, compondo?: boolean) => void;
  placeholder?: string; type?: string; hint?: string; min?: number; max?: number; list?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}{required && <span className="text-[#c98f70]"> *</span>}</label>
      <input type={type} value={value ?? ""} min={min} max={max} list={list}
        inputMode={type === "number" ? "numeric" : undefined}
        onChange={e => onChange(e.target.value, (e.nativeEvent as InputEvent).isComposing === true)}
        onCompositionEnd={e => onChange(e.currentTarget.value, false)} placeholder={placeholder}
        className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-[#c98f70]/60 focus:bg-white/8 transition-all duration-200 text-sm"/>
      {hint && <p className="text-xs text-white/30 mt-1">{hint}</p>}
    </div>
  );
}

function TextareaInput({ label, value, onChange, placeholder, hint, required, limite, assistente }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
  required?: boolean;
  /** Teto do servidor: mostra o contador e avisa quando o texto (digitado ou ditado) passa dele. */
  limite?: number;
  /** "Gravar áudio" e "Revisar texto" embaixo do campo. */
  assistente?: boolean;
}) {
  const { t } = useTranslation();
  const passou = limite !== undefined && value.length > limite;
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}{required && <span className="text-[#c98f70]"> *</span>}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
        aria-invalid={passou || undefined}
        className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:bg-white/8 transition-all duration-200 text-sm resize-none ${passou ? "border-red-400/60 focus:border-red-400/80" : "border-white/15 focus:border-[#c98f70]/60"}`}/>
      {assistente && <AssistenteDeTexto valor={value} onChange={onChange}/>}
      {(hint || limite !== undefined) && (
        <div className="flex items-start justify-between gap-3 mt-1">
          {hint ? <p className="text-xs text-white/30">{hint}</p> : <span/>}
          {limite !== undefined && (
            <span className={`text-[11px] tabular-nums shrink-0 ${passou ? "text-red-400" : "text-white/25"}`}>
              {t("assistenteTexto.contador", { atual: value.length, maximo: limite })}
            </span>
          )}
        </div>
      )}
      {passou && <p className="text-xs text-red-400/80 mt-1">{t("assistenteTexto.textoLongo", { maximo: limite })}</p>}
    </div>
  );
}

function SelectInput({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-2">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#211e1b] border border-white/15 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#c98f70]/60 transition-all duration-200 text-sm">
        <option className="bg-white text-[#322C26]" value="">{placeholder || "..."}</option>
        {options.map(o => <option className="bg-white text-[#322C26]" key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [visible, setVisible] = useState(true);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const municipiosRef = useRef<string[] | null>(null);
  const prefilled = useRef(false);
  // Chave do rascunho em localStorage: existe só depois de saber quem é a
  // usuária e de restaurar o que ela já tinha (ver "Rascunho do cadastro").
  const [chaveDoRascunho, setChaveDoRascunho] = useState<string | null>(null);

  // Pre-preenche com o que ja existe: o nome dado no cadastro (users.name) e,
  // num re-onboarding, o perfil salvo. Antes o formulario abria vazio e pedia
  // o nome de novo. O rascunho da usuária entra ANTES: campo que ela já
  // preencheu vence o perfil salvo.
  // A bio da carga vai até 2000 caracteres (scripts/importacao/planilha.mjs) e o
  // formulário só mostra LIMITE_BIO. Sem esta marca, concluir o cadastro sem tocar
  // no campo mandava o texto CORTADO por cima do salvo e destruía o resto, em
  // silêncio e sem volta (validação de 16/09 na #135, item 10).
  const bioPrePreenchida = useRef<string | null>(null);
  const bioSalvaEraMaior = useRef(false);
  const profileQuery = trpc.profile.get.useQuery(undefined, { staleTime: 60_000 });
  useEffect(() => {
    if (prefilled.current || !profileQuery.data) return;
    const { user, profile } = profileQuery.data as { user?: { id?: number; name?: string | null } | null; profile?: Partial<FormData> & { displayName?: string | null; city?: string | null; country?: string | null; bio?: string | null; preferredCompanySize?: string | null } | null };
    prefilled.current = true;
    const chave = user?.id != null ? chaveDoRascunhoDa(user.id) : null;
    const rascunho = chave ? lerRascunho(chave) : null;
    // Chave e formulário mudam juntos (mesmo lote): o efeito que grava só roda
    // com o formulário já restaurado, nunca com o vazio do primeiro render.
    setChaveDoRascunho(chave);
    // A bio da carga vai até 2000 caracteres e o formulário mostra LIMITE_BIO. O que
    // aparece e se o salvo era MAIOR ficam decididos aqui, fora do atualizador: lá
    // dentro a segunda passagem recebe o estado já preenchido e o sinalizador zerava.
    const bioSalva = profile?.bio ?? "";
    const bioDoRascunho = (rascunho as { bio?: string } | null)?.bio ?? "";
    const corteDoSalvo = cortarSemPartirEmoji(bioSalva, LIMITE_BIO);
    const bioMostrada = bioDoRascunho || corteDoSalvo;
    bioPrePreenchida.current = bioMostrada;
    // O rascunho guarda a bio, e o que ele guardou na primeira visita foi o
    // CORTE que esta mesma tela pré-preencheu. Tratar esse corte como texto
    // da pessoa fazia a trava valer uma visita só: da segunda em diante o
    // corte voltava a ser enviado e o resto da apresentação era apagado.
    bioSalvaEraMaior.current = (!bioDoRascunho || bioDoRascunho === corteDoSalvo) && bioSalva.length > corteDoSalvo.length;
    setForm(prev => {
      const base = rascunho ? { ...prev, ...rascunho } : prev;
      return {
        ...base,
        displayName: base.displayName || profile?.displayName || user?.name || "",
        city: base.city || profile?.city || "",
        country: rascunho?.country || profile?.country || base.country,
        // A bio já salva (contas da carga de scripts/importar-participantes.mjs)
        // não vinha para o formulário e saía vazia ao concluir, apagando-a no
        // servidor (lista do Nicolas na PR #135, item 10). A carga insere sem
        // limite e o zod de completeOnboarding aceita até LIMITE_BIO: maior que
        // isso, o "Continuar" da etapa 1 travava e a conta não concluía.
        bio: bioMostrada,
        // O porte já gravado volta marcado, venha no formato antigo (um porte só)
        // ou no novo (lista separada por vírgula) — ver lerPortes.
        preferredCompanySizes: base.preferredCompanySizes.length > 0
          ? base.preferredCompanySizes
          : lerPortes(profile?.preferredCompanySize),
      };
    });
  }, [profileQuery.data]);

  // Grava o rascunho a cada mudança (objeto pequeno; síncrono).
  useEffect(() => {
    if (chaveDoRascunho) gravarRascunho(chaveDoRascunho, form);
  }, [form, chaveDoRascunho]);

  // Sugestoes de cidade (IBGE) so quando o pais e o Brasil: filtra em memoria
  // a partir de 2 letras, ignorando acento, e mostra no maximo 50 opcoes para
  // o datalist nao travar em mobile.
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  useEffect(() => {
    if (form.country !== "BR" || form.city.trim().length < 2) { setCityOptions([]); return; }
    let alive = true;
    const filtrar = (lista: string[]) => {
      const q = norm(form.city.trim());
      if (alive) setCityOptions(lista.filter(m => norm(m).startsWith(q)).slice(0, 50));
    };
    if (municipiosRef.current) filtrar(municipiosRef.current);
    else import("@/data/municipios-br.json").then(mod => {
      municipiosRef.current = mod.default as string[];
      filtrar(municipiosRef.current);
    }).catch(() => {});
    return () => { alive = false; };
  }, [form.city, form.country]);

  // O banco guarda a CHAVE (estavel entre idiomas); o rotulo e so exibicao.
  // Antes era gravado o texto traduzido, e usuarias de idiomas diferentes
  // nunca davam match entre si.
  const SPECIALTIES = [
    { key: "tech", icon: "💻" }, { key: "finance", icon: "📈" },
    { key: "design", icon: "🎨" }, { key: "marketing", icon: "📣" },
    { key: "legal", icon: "⚖️" }, { key: "engineering", icon: "🏗️" },
    { key: "health", icon: "🏥" }, { key: "education", icon: "🎓" },
    { key: "sustainability", icon: "🌱" }, { key: "retail", icon: "🏪" },
    { key: "gastronomy", icon: "🍽️" }, { key: "startups", icon: "🚀" },
  ].map(o => ({ ...o, label: t("onboarding.specialties." + o.key) }));

  // "O que você busca?": as 12 opções do Lucas (grupo, 14/09 20:58), na ordem
  // dele e com "Outra necessidade" por último — não em ordem alfabética. As
  // chaves, os emojis e o legado (investor, team, job...) vivem em
  // shared/o-que-busca.ts. "Quero também mentorar" é oferta, não busca, e
  // continua como o botão próprio logo abaixo.
  const SEEKING_TYPES = OPCOES_O_QUE_BUSCA.map(o => ({
    key: o.chave, icon: o.emoji,
    label: t(`oQueBusca.opcoes.${o.chave}.titulo`),
    desc: t(`oQueBusca.opcoes.${o.chave}.descricao`),
  }));

  // Setores: fonte ÚNICA em shared/setores.ts, a mesma do Perfil ("Setores de
  // interesse") e de "Nova Oportunidade" — antes eram três listas diferentes e
  // quem se cadastrava em "Tecnologia & Software" não achava o próprio setor na
  // lista de interesses (reteste v4, item 7). O cadastro continua gravando o
  // RÓTULO traduzido, não a chave: é o que server/matching.ts normaliza em
  // `chaveDoSetor`, e os rótulos dos setores que já existiam aqui não mudaram.
  const SECTORS = setoresTraduzidos(t).map(s => ({ key: s.chave, label: s.rotulo }));
  // "Outro" não é setor: é a saída para texto livre, e por isso fica fora da
  // fonte única e sempre no fim da lista.
  const OTHER_SECTOR_LABEL = t("onboarding.sectors.other");

  // "Qualquer tamanho" continua na tela, agora como o cartão que LIMPA a
  // seleção: marcado quando nenhum porte específico está, e clicá-lo desmarca
  // todos. É o mesmo significado de sempre, sem virar um porte da lista.
  const COMPANY_SIZES = [
    { value: "micro", label: t("onboarding.companySize.micro"), icon: "🌱" },
    { value: "small", label: t("onboarding.companySize.small"), icon: "🏠" },
    { value: "medium", label: t("onboarding.companySize.medium"), icon: "🏢" },
    { value: "large", label: t("onboarding.companySize.large"), icon: "🏙️" },
  ];

  const INCOME_RANGES = [
    { value: "under_3k", label: t("onboarding.income.under_3k"), icon: "🌱" },
    { value: "3k_7k", label: t("onboarding.income.3k_7k"), icon: "📈" },
    { value: "7k_15k", label: t("onboarding.income.7k_15k"), icon: "💼" },
    { value: "15k_30k", label: t("onboarding.income.15k_30k"), icon: "🏆" },
    { value: "30k_plus", label: t("onboarding.income.30k_plus"), icon: "👑" },
  ];

  const INVESTMENT_CAPACITIES = [
    { value: "none", label: t("onboarding.investment.none") },
    { value: "under_10k", label: t("onboarding.investment.under_10k") },
    { value: "10k_50k", label: t("onboarding.investment.10k_50k") },
    { value: "50k_200k", label: t("onboarding.investment.50k_200k") },
    { value: "200k_plus", label: t("onboarding.investment.200k_plus") },
  ];

  // Estilo de trabalho, valores principais e idiomas saíram do cadastro (Rosber,
  // 14/09 21:08). Os rótulos seguem nos 10 JSONs porque o Dashboard traduz por
  // eles o que já está gravado (onboarding.workStyle/values/languages).

  const EDUCATION_LEVELS = [
    { value: "high_school", label: t("onboarding.education.high_school") },
    { value: "technical", label: t("onboarding.education.technical") },
    { value: "bachelor", label: t("onboarding.education.bachelor") },
    { value: "postgrad", label: t("onboarding.education.postgrad") },
    { value: "master", label: t("onboarding.education.master") },
    { value: "phd", label: t("onboarding.education.phd") },
    { value: "mba", label: t("onboarding.education.mba") },
  ];

  const COUNTRIES = [
    { value: "BR", label: t("onboarding.countries.brazil") },
    { value: "PT", label: t("onboarding.countries.portugal") },
    { value: "US", label: t("onboarding.countries.usa") },
    { value: "AR", label: t("onboarding.countries.argentina") },
    { value: "CL", label: t("onboarding.countries.chile") },
    { value: "MX", label: t("onboarding.countries.mexico") },
    { value: "CO", label: t("onboarding.countries.colombia") },
    { value: "DE", label: t("onboarding.countries.germany") },
    { value: "FR", label: t("onboarding.countries.france") },
    { value: "GB", label: t("onboarding.countries.uk") },
    { value: "ES", label: t("onboarding.countries.spain") },
    { value: "IT", label: t("onboarding.countries.italy") },
    { value: "JP", label: t("onboarding.countries.japan") },
    { value: "CN", label: t("onboarding.countries.china") },
    { value: "IN", label: t("onboarding.countries.india") },
    { value: "AE", label: t("onboarding.countries.uae") },
    { value: "XX", label: t("onboarding.countries.other") },
  ];

  // "Seus valores" saiu da lista junto com o campo (21:08): a etapa de revisão
  // não pode prometer uma análise do que o cadastro não pergunta mais.
  const AI_ANALYSIS_ITEMS = [
    t("onboarding.aiAnalysis.specialty"), t("onboarding.aiAnalysis.goals"),
    t("onboarding.aiAnalysis.income"), t("onboarding.aiAnalysis.location"),
    t("onboarding.aiAnalysis.sectors"),
  ];

  // 8 etapas: "Vida & Valores" foi integrada a "O que você busca", "Quem sou"
  // saiu com a Rede Institucional (21:15), e o Termo Geral de Uso (última)
  // substituiu a antiga "Termos e Condições".
  const STEPS = [
    { id: 1, title: t("onboarding.steps.s1_title"), subtitle: t("onboarding.steps.s1_sub"), icon: "👤" },
    { id: 2, title: t("onboarding.steps.s2_title"), subtitle: t("onboarding.steps.s2_sub"), icon: "⚡" },
    { id: 3, title: t("onboarding.steps.s3_title"), subtitle: t("onboarding.steps.s3_sub"), icon: "🎯" },
    { id: 4, title: t("onboarding.steps.s4_title"), subtitle: t("onboarding.steps.s4_sub"), icon: "🌐" },
    { id: 5, title: t("onboarding.steps.s8_title"), subtitle: t("onboarding.steps.s8_sub"), icon: "✦" },
    { id: 6, title: t("onboarding.steps.s9_title"), subtitle: t("onboarding.steps.s9_sub"), icon: "◈" },
    { id: 7, title: t("onboarding.steps.s6_title"), subtitle: t("onboarding.steps.s6_sub"), icon: "🚀" },
    // Termo Geral de Uso do Dr. Ronei: "última etapa do processo de
    // cadastramento", e a única de termos. A etapa "Termos e Condições" (contrato
    // de comissão) saiu do cadastro; o tipo `contrato_comissao` e os aceites já
    // gravados continuam no servidor.
    { id: ETAPA_TERMO_GERAL, title: t("termoGeral.etapaTitulo"), subtitle: t("termoGeral.etapaSubtitulo"), icon: "📜" },
  ];

  // Termo Geral de Uso: o texto é o da versão PUBLICADA, lido quando a pessoa
  // chega à última etapa. Sem versão publicada, `document` vem null (e
  // `accepted: true`, a regra dos outros termos) — aqui isso NÃO libera: a
  // etapa mostra que o termo não está disponível e o botão final fica travado.
  const termoGeralQuery = trpc.consent.status.useQuery(
    { type: TIPO_TERMO_GERAL },
    { enabled: step === ETAPA_TERMO_GERAL, refetchOnWindowFocus: false },
  );
  const documentoTermoGeral = termoGeralQuery.data?.document ?? null;
  const aceitouTermoGeral = documentoTermoGeral !== null && form.termoGeralAceitoId === documentoTermoGeral.id;
  const aceitarTermoGeral = trpc.consent.accept.useMutation();

  const utils = trpc.useUtils();
  const concluir = () => {
    // Cadastro gravado: o rascunho não tem mais razão de existir.
    if (chaveDoRascunho) apagarRascunho(chaveDoRascunho);
    // O servidor acabou de gravar onboardingCompleted = true, mas o auth.me em
    // cache ainda diz false: sem isto o ProtectedRoute do /dashboard mandaria a
    // pessoa de volta a /onboarding (cadastro incompleto vai para lá).
    utils.auth.me.setData(undefined, atual => (atual ? { ...atual, onboardingCompleted: true } : atual));
    void utils.auth.me.invalidate();
    toast.success(t("onboarding.successMsg"));
    navigate("/dashboard");
  };

  // O aceite que deixa rastro no servidor (IP, user-agent, hash do texto) é o do
  // Termo Geral, registrado em handleSubmit ANTES de salvar o perfil. O cadastro
  // não registra mais o contrato_comissao: a etapa dele saiu (Rosber, 14/09 21:34).
  const saveOnboarding = trpc.profile.completeOnboarding.useMutation({
    onSuccess: concluir,
    onError: (err: { message: string }) => {
      toast.error(t("onboarding.errorMsg") + " " + (err.message || ""));
    },
  });

  const set = (key: keyof FormData, value: unknown) => setForm(prev => ({ ...prev, [key]: value }));

  // O que "O que tenho" vale de fato: as opções marcadas (sem a porta "outros")
  // mais o ativo escrito à mão. É o que a contagem mostra e o que vai gravado.
  const ativosDoQueTenho = ativosParaGravar(form.whatIHave, form.whatIHaveOther);

  const toggleArray = (key: keyof FormData, value: string) => {
    const arr = (form[key] as string[]) || [];
    set(key, arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]);
  };

  const goTo = (next: number) => {
    const dir = next > step ? "forward" : "back";
    setAnimDir(dir);
    setVisible(false);
    setTimeout(() => {
      setStep(next);
      setVisible(true);
      // O passo novo precisa começar do topo. Sem isto a página mantinha a
      // rolagem do passo anterior e a pessoa caía no meio (ou no fim) do
      // formulário novo, tendo que subir na mão para ler o título e o primeiro
      // campo — relatado pelo Rosber em 09/09: "quando você muda de um fichário
      // pro outro (...) a página não abre no topo".
      // `scrollTo` no window cobre o caso normal; `scrollingElement` cobre o
      // navegador que rola o documento em vez da janela. Em jsdom o método não
      // existe, então a guarda também serve ao teste.
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
      const raiz = document.scrollingElement ?? document.documentElement;
      if (raiz) raiz.scrollTop = 0;
    }, 220);
  };

  const canProceed = () => {
    if (step === 1) return form.displayName.trim().length >= 2 && form.city.trim().length >= 2 && form.bio.length <= LIMITE_BIO;
    if (step === 2) {
      const temEspecialidade = form.primarySpecialties.length > 0 || form.customSpecialty.trim().length > 0;
      // Quem se declara MEI, pessoa juridica ou sem fins lucrativos tem cadastro empresarial por definicao (A7).
      const cadastroOk = !exigeCadastroEmpresarial(form.personType) || normalizarCadastroEmpresarial(form.companyCnpj).length > 0;
      return temEspecialidade && cadastroOk;
    }
    if (step === 3) {
      const textosCabem = form.shortTermGoal.length <= LIMITE_META && form.longTermGoal.length <= LIMITE_META
        && form.currentResources.length <= LIMITE_META;
      // Estilo de trabalho era exigido aqui e saiu do cadastro (21:08).
      return form.seekingTypes.length > 0 && form.incomeRange.length > 0
        && outraNecessidadeValida(form.seekingTypes, form.seekingOtherNeed) && textosCabem;
    }
    if (step === 4) return form.sector.length > 0;
    // "O que tenho": marcar nada continua valendo, mas "Outros" marcado exige o texto.
    if (step === 5) return outroAtivoValido(form.whatIHave, form.whatIHaveOther);
    // "O que preciso": marcar nada continua valendo, mas categoria marcada precisa
    // de ao menos uma demanda detalhada e válida — a seleção sozinha não gera conexão.
    if (step === 6) return categoriasPendentes(form.whatINeed, form.whatINeedDetails).length === 0;
    if (step === ETAPA_TERMO_GERAL) return aceitouTermoGeral;
    // Etapas profissionais e de ativos são opcionais — sempre pode avançar
    return true;
  };

  // Ordem: primeiro o aceite do Termo Geral (com a versão que a tela mostrou),
  // depois o perfil. Ao contrário, o perfil ficaria salvo e o cadastro marcado
  // como concluído sem o termo — e o servidor também recusa concluir sem ele.
  const handleSubmit = () => {
    if (!canProceed() || !documentoTermoGeral) return;
    aceitarTermoGeral.mutate(
      { type: TIPO_TERMO_GERAL, documentVersionId: documentoTermoGeral.id },
      {
        onSuccess: salvarPerfil,
        onError: (erro: { data?: { code?: string } | null }) => {
          if (erro.data?.code === "CONFLICT") {
            // Publicaram versão nova enquanto ela lia: o aceite não cobre o
            // texto novo. Recarrega, desmarca e pede para ler de novo.
            set("termoGeralAceitoId", null);
            void termoGeralQuery.refetch();
            toast.error(t("termoGeral.versaoMudou"));
            return;
          }
          toast.error(t("termoGeral.erroAceite"));
        },
      },
    );
  };

  const salvarPerfil = () => {
    const selectedSpecialties = normalizePrimarySpecialties(form.primarySpecialties, form.customSpecialty);
    saveOnboarding.mutate({
      displayName: form.displayName, city: form.city, country: form.country,
      // Em branco, o campo não vai: `bio: ""` apagava a bio importada, e o
      // servidor (upsertUserProfile → UPDATE do Drizzle) não toca na coluna
      // quando o valor está ausente.
      // Campo intocado cujo conteúdo é o texto CORTADO do que já está salvo: não vai.
      // Ausente, o servidor não mexe na coluna e a bio longa da carga sobrevive.
      bio: bioSalvaEraMaior.current && form.bio === bioPrePreenchida.current ? undefined : (form.bio.trim() || undefined),
      primarySpecialty: selectedSpecialties[0], secondarySpecialties: selectedSpecialties.slice(1),
      experienceYears: form.experienceYears ?? undefined,
      educationLevel: form.educationLevel as "high_school" | "bachelor" | "master" | "phd" | "other" | undefined,
      // seekingTypes nunca era enviado: o campo alimenta a dimensao "objetivos",
      // que vale 30% do score de match, e ficava vazio para todo mundo.
      seekingTypes: form.seekingTypes,
      // Necessidade declarada de "Outra necessidade"; sem a opção, o servidor grava null.
      seekingOtherNeed: form.seekingTypes.includes(CHAVE_OUTRA_NECESSIDADE) ? form.seekingOtherNeed.trim() : undefined,
      shortTermGoal: form.shortTermGoal.trim() || undefined,
      longTermGoal: form.longTermGoal.trim() || undefined,
      sector: form.sector === OTHER_SECTOR_LABEL && form.customSector.trim() ? form.customSector.trim() : form.sector,
      businessInterests: form.businessInterests,
      // Vários portes num campo só, ou "any" sem nenhum (ver portesParaGravar).
      preferredCompanySize: portesParaGravar(form.preferredCompanySizes),
      incomeRange: form.incomeRange as "under_3k" | "3k_7k" | "7k_15k" | "15k_30k" | "30k_plus",
      // Sem escolha o campo não vai: o zod do servidor é optional() e recusaria "".
      investmentCapacity: (form.investmentCapacity || undefined) as "none" | "under_10k" | "10k_50k" | "50k_200k" | "200k_plus" | undefined,
      lookingForInvestment: form.lookingForInvestment,
      gender: form.gender || undefined,
      personType: form.personType || undefined,
      companySize: form.personType === "mei" ? "mei" : form.companySize || undefined,
      companyCnpj: form.personType !== "individual" ? normalizarCadastroEmpresarial(form.companyCnpj) || undefined : undefined,
      currentResources: form.currentResources || undefined,
      // workStyle, values, languages, openToRemote, availableForTravel e
      // institutionalNetwork saíram do cadastro (21:08, 21:10 e 21:15): o campo
      // não vai no envio, e o que já está gravado no banco fica onde está — o
      // servidor não escreve coluna que não recebeu.
      // Novos campos v2
      company: form.company || undefined,
      jobTitle: form.jobTitle || undefined,
      activityArea: form.activityArea || undefined,
      interestSectors: form.interestSectors.length > 0 ? form.interestSectors : undefined,
      whatIHave: ativosDoQueTenho.length > 0 ? ativosDoQueTenho : undefined,
      whatINeed: form.whatINeed.length > 0 ? form.whatINeed : undefined,
      // Cada demanda separada, sem as em branco; o servidor valida de novo.
      whatINeedDetails: form.whatINeed.length > 0 ? demandasParaGravar(form.whatINeed, form.whatINeedDetails) : undefined,
    });
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-transparent flex">
      {/* LEFT PANEL */}
      <div className="hidden lg:flex flex-col w-80 xl:w-96 bg-[#211e1b] border-r border-white/5 p-8 relative overflow-hidden">
        {/* Os assets do CloudFront do Manus expiraram (403); o painel usa um
            gradiente local no lugar da imagem de fundo. */}
        <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(ellipse at 20% 15%, rgba(201,143,112,0.18), transparent 55%), radial-gradient(ellipse at 85% 80%, rgba(59,130,246,0.14), transparent 50%)" }}/>
        <div className="relative z-10 mb-12">
          <BrandLogo variante="lockup" className="w-40" />
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto">
          {STEPS.map((s) => {
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <div key={s.id} className="flex items-start gap-4 mb-5">
                <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${isDone ? "bg-[#c98f70] text-[#151312]" : isActive ? "bg-[#c98f70]/20 border-2 border-[#c98f70] text-[#c98f70]" : "bg-white/5 border border-white/15 text-white/30"}`}>
                  {isDone ? "✓" : s.icon}
                </div>
                <div className={`transition-all duration-300 ${isActive ? "opacity-100" : isDone ? "opacity-70" : "opacity-30"}`}>
                  <div className={`font-semibold text-sm ${isActive ? "text-white" : "text-white/60"}`}>{s.title}</div>
                  <div className="text-xs text-white/40">{s.subtitle}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="relative z-10 mt-8 flex justify-center">
          <BrainCircuit aria-hidden className="w-24 h-24 text-[#c98f70] opacity-60"
            style={{ filter: "drop-shadow(0 0 20px rgba(201,143,112,0.3))", animation: "pulse-glow 3s ease-in-out infinite" }}/>
        </div>
        <p className="relative z-10 text-center text-xs text-white/30 mt-4">
          {t("onboarding.subtitle")}
        </p>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex flex-col">
        <div className="h-1 bg-white/5">
          <div className="h-full bg-gradient-to-r from-[#c98f70] to-[#efcba8] transition-all duration-500 ease-out" style={{ width: `${progress}%` }}/>
        </div>
        <div className="lg:hidden flex items-center justify-between px-6 py-4 border-b border-white/5">
          <BrandMark />
          <span className="text-sm text-white/40">{step} / {STEPS.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-10"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateX(0)" : animDir === "forward" ? "translateX(30px)" : "translateX(-30px)",
              transition: "opacity 0.22s ease, transform 0.22s cubic-bezier(0.23,1,0.32,1)",
            }}>

            <div className="mb-8">
              <div className="text-4xl mb-3">{STEPS[step - 1].icon}</div>
              <h1 className="text-3xl font-black text-white">{STEPS[step - 1].title}</h1>
              <p className="text-white/50 mt-1">{STEPS[step - 1].subtitle}</p>
            </div>

            {/* STEP 1 — Dados pessoais */}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                {(() => {
                  // "Sua idade" saiu (Rosber, 14/09 20:31). O servidor ainda aceita
                  // `age` opcional, e o dado de quem já informou continua no banco.
                  return <>
                    <div>
                      <TextareaInput label={t("onboarding.fields.bio")} value={form.bio} onChange={v => set("bio", v)}
                        placeholder={t("onboarding.fields.bioPlaceholder")} hint={t("onboarding.fields.bioHint")}
                        limite={LIMITE_BIO} assistente/>
                    </div>
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <TextInput label={t("onboarding.fields.city")} value={form.city} list={form.country === "BR" ? "cidades-br" : undefined}
                            onChange={v => set("city", v.replace(/\s\([A-Z]{2}\)$/, ""))}
                            placeholder={t("onboarding.fields.cityPlaceholder")}/>
                          {form.country === "BR" && (
                            <datalist id="cidades-br">
                              {cityOptions.map(m => <option key={m} value={m}/>)}
                            </datalist>
                          )}
                        </div>
                        <SelectInput label={t("onboarding.fields.country")} value={form.country} onChange={v => set("country", v)}
                          options={sortOptionsAlphabetically(COUNTRIES, i18n.language)} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                      </div>
                    </div>
                    <div>
                      <SelectInput label={t("profile.gender.label")} value={form.gender} onChange={v => set("gender", v as FormData["gender"])}
                        options={sortOptionsAlphabetically([
                          { value: "male", label: t("profile.gender.male") },
                          { value: "female", label: t("profile.gender.female") },
                          { value: "prefer_not_to_say", label: t("profile.gender.preferNotToSay") },
                        ], i18n.language)} placeholder={t("profile.gender.placeholder")}/>
                    </div>
                    <div>
                      <TextInput label={t("onboarding.fields.displayName")} value={form.displayName} onChange={v => set("displayName", v)}
                        placeholder={t("onboarding.fields.displayNamePlaceholder")} hint={t("onboarding.fields.displayNameHint")}/>
                    </div>
                  </>;
                })()}
              </div>
            )}

            {/* STEP 2 — Especialidade */}
            {step === 2 && (
              <div className="flex flex-col gap-6">
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.primarySpecialty")} <span className="text-white/30 font-normal">{t("onboarding.fields.specialtySelectionCount", { count: form.primarySpecialties.length + (form.customSpecialty.trim() ? 1 : 0) })}</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {sortOptionsAlphabetically(SPECIALTIES, i18n.language).map(s => (
                      <CardOption key={s.key} selected={form.primarySpecialties.includes(s.key)}
                        onClick={() => {
                          if (form.primarySpecialties.includes(s.key) || form.primarySpecialties.length < 5) {
                            set("primarySpecialties", togglePrimarySpecialty(form.primarySpecialties, s.key));
                          } else {
                            toast.error(t("onboarding.maxSpecialties"));
                          }
                        }}
                        icon={s.icon} label={s.label}/>
                    ))}
                  </div>
                </div>
                <div >
                  <TextInput label={t("onboarding.fields.customSpecialty")} value={form.customSpecialty}
                    onChange={value => set("customSpecialty", value)}
                    placeholder={t("onboarding.fields.customSpecialtyPlaceholder")}
                    hint={t("onboarding.fields.customSpecialtyHint")}/>
                </div>
                <div className="rounded-2xl border border-[#c98f70]/25 bg-[#c98f70]/5 p-5 space-y-4">
                  <div>
                    <h2 className="text-white font-semibold text-base">{t("profile.business.personType")}</h2>
                    {/* O texto de apoio fica SÓ aqui: repetido como dica do campo de
                        Número de Cadastro Empresarial, aparecia duas vezes no mesmo
                        bloco (reteste v4, item 10). Como subtítulo ele é visível antes
                        de escolher o tipo, que é quando ajuda. */}
                    <p className="text-xs text-white/45 mt-1">{t("profile.business.registrationNumberHint")}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {sortOptionsAlphabetically([
                      { value: "individual", label: t("profile.business.individual"), icon: "👤" },
                      { value: "legal_entity", label: t("profile.business.legalEntity"), icon: "🏢" },
                      { value: "mei", label: t("profile.business.mei"), icon: "🌱" },
                      { value: "nonprofit", label: t("profile.business.nonprofit"), icon: "🤝" },
                    ], i18n.language).map(option => (
                      <CardOption key={option.value} selected={form.personType === option.value}
                        onClick={() => {
                          set("personType", option.value);
                          set("companySize", option.value === "mei" ? "mei" : "");
                          if (option.value === "individual") set("companyCnpj", "");
                        }} icon={option.icon} label={option.label}/>
                    ))}
                  </div>
                  {exigeCadastroEmpresarial(form.personType) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <SelectInput label={t("profile.business.companySize")} value={form.companySize}
                        onChange={value => set("companySize", value as FormData["companySize"])}
                        options={form.personType === "mei"
                          ? [{ value: "mei", label: t("profile.business.sizeMei") }]
                          : sortOptionsAlphabetically([
                              { value: "micro", label: t("profile.business.sizeMicro") },
                              { value: "small", label: t("profile.business.sizeSmall") },
                              { value: "medium", label: t("profile.business.sizeMedium") },
                              { value: "large", label: t("profile.business.sizeLarge") },
                            ], i18n.language)} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                      <TextInput label={t("profile.business.registrationNumber")} required value={form.companyCnpj}
                        onChange={(value, compondo) => set("companyCnpj", compondo ? value : normalizarCadastroEmpresarial(value))}
                        placeholder={t("profile.business.registrationNumberPlaceholder")}/>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {/* Cargo e empresa gravam em jobTitle/company, os mesmos campos da
                      tela de Perfil (consolidação das colunas duplicadas). */}
                  <TextInput label={t("onboarding.fields.currentRole")} value={form.jobTitle} onChange={v => set("jobTitle", v)}
                    placeholder={t("onboarding.fields.currentRolePlaceholder")}/>
                  <TextInput label={t("onboarding.fields.currentCompany")} value={form.company} onChange={v => set("company", v)}
                    placeholder={t("onboarding.fields.currentCompanyPlaceholder")}/>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <TextInput label={t("onboarding.fields.experienceYears")} value={form.experienceYears ?? ""} type="number" min={0} max={60}
                    onChange={v => set("experienceYears", v ? Math.max(0, parseInt(v)) : null)} placeholder={t("onboarding.fields.experienceYearsPlaceholder")}/>
                  <SelectInput label={t("onboarding.fields.educationLevel")} value={form.educationLevel}
                    onChange={v => set("educationLevel", v)} options={EDUCATION_LEVELS}
                    placeholder={t("onboarding.fields.selectPlaceholder")}/>
                </div>
              </div>
            )}

            {/* STEP 3 — O que busca */}
            {step === 3 && (
              <div className="flex flex-col gap-6">
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.seekingTypes")} <span className="text-white/30 font-normal">{t("onboarding.fields.selectAll")}</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SEEKING_TYPES.map(s => (
                      <CardOption key={s.key} selected={form.seekingTypes.includes(s.key)}
                        onClick={() => toggleArray("seekingTypes", s.key)} icon={s.icon} label={s.label} desc={s.desc}/>
                    ))}
                  </div>
                  {form.seekingTypes.includes(CHAVE_OUTRA_NECESSIDADE) && (
                    <div className="mt-3">
                      <TextareaInput label={t("oQueBusca.outraNecessidadeRotulo")} required
                        value={form.seekingOtherNeed} onChange={v => set("seekingOtherNeed", v)}
                        placeholder={t("oQueBusca.outraNecessidadePlaceholder")}
                        hint={form.seekingOtherNeed.trim().length < 3 ? t("oQueBusca.outraNecessidadeObrigatoria") : undefined}
                        limite={LIMITE_OUTRA_NECESSIDADE} assistente/>
                    </div>
                  )}
                  <button type="button" onClick={() => toggleArray("seekingTypes", CHAVE_QUERO_MENTORAR)}
                    className={"mt-3 w-full p-4 rounded-xl border text-left transition-all duration-200 " + (form.seekingTypes.includes(CHAVE_QUERO_MENTORAR) ? "bg-[#c98f70]/15 border-[#c98f70]" : "bg-white/5 border-white/10")}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🤲</span>
                      <div>
                        <div className={"font-semibold text-sm " + (form.seekingTypes.includes(CHAVE_QUERO_MENTORAR) ? "text-[#c98f70]" : "text-white")}>{t("onboarding.seeking.be_mentor")}</div>
                        <div className="text-xs text-white/40">{t("onboarding.seeking.be_mentor_desc")}</div>
                      </div>
                    </div>
                  </button>
                </div>
                <TextareaInput label={t("onboarding.fields.shortTermGoal")} value={form.shortTermGoal} onChange={v => set("shortTermGoal", v)}
                  placeholder={t("onboarding.fields.shortTermGoalPlaceholder")} hint={t("onboarding.fields.shortTermGoalHint")}
                  limite={LIMITE_META} assistente/>
                <TextareaInput label={t("onboarding.fields.longTermGoal")} value={form.longTermGoal} onChange={v => set("longTermGoal", v)}
                  placeholder={t("onboarding.fields.longTermGoalPlaceholder")} hint={t("onboarding.fields.longTermGoalHint")}
                  limite={LIMITE_META} assistente/>
                <div>
                  <TextareaInput label={t("onboarding.fields.currentResources")} value={form.currentResources} onChange={v => set("currentResources", v)}
                    placeholder={t("onboarding.fields.currentResourcesPlaceholder")} hint={t("onboarding.fields.currentResourcesHint")}
                    limite={LIMITE_META} assistente/>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-6">
                  <div>
                    <h2 className="text-white font-semibold">{t("onboarding.steps.s5_title")}</h2>
                    <p className="text-xs text-white/40 mt-1">{t("onboarding.steps.s5_sub")}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-3">{t("onboarding.fields.incomeRange")}</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {INCOME_RANGES.map(r => (
                        <CardOption key={r.value} selected={form.incomeRange === r.value}
                          onClick={() => set("incomeRange", r.value)} icon={r.icon} label={r.label}/>
                      ))}
                    </div>
                    <p className="text-xs text-white/25 mt-2">🔒 {t("onboarding.fields.incomePrivacy")}</p>
                  </div>
                  <SelectInput label={t("onboarding.fields.investmentCapacity")} value={form.investmentCapacity}
                    onChange={v => set("investmentCapacity", v)} options={INVESTMENT_CAPACITIES}
                    placeholder={t("onboarding.fields.selectPlaceholder")}/>
                  <button type="button" onClick={() => set("lookingForInvestment", !form.lookingForInvestment)}
                    className={`w-full p-4 rounded-xl border text-left transition-all duration-200 ${form.lookingForInvestment ? "bg-[#c98f70]/15 border-[#c98f70]" : "bg-white/5 border-white/10"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">💰</span>
                      <div>
                        <div className={`font-semibold text-sm ${form.lookingForInvestment ? "text-[#c98f70]" : "text-white"}`}>{t("onboarding.fields.lookingForInvestment")}</div>
                        <div className="text-xs text-white/40">{t("onboarding.fields.lookingForInvestmentDesc")}</div>
                      </div>
                    </div>
                  </button>
                  {/* Estilo de trabalho preferido, valores principais e idiomas
                      ficavam aqui e saíram do cadastro (Rosber, 14/09 21:08). */}
                </div>
              </div>
            )}

            {/* STEP 4 — Setor e mercado */}
            {step === 4 && (
              <div className="flex flex-col gap-6">
                <div>
                  {/* Opção "outro" sempre no final, não alfabética: consistência com demais dropdowns (validação de testes) */}
                  <SelectInput label={t("onboarding.fields.sector")} value={form.sector} onChange={v => set("sector", v)}
                    options={[...sortOptionsAlphabetically(SECTORS.map(s => ({ value: s.label, label: s.label })), i18n.language), { value: OTHER_SECTOR_LABEL, label: t("onboarding.sectors.other") }]} placeholder={t("onboarding.fields.selectPlaceholder")}/>
                  {form.sector === OTHER_SECTOR_LABEL && (
                    <div className="mt-3">
                      <TextInput label={t("onboarding.fields.customSector")} value={form.customSector}
                        onChange={v => set("customSector", v)}
                        placeholder={t("onboarding.fields.customSpecialtyPlaceholder")}/>
                    </div>
                  )}
                </div>
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {/* O teto de 4 saiu (Rosber, 14/09 21:09: "retirar essa
                        limitação de até quatro, Setores de interesse"). */}
                    {t("onboarding.fields.businessInterests")} <span className="text-white/30 font-normal">{t("onboarding.misc.selectAllApply")}</span>
                  </label>
                  {/* Mesma lista do campo "Setor" acima, inclusive o setor da
                      própria usuária: ela era descartada por `s.label !== form.sector`
                      e quem é de tecnologia não conseguia declarar interesse no
                      próprio setor (reteste v4, item 7) — que é justamente onde
                      mais se procura parceria.
                      Grava a CHAVE ("construcao"), não o rótulo traduzido: o valor
                      precisa ser o mesmo em qualquer idioma, senão duas usuárias
                      com o mesmo interesse em línguas diferentes nunca se cruzam.
                      A tela mostra o rótulo, e `interesseEhDoSetor` mantém marcado
                      o que foi gravado com o rótulo antes desta correção. */}
                  <div className="flex flex-wrap gap-2">
                    {sortOptionsAlphabetically(SECTORS, i18n.language).map(s => {
                      const setor = { chave: s.key, rotulo: s.label };
                      const marcado = form.businessInterests.some(gravado => interesseEhDoSetor(gravado, setor));
                      return (
                        <TagOption key={s.key} selected={marcado} label={s.label}
                          onClick={() => set("businessInterests", marcado
                            ? form.businessInterests.filter(gravado => !interesseEhDoSetor(gravado, setor))
                            : [...form.businessInterests, s.key])}/>
                      );
                    })}
                  </div>
                </div>
                <div >
                  <label className="block text-sm font-medium text-white/70 mb-3">
                    {t("onboarding.fields.preferredCompanySize")} <span className="text-white/30 font-normal">{t("onboarding.misc.selectAllApply")}</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {COMPANY_SIZES.map(c => (
                      <CardOption key={c.value} selected={form.preferredCompanySizes.includes(c.value)}
                        onClick={() => toggleArray("preferredCompanySizes", c.value)} icon={c.icon} label={c.label}/>
                    ))}
                    {/* "Qualquer tamanho": marcado quando nenhum porte específico
                        está, e clicar nele limpa a seleção. */}
                    <CardOption selected={form.preferredCompanySizes.length === 0}
                      onClick={() => set("preferredCompanySizes", [])}
                      icon="🌍" label={t("onboarding.companySize.any")}/>
                  </div>
                </div>
                {/* "Aberto a remoto" e "Disponível para viagens" ficavam aqui e
                    saíram do cadastro (Rosber, 14/09 21:10: "está mais voltado
                    para busca de empregos"). */}
              </div>
            )}

            {/* A etapa "Quem sou" existia só para a Rede Institucional e saiu
                inteira com o campo (Rosber, 14/09 21:15). O que estava gravado
                em institutionalNetwork continua no banco e no Perfil. */}

            {/* STEP 5 — O QUE TENHO */}
            {step === 5 && (
              <div className="space-y-5">
                <p className="text-white/40 text-sm -mt-4 mb-2">
                  {t("onboarding.misc.step7_hint")} <span className="text-white/25">{t("onboarding.misc.optional")}</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {sortOptionsAlphabetically(WHAT_I_HAVE_OPTIONS, i18n.language).map(opt => (
                    <TagButton
                      key={opt.id}
                      icon={opt.icon}
                      label={opt.label}
                      selected={form.whatIHave.includes(opt.id)}
                      onClick={() => toggleArray("whatIHave", opt.id)}
                    />
                  ))}
                  {/* "Outros" fica sempre no fim, fora da ordem alfabética: é a
                      porta do texto livre, não mais um ativo da lista. */}
                  <TagButton icon="✍️" label={t("onboarding.misc.outrosAtivo")}
                    selected={form.whatIHave.includes(CHAVE_OUTRO_ATIVO)}
                    onClick={() => toggleArray("whatIHave", CHAVE_OUTRO_ATIVO)}/>
                </div>
                {form.whatIHave.includes(CHAVE_OUTRO_ATIVO) && (
                  <TextareaInput label={t("onboarding.misc.outrosAtivoRotulo")} required
                    value={form.whatIHaveOther} onChange={v => set("whatIHaveOther", v)}
                    placeholder={t("onboarding.misc.outrosAtivoPlaceholder")}
                    hint={form.whatIHaveOther.trim().length < MINIMO_DO_OUTRO_ATIVO ? t("onboarding.misc.outrosAtivoObrigatorio") : undefined}
                    limite={LIMITE_DO_OUTRO_ATIVO} assistente/>
                )}
                {ativosDoQueTenho.length > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-[#c98f70]/8 border border-[#c98f70]/20">
                    <p className="text-xs text-[#c98f70]/70 font-medium">
                      ✦ {ativosDoQueTenho.length} {ativosDoQueTenho.length === 1 ? t("onboarding.misc.assetSelected") : t("onboarding.misc.assetsSelected")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 6 — O QUE PRECISO */}
            {step === 6 && (
              <div className="space-y-5">
                {/* Texto explicativo e frase discreta do Rosber (14/09 21:24; "conexões", não "Match", 21:34). */}
                <div className="-mt-4 mb-2">
                  <p className="text-white/40 text-sm">{t("oQuePreciso.textoExplicativo")}</p>
                  <p className="text-white/25 text-xs mt-1">{t("oQuePreciso.fraseDiscreta")}</p>
                </div>
                {/* Cartões na ordem da mensagem (não alfabética), contador e segunda camada no componente. */}
                <EditorDoQuePreciso
                  valor={{ categorias: form.whatINeed, demandas: form.whatINeedDetails }}
                  onChange={({ categorias, demandas }) => setForm(prev => ({ ...prev, whatINeed: categorias, whatINeedDetails: demandas }))}
                />
              </div>
            )}

            {/* STEP 7 — Revisão final */}
            {step === 7 && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: t("onboarding.review.name"), value: form.displayName, icon: "👤" },
                    { label: t("onboarding.review.location"), value: `${form.city}, ${form.country}`, icon: "📍" },
                    ...(form.gender ? [{ label: t("profile.gender.label"), value: t(`profile.gender.${form.gender === "prefer_not_to_say" ? "preferNotToSay" : form.gender}`), icon: "⚥" }] : []),
                    { label: t("onboarding.review.specialty"), value: normalizePrimarySpecialties(form.primarySpecialties, form.customSpecialty).map(k => t("onboarding.specialties." + k, { defaultValue: k })).join(", "), icon: "⚡" },
                    { label: t("onboarding.misc.company"), value: form.company || "-", icon: "🏢" },
                    { label: t("onboarding.review.seeking"), value: form.seekingTypes.slice(0, 2).map(k => rotuloDaBusca(t, k) ?? k).join(", ") + (form.seekingTypes.length > 2 ? "..." : ""), icon: "🎯" },
                    ...(form.currentResources ? [{ label: t("onboarding.fields.currentResources"), value: form.currentResources, icon: "✦" }] : []),
                    { label: t("onboarding.review.sector"), value: form.sector, icon: "🌐" },
                    ...(form.personType ? [{ label: t("profile.business.personType"), value: t(`profile.business.${form.personType === "legal_entity" ? "legalEntity" : form.personType}`), icon: "🏢" }] : []),
                  ].map((item, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{item.icon}</span>
                        <span className="text-xs text-white/40">{item.label}</span>
                      </div>
                      <div className="text-sm font-medium text-white truncate">{item.value || "-"}</div>
                    </div>
                  ))}
                </div>

                {/* Resumo O que tenho / O que preciso. O "outros" marcado não
                    conta como ativo; o texto que a pessoa escreveu conta. */}
                {(ativosDoQueTenho.length > 0 || form.whatINeed.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {ativosDoQueTenho.length > 0 && (
                      <div className="p-3 rounded-xl bg-[#c98f70]/8 border border-[#c98f70]/20">
                        <p className="text-xs text-[#c98f70]/70 font-medium mb-1">✦ {t("onboarding.steps.s8_title")}</p>
                        <p className="text-xs text-white/50">{ativosDoQueTenho.length} {ativosDoQueTenho.length === 1 ? t("onboarding.misc.asset") : t("onboarding.misc.assets")} {ativosDoQueTenho.length === 1 ? t("onboarding.misc.selected") : t("onboarding.misc.selectedPlural")}</p>
                      </div>
                    )}
                    {form.whatINeed.length > 0 && (
                      <div className="p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
                        <p className="text-xs text-blue-400/70 font-medium mb-1">◈ {t("onboarding.steps.s9_title")}</p>
                        <p className="text-xs text-white/50">{form.whatINeed.length} {form.whatINeed.length === 1 ? t("onboarding.misc.demand") : t("onboarding.misc.demands")} {form.whatINeed.length === 1 ? t("onboarding.misc.selectedF") : t("onboarding.misc.selectedFPlural")}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-5 rounded-xl bg-[#c98f70]/10 border border-[#c98f70]/30">
                  <div className="flex items-center gap-3 mb-3">
                    <BrainCircuit aria-hidden className="w-8 h-8 text-[#c98f70]"/>
                    <span className="font-bold text-[#c98f70] text-sm">{t("onboarding.aiAnalysis.title")}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-white/60">
                    {AI_ANALYSIS_ITEMS.map(item => (
                      <div key={item} className="flex items-center gap-2"><span className="text-[#c98f70]">✓</span> {item}</div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-white/30 text-center">🔒 {t("onboarding.dataPrivacy")}</p>
              </div>
            )}

            {/* ETAPA 9 — Termo Geral de Uso (última e única etapa de termos) */}
            {step === ETAPA_TERMO_GERAL && (
              <EtapaTermoGeralDeUso
                carregando={termoGeralQuery.isLoading}
                erro={termoGeralQuery.isError}
                documento={documentoTermoGeral}
                aceito={aceitouTermoGeral}
                onAceitoChange={aceito => set("termoGeralAceitoId", aceito && documentoTermoGeral ? documentoTermoGeral.id : null)}
                onTentarDeNovo={() => { void termoGeralQuery.refetch(); }}
              />
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-white/10">
              <button type="button" onClick={() => step > 1 ? goTo(step - 1) : navigate("/")}
                className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors duration-200">
                ← {step > 1 ? t("onboarding.nav.back") : t("onboarding.nav.home")}
              </button>
              {/* Com 9 etapas as bolinhas empurravam o botão para fora da tela no
                  celular; lá o topo já mostra "etapa / total". */}
              <div className="hidden sm:flex items-center gap-2">
                {STEPS.map((_, i) => (
                  <div key={i} className={`rounded-full transition-all duration-300 ${i + 1 === step ? "w-6 h-2 bg-[#c98f70]" : i + 1 < step ? "w-2 h-2 bg-[#c98f70]/60" : "w-2 h-2 bg-white/15"}`}/>
                ))}
              </div>
              {step < STEPS.length ? (
                <button type="button" onClick={() => canProceed() && goTo(step + 1)} disabled={!canProceed()}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 active:scale-95 ${canProceed() ? "bg-[#c98f70] hover:bg-[#b07a5c] text-[#151312] shadow-lg shadow-[#c98f70]/20" : "bg-white/10 text-white/30 cursor-not-allowed"}`}>
                  {t("onboarding.nav.continue")} →
                </button>
              ) : (
                <button type="button" onClick={handleSubmit}
                  disabled={saveOnboarding.isPending || aceitarTermoGeral.isPending || !canProceed()}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-[#c98f70] hover:bg-[#b07a5c] text-[#151312] transition-all duration-200 active:scale-95 shadow-lg shadow-[#c98f70]/20 disabled:opacity-60 disabled:cursor-not-allowed">
                  {saveOnboarding.isPending || aceitarTermoGeral.isPending
                    ? <><span className="animate-spin">⏳</span> {t("onboarding.nav.analyzing")}</>
                    : <>🚀 {t("onboarding.nav.findMatches")}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-glow {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(201,143,112,0.3)); }
          50% { filter: drop-shadow(0 0 40px rgba(201,143,112,0.6)); }
        }
      `}</style>
    </div>
  );
}
