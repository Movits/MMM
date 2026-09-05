import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * invokeLLM tem teto por tentativa e orçamento total.
 *
 * A reverificação de 04/09 achou fetchWithBackoff sem `signal` nem timeout:
 * um upstream que aceita a conexão e nunca responde só era derrubado pelo
 * headersTimeout do Node (300 s), vezes 5 tentativas com backoff — a mutation
 * enrichment.sendMessage ficava presa por ~25 min com a tela em "pensando" e
 * o campo travado, sem cancelar. A spec da etapa 4 pede 15 s com erro claro.
 *
 * Timers falsos: o fetch é um dublê que nunca responde por conta própria —
 * como o upstream mudo — e só rejeita quando o AbortSignal que recebeu é
 * disparado. Se o código deixar de passar o sinal (ou de armar o teto), a
 * promessa nunca assenta e o teste falha na hora, sem esperar de verdade.
 *
 * A revisão da PR-C achou a segunda metade do mesmo defeito: o teto cobria só
 * os CABEÇALHOS. Um upstream que responde 200 e nunca fecha o corpo deixava o
 * `response.json()` fora do relógio, preso até o bodyTimeout do undici
 * (300 s), sem retentativa. O dublê "corpo mudo" abaixo imita o undici: o
 * corpo é um stream que nunca fecha, e o abort do sinal é o que o erra.
 */

process.env.LLM_API_URL = "https://ia.teste.local/v1beta/openai";
process.env.LLM_API_KEY = "chave-de-teste";

const { invokeLLM } = await import("./_core/llm");

type Chamada = { url: string; init: RequestInit };
const chamadas: Chamada[] = [];
const fetchOriginal = globalThis.fetch;

// Upstream mudo: só a abortagem o tira do ar (é o que o undici faz de verdade).
const fetchMudo = () => vi.fn((url: string, init: RequestInit) => {
  chamadas.push({ url, init });
  return new Promise<Response>((_, rejeitar) => {
    init.signal?.addEventListener("abort", () => rejeitar(init.signal?.reason ?? new Error("abortado")));
  });
});

// Cabeçalhos 200 na hora; o corpo é um stream que nunca enfileira nem fecha.
// Como no undici, abortar o sinal erra o stream — é isso que solta o
// `response.text()` de quem estiver lendo.
const fetchDeCorpoMudo = () => vi.fn((url: string, init: RequestInit) => {
  chamadas.push({ url, init });
  let controlador: ReadableStreamDefaultController<Uint8Array> | undefined;
  const corpo = new ReadableStream<Uint8Array>({ start(c) { controlador = c; } });
  init.signal?.addEventListener("abort", () => controlador?.error(init.signal?.reason ?? new Error("abortado")));
  return Promise.resolve(new Response(corpo, { status: 200, headers: { "content-type": "application/json" } }));
});

const mensagens = [{ role: "user" as const, content: "11 99999-8888" }];

// Dispara a chamada e registra quando (no relógio falso) e como ela assentou.
function observar(promessa: Promise<unknown>) {
  const inicio = Date.now();
  const saida = { assentou: false, erro: null as unknown, duracao: -1 };
  promessa.then(
    () => { saida.assentou = true; saida.duracao = Date.now() - inicio; },
    (e) => { saida.assentou = true; saida.erro = e; saida.duracao = Date.now() - inicio; },
  );
  return saida;
}

beforeEach(() => {
  vi.useFakeTimers();
  chamadas.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("invokeLLM — teto por tentativa e orçamento total", () => {
  it("upstream mudo: cada tentativa recebe um AbortSignal, que dispara no teto", async () => {
    globalThis.fetch = fetchMudo() as never;
    const saida = observar(invokeLLM({ messages: mensagens, timeoutMs: 1_000, orcamentoMs: 1_500 }));

    await vi.advanceTimersByTimeAsync(0);
    expect(chamadas).toHaveLength(1);
    // Mutante "fetch(url, init) sem sinal": init.signal seria undefined.
    expect(chamadas[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(chamadas[0].init.signal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(chamadas[0].init.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas[0].init.signal!.aborted).toBe(true);

    // 1 s gasto + espera + mais 1 s de teto não cabem em 1,5 s: desiste já.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saida.assentou).toBe(true);
    expect(saida.erro).toBeInstanceOf(Error);
    expect((saida.erro as Error).message).toMatch(/sem resposta em 1s/);
    expect(chamadas).toHaveLength(1);
  });

  it("cabeçalhos chegam e o corpo nunca fecha: rejeita no teto, aborta a leitura e não deixa timer armado", async () => {
    globalThis.fetch = fetchDeCorpoMudo() as never;
    const saida = observar(invokeLLM({ messages: mensagens, timeoutMs: 1_000, orcamentoMs: 1_500 }));

    await vi.advanceTimersByTimeAsync(0);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].init.signal!.aborted).toBe(false);

    // Mutante "corpo lido fora do teto" (o timer é limpo quando os cabeçalhos
    // chegam e o `.json()` espera sem relógio): a promessa nunca assentaria e
    // o sinal nunca seria abortado.
    await vi.advanceTimersByTimeAsync(999);
    expect(saida.assentou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas[0].init.signal!.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(saida.assentou).toBe(true);
    expect(saida.erro).toBeInstanceOf(Error);
    expect((saida.erro as Error).message).toMatch(/sem resposta em 1s/);
    expect(saida.duracao).toBeLessThanOrEqual(1_500);
    expect(chamadas).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retenta dentro do orçamento e rejeita ANTES de estourá-lo, com o total de tentativas que coube", async () => {
    globalThis.fetch = fetchMudo() as never;
    const saida = observar(invokeLLM({ messages: mensagens, timeoutMs: 1_000, orcamentoMs: 5_000 }));

    // 1ª (1 s) + espera (0,25-0,5 s) + 2ª (1 s) + espera (0,5-1 s) + 3ª (1 s):
    // 3,75-4,5 s. A 4ª exigiria espera de 1-2 s + 1 s: não cabe em 5 s.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(saida.assentou).toBe(true);
    expect(saida.erro).toBeInstanceOf(Error);
    // Mutante "sem orçamento": seguiria até as 5 tentativas (mais de 5 s).
    expect(saida.duracao).toBeLessThanOrEqual(5_000);
    expect(chamadas).toHaveLength(3);
    for (const c of chamadas) expect(c.init.signal!.aborted).toBe(true);
  });

  it("sem parâmetros vale o padrão: teto de 60 s por tentativa e orçamento de 120 s", async () => {
    globalThis.fetch = fetchMudo() as never;
    const saida = observar(invokeLLM({ messages: mensagens }));

    await vi.advanceTimersByTimeAsync(59_999);
    expect(saida.assentou).toBe(false);
    expect(chamadas[0].init.signal!.aborted).toBe(false);

    // Mutante "sem teto padrão": a promessa continuaria pendente por minutos.
    await vi.advanceTimersByTimeAsync(120_000 - 59_999);
    expect(saida.assentou).toBe(true);
    expect(saida.duracao).toBeLessThanOrEqual(120_000);
  });

  it("resposta 503 é retentada enquanto cabe no orçamento; quando não cabe, devolve o erro em vez de dormir", async () => {
    globalThis.fetch = vi.fn((url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return Promise.resolve(new Response("alta demanda", { status: 503, statusText: "Service Unavailable" }));
    }) as never;
    const saida = observar(invokeLLM({ messages: mensagens, timeoutMs: 1_000, orcamentoMs: 1_500 }));

    await vi.advanceTimersByTimeAsync(1_500);

    expect(saida.assentou).toBe(true);
    expect((saida.erro as Error).message).toMatch(/LLM invoke failed: 503/);
    // 1ª imediata → espera (0,25-0,5 s) → 2ª → a 3ª exigiria 0,5-1 s + 1 s: não cabe.
    expect(chamadas).toHaveLength(2);
    expect(saida.duracao).toBeLessThanOrEqual(1_500);
  });

  it("sucesso: devolve o JSON e não deixa o timer do teto pendurado", async () => {
    globalThis.fetch = vi.fn((url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ id: "r1", choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    }) as never;

    const resultado = await invokeLLM({ messages: mensagens, timeoutMs: 1_000 });

    expect(resultado.id).toBe("r1");
    expect(chamadas[0].init.signal!.aborted).toBe(false);
    // Mutante "sem clearTimeout": o teto continuaria armado depois da resposta.
    expect(vi.getTimerCount()).toBe(0);
  });
});
