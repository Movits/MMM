import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Etapa 8 — a confidencial não vaza pelo TERCEIRO caminho de consulta: o
 * favorito. `toggleSave` gravava em saved_opportunities sem buscar a
 * oportunidade, e `saved` devolvia a linha inteira do JOIN sem olhar
 * status nem isConfidential; uma Prata que enumerasse ids lia título e
 * descrição da confidencial na aba "Salvas", com `get` fechado.
 *
 * A revisão adversarial achou mais dois buracos na régua:
 * - as réguas de GRAVAR e de LISTAR divergiam (a dona salvava a própria
 *   pendente, a aba não a mostrava, e o clique seguinte apagava);
 * - DESFAZER passava pela régua de leitura, e a linha antiga (gravada antes
 *   da guarda, ou de uma Ouro rebaixada) ficava órfã com FORBIDDEN.
 *
 * Provas executadas, não lidas no fonte: rota real via createCaller; as três
 * funções do favorito em db.ts são REAIS, sobre um drizzle de verdade com um
 * mysql2 falso que captura o SQL (molde de enriquecimento-aplicacao.test.ts).
 * O filtro está no SQL, não na tela — e os WHERE são conferidos inteiros, com
 * a conjunção (um `and` trocado por `or` não passa por `toContain`).
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** Já existe a linha em saved_opportunities para (usuária, oportunidade)? */
  jaSalva: false,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      // O dublê responde pelo CONTEÚDO da consulta: o DELETE diz quantas
      // linhas apagou (é o que decide "desfazer" × "gravar"); o INSERT
      // confirma; qualquer SELECT volta vazio.
      if (config.sql.startsWith("delete")) return [{ affectedRows: estado.jaSalva ? 1 : 0 }, []];
      if (config.sql.startsWith("insert")) return [{ affectedRows: 1, insertId: 1 }, []];
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const getOpportunityById = vi.fn();

// O router importa dezenas de nomes de ../db; o Proxy entrega um stub para
// qualquer um, observa a busca da oportunidade e deixa REAIS as três funções
// do favorito — é o SQL delas que a prova examina.
const FUNCOES_REAIS_DO_FAVORITO = new Set(["desfazerOportunidadeSalva", "salvarOportunidade", "getSavedOpportunities"]);
vi.mock("./db", async () => {
  const real = await vi.importActual<typeof import("./db")>("./db");
  const { BancoIndisponivel } = await import("./banco-indisponivel");
  return new Proxy({}, {
    has: () => true,
    get: (_alvo, prop) => {
      if (prop === "getOpportunityById") return (...args: unknown[]) => getOpportunityById(...(args as []));
      if (typeof prop === "string" && FUNCOES_REAIS_DO_FAVORITO.has(prop)) return real[prop as keyof typeof real];
      if (prop === "getDb") return async () => null;
      if (prop === "exigirDb") return async () => { throw new BancoIndisponivel(); };
      if (prop === "then" || prop === Symbol.toStringTag) return undefined;
      return async () => undefined;
    },
  });
});
vi.mock("./security", () => ({ createAuditLog: async () => {} }));

const { opportunitiesRouter } = await import("./routers/opportunities");

const ctxComUser = (id: number, role: string) => ({
  user: { id, openId: `u-${id}`, email: "t@local", role },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const confidencialAtiva = { id: 99, publishedBy: 42, isConfidential: true, status: "active", viewCount: 0 };

const gravacoes = () => estado.consultas.filter(c => c.sql.startsWith("insert into `saved_opportunities`"));
const remocoes = () => estado.consultas.filter(c => c.sql.startsWith("delete from `saved_opportunities`"));

beforeEach(() => {
  getOpportunityById.mockReset();
  estado.consultas = [];
  estado.jaSalva = false;
});

describe("Etapa 8 — toggleSave só GRAVA o que passa pela régua de get", () => {
  it("Prata salvando uma confidencial leva FORBIDDEN — e nada é gravado", async () => {
    getOpportunityById.mockResolvedValue(confidencialAtiva);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("Ouro salva a confidencial: o INSERT sai com a usuária e a oportunidade", async () => {
    getOpportunityById.mockResolvedValue(confidencialAtiva);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await expect(rota.toggleSave({ opportunityId: 99 })).resolves.toEqual({ saved: true });
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0].params).toEqual([7, 99]);
  });

  it("a própria criadora, mesmo Prata, salva a sua confidencial", async () => {
    getOpportunityById.mockResolvedValue(confidencialAtiva);
    const rota = opportunitiesRouter.createCaller(ctxComUser(42, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).resolves.toEqual({ saved: true });
    expect(gravacoes()).toHaveLength(1);
  });

  it("rejeitada é NOT_FOUND para quem não é dona nem staff", async () => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status: "rejected" });
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("pendente de terceira é FORBIDDEN para quem não é dona nem staff", async () => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status: "pending" });
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("oportunidade inexistente é NOT_FOUND, não um favorito fantasma", async () => {
    getOpportunityById.mockResolvedValue(undefined);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await expect(rota.toggleSave({ opportunityId: 12345 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("contraste: a porta da frente (get) continua fechada para a Prata", async () => {
    getOpportunityById.mockResolvedValue(confidencialAtiva);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.get({ id: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Etapa 8 — gravar e listar seguem o MESMO predicado de status", () => {
  it("a dona Prata salva a própria pendente — e a aba Salvas a lista (status ativo OU pendente dela)", async () => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status: "pending", publishedBy: 42 });
    const rota = opportunitiesRouter.createCaller(ctxComUser(42, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).resolves.toEqual({ saved: true });
    expect(gravacoes()[0].params).toEqual([42, 99]);

    // Mutante "saved só lista active": o WHERE abaixo não teria o ramo da
    // pendente publicada por ela, e o favorito recém-gravado nasceria invisível.
    estado.consultas = [];
    await rota.saved();
    const { where, params } = whereDasSalvas();
    expect(where).toMatch(/^ where \(`saved_opportunities`\.`userId` = \? and \(`opportunities`\.`status` = \? or \(`opportunities`\.`status` = \? and `opportunities`\.`publishedBy` = \?\)\) and \(`opportunities`\.`isConfidential` = \? or `opportunities`\.`publishedBy` = \?\)\) order by /);
    expect(params).toEqual([42, "active", "pending", 42, false, 42]);
  });

  it.each(["closed", "draft", "removed"])("%s não pode ser salva: BAD_REQUEST e nada gravado (a aba nunca a mostraria)", async (status) => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status });
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("a própria dona não salva a sua rejeitada (ela pode ler, mas a aba não lista)", async () => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status: "rejected", publishedBy: 42 });
    const rota = opportunitiesRouter.createCaller(ctxComUser(42, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(gravacoes()).toHaveLength(0);
  });

  it("staff lê a pendente de terceira, mas não a salva: as salvas só listam a pendente da própria dona", async () => {
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false, status: "pending", publishedBy: 42 });
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "president"));
    await expect(rota.toggleSave({ opportunityId: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(gravacoes()).toHaveLength(0);
  });
});

describe("Etapa 8 — desfazer NÃO passa pela régua: a linha antiga sai sempre", () => {
  it("Prata com uma confidencial já salva (linha antiga, ou Ouro rebaixada) desfaz sem FORBIDDEN", async () => {
    estado.jaSalva = true;
    getOpportunityById.mockResolvedValue(confidencialAtiva);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).resolves.toEqual({ saved: false });

    // O DELETE leva a usuária no WHERE (a linha de outra não sai) e nada é gravado.
    expect(remocoes()).toHaveLength(1);
    expect(remocoes()[0].sql).toBe("delete from `saved_opportunities` where (`saved_opportunities`.`userId` = ? and `saved_opportunities`.`opportunityId` = ?)");
    expect(remocoes()[0].params).toEqual([7, 99]);
    expect(gravacoes()).toHaveLength(0);
    // A régua nem é consultada: desfazer não depende de poder ler.
    expect(getOpportunityById).not.toHaveBeenCalled();
  });

  it("até uma linha órfã (oportunidade que não existe mais) pode ser desfeita", async () => {
    estado.jaSalva = true;
    getOpportunityById.mockResolvedValue(undefined);
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.toggleSave({ opportunityId: 12345 })).resolves.toEqual({ saved: false });
    expect(remocoes()[0].params).toEqual([7, 12345]);
  });

  it("sem linha antiga, o DELETE apaga zero e a régua decide a gravação", async () => {
    estado.jaSalva = false;
    getOpportunityById.mockResolvedValue({ ...confidencialAtiva, isConfidential: false });
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.toggleSave({ opportunityId: 99 })).resolves.toEqual({ saved: true });
    expect(remocoes()).toHaveLength(1);
    expect(gravacoes()).toHaveLength(1);
    expect(getOpportunityById).toHaveBeenCalledWith(99);
  });
});

// A projeção seleciona TODAS as colunas (isConfidential inclusive); o que
// importa é o WHERE, então só ele é examinado — mas INTEIRO, do " where " ao
// " order by ", para a conjunção ficar fixada.
const whereDasSalvas = () => {
  const consulta = estado.consultas.find(c => c.sql.startsWith("select") && c.sql.includes("from `saved_opportunities`"));
  expect(consulta).toBeDefined();
  const inicio = consulta!.sql.indexOf(" where ");
  expect(inicio).toBeGreaterThan(0);
  return { where: consulta!.sql.slice(inicio), params: consulta!.params };
};

describe("Etapa 8 — as salvas são filtradas NO BANCO", () => {
  const WHERE_PRATA = /^ where \(`saved_opportunities`\.`userId` = \? and \(`opportunities`\.`status` = \? or \(`opportunities`\.`status` = \? and `opportunities`\.`publishedBy` = \?\)\) and \(`opportunities`\.`isConfidential` = \? or `opportunities`\.`publishedBy` = \?\)\) order by `saved_opportunities`\.`createdAt` desc$/;
  const WHERE_OURO = /^ where \(`saved_opportunities`\.`userId` = \? and \(`opportunities`\.`status` = \? or \(`opportunities`\.`status` = \? and `opportunities`\.`publishedBy` = \?\)\)\) order by `saved_opportunities`\.`createdAt` desc$/;

  it("para a Prata o WHERE é: dela E (ativa OU pendente dela) E (não confidencial OU publicada por ela)", async () => {
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "silver"));
    await expect(rota.saved()).resolves.toEqual([]);

    const { where, params } = whereDasSalvas();
    expect(where).toMatch(WHERE_PRATA);
    expect(params).toEqual([7, "active", "pending", 7, false, 7]);
  });

  it("para Ouro o WHERE não filtra confidencialidade, mas continua exigindo o status das listas", async () => {
    const rota = opportunitiesRouter.createCaller(ctxComUser(7, "gold"));
    await rota.saved();

    const { where, params } = whereDasSalvas();
    expect(where).toMatch(WHERE_OURO);
    expect(where).not.toContain("`isConfidential`");
    expect(params).toEqual([7, "active", "pending", 7]);
  });

  it("admin e president valem como Ouro", async () => {
    for (const papel of ["admin", "president"]) {
      estado.consultas = [];
      await opportunitiesRouter.createCaller(ctxComUser(7, papel)).saved();
      expect(whereDasSalvas().where).toMatch(WHERE_OURO);
    }
  });
});
