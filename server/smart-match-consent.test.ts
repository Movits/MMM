import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

// hasValidConsent faz duas consultas em sequência: primeiro o documento
// vigente, depois o consentimento ativo. A fila devolve uma resposta por
// consulta, na ordem — não é preciso identificar a tabela.
let respostas: unknown[][] = [];

const dbFalso = {
  select: vi.fn(() => dbFalso),
  from: vi.fn(() => dbFalso),
  where: vi.fn(() => dbFalso),
  limit: vi.fn(async () => respostas.shift() ?? []),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbFalso),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

const { hasValidConsent } = await import("./routers/consent");
const { getDb } = await import("./db");

const TERMO = [{ id: "doc-1", type: "termo_smart_match", version: 1 }];

describe("Etapa 11 — autorização do Smart Match", () => {
  beforeEach(() => {
    respostas = [];
    vi.mocked(getDb).mockResolvedValue(dbFalso as never);
  });

  it("libera o cruzamento quando ainda não existe termo publicado", async () => {
    // Enquanto o texto jurídico não fica pronto, exigir aceite desligaria o
    // recurso de todo mundo. Sem documento vigente, não há o que consentir.
    respostas = [[]];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(true);
  });

  it("recusa o cruzamento quando há termo vigente e nenhum aceite", async () => {
    respostas = [TERMO, []];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(false);
  });

  it("libera o cruzamento com aceite ativo na versão vigente", async () => {
    respostas = [TERMO, [{ id: 10 }]];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(true);
  });

  it("recusa depois de revogado, porque a consulta filtra revokedAt nulo", async () => {
    // Revogar não apaga a linha: ela some desta consulta por causa do filtro,
    // e é isso que dá efeito imediato, sem rotina de limpeza.
    respostas = [TERMO, []];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(false);
  });

  it("recusa quando o banco cai no meio, em vez de liberar por engano", async () => {
    respostas = [TERMO];
    vi.mocked(getDb)
      .mockResolvedValueOnce(dbFalso as never)
      .mockResolvedValueOnce(null as never);

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(false);
  });
});
