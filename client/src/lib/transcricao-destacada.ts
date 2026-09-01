// Destaques da transcrição de reunião (etapa 3): a IA já diz o TIPO de cada
// entidade extraída (pessoa, empresa, telefone...), mas o texto era exibido
// corrido — "não dá pra saber qual é qual". Aqui a transcrição é dividida em
// trechos para a tela pintar cada menção com a cor do seu tipo.
//
// Paleta pensada para o tema escuro do app: fundo translúcido + borda na cor do
// tipo + TEXTO CLARO, sempre mais visível que o corpo (text-white/75). Nunca o
// <mark> padrão do navegador, que é amarelo com texto preto — ilegível aqui.

export type TipoEntidade =
  | "person" | "company" | "phone" | "email"
  | "role" | "asset" | "need" | "opportunity";

export const TIPOS_DE_ENTIDADE: Record<TipoEntidade, { rotulo: string; classes: string }> = {
  person:      { rotulo: "Pessoa",       classes: "border border-amber-300/40 bg-amber-300/15 text-amber-200" },
  company:     { rotulo: "Empresa",      classes: "border border-sky-300/40 bg-sky-300/15 text-sky-200" },
  phone:       { rotulo: "Telefone",     classes: "border border-emerald-300/40 bg-emerald-300/15 text-emerald-200" },
  email:       { rotulo: "E-mail",       classes: "border border-teal-300/40 bg-teal-300/15 text-teal-200" },
  role:        { rotulo: "Cargo",        classes: "border border-violet-300/40 bg-violet-300/15 text-violet-200" },
  asset:       { rotulo: "Oferece",      classes: "border border-pink-300/40 bg-pink-300/15 text-pink-200" },
  need:        { rotulo: "Procura",      classes: "border border-orange-300/40 bg-orange-300/15 text-orange-200" },
  opportunity: { rotulo: "Oportunidade", classes: "border border-indigo-300/40 bg-indigo-300/15 text-indigo-200" },
};

export type Segmento = { texto: string; tipo?: TipoEntidade };

// Normaliza para comparar sem caixa nem acento, guardando o mapa de volta para
// os índices do texto original (decompor acento muda o comprimento da string).
function normalizarComMapa(s: string): { norm: string; mapa: number[] } {
  let norm = "";
  const mapa: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const decomposto = s[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of decomposto) {
      norm += ch;
      mapa.push(i);
    }
  }
  return { norm, mapa };
}

const ehLetraOuDigito = (ch: string | undefined) => !!ch && /[a-z0-9]/.test(ch);

/**
 * Divide a transcrição em segmentos: trechos comuns e trechos que são uma
 * entidade conhecida. Regras: comparação sem caixa/acentos; a entidade mais
 * longa vence quando uma contém a outra ("Solar Andes" antes de "Andes");
 * todas as ocorrências são marcadas; nada é marcado no meio de uma palavra
 * ("Ana" não acende dentro de "Anastácia"); tipos desconhecidos são ignorados.
 */
export function segmentarTranscricao(
  texto: string,
  entidades: Array<{ entityType: string; value: string }>,
): Segmento[] {
  if (!texto) return [];
  const { norm, mapa } = normalizarComMapa(texto);
  if (!norm.length) return [{ texto }];

  // Prioridade fixa quando o MESMO valor vem com dois tipos (a ordem vinda do
  // banco não é determinística): pessoa vence empresa, e assim por diante —
  // a cor não pode mudar entre um carregamento e outro.
  const prioridade: TipoEntidade[] = ["person", "company", "phone", "email", "role", "need", "asset", "opportunity"];
  const porValor = new Map<string, TipoEntidade>();
  for (const e of entidades) {
    const tipo = e.entityType as TipoEntidade;
    if (!TIPOS_DE_ENTIDADE[tipo]) continue;
    const valorNorm = normalizarComMapa((e.value ?? "").trim()).norm;
    // Valor de 1 caractere marcaria todo artigo "a" da transcrição como ruído.
    if (valorNorm.length < 2) continue;
    const atual = porValor.get(valorNorm);
    if (!atual || prioridade.indexOf(tipo) < prioridade.indexOf(atual)) porValor.set(valorNorm, tipo);
  }
  const alvos = Array.from(porValor, ([valorNorm, tipo]) => ({ valorNorm, tipo }));
  alvos.sort((a, b) => b.valorNorm.length - a.valorNorm.length);

  const dono: (TipoEntidade | null)[] = new Array(norm.length).fill(null);
  for (const alvo of alvos) {
    let de = 0;
    while (de <= norm.length - alvo.valorNorm.length) {
      const i = norm.indexOf(alvo.valorNorm, de);
      if (i === -1) break;
      const fim = i + alvo.valorNorm.length;
      de = i + 1;
      if (ehLetraOuDigito(norm[i - 1]) || ehLetraOuDigito(norm[fim])) continue;
      let livre = true;
      for (let k = i; k < fim; k++) if (dono[k]) { livre = false; break; }
      if (!livre) continue;
      for (let k = i; k < fim; k++) dono[k] = alvo.tipo;
      de = fim;
    }
  }

  const segmentos: Segmento[] = [];
  let inicio = 0;
  for (let k = 1; k <= norm.length; k++) {
    if (k === norm.length || dono[k] !== dono[inicio]) {
      const inicioOrig = inicio === 0 ? 0 : mapa[inicio];
      const fimOrig = k === norm.length ? texto.length : mapa[k];
      const trecho = texto.slice(inicioOrig, fimOrig);
      if (trecho) {
        const tipo = dono[inicio];
        segmentos.push(tipo ? { texto: trecho, tipo } : { texto: trecho });
      }
      inicio = k;
    }
  }
  return segmentos;
}
