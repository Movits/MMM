import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@shared/_core/errors";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Endpoints de cron (/api/scheduled/*) — a resposta a quem chega sem sessão.
 *
 * Revisão adversarial da PR de Reuniões: `sdk.authenticateRequest` lança
 * quando não há cookie válido, e os três endpoints o chamavam dentro do try
 * genérico — uma chamada anônima respondia 500 "Invalid session cookie", que
 * um agendador externo leria como "o servidor quebrou". Agora a autenticação
 * é um passo próprio (server/_core/cron.ts): sem sessão é 401, sessão de
 * usuária comum é 403, e o try do endpoint só cobre o trabalho em si.
 *
 * Os handlers vivem inline em startServer, e index.ts chama startServer ao
 * carregar. Em vez de ler o código-fonte (o que provaria o texto, não o
 * comportamento — um `if (!user)` sem `return` continuaria "contendo" a
 * guarda), o index.ts REAL sobe aqui numa jarra: o express é um dublê que só
 * guarda as rotas registradas, http/net não abrem porta, e tudo que toca
 * banco, bucket ou rede está mockado. Cada handler é então chamado com
 * req/res falsos, e o que se assevera é o que ele FAZ: o trabalho não roda
 * sem sessão de cron, roda uma vez com ela, e a resposta/auditoria batem.
 */

const jarra = vi.hoisted(() => {
  type Handler = (req: unknown, res: unknown) => Promise<unknown>;
  const rotas = new Map<string, Handler>();
  let servidorNoAr: () => void = () => {};
  let subidaFalhou: (erro: unknown) => void = () => {};
  const noAr = new Promise<void>((resolve, reject) => { servidorNoAr = resolve; subidaFalhou = reject; });
  const passa = (_req: unknown, _res: unknown, next?: () => void) => next?.();
  const app = {
    set: () => app,
    use: () => app,
    get: () => app,
    post: (caminho: string, handler: Handler) => { rotas.set(caminho, handler); return app; },
  };
  return { rotas, noAr, servidorNoAr: () => servidorNoAr(), subidaFalhou: (erro: unknown) => subidaFalhou(erro), passa, app };
});

const authenticateRequest = vi.fn();
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: (...args: unknown[]) => authenticateRequest(...args) } }));

// --- a jarra: o que startServer toca e não é o que está em teste ---
vi.mock("express", () => {
  const fabrica = Object.assign(() => jarra.app, { json: () => jarra.passa, urlencoded: () => jarra.passa, static: () => jarra.passa });
  return { default: fabrica, ...fabrica };
});
vi.mock("http", () => {
  const createServer = () => ({ listen: (_porta: number, aoSubir?: () => void) => { aoSubir?.(); jarra.servidorNoAr(); } });
  return { default: { createServer }, createServer };
});
vi.mock("net", () => {
  // findAvailablePort (fora de produção) sonda a porta com net.createServer:
  // aqui toda porta está "livre", sem tocar a máquina.
  const createServer = () => ({ listen: (_porta: number, aoSubir?: () => void) => aoSubir?.(), close: (aoFechar?: () => void) => aoFechar?.(), on: () => {} });
  return { default: { createServer }, createServer };
});
vi.mock("@trpc/server/adapters/express", () => ({ createExpressMiddleware: () => jarra.passa }));
vi.mock("./_core/storageProxy", () => ({ registerStorageProxy: () => {} }));
vi.mock("./routers", () => ({ appRouter: {} }));
vi.mock("./_core/context", () => ({ createContext: () => ({}) }));
vi.mock("./_core/vite", () => ({ serveStatic: () => {}, setupVite: async () => {} }));

const cleanupExpiredSessions = vi.fn(async () => 0);
const createAuditLog = vi.fn(async () => {});
vi.mock("./security", () => ({
  cleanupExpiredSessions: (...args: unknown[]) => cleanupExpiredSessions(...(args as [])),
  createAuditLog: (...args: unknown[]) => createAuditLog(...(args as [])),
}));
type ResultadoDaLimpeza = { encontradas: number; apagadas: number; prazosAjustados?: number };
type ResultadoDaPoda = { prazosAjustados: number; vencidasNaPoda: string[] };
const limparGravacoesVencidas = vi.fn(async (_chavesDaPoda?: readonly string[]): Promise<ResultadoDaLimpeza> => ({ encontradas: 0, apagadas: 0, prazosAjustados: 0 }));
const ajustarPrazosDasGravacoes = vi.fn(async (): Promise<ResultadoDaPoda> => ({ prazosAjustados: 0, vencidasNaPoda: [] }));
const marcarReunioesInterrompidas = vi.fn(async () => ({ encontradas: 0, marcadas: 0 }));
// A ordem do boot: cada trabalho e o listen se anotam aqui.
const ordem: string[] = [];
vi.mock("./meeting-service", () => ({
  limparGravacoesVencidas: (...args: unknown[]) => { ordem.push("limpeza"); return limparGravacoesVencidas(...(args as [])); },
  ajustarPrazosDasGravacoes: (...args: unknown[]) => { ordem.push("poda"); return ajustarPrazosDasGravacoes(...(args as [])); },
  marcarReunioesInterrompidas: (...args: unknown[]) => { ordem.push("presas"); return marcarReunioesInterrompidas(...(args as [])); },
}));

const { autenticarCron } = await import("./_core/cron");

// Com DATABASE_URL o boot varre as reuniões presas (contra o mock acima) e
// agenda a varredura periódica; o setInterval é falso para o teste avançar
// os 5 min sem esperar. NODE_ENV não é "production": nada de migração. Com
// STORAGE_BUCKET o boot também poda os prazos das gravações e dispara o
// apagamento — que fica PENDENTE aqui até o teste soltá-lo: se a subida o
// aguardasse, `jarra.noAr` nunca resolveria.
const databaseUrlAntes = process.env.DATABASE_URL;
const storageBucketAntes = process.env.STORAGE_BUCKET;
process.env.DATABASE_URL = "mysql://jarra";
process.env.STORAGE_BUCKET = "bucket-da-jarra";
let soltarLimpezaDoBoot: (resultado: ResultadoDaLimpeza) => void = () => {};
limparGravacoesVencidas.mockImplementationOnce(() => new Promise(resolver => { soltarLimpezaDoBoot = resolver; }));
// A poda do boot também fica PENDENTE até a jarra soltá-la: um dublê que
// resolvesse na hora não distinguiria "listen depois da poda" de "listen com a
// poda disparada e ainda rodando".
let soltarPodaDoBoot: (resultado: ResultadoDaPoda) => void = () => {};
ajustarPrazosDasGravacoes.mockImplementationOnce(() => new Promise(resolver => { soltarPodaDoBoot = resolver; }));
const CHAVE_VENCIDA_NA_PODA = "meetings/dona-1/reuniao-antiga/recording_abc12345.webm";
vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { jarra.subidaFalhou(args[0]); });
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
const aoSubir = jarra.noAr.then(() => { ordem.push("listen"); });
await import("./_core/index");
/** Uma volta real do relógio (o setTimeout não é falsificado aqui). */
const esperarDeVerdade = (ms: number) => new Promise(resolver => setTimeout(resolver, ms));
for (let volta = 0; volta < 200 && !ordem.includes("poda"); volta++) await esperarDeVerdade(5);
await esperarDeVerdade(50);
const ordemComAPodaPendente = [...ordem];
soltarPodaDoBoot({ prazosAjustados: 1, vencidasNaPoda: [CHAVE_VENCIDA_NA_PODA] });
await aoSubir;
const varredurasNoBoot = marcarReunioesInterrompidas.mock.calls.length;
const ajustesNoBoot = ajustarPrazosDasGravacoes.mock.calls.length;
const limpezasNoBoot = limparGravacoesVencidas.mock.calls.length;
const argumentosDaLimpezaNoBoot = limparGravacoesVencidas.mock.calls.map(chamada => [...chamada]);
const ordemDoBoot = [...ordem];
vi.restoreAllMocks();
afterAll(() => {
  vi.useRealTimers();
  if (databaseUrlAntes === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrlAntes;
  if (storageBucketAntes === undefined) delete process.env.STORAGE_BUCKET;
  else process.env.STORAGE_BUCKET = storageBucketAntes;
});
/** Deixa terminar o que a passada do timer encadeou (presas → gravações → auditoria). */
const esvaziarFila = () => new Promise(resolver => setImmediate(resolver));

const requisicao = (rota = "mark-interrupted-meetings") => ({ url: `/api/scheduled/${rota}`, headers: {} }) as never;
function resposta() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
const SESSAO_DE_CRON = { id: -1, openId: "cron_tarefa", isCron: true, taskUid: "uid-1" };
const USUARIA_COMUM = { id: 7, openId: "dona-1", isCron: false };

beforeEach(() => {
  authenticateRequest.mockReset();
  cleanupExpiredSessions.mockClear();
  limparGravacoesVencidas.mockClear();
  marcarReunioesInterrompidas.mockClear();
  createAuditLog.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("autenticarCron — sem sessão é 401, usuária comum é 403, cron passa", () => {
  it("cookie ausente ou inválido: 401 (não 500) e o endpoint não segue", async () => {
    authenticateRequest.mockRejectedValue(new HttpError(403, "Invalid session cookie"));
    const res = resposta();

    expect(await autenticarCron(requisicao(), res as never)).toBeNull();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Sessão de cron ausente ou inválida." });
  });

  it("qualquer falha da autenticação (banco fora, sessão revogada) também é 401 — nunca a mensagem interna", async () => {
    authenticateRequest.mockRejectedValue(new Error("Banco de dados indisponível; tente de novo em instantes"));
    const res = resposta();

    expect(await autenticarCron(requisicao(), res as never)).toBeNull();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("Banco de dados");
  });

  it("sessão de usuária comum: 403, rota é só de cron", async () => {
    authenticateRequest.mockResolvedValue(USUARIA_COMUM);
    const res = resposta();

    expect(await autenticarCron(requisicao(), res as never)).toBeNull();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only endpoint" });
  });

  it("sessão de cron: devolve a sessão (com taskUid) e não responde nada", async () => {
    authenticateRequest.mockResolvedValue(SESSAO_DE_CRON);
    const res = resposta();

    expect(await autenticarCron(requisicao(), res as never)).toBe(SESSAO_DE_CRON);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

// Cada rota, o trabalho que ela dispara, o que ele devolve e como isso vira
// resposta e auditoria. cleanup-sessions é a exceção de forma: o trabalho
// devolve um número, que vai como `cleaned` na resposta e `cleanedCount` na
// auditoria.
const ROTAS = [
  {
    rota: "cleanup-sessions", trabalho: cleanupExpiredSessions, devolve: 3,
    acao: "CRON_CLEANUP_SESSIONS", recurso: "sessions", naResposta: { cleaned: 3 }, naAuditoria: { cleanedCount: 3 },
  },
  {
    rota: "cleanup-recordings", trabalho: limparGravacoesVencidas, devolve: { encontradas: 2, apagadas: 1 },
    acao: "CRON_CLEANUP_RECORDINGS", recurso: "meeting_recordings", naResposta: { encontradas: 2, apagadas: 1 }, naAuditoria: { encontradas: 2, apagadas: 1 },
  },
  {
    rota: "mark-interrupted-meetings", trabalho: marcarReunioesInterrompidas, devolve: { encontradas: 1, marcadas: 1 },
    acao: "CRON_MARK_INTERRUPTED_MEETINGS", recurso: "meetings", naResposta: { encontradas: 1, marcadas: 1 }, naAuditoria: { encontradas: 1, marcadas: 1 },
  },
] as const;
const handlerDe = (rota: string) => {
  const handler = jarra.rotas.get(`/api/scheduled/${rota}`);
  expect(handler, `POST /api/scheduled/${rota} não foi registrado`).toBeDefined();
  return handler!;
};
const trabalhos = () => ROTAS.map(({ trabalho }) => trabalho);

describe("os três endpoints /api/scheduled/* — o trabalho só roda com sessão de cron", () => {
  it.each(ROTAS)("/api/scheduled/$rota sem sessão: 401 e NENHUM trabalho roda (nem auditoria)", async ({ rota }) => {
    authenticateRequest.mockRejectedValue(new HttpError(403, "Invalid session cookie"));
    const res = resposta();

    await handlerDe(rota)(requisicao(rota), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Sessão de cron ausente ou inválida." });
    for (const trabalho of trabalhos()) expect(trabalho).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each(ROTAS)("/api/scheduled/$rota com sessão de usuária comum: 403 e NENHUM trabalho roda", async ({ rota }) => {
    authenticateRequest.mockResolvedValue(USUARIA_COMUM);
    const res = resposta();

    await handlerDe(rota)(requisicao(rota), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only endpoint" });
    expect(res.json).toHaveBeenCalledTimes(1);
    for (const trabalho of trabalhos()) expect(trabalho).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each(ROTAS)("/api/scheduled/$rota com sessão de cron: o trabalho roda UMA vez, a resposta traz ok + resultado e a auditoria leva o taskUid", async ({ rota, trabalho, devolve, acao, recurso, naResposta, naAuditoria }) => {
    authenticateRequest.mockResolvedValue(SESSAO_DE_CRON);
    (trabalho as ReturnType<typeof vi.fn>).mockResolvedValueOnce(devolve);
    const res = resposta();

    await handlerDe(rota)(requisicao(rota), res);

    expect(trabalho).toHaveBeenCalledTimes(1);
    for (const outro of trabalhos()) if (outro !== trabalho) expect(outro).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ ok: true, ...naResposta, timestamp: expect.any(String) });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: null, action: acao, resource: recurso, status: "success",
      details: expect.objectContaining({ ...naAuditoria, taskUid: "uid-1" }),
    }));
  });

  it("o trabalho lança: 500 com a mensagem — a autenticação já passou, então não é 401 nem 403", async () => {
    authenticateRequest.mockResolvedValue(SESSAO_DE_CRON);
    marcarReunioesInterrompidas.mockRejectedValueOnce(new Error("Banco de dados indisponível"));
    const res = resposta();

    await handlerDe("mark-interrupted-meetings")(requisicao(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Banco de dados indisponível" }));
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("a auditoria fora do ar não derruba a resposta: o trabalho feito é respondido como ok", async () => {
    authenticateRequest.mockResolvedValue(SESSAO_DE_CRON);
    createAuditLog.mockRejectedValueOnce(new Error("audit_logs fora do ar"));
    const res = resposta();

    await handlerDe("mark-interrupted-meetings")(requisicao(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

describe("a varredura de reuniões presas fora do endpoint — no boot e a cada 5 min", () => {
  it("o boot (com DATABASE_URL) varreu exatamente uma vez antes de o servidor aceitar tráfego", () => {
    expect(varredurasNoBoot).toBe(1);
  });

  it("a cada 5 min varre de novo, e um erro na varredura periódica é log, não queda do processo", async () => {
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(marcarReunioesInterrompidas).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(marcarReunioesInterrompidas).toHaveBeenCalledTimes(1);

    marcarReunioesInterrompidas.mockRejectedValueOnce(new Error("banco fora"));
    const registrado = vi.spyOn(console, "error").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(marcarReunioesInterrompidas).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(registrado.mock.calls)).toContain("banco fora");
  });
});

// O áudio de reunião vive 24 h depois da transcrição ou da falha: a limpeza não
// pode esperar alguém abrir a tela nem um agendador externo, que não existe.
describe("a limpeza das gravações de reunião fora do endpoint — no boot e a cada 5 min", () => {
  it("o boot: presas, depois a poda dos prazos e o apagamento disparado — uma vez cada, antes de o servidor aceitar tráfego", () => {
    expect(ordemDoBoot).toEqual(["presas", "poda", "limpeza", "listen"]);
    expect(ajustesNoBoot).toBe(1);
    expect(limpezasNoBoot).toBe(1);
  });

  it("com a poda do boot ainda rodando, o servidor NÃO aceita tráfego nem dispara o apagamento: nenhuma requisição desta instância vê o prazo velho", () => {
    expect(ordemComAPodaPendente).toEqual(["presas", "poda"]);
  });

  it("o apagamento do boot recebe as chaves que a poda pôs no passado, para expurgá-las pela chave mesmo que a linha já tenha saído", () => {
    expect(argumentosDaLimpezaNoBoot).toEqual([[[CHAVE_VENCIDA_NA_PODA]]]);
  });

  it("o apagamento do boot não segura a subida e, enquanto não termina, a passada de 5 min não começa outro (trava); solto, a passada seguinte apaga", async () => {
    // Este arquivo só carregou porque o servidor subiu com a limpeza do boot
    // ainda pendente. As passadas dos testes acima já bateram na trava.
    const podasAntes = ajustarPrazosDasGravacoes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(marcarReunioesInterrompidas).toHaveBeenCalledTimes(1);
    expect(limparGravacoesVencidas).not.toHaveBeenCalled();

    soltarLimpezaDoBoot({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
    await esvaziarFila();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(limparGravacoesVencidas).toHaveBeenCalledTimes(1);
    // a poda solta é só do boot: no timer, a limpeza já poda antes de apagar
    expect(ajustarPrazosDasGravacoes.mock.calls.length).toBe(podasAntes);
  });

  it("a passada que apagou algo vai para a auditoria (CRON_CLEANUP_RECORDINGS, com a origem) e para o log; a que não apagou nada não enche audit_logs", async () => {
    limparGravacoesVencidas.mockResolvedValueOnce({ encontradas: 3, apagadas: 2, prazosAjustados: 1 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: null, action: "CRON_CLEANUP_RECORDINGS", resource: "meeting_recordings", status: "success",
      details: expect.objectContaining({ encontradas: 3, apagadas: 2, prazosAjustados: 1, origem: "Varredura" }),
    }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("2 de 3");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(limparGravacoesVencidas).toHaveBeenCalledTimes(2);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it("erro na limpeza periódica é log, não queda do processo — e a trava é solta para a passada seguinte", async () => {
    limparGravacoesVencidas.mockRejectedValueOnce(new Error("bucket fora"));
    const registrado = vi.spyOn(console, "error").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(JSON.stringify(registrado.mock.calls)).toContain("bucket fora");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await esvaziarFila();
    expect(limparGravacoesVencidas).toHaveBeenCalledTimes(2);
  });

  it("sem STORAGE_BUCKET (dev com banco e sem bucket), a passada de 5 min varre as presas mas não tenta apagar gravação", async () => {
    delete process.env.STORAGE_BUCKET;
    try {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await esvaziarFila();
      expect(marcarReunioesInterrompidas).toHaveBeenCalledTimes(1);
      expect(limparGravacoesVencidas).not.toHaveBeenCalled();
    } finally {
      process.env.STORAGE_BUCKET = "bucket-da-jarra";
    }
  });
});
