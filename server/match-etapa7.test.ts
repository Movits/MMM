import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 7 — o exemplo de aceite da Glenda e o ciclo de vida do cruzamento.
 *
 * 1. "A possui mina de terras raras; B procura fornecedor de terras raras" é o
 *    exemplo LITERAL do requisito — e pontuava 0, porque o motor não atravessava
 *    a cabeça transparente ("mina de", "fornecedor de") até a substância.
 * 2. A regra da direção passa a usar a direção EFETIVA (campo cruzado com a
 *    palavra): "Café" possuído diante de "Exportar café" procurado são duas
 *    vendedoras, e o par saía em 100 com e-mail.
 * 3. Contato apagado leva o rastro junto (possui/procura/sugestões) e o
 *    recálculo roda sozinho na exclusão — sem isso o match órfão renascia a
 *    cada rodada, apontando para um contato fantasma.
 */

const { scoreMatch, slugifyMatchTag } = await import("./match-service");
const { nucleoDoTermo } = await import("@shared/direcao-do-termo");

const item = (label: string, category: string | null = null) =>
  ({ slug: slugifyMatchTag(label), label, category });

describe("Núcleo do termo — a substância atravessa a cabeça transparente", () => {
  it("extrai a substância de papel e de estrutura produtiva", () => {
    expect(nucleoDoTermo("Mina de terras raras")).toBe("terras-raras");
    expect(nucleoDoTermo("Fornecedor de terras raras")).toBe("terras-raras");
    expect(nucleoDoTermo("Fazenda de café")).toBe("cafe");
    expect(nucleoDoTermo("Procura fornecedor de terras raras")).toBe("terras-raras");
  });

  it("cabeça fora da lista fica inteira — 'sapatos de couro' não vira 'couro'", () => {
    expect(nucleoDoTermo("Sapatos de couro")).toBe("sapatos-de-couro");
    expect(nucleoDoTermo("Curso de inglês")).toBe("curso-de-ingles");
  });

  it("locativo continua protegido: 'exportação para a China' não empresta objeto", () => {
    expect(nucleoDoTermo("Exportação para a China")).toBe("exportacao-para-a-china");
  });
});

describe("scoreMatch — o exemplo de aceite da etapa 7", () => {
  it("mina de terras raras casa com fornecedor de terras raras em 100", () => {
    const r = scoreMatch(item("Mina de terras raras"), item("Fornecedor de terras raras"));
    expect(r.score).toBe(100);
    expect(r.type).toBe("exact");
  });

  it("mina de terras raras casa com quem procura terras raras", () => {
    expect(scoreMatch(item("Mina de terras raras"), item("Terras raras")).score).toBe(100);
  });

  it("substâncias diferentes sob cabeças transparentes não casam", () => {
    expect(scoreMatch(item("Mina de terras raras"), item("Fornecedor de vinho")).score).toBe(0);
  });

  it("cabeça opaca não reduz: sapatos de couro não casa com bolsa de couro", () => {
    expect(scoreMatch(item("Sapatos de couro"), item("Bolsa de couro")).score).toBe(0);
  });

  it("os casos que já funcionavam continuam: tag exata, marcador fraco e direção oposta", () => {
    expect(scoreMatch(item("Terras raras"), item("Procura terras raras")).score).toBe(100);
    expect(scoreMatch(item("Exportar vinho"), item("Importar vinho")).score).toBe(100);
    expect(scoreMatch(item("Armazenagem refrigerada"), item("Terrenos com outorga")).score).toBe(0);
  });
});

describe("scoreMatch — a regra da direção continua exigindo verbo dos DOIS lados", () => {
  it("duas ofertas explícitas seguem bloqueadas", () => {
    const r = scoreMatch(item("Exportar vinho"), item("Exportar vinho"));
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBe("concorrentes");
  });

  // A tentativa de barrar pela direção efetiva de um lado só foi revertida na
  // revisão: ela zerava pares legítimos. Estes testes pinam a decisão.
  it("uma ponta neutra nunca é barrada: 'Café' possuído segue casando com 'Exportar café' procurado", () => {
    expect(scoreMatch(item("Café"), item("Exportar café")).score).toBe(100);
  });

  it("'Terras raras' × 'Fornecimento de terras raras': o substantivo de ação no que se procura nomeia o serviço, não concorrência", () => {
    expect(scoreMatch(item("Terras raras"), item("Fornecimento de terras raras")).score).toBe(100);
  });

  it("'Exportar café' possuído × 'Café' procurado: oferta e demanda, casa em 100", () => {
    expect(scoreMatch(item("Exportar café"), item("Café")).score).toBe(100);
  });
});

/**
 * As garantias de fiação (o cascade da exclusão e o recálculo automático) vivem
 * em funções coladas ao banco; o contrato delas fica pinado no fonte — mesmo
 * caminho do teste da política de microfone — e a prova comportamental roda no
 * exame de produção.
 */
describe("Ciclo de vida — contato apagado leva o rastro e recalcula", () => {
  const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), "utf8");

  it("deletePrivateContact apaga possui, procura e sugestões do contato", () => {
    const db = fonte("db.ts");
    // O rastro mora em apagarRastroDoContato (exclusão-sem-fantasma a executa
    // de verdade); aqui fica pinado que a exclusão chama a limpeza e que os
    // deletes originais continuam lá.
    const corpo = db.slice(db.indexOf("export async function apagarRastroDoContato"), db.indexOf("// ─── Contextos"));
    expect(corpo).toContain("delete(contactAssets)");
    expect(corpo).toContain("delete(contactNeeds)");
    expect(corpo).toContain("delete(aiMatchSuggestions)");
    expect(corpo).toContain("pairLowContactId");
    expect(corpo).toContain("pairHighContactId");
    expect(corpo).toContain("await apagarRastroDoContato(db, ownerId, contactId)");
  });

  it("network.delete dispara o recálculo (com a trava da etapa 11)", () => {
    const rede = fonte(join("routers", "network.ts"));
    expect(rede).toContain("recalculatePrivateMatches(ctx.user.openId)");
    expect(rede).toContain('hasValidConsent(ctx.user.id, "termo_smart_match")');
  });

  it("o enriquecimento não grava possui/procura para contato apagado", () => {
    const db = fonte("db.ts");
    const corpo = db.slice(db.indexOf("export async function aplicarRespostaAoContato"), db.indexOf('const fieldMap'));
    expect(corpo).toContain("contatoVivo");
  });

  it("existe remover: removeAsset e removeNeed recalculam ao sair", () => {
    const rotas = fonte(join("routers", "matches.ts"));
    const blocoRemocao = rotas.slice(rotas.indexOf("removeAsset: smartMatchProcedure"), rotas.indexOf("recalculate: smartMatchProcedure"));
    expect(blocoRemocao).toContain("removeNeed: smartMatchProcedure");
    // o recálculo é o que faz a sugestão morrer junto com a razão dela
    expect(blocoRemocao.split("recalculatePrivateMatches").length - 1).toBe(2);
  });

  it("remover o último item ainda limpa órfãos: o recálculo não retorna cedo", () => {
    const servico = fonte("match-service.ts");
    const recalc = servico.slice(servico.indexOf("export async function recalculatePrivateMatches"));
    // a limpeza de órfãos precisa ser alcançável mesmo com zero ativos/necessidades
    expect(recalc).not.toMatch(/size === 0.*return \{ created: 0/);
    expect(recalc).toContain("Match órfão");
  });

  it("o alerta de oportunidade filtra por consentimento e não chama o LLM com a lista vazia", () => {
    const alerta = fonte(join("routers", "matching.ts"));
    expect(alerta).toContain("usersComConsentimento");
    expect(alerta).toContain("if (!profiles.length) return { notified: 0 }");
  });
});
