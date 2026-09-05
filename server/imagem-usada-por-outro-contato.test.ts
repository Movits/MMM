import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * imagemUsadaPorOutroContato (etapas 1/8): antes de apagar uma foto ou cartão
 * do bucket, o router da Rede pergunta se OUTRO contato da MESMA dona ainda
 * aponta para a mesma chave. Os testes do router (etapa8-niveis.test.ts) usam
 * um dublê desta função; aqui é a CONSULTA que se prova, porque cada pedaço
 * do WHERE segura um defeito diferente:
 *
 * - sem `ownerId`, a pergunta atravessaria as redes de todas as usuárias
 *   (privacidade é regra de consulta, não de tela);
 * - só `photoUrl`, um cartão compartilhado seria apagado do bucket;
 * - sem `id <> ?`, o próprio contato que está soltando a imagem contaria como
 *   "outro", e nada sairia do bucket nunca.
 *
 * Mesmo padrão de contextos.test.ts: drizzle de verdade sobre um cliente
 * mysql2 falso que captura o SQL e os parâmetros.
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

const { imagemUsadaPorOutroContato } = await import("./db");

const CAMINHO = "/manus-storage/contacts/dona-1/foto_ana.jpg";

describe("imagemUsadaPorOutroContato — a consulta pergunta pela rede DESTA dona, pelas DUAS colunas, fora do próprio contato", () => {
  beforeEach(() => { estado.consultas = []; estado.respostas = []; });

  it("o WHERE inteiro: ownerId, (photoUrl ou cardImageUrl) e id diferente, com os parâmetros na ordem", async () => {
    estado.respostas = [[]];
    await imagemUsadaPorOutroContato("dona-1", CAMINHO, 8);

    expect(estado.consultas).toHaveLength(1);
    const [consulta] = estado.consultas;
    expect(consulta.sql).toContain("from `private_contacts`");
    // As três condições juntas, com `and` entre elas — um `or` no lugar de
    // qualquer `and` devolveria contatos de outra dona ou o próprio contato.
    expect(consulta.sql).toContain(
      "`private_contacts`.`ownerId` = ? and (`private_contacts`.`photoUrl` = ? or `private_contacts`.`cardImageUrl` = ?) and `private_contacts`.`id` <> ?",
    );
    // O caminho entra duas vezes (foto e cartão); o último parâmetro é o limit 1.
    expect(consulta.params).toEqual(["dona-1", CAMINHO, CAMINHO, 8, 1]);
  });

  it("nenhuma linha ⇒ false: o objeto pode sair do bucket", async () => {
    estado.respostas = [[]];
    await expect(imagemUsadaPorOutroContato("dona-1", CAMINHO, 8)).resolves.toBe(false);
  });

  it("uma linha ⇒ true: outro contato ainda usa a imagem, o objeto fica", async () => {
    estado.respostas = [[[9]]];
    await expect(imagemUsadaPorOutroContato("dona-1", CAMINHO, 8)).resolves.toBe(true);
  });
});
