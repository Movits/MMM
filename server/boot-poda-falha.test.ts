import { afterAll, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * A poda dos prazos das gravações roda no boot, com await e antes do listen
 * (server/_core/index.ts). O bloco promete que qualquer erro dela é log e não
 * aborta a subida: um Lock wait timeout ou a conexão caindo bem na hora do
 * deploy não pode deixar o site fora do ar — servidor de pé com o prazo velho
 * por 5 min é melhor do que servidor fora, e a passada seguinte poda de novo.
 *
 * Arquivo próprio, com a mesma jarra de agendados-autenticacao.test.ts: a
 * jarra importa o index.ts uma vez por arquivo, e lá a poda do boot resolve.
 * Aqui ela REJEITA, e o que se assevera é o que o boot faz depois: o
 * apagamento é disparado, o servidor sobe e o erro vai para o log.
 */

const jarra = vi.hoisted(() => {
  let servidorNoAr: () => void = () => {};
  const noAr = new Promise<void>(resolve => { servidorNoAr = resolve; });
  const passa = (_req: unknown, _res: unknown, next?: () => void) => next?.();
  const app = { set: () => app, use: () => app, get: () => app, post: () => app };
  return { noAr, servidorNoAr: () => servidorNoAr(), passa, app };
});

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => { throw new Error("sem sessão"); } } }));
vi.mock("express", () => {
  const fabrica = Object.assign(() => jarra.app, { json: () => jarra.passa, urlencoded: () => jarra.passa, static: () => jarra.passa });
  return { default: fabrica, ...fabrica };
});
vi.mock("http", () => {
  const createServer = () => ({ listen: (_porta: number, aoSubir?: () => void) => { aoSubir?.(); jarra.servidorNoAr(); } });
  return { default: { createServer }, createServer };
});
vi.mock("net", () => {
  const createServer = () => ({ listen: (_porta: number, aoSubir?: () => void) => aoSubir?.(), close: (aoFechar?: () => void) => aoFechar?.(), on: () => {} });
  return { default: { createServer }, createServer };
});
vi.mock("@trpc/server/adapters/express", () => ({ createExpressMiddleware: () => jarra.passa }));
vi.mock("./_core/storageProxy", () => ({ registerStorageProxy: () => {} }));
vi.mock("./routers", () => ({ appRouter: {} }));
vi.mock("./_core/context", () => ({ createContext: () => ({}) }));
vi.mock("./_core/vite", () => ({ serveStatic: () => {}, setupVite: async () => {} }));
vi.mock("./security", () => ({ cleanupExpiredSessions: async () => 0, createAuditLog: async () => {} }));

const limparGravacoesVencidas = vi.fn(async (_chavesDaPoda?: readonly string[]) => ({ encontradas: 0, apagadas: 0, prazosAjustados: 0 }));
const ajustarPrazosDasGravacoes = vi.fn(async () => ({ prazosAjustados: 0, vencidasNaPoda: [] as string[] }));
const marcarReunioesInterrompidas = vi.fn(async () => ({ encontradas: 0, marcadas: 0 }));
const ordem: string[] = [];
vi.mock("./meeting-service", () => ({
  limparGravacoesVencidas: (...args: unknown[]) => { ordem.push("limpeza"); return limparGravacoesVencidas(...(args as [])); },
  ajustarPrazosDasGravacoes: (...args: unknown[]) => { ordem.push("poda"); return ajustarPrazosDasGravacoes(...(args as [])); },
  marcarReunioesInterrompidas: (...args: unknown[]) => { ordem.push("presas"); return marcarReunioesInterrompidas(...(args as [])); },
}));

const databaseUrlAntes = process.env.DATABASE_URL;
const storageBucketAntes = process.env.STORAGE_BUCKET;
process.env.DATABASE_URL = "mysql://jarra";
process.env.STORAGE_BUCKET = "bucket-da-jarra";
ajustarPrazosDasGravacoes.mockRejectedValueOnce(new Error("banco fora na poda"));
vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
// Só coleta: na outra jarra o console.error derruba a subida, e aqui ele é
// justamente o que se espera.
const erros: unknown[][] = [];
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { erros.push(args); });
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});
const aoSubir = jarra.noAr.then(() => { ordem.push("listen"); });
await import("./_core/index");
// Se a subida abortasse, o listen não viria nunca: o prazo é do teste, não da jarra.
await Promise.race([aoSubir, new Promise(resolver => setTimeout(resolver, 1500))]);
const ordemDoBoot = [...ordem];
const errosDoBoot = JSON.stringify(erros);
const limpezasDoBoot = limparGravacoesVencidas.mock.calls.map(chamada => [...chamada]);
vi.restoreAllMocks();

afterAll(() => {
  vi.useRealTimers();
  if (databaseUrlAntes === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrlAntes;
  if (storageBucketAntes === undefined) delete process.env.STORAGE_BUCKET;
  else process.env.STORAGE_BUCKET = storageBucketAntes;
});

describe("boot com a poda dos prazos falhando", () => {
  it("o servidor sobe mesmo assim: presas, poda, apagamento disparado e listen, nessa ordem", () => {
    expect(ordemDoBoot).toEqual(["presas", "poda", "limpeza", "listen"]);
  });

  it("o erro da poda vai para o log, com a mensagem", () => {
    expect(errosDoBoot).toContain("Não foi possível ajustar os prazos das gravações de reunião");
    expect(errosDoBoot).toContain("banco fora na poda");
  });

  it("sem poda, a passada do boot vai sem chaves — e a poda de dentro dela tenta de novo", () => {
    expect(limpezasDoBoot).toEqual([[[]]]);
  });
});
