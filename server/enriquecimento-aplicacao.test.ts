import { describe, expect, it, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { aplicarRespostaAoContato } from "./db";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O contrato de aplicarRespostaAoContato: cada resposta do chat de
 * enriquecimento tem um destino de verdade, e a função diz a verdade sobre ter
 * gravado ou não.
 *
 * Existe por causa de um defeito que passou meses invisível: a versão anterior
 * marcava a sugestão como "applied" e jogava fora as respostas de assets,
 * needs, how_met e relationship_type — justamente o que alimenta o Cruzamento
 * Inteligente. 18 respostas confirmadas se perderam sem um erro sequer.
 *
 * Mesmo padrão dos testes do consentimento: drizzle de verdade sobre um cliente
 * mysql2 falso que captura o SQL. Sabotagem no destino muda o SQL e quebra.
 */

type Consulta = { sql: string; params: unknown[] };

let consultas: Consulta[] = [];
let respostas: unknown[][] = [];

const clienteFalso = {
  query: async (config: { sql: string }, params: unknown[] = []) => {
    consultas.push({ sql: config.sql, params });
    return [respostas.shift() ?? [], []];
  },
} as never;

const db = drizzle(clienteFalso) as never as Parameters<typeof aplicarRespostaAoContato>[0];

const sqlDe = (trecho: string) => consultas.find(c => c.sql.includes(trecho));

describe("Enriquecimento — cada resposta chega ao seu destino", () => {
  beforeEach(() => { consultas = []; respostas = []; });

  it("'o que possui' vira linha em contact_assets, com slug e rótulo", async () => {
    respostas = [[[42]], [], []]; // contato vivo; não existe ainda; insert
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "Fábrica de calçados", 1000);

    expect(gravou).toBe(true);
    const insert = sqlDe("insert into `contact_assets`");
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("fabrica-de-calcados");
    expect(insert!.params).toContain("Fábrica de calçados");
    expect(insert!.params).toContain("dona-1");
    expect(insert!.params).toContain(42);
  });

  it("'o que procura' vira linha em contact_needs", async () => {
    respostas = [[[42]], [], []];
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "needs", "investidores", 1000);

    expect(gravou).toBe(true);
    expect(sqlDe("insert into `contact_needs`")).toBeDefined();
    expect(sqlDe("insert into `contact_assets`")).toBeUndefined();
  });

  it("confirmar duas vezes não duplica: o item existente barra o insert", async () => {
    // A base real tinha "fabrica" confirmada CINCO vezes no mesmo contato.
    respostas = [[[42]], [[7]]]; // contato vivo; o select de existência devolve uma linha
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "fabrica", 1000);

    expect(gravou).toBe(false);
    expect(consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
  });

  it("a busca de duplicata é pelo slug, do dono e do contato certos", async () => {
    respostas = [[[42]], [], []];
    await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "FÁBRICA", 1000);

    const busca = sqlDe("select `id` from `contact_assets`");
    expect(busca).toBeDefined();
    expect(busca!.sql).toContain("`owner_id` = ?");
    expect(busca!.sql).toContain("`contact_id` = ?");
    expect(busca!.sql).toContain("`tag_slug` = ?");
    expect(busca!.params).toEqual(expect.arrayContaining(["dona-1", 42, "fabrica"]));
  });

  /**
   * Estes casos mudaram de lado. Até o PR #29, "como se conheceram" CRIAVA um
   * contexto com os primeiros 100 caracteres da resposta livre, e os testes
   * daqui fixavam isso. O efeito na tela de Contextos era "Fomos apresentadas
   * por uma amiga em comum" aparecendo como contexto da dona, com uma linha
   * nova a cada variação da frase. O requisito atual: corresponder a contexto
   * existente vincula; não corresponder fica só na nota; criar contexto é
   * decisão explícita da dona, nunca efeito colateral do chat.
   */
  it("'como se conheceram' que corresponde a um contexto existente REUSA esse contexto", async () => {
    respostas = [
      [[42]],                                       // contato vivo
      [[null]],                                     // notes atual: null → vai anotar
      [],                                           // update das notas
      [["ctx-1", "Em um evento", "dona-1"]],        // contexto com esse nome já existe
      [],                                           // não existe vínculo → vai criar
      [],                                           // insert do vínculo
    ];
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Em um evento", 1000);

    expect(gravou).toBe(true);
    const update = sqlDe("update `private_contacts`");
    expect(update).toBeDefined();
    expect(String(update!.params[0])).toContain("Como se conheceram: Em um evento");

    // O que este teste existe para impedir: contexto nascido da resposta.
    expect(sqlDe("insert into `contexts`")).toBeUndefined();

    const insertVinculo = sqlDe("insert into `contact_contexts`");
    expect(insertVinculo).toBeDefined();
    expect(insertVinculo!.params).toContain("ctx-1");
    expect(insertVinculo!.params).toContain(42);
  });

  it("caixa e espaços não criam duplicata: a resposta acha o mesmo contexto", async () => {
    respostas = [
      [[42]],
      [[null]],
      [],
      [["ctx-1", "Feira de Milão", "dona-1"]],
      [],
      [],
    ];
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "  feira   de MILAO  ", 1000);

    expect(gravou).toBe(true);
    expect(sqlDe("insert into `contexts`")).toBeUndefined();
    expect(sqlDe("insert into `contact_contexts`")!.params).toContain("ctx-1");
  });

  it("nomes diferentes continuam contextos diferentes: nada de aproximar frases", async () => {
    respostas = [
      [[42]],
      [[null]],
      [],
      [["ctx-1", "Feira de Bolonha", "dona-1"]], // parecido, mas outro evento
    ];
    await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Feira de Milão", 1000);

    expect(sqlDe("insert into `contexts`")).toBeUndefined();
    expect(sqlDe("insert into `contact_contexts`")).toBeUndefined();
  });

  it("sem contexto correspondente, a resposta fica SÓ na nota e não cria contexto", async () => {
    // A frase do relato: resposta livre e legítima que não é nome de contexto.
    respostas = [
      [[42]],   // contato vivo
      [[null]], // notes atual: null → vai anotar
      [],       // update das notas
      [],       // nenhum contexto com esse nome
    ];
    const gravou = await aplicarRespostaAoContato(
      db, "dona-1", 42, "how_met", "Fomos apresentadas por uma amiga em comum", 1000,
    );

    expect(gravou).toBe(true); // a nota foi gravada
    const update = sqlDe("update `private_contacts`");
    expect(String(update!.params[0])).toContain("Como se conheceram: Fomos apresentadas por uma amiga em comum");

    expect(sqlDe("insert into `contexts`")).toBeUndefined();
    expect(sqlDe("insert into `contact_contexts`")).toBeUndefined();
  });

  it("'como se conheceram' repetido não duplica nada: nota e vínculo já existem", async () => {
    respostas = [
      [[42]],                                 // contato vivo
      [["Como se conheceram: Em um evento"]], // nota já está lá
      [["ctx-1", "Em um evento", "dona-1"]],  // contexto já existe
      [["vinc-1"]],                           // vínculo já existe
    ];
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Em um evento", 1000)).toBe(false);
    expect(consultas.some(c => c.sql.startsWith("insert") || c.sql.startsWith("update"))).toBe(false);
  });

  it("reprocessamento em lote de resposta antiga não cria contexto nenhum", async () => {
    // scripts/recuperar-enriquecimento.ts reaplica por aqui, em massa. Era este
    // o caminho que enchia a tela de Contextos com respostas de anos atrás.
    respostas = [
      [[42]],                                 // contato vivo
      [["Como se conheceram: Em um evento"]], // nota já está lá
      [],                                     // nenhum contexto corresponde
    ];
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Em um evento", 1000)).toBe(false);
    expect(consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
    expect(sqlDe("update `private_contacts`")).toBeUndefined(); // nota não é regravada
  });

  it("'relacionamento' entra nas anotações do contato, uma vez só", async () => {
    respostas = [[[42]], [[null]]];
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "relationship_type", "profissional", 1000);

    expect(gravou).toBe(true);
    const update = sqlDe("update `private_contacts`");
    expect(update).toBeDefined();
    expect(String(update!.params[0])).toContain("Relacionamento: profissional");

    consultas = []; respostas = [[[42]], [["Relacionamento: profissional"]]];
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "relationship_type", "profissional", 1000)).toBe(false);
    expect(sqlDe("update `private_contacts`")).toBeUndefined();
  });

  it("instagram vai para a coluna que existe", async () => {
    // O mapa antigo apontava para `instagramHandle`, coluna inexistente — a
    // primeira sugestão de instagram confirmada teria quebrado em produção.
    respostas = [[[42]], []];
    await aplicarRespostaAoContato(db, "dona-1", 42, "instagram_handle", "@empresa", 1000);

    const update = sqlDe("update `private_contacts`");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("`instagram` = ?");
  });

  it("tipo sem destino lança em vez de fingir sucesso", async () => {
    respostas = [[[42]]];
    await expect(aplicarRespostaAoContato(db, "dona-1", 42, "tipo_invenido", "x", 1000))
      .rejects.toThrow(/sem destino/);
  });

  it("contato apagado: nada é gravado — resposta confirmada não recria órfão", async () => {
    respostas = [[]]; // o select do contato não encontra ninguém
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "Fábrica", 1000)).toBe(false);
    expect(consultas.some(c => c.sql.startsWith("insert") || c.sql.startsWith("update"))).toBe(false);
  });

  it("valor vazio não grava nada e diz que não gravou", async () => {
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "   ", 1000)).toBe(false);
    expect(consultas).toHaveLength(0);
  });
});
