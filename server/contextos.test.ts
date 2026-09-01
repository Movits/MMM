import { describe, expect, it, beforeEach, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Contextos (etapa 5) — o que as listagens devolvem e o que o vínculo garante.
 *
 * O defeito que motivou estes testes passou despercebido por não ter teste
 * nenhum no módulo: listContexts buscava o slug do tipo no JOIN e o descartava
 * no retorno. A tela ficava sem os ícones e — pior — o formulário de edição
 * abria com o tipo vazio, então salvar qualquer edição apagava o tipo do
 * contexto em silêncio.
 *
 * Mesmo padrão dos testes do enriquecimento: drizzle de verdade sobre um
 * cliente mysql2 falso que captura o SQL. Como estas funções obtêm a conexão
 * por getDb(), o falso entra pelo mock de drizzle-orm/mysql2: a URL de banco
 * vira o cliente falso, e quem já passa um cliente segue intocado.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  respostas: [] as unknown[][],
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      return [estado.respostas.shift() ?? [], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { listContexts, listContextsByContact, linkContactToContext, getContextById } = await import("./db");

const sqlDe = (trecho: string) => estado.consultas.find(c => c.sql.includes(trecho));

// Linha de `contexts` na ordem das colunas do schema (13 colunas).
const linhaContexto = (id: string, nome: string, dono: string | null = "dona-1", tipoId: string | null = "tipo-1") =>
  [id, dono, tipoId, nome, null, "2024-10-01", "Milão", "Itália", null, 1, "private", 1000, 1000];

// Linha de `contact_contexts` na ordem das colunas do schema (12 colunas).
const linhaVinculo = (id: string, contatoId: number, contextoId: string) =>
  [id, "dona-1", contatoId, contextoId, null, "Milão", null, null, "profissional", "private", 1000, 1000];

describe("Contextos — listagens dizem tudo o que a tela precisa", () => {
  beforeEach(() => { estado.consultas = []; estado.respostas = []; });

  it("listContexts devolve o slug do tipo — é ele que dá o ícone e preenche a edição", async () => {
    estado.respostas = [
      [[...linhaContexto("ctx-1", "CPHI 2024"), "CPHI", "#6366F1", "cphi"]], // contextos + tipo
      [[3]], // contagem de contatos do ctx-1
      [[1]], // total
    ];
    const r = await listContexts("dona-1", {});

    expect(r.total).toBe(1);
    expect(r.data[0].name).toBe("CPHI 2024");
    expect(r.data[0].typeName).toBe("CPHI");
    expect(r.data[0].typeSlug).toBe("cphi"); // o campo que era descartado
    expect(r.data[0].contactCount).toBe(3);
  });

  it("listContextsByContact devolve os contextos de um contato, com nome e tipo", async () => {
    estado.respostas = [
      [[...linhaVinculo("vinc-1", 42, "ctx-1"), "CPHI 2024", "CPHI", "#6366F1", "cphi"]],
    ];
    const r = await listContextsByContact("dona-1", 42);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      linkId: "vinc-1", contextId: "ctx-1", name: "CPHI 2024",
      city: "Milão", relationshipType: "profissional", typeSlug: "cphi",
    });
    const busca = sqlDe("from `contact_contexts`");
    expect(busca).toBeDefined();
    expect(busca!.params).toEqual(expect.arrayContaining(["dona-1", 42]));
  });

  it("getContextById traz o NOME de cada contato vinculado, não só o número", async () => {
    estado.respostas = [
      [[...linhaContexto("ctx-1", "CPHI 2024"), "CPHI", "#6366F1", "cphi", "flask-conical"]], // contexto + tipo
      [linhaVinculo("vinc-1", 42, "ctx-1")], // vínculos
      [[42, "Ana Souza"]],                   // nomes dos vinculados
      [],                                    // participantes
      [],                                    // mídia
    ];
    const r = await getContextById("dona-1", "ctx-1");

    expect(r).not.toBeNull();
    expect(r!.links[0].contactName).toBe("Ana Souza");
    expect(r!.links[0].contactId).toBe(42);
  });

  it("vincular o mesmo contato duas vezes devolve o vínculo existente, sem duplicar", async () => {
    estado.respostas = [[["vinc-1"]]]; // já existe
    const id = await linkContactToContext("dona-1", { contactId: 42, contextId: "ctx-1" });

    expect(id).toBe("vinc-1");
    expect(estado.consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
  });

  it("re-vincular com dados novos atualiza o encontro existente em vez de descartá-los", async () => {
    estado.respostas = [[["vinc-1"]], []]; // já existe; update
    const id = await linkContactToContext("dona-1", {
      contactId: 42, contextId: "ctx-1", notes: "sentamos na mesma mesa", city: "Lisboa",
    });

    expect(id).toBe("vinc-1");
    const update = sqlDe("update `contact_contexts`");
    expect(update).toBeDefined();
    expect(update!.params).toEqual(expect.arrayContaining(["sentamos na mesma mesa", "Lisboa"]));
    expect(estado.consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
  });

  it("vínculo novo é criado com dono, contato e contexto certos", async () => {
    estado.respostas = [[], []]; // não existe; insert
    const id = await linkContactToContext("dona-1", { contactId: 42, contextId: "ctx-1" });

    expect(id).not.toBe("vinc-1");
    const insert = sqlDe("insert into `contact_contexts`");
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(expect.arrayContaining(["dona-1", 42, "ctx-1"]));
  });
});
