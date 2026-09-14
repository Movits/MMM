/**
 * Os quatro defeitos do alerta de segurança, achados em 12/09/2026 na auditoria
 * da faxina do banco de produção.
 *
 * O sintoma: 851 eventos de segurança não resolvidos, gerados por 26 contas de
 * TESTE em treze dias — 678 deles do tipo "multiple_sessions", todos dizendo o
 * mesmo "10 sessões simultâneas detectadas".
 *
 * As quatro causas, cada uma com um teste aqui:
 *
 * A) A contagem de sessões incluía sessão VENCIDA. O filtro pedia `isActive`
 *    e atividade nas últimas 24 h, e não pedia validade. Como
 *    `cleanupExpiredSessions` só roda quando alguém abre o painel, havia 80
 *    sessões vencidas ainda marcadas como ativas no Aiven.
 * B) O número relatado era SEMPRE 10, porque vinha do `.length` de uma consulta
 *    com `.limit(10)` — e por isso o ramo "crítico a partir de 20" era
 *    inalcançável por construção.
 * C) Não havia dedupe: a mesma condição virava linha nova a cada requisição.
 * D) O bloqueio automático era reavaliado em TODA requisição autenticada, num
 *    SELECT que entre dois eventos críticos só podia devolver o mesmo de antes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";

type Linha = Record<string, unknown>;

const estado = {
  sessoes: [] as Linha[],
  totalDeSessoes: 0,
  jaExisteEventoIgual: false,
  inseridos: [] as { tabela: string; valores: Linha }[],
  consultas: [] as string[],
  condicaoDasSessoes: null as unknown,
};

/** Nomes de coluna citados numa condição do Drizzle, em qualquer profundidade. */
function colunasCitadas(no: unknown, achadas = new Set<string>()): Set<string> {
  if (!no || typeof no !== "object") return achadas;
  const obj = no as Record<string, unknown>;
  if (typeof obj.name === "string" && obj.table) achadas.add(obj.name);
  const pedacos = (obj.queryChunks ?? obj.chunks) as unknown[] | undefined;
  if (Array.isArray(pedacos)) for (const p of pedacos) colunasCitadas(p, achadas);
  return achadas;
}

vi.mock("./db", () => ({
  exigirDb: async () => ({
    select: (campos?: Record<string, unknown>) => ({
      from: (tabela: unknown) => {
        const nome = getTableName(tabela as never);
        const ehContagem = !!campos && "n" in campos;
        return {
          where: (condicao: unknown) => {
            estado.consultas.push(`${nome}:${ehContagem ? "contagem" : "linhas"}`);
            if (nome === "sessions" && !ehContagem) estado.condicaoDasSessoes = condicao;
            const resolver = (r: (linhas: Linha[]) => unknown) => {
              if (ehContagem) return r([{ n: estado.totalDeSessoes }]);
              if (nome === "security_events") return r(estado.jaExisteEventoIgual ? [{ id: 1 }] : []);
              return r([]);
            };
            return {
              orderBy: () => ({ limit: async (n: number) => estado.sessoes.slice(0, n) }),
              limit: async () => (nome === "security_events" && estado.jaExisteEventoIgual ? [{ id: 1 }] : []),
              then: resolver,
            };
          },
        };
      },
    }),
    insert: (tabela: unknown) => ({
      values: async (valores: Linha) => {
        estado.inseridos.push({ tabela: getTableName(tabela as never), valores });
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

const { detectSessionAnomaly, createSecurityEvent } = await import("./security");

const IP = "200.100.50.1";

function sessao(i: number): Linha {
  return {
    id: i,
    userId: 1,
    ipAddress: IP,
    deviceFingerprint: "impressao-" + i,
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    isActive: true,
  };
}

function eventosGravados() {
  return estado.inseridos.filter(l => l.tabela === "security_events").map(l => l.valores);
}

beforeEach(() => {
  estado.sessoes = [];
  estado.totalDeSessoes = 0;
  estado.jaExisteEventoIgual = false;
  estado.inseridos = [];
  estado.consultas = [];
  estado.condicaoDasSessoes = null;
});

// ═══ A) sessão vencida não pode contar ═══════════════════════════════════════
describe("A) a busca de sessões simultâneas exige sessão NÃO VENCIDA", () => {
  it("a condição cita expiresAt, e não só isActive", async () => {
    estado.sessoes = [sessao(1)];
    await detectSessionAnomaly(1, IP, "navegador-de-teste");

    const colunas = colunasCitadas(estado.condicaoDasSessoes);
    expect(colunas.has("isActive"), "o filtro perdeu o isActive").toBe(true);
    expect(
      colunas.has("expiresAt"),
      "sem expiresAt no filtro, sessão vencida volta a contar como simultânea — foi o que encheu 678 alertas",
    ).toBe(true);
  });
});

// ═══ B) o número tem de ser o real, não o tamanho da amostra ═════════════════
describe("B) o número de sessões é contado, não é o tamanho da amostra", () => {
  it("com a amostra cheia, grava a contagem de verdade e chega a crítico", async () => {
    estado.sessoes = Array.from({ length: 10 }, (_, i) => sessao(i + 1));
    estado.totalDeSessoes = 37;

    await detectSessionAnomaly(1, IP, "navegador-de-teste");

    const eventos = eventosGravados();
    expect(eventos).toHaveLength(1);
    const detalhes = eventos[0].details as Record<string, unknown>;
    expect(detalhes.activeSessions, "gravou o tamanho da amostra em vez da contagem").toBe(37);
    expect(
      eventos[0].severity,
      "37 sessões tem de ser crítico; antes o ramo crítico era inalcançável porque o número era sempre 10",
    ).toBe("critical");
    expect(estado.consultas).toContain("sessions:contagem");
  });

  it("abaixo do limite não alerta, e não gasta a consulta de contagem", async () => {
    estado.sessoes = Array.from({ length: 3 }, (_, i) => sessao(i + 1));

    await detectSessionAnomaly(1, IP, "navegador-de-teste");

    expect(eventosGravados()).toHaveLength(0);
    expect(
      estado.consultas.filter(c => c === "sessions:contagem"),
      "a contagem só pode ser pedida quando a amostra enche: é uma consulta por requisição de cada usuária",
    ).toHaveLength(0);
  });
});

// ═══ C) alerta repetido não vira linha nova ══════════════════════════════════
describe("C) o mesmo alerta não se repete dentro da janela", () => {
  it("com alerta igual recente, nada é gravado", async () => {
    estado.sessoes = Array.from({ length: 10 }, (_, i) => sessao(i + 1));
    estado.totalDeSessoes = 12;
    estado.jaExisteEventoIgual = true;

    await detectSessionAnomaly(1, IP, "navegador-de-teste");

    expect(
      eventosGravados(),
      "sem dedupe, 26 contas de teste geraram 851 eventos em treze dias",
    ).toHaveLength(0);
  });

  it("sem alerta igual recente, grava", async () => {
    estado.sessoes = Array.from({ length: 10 }, (_, i) => sessao(i + 1));
    estado.totalDeSessoes = 12;
    estado.jaExisteEventoIgual = false;

    await detectSessionAnomaly(1, IP, "navegador-de-teste");

    expect(eventosGravados()).toHaveLength(1);
  });

  it("evento crítico de força bruta NÃO é dedupado: cada tentativa continua registrada", async () => {
    estado.jaExisteEventoIgual = true;
    await createSecurityEvent(1, "brute_force_attempt", "critical", IP, { tentativas: 9 });
    expect(eventosGravados()).toHaveLength(1);
  });
});

// ═══ D) o bloqueio automático é avaliado quando nasce um crítico ═════════════
describe("D) o bloqueio automático sai do caminho de toda requisição", () => {
  it("evento crítico dispara a checagem do limite", async () => {
    await createSecurityEvent(1, "brute_force_attempt", "critical", IP, {});
    expect(estado.consultas).toContain("security_events:linhas");
  });

  it("evento de aviso não dispara a checagem", async () => {
    estado.consultas = [];
    await createSecurityEvent(1, "suspicious_ip", "warning", IP, {});
    expect(
      estado.consultas.filter(c => c === "security_events:linhas"),
      "aviso não muda a contagem de críticos, então não pode custar uma consulta",
    ).toHaveLength(0);
  });

  it("o próprio bloqueio não se realimenta", async () => {
    estado.consultas = [];
    await createSecurityEvent(1, "account_locked", "critical", IP, {});
    expect(
      estado.consultas.filter(c => c === "security_events:linhas"),
      "account_locked é gravado pela própria função de bloqueio: relançar a checagem seria recursão",
    ).toHaveLength(0);
  });

  it("o caminho de autenticação não importa mais a checagem", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("./_core/sdk.ts", import.meta.url), "utf8");
    expect(
      fonte.includes("checkAutoLockThreshold"),
      "voltou a ser chamada em getUserFromRequest: é um SELECT por requisição autenticada",
    ).toBe(false);
  });
});
