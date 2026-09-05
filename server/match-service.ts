import crypto from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { aiMatchSuggestions, contactAssets, contactNeeds, privateContacts } from "../drizzle/schema";
import { cosineSimilarity, normalizeVector } from "./memory-service";
import { exigirDb } from "./db";
import { sendEmail } from "./_core/email";
import { embedWithGemini } from "./gemini";
import { analisarTermo, ehLugar, normalizar, nucleoDoTermo, saoConcorrentes, SEPARADOR_DE_PALAVRA } from "@shared/direcao-do-termo";

const SEMANTIC_THRESHOLD = 0.7;
const SAVE_THRESHOLD = 50;
const EMAIL_THRESHOLD = 70;

/**
 * O score do critério semântico, e se ele está ligado.
 *
 * 45 fica abaixo de SAVE_THRESHOLD de propósito (o porquê está em scoreMatch),
 * o que significa que nenhuma similaridade — nem 1.0, o máximo possível — vira
 * sugestão. A comparação abaixo torna isso explícito, e é o que impede o pior
 * efeito colateral: enquanto o critério estiver desligado, o texto do que cada
 * contato possui e procura NÃO sai daqui para o provedor de embeddings. Antes
 * saía a cada recálculo, para não gerar nada — inclusive para os pares que a
 * regra da direção acabara de barrar como concorrentes.
 *
 * Religar é subir SEMANTIC_SCORE acima de SAVE_THRESHOLD; a chamada volta
 * sozinha, sem ninguém precisar lembrar desta linha.
 */
const SEMANTIC_SCORE = 45;
const SEMANTIC_ENABLED = SEMANTIC_SCORE >= SAVE_THRESHOLD;

export type MatchReason = { slug: string; label: string; category?: string | null };
export type MatchType = "mutual" | "exact" | "category" | "semantic";

/** Um encontro entre o que alguém possui e o que outra pessoa procura. */
type Encontro = { deId: number; paraId: number; asset: MatchReason; need: MatchReason; score: number; type: MatchType };

/**
 * Tudo que liga dois contatos. Guardar por par, e não por encontro, é o que
 * permite ver "três coisas em comum" e, principalmente, reconhecer quando cada
 * um tem o que o outro procura.
 */
type Par = { lowId: number; highId: number; encontros: Encontro[] };

export function slugifyMatchTag(value: string) {
  // A MESMA normalização do analisador de termo: o slug é o objeto inteiro, e
  // os dois precisam enxergar as mesmas letras (antes, [a-z0-9] aqui e lá
  // apagava qualquer tag fora do alfabeto latino). O corte é por caractere,
  // não por unidade UTF-16: tag_slug é varchar(160) em utf8mb4, e uma
  // surrogate pair partida ao meio nem entra no banco.
  const slug = normalizar(value).replace(SEPARADOR_DE_PALAVRA, "-").replace(/^-+|-+$/g, "");
  return Array.from(slug).slice(0, 160).join("");
}

export function scoreMatch(asset: MatchReason, need: MatchReason, semanticScore = 0) {
  // Etapa 11: o cruzamento não pode ser feito por palavra parecida. "Exportar
  // vinho" e "importar vinho" são quase o mesmo texto e são o negócio; duas
  // pontas que querem exportar são concorrentes. A regra vem antes de tudo:
  // nenhum outro critério pode reapresentar quem foi barrado aqui.
  //
  // E ela exige verbo explícito NOS DOIS lados, de propósito: com uma ponta
  // neutra não há evidência de conflito na palavra. "Café" possuído diante de
  // "Exportar café" procurado não é concorrência — é quem tem o produto diante
  // de quem precisa dele para exportar. Uma tentativa de barrar pela direção
  // efetiva de um lado só zerava pares legítimos como "Terras raras" ×
  // "Fornecimento de terras raras" (a lista de verbos tem substantivos de ação
  // que, no campo de procura, nomeiam o serviço de que a pessoa precisa).
  if (saoConcorrentes(asset.label, need.label)) {
    return { score: 0, type: "semantic" as const, bloqueio: "concorrentes" as const };
  }

  if (asset.slug && asset.slug === need.slug) return { score: 100, type: "exact" as const };

  // O outro lado da mesma regra. Tirado o verbo, sobra o objeto — e é o objeto
  // que as duas pontas têm em comum. "Exportar vinho" e "importar vinho" viram
  // as duas "vinho": mesmo objeto, direções opostas, negócio. Sem isto a regra
  // só saberia barrar, e o par que ela existe para encontrar continuaria valendo
  // os 60 da categoria.
  //
  // Mas lugar não é mercadoria de quem DECLAROU direção: "Importação da China"
  // × "Exportação da China" reduziam os dois lados a "china", e 100 é a nota
  // de quem tem a MESMA coisa, acima do corte de e-mail. A guarda vale para o
  // objeto E para o núcleo — só num deles, o outro ainda dava 100 — e só
  // quando ao menos uma ponta trouxe verbo ou substantivo de ação: sem
  // direção nas palavras, "China" × "Procura China" é a mesma coisa dita de
  // dois jeitos, como "Terras raras" × "Procura terras raras" (revisão
  // adversarial de 05/09). Tag idêntica ("China" × "China") casa pelo slug.
  const termoAsset = analisarTermo(asset.label);
  const termoNeed = analisarTermo(need.label);
  const direcaoDeclarada = termoAsset.verbo !== null || termoNeed.verbo !== null;
  const ehSubstancia = (x: string) => !!x && !(direcaoDeclarada && ehLugar(x.split("-")));
  const objetoAsset = termoAsset.objeto;
  const objetoNeed = termoNeed.objeto;
  if (ehSubstancia(objetoAsset) && objetoAsset === objetoNeed) return { score: 100, type: "exact" as const };

  // E o núcleo atravessa a cabeça transparente: "mina DE terras raras" e
  // "fornecedor DE terras raras" falam ambos de terras raras — o exemplo de
  // aceite da etapa 7, que sem isto pontuava 0 e não virava sugestão.
  const nucleoAsset = nucleoDoTermo(asset.label);
  const nucleoNeed = nucleoDoTermo(need.label);
  if (ehSubstancia(nucleoAsset) && nucleoAsset === nucleoNeed) return { score: 100, type: "exact" as const };

  const categoriaAsset = slugifyMatchTag(asset.category ?? "");
  const categoriaNeed = slugifyMatchTag(need.category ?? "");
  if (categoriaAsset && categoriaNeed && categoriaAsset === categoriaNeed) return { score: 60, type: "category" as const };
  // 45 fica DE PROPÓSITO abaixo de SAVE_THRESHOLD (50), o que mantém o critério
  // semântico desligado. Não é esquecimento: com SEMANTIC_THRESHOLD em 0.7, ele
  // casa tudo com tudo. Medido em 31/08/2026 numa rede de 10 contatos — ao subir
  // para 50, os 45 pares possíveis viraram match, incluindo "Armazenagem
  // refrigerada" com "Terrenos com outorga". Reativar exige calibrar o limiar
  // com dados reais antes, não mexer nesta linha. A regra da etapa 11 reforça
  // este desligamento: parecença de texto é justamente o que confunde "exportar"
  // com "importar", e é por parecença que o critério semântico decide.
  if (semanticScore > SEMANTIC_THRESHOLD) return { score: SEMANTIC_SCORE, type: "semantic" as const };
  return { score: 0, type: "semantic" as const };
}

async function embed(text: string) {
  return normalizeVector(await embedWithGemini(text, "SEMANTIC_SIMILARITY"));
}

/**
 * Embeddings de uma rodada. O laço compara cada ativo com cada necessidade,
 * então sem cache o mesmo texto seria enviado ao Gemini uma vez por par —
 * dezenas de chamadas idênticas por recálculo.
 */
type SemanticContext = { cache: Map<string, number[]>; disponivel: boolean };

async function embedCached(texto: string, contexto: SemanticContext) {
  const emCache = contexto.cache.get(texto);
  if (emCache) return emCache;
  const vetor = await embed(texto);
  contexto.cache.set(texto, vetor);
  return vetor;
}

/**
 * Similaridade semântica é o terceiro critério, usado só quando tag e categoria
 * não casam. Se o provedor de embeddings estiver fora do ar ou sem cota, o
 * recálculo continua sem ele: os matches por tag exata e por categoria não
 * dependem de IA e não podem ser perdidos junto. Uma falha desliga o critério
 * para o resto da rodada, em vez de repetir a chamada a cada par.
 */
async function semanticScore(
  asset: { tagLabel: string; description: string | null },
  need: { tagLabel: string; description: string | null },
  contexto: SemanticContext,
) {
  if (!contexto.disponivel) return 0;
  try {
    const [assetEmbedding, needEmbedding] = await Promise.all([
      embedCached(`${asset.tagLabel}. ${asset.description ?? ""}`, contexto),
      embedCached(`${need.tagLabel}. ${need.description ?? ""}`, contexto),
    ]);
    return cosineSimilarity(assetEmbedding, needEmbedding);
  } catch (erro) {
    contexto.disponivel = false;
    console.warn("[Match] Similaridade semântica indisponível nesta rodada:", erro instanceof Error ? erro.message : erro);
    return 0;
  }
}

export async function recalculatePrivateMatches(ownerId: string, ownerEmail?: string | null) {
  const db = await exigirDb();
  const [assets, needs, contacts, existing] = await Promise.all([
    db.select().from(contactAssets).where(eq(contactAssets.ownerId, ownerId)),
    db.select().from(contactNeeds).where(eq(contactNeeds.ownerId, ownerId)),
    db.select().from(privateContacts).where(eq(privateContacts.ownerId, ownerId)),
    db.select().from(aiMatchSuggestions).where(eq(aiMatchSuggestions.ownerId, ownerId)),
  ]);
  // Sem ativos OU sem necessidades não nasce par nenhum — mas a rodada segue
  // até o fim mesmo assim: a limpeza de órfãos lá embaixo é que apaga a
  // sugestão cuja razão acabou de sumir. Um retorno antecipado aqui deixava a
  // última remoção com uma sugestão fantasma que nenhum recálculo alcançava.

  const contactName = new Map(contacts.map(contact => [contact.id, contact.fullName]));
  const semantico: SemanticContext = { cache: new Map(), disponivel: true };

  // Junta por PAR de contatos, não por encontro. É o que permite acumular todas
  // as razões e enxergar quando os dois lados se completam.
  const pares = new Map<string, Par>();
  for (const asset of assets) {
    for (const need of needs) {
      if (asset.contactId === need.contactId) continue;
      // Linha gravada antes do conserto da escrita não latina tem tag_slug ""
      // (o slug antigo apagava tudo fora de [a-z0-9]). O rótulo continua lá:
      // recalcular o slug aqui evita migração de dados e impede que "unicos"
      // — que dedupe por slug — junte todas essas razões numa só.
      const baseAsset: MatchReason = { slug: asset.tagSlug || slugifyMatchTag(asset.tagLabel), label: asset.tagLabel, category: asset.category };
      const baseNeed: MatchReason = { slug: need.tagSlug || slugifyMatchTag(need.tagLabel), label: need.tagLabel, category: need.category };
      let result = scoreMatch(baseAsset, baseNeed);
      // Só chama o provedor de embeddings se a resposta puder mudar alguma
      // coisa. Com o critério desligado não pode, e mandar o texto para fora
      // seria transferência de dado sem finalidade.
      if (!result.score && SEMANTIC_ENABLED) {
        result = scoreMatch(baseAsset, baseNeed, await semanticScore(asset, need, semantico));
      }
      if (result.score < SAVE_THRESHOLD) continue;

      const lowId = Math.min(asset.contactId, need.contactId);
      const highId = Math.max(asset.contactId, need.contactId);
      const chave = `${lowId}:${highId}`;
      const par = pares.get(chave) ?? { lowId, highId, encontros: [] };
      par.encontros.push({ deId: asset.contactId, paraId: need.contactId, asset: baseAsset, need: baseNeed, score: result.score, type: result.type });
      pares.set(chave, par);
    }
  }

  const unicos = (itens: MatchReason[]) => {
    const vistos = new Map<string, MatchReason>();
    for (const item of itens) if (!vistos.has(item.slug)) vistos.set(item.slug, item);
    return Array.from(vistos.values());
  };
  const listar = (rotulos: string[]) =>
    rotulos.length === 1 ? rotulos[0] : `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;

  const existingByPair = new Map(existing.map(match => [`${match.pairLowContactId}:${match.pairHighContactId}`, match]));
  const timestamp = Date.now(); let created = 0; let updated = 0; let newHighScore = 0;

  for (const par of Array.from(pares.values())) {
    // Direção é quem possui. Havendo encontros nos dois sentidos, cada contato
    // tem o que o outro procura — a conexão mais forte que existe aqui.
    const direcoes = new Map<number, Encontro[]>();
    for (const encontro of par.encontros) {
      const lista = direcoes.get(encontro.deId) ?? [];
      lista.push(encontro);
      direcoes.set(encontro.deId, lista);
    }
    const mutuo = direcoes.size > 1;
    const melhor = par.encontros.reduce((a, b) => (b.score > a.score ? b : a));

    const reasonText = mutuo
      ? Array.from(direcoes.entries())
          .map(([deId, lista]) => {
            const quem = contactName.get(deId) ?? "Este contato";
            const outro = contactName.get(lista[0].paraId) ?? "o outro contato";
            return `${quem} possui ${listar(unicos(lista.map(e => e.asset)).map(a => a.label))}, que ${outro} procura`;
          })
          .join("; ") + "."
      : (() => {
          const quem = contactName.get(melhor.deId) ?? "Este contato";
          const outro = contactName.get(melhor.paraId) ?? "outro contato";
          const rotulos = unicos(par.encontros.map(e => e.asset)).map(a => a.label);
          return `${quem} possui ${listar(rotulos)}, que ${outro} procura.`;
        })();

    const values = {
      contactAId: melhor.deId,
      contactBId: melhor.paraId,
      matchScore: melhor.score,
      matchType: (mutuo ? "mutual" : melhor.type) as MatchType,
      matchedAssets: unicos(par.encontros.map(e => e.asset)),
      matchedNeeds: unicos(par.encontros.map(e => e.need)),
      reasonText,
      updatedAt: timestamp,
    };

    const chave = `${par.lowId}:${par.highId}`;
    const previous = existingByPair.get(chave);
    if (previous) {
      // A linha é do PAR (índice único por dona e par), e a decisão da usuária
      // — aceita ou dispensada — foi tomada sobre a razão que ela viu. Quando
      // essa razão some e nasce outra sem NADA em comum com a antiga, é outra
      // oportunidade: o par volta a pendente para ela decidir de novo (decisão
      // do Nicolas, 04/09). Com qualquer razão em comum, a decisão permanece.
      // O par só VISTO segue a mesma regra: o que ela viu foi a razão antiga,
      // e a nova ainda não foi vista nem anunciada (revisão adversarial de
      // 05/09). dismissedAt/acceptedAt ficam como histórico da decisão
      // anterior. O slug antigo pode estar vazio (linha anterior ao conserto
      // da escrita não latina): recalcula-se do rótulo, como no laço lá em cima.
      const slugsAntigos = new Set([...(previous.matchedAssets ?? []), ...(previous.matchedNeeds ?? [])]
        .map(razao => razao.slug || slugifyMatchTag(razao.label)));
      const razaoTotalmenteNova = ![...values.matchedAssets, ...values.matchedNeeds].some(razao => slugsAntigos.has(razao.slug));
      const reabrir = razaoTotalmenteNova && (previous.status === "dismissed" || previous.status === "accepted" || previous.status === "viewed");
      const patch = reabrir ? { ...values, status: "pending" as const, viewedAt: null, notifiedAt: null } : values;
      await db.update(aiMatchSuggestions).set(patch).where(and(eq(aiMatchSuggestions.id, previous.id), eq(aiMatchSuggestions.ownerId, ownerId)));
      if (reabrir) {
        const decisao = previous.status === "accepted" ? "aceitado" : previous.status === "dismissed" ? "dispensado" : "visto";
        console.info(`[Match] Par ${chave} reaberto: a razão que a usuária tinha ${decisao} sumiu e nasceu outra.`);
      }
      updated += 1;
      // Só conta para o e-mail o que a usuária ainda vai ver. Par aceito ou
      // dispensado que sobe de nota pela mesma razão não é oportunidade nova
      // para ela — antes o e-mail saía e na tela não havia nada novo.
      const statusFinal = reabrir ? "pending" : previous.status;
      const aindaPorDecidir = statusFinal === "pending" || statusFinal === "viewed";
      if (aindaPorDecidir && values.matchScore >= EMAIL_THRESHOLD && (previous.matchScore < EMAIL_THRESHOLD || reabrir)) newHighScore += 1;
    } else {
      await db.insert(aiMatchSuggestions).values({ id: crypto.randomUUID(), ownerId, pairLowContactId: par.lowId, pairHighContactId: par.highId, status: "pending", notifiedAt: null, viewedAt: null, acceptedAt: null, dismissedAt: null, createdAt: timestamp, ...values });
      created += 1;
      if (values.matchScore >= EMAIL_THRESHOLD) newHighScore += 1;
    }
  }

  // Match órfão: o ativo ou a necessidade que o justificava foi apagado, e o
  // motivo exibido virou mentira. Só some o que ainda é sugestão — decisão da
  // usuária, aceita ou dispensada, permanece como histórico.
  let removed = 0;
  for (const antigo of existing) {
    if (pares.has(`${antigo.pairLowContactId}:${antigo.pairHighContactId}`)) continue;
    if (antigo.status !== "pending" && antigo.status !== "viewed") continue;
    await db.delete(aiMatchSuggestions).where(and(eq(aiMatchSuggestions.id, antigo.id), eq(aiMatchSuggestions.ownerId, ownerId)));
    removed += 1;
  }

  if (newHighScore && ownerEmail) {
    const sent = await sendEmail({ to: ownerEmail, subject: `${newHighScore} nova(s) oportunidade(s) de conexão no MMM`, text: `Encontramos ${newHighScore} oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede. Abra o painel de Matches Inteligentes para revisar.`, html: `<p>Encontramos <strong>${newHighScore}</strong> oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede MMM.</p><p>Abra o painel de Matches Inteligentes para revisar.</p>` });
    // O carimbo só alcança o que a usuária ainda vai decidir: linha aceita ou
    // dispensada não foi anunciada neste e-mail, e carimbá-la apagaria o rastro
    // de quando (e se) ela foi notificada de verdade.
    if (sent) await db.update(aiMatchSuggestions).set({ notifiedAt: timestamp }).where(and(eq(aiMatchSuggestions.ownerId, ownerId), gte(aiMatchSuggestions.matchScore, EMAIL_THRESHOLD), inArray(aiMatchSuggestions.status, ["pending", "viewed"])));
  }
  return { created, updated, removed, total: pares.size };
}
