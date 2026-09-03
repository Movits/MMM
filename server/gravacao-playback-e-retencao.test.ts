import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Tarefa do quadro: "Tocar a gravação da reunião no app (playback do áudio)".
 *
 * O áudio já subia, transcrevia e ficava no bucket — mas a API nunca devolvia
 * a gravação, então não havia como ouvir de volta. Junto vinham duas dívidas
 * que só apareciam quando existisse um player:
 *
 *  1. O prazo de 30 dias era decorativo: `expiresAt` era escrito e nunca lido,
 *     e nada apagava o arquivo. A tela prometia "expira automaticamente após
 *     30 dias" enquanto o áudio ficava para sempre.
 *  2. Apagar a reunião não apagava o áudio do bucket — e sem a linha do banco,
 *     ninguém saberia que o objeto continuava lá.
 */

const storageDelete = vi.fn(async () => {});
vi.mock("./storage", () => ({
  storagePut: async () => ({ key: "k", url: "/manus-storage/k" }),
  storageDelete: (...args: unknown[]) => storageDelete(...(args as [string])),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: async () => ({ choices: [{ message: { content: "{}" } }] }) }));
vi.mock("./gemini", () => ({ transcribeWithGemini: async () => ({ text: "", segments: [] }) }));

const schema = await import("../drizzle/schema");

const AGORA = Date.now();
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const tabelas = new Map<unknown, Record<string, unknown>[]>();
const delecoes: Array<{ tabela: unknown; colunas: string[] }> = [];
const tabelasApagadas = () => delecoes.map(operacao => operacao.tabela);

/**
 * Colunas citadas num predicado do drizzle. PARA na coluna: descer nela
 * levaria à tabela, que traz todas as outras — e aí qualquer condição
 * "conteria" owner_id, deixando passar o mutante que remove o escopo por dona.
 */
function colunasDe(condicao: unknown): string[] {
  const achadas: string[] = [];
  const visitados = new Set<unknown>();
  const visitar = (no: unknown) => {
    if (!no || typeof no !== "object" || visitados.has(no)) return;
    visitados.add(no);
    const alvo = no as Record<string, unknown>;
    if (typeof alvo.name === "string" && alvo.table) { achadas.push(alvo.name); return; }
    for (const valor of Object.values(alvo)) {
      if (Array.isArray(valor)) valor.forEach(visitar);
      else if (valor && typeof valor === "object") visitar(valor);
    }
  };
  visitar(condicao);
  return achadas;
}

type Operacao = { tabela: unknown; colunas: string[] };
const leituras: Operacao[] = [];
const ordenacoes: unknown[] = [];

/** where() do drizzle é "thenable": dá para aguardar direto ou encadear. */
const consulta = (linhas: Record<string, unknown>[]) => ({
  limit: async () => linhas,
  // síncrono de propósito: o drizzle encadeia .orderBy(...).limit(...)
  orderBy: (ordem: unknown) => { ordenacoes.push(ordem); return consulta(linhas); },
  then: (resolver: (valor: Record<string, unknown>[]) => unknown) => resolver(linhas),
});

const fakeDb = {
  select: () => ({
    from: (tabela: unknown) => ({
      where: (condicao?: unknown) => {
        leituras.push({ tabela, colunas: colunasDe(condicao) });
        return consulta(tabelas.get(tabela) ?? []);
      },
    }),
  }),
  delete: (tabela: unknown) => ({
    where: async (condicao?: unknown) => { delecoes.push({ tabela, colunas: colunasDe(condicao) }); },
  }),
  update: () => ({ set: () => ({ where: async () => {} }) }),
  insert: () => ({ values: async () => {} }),
};
vi.mock("./db", () => ({ exigirDb: async () => fakeDb as never, getDb: async () => fakeDb as never }));

const servico = await import("./meeting-service");

const REUNIAO = { id: "reuniao-1", ownerId: "dona-1", title: "Reunião", status: "ready", consentGranted: true, createdAt: AGORA - 1000 };
const gravacaoCom = (expiresAt: number) => ({
  id: "grav-1", meetingId: "reuniao-1", ownerId: "dona-1",
  storageKey: "meetings/dona-1/reuniao-1/recording_abc.webm",
  storageUrl: "/manus-storage/meetings/dona-1/reuniao-1/recording_abc.webm",
  mimeType: "audio/webm", sizeBytes: 12345, durationSeconds: 92,
  expiresAt, createdAt: AGORA,
});

beforeEach(() => {
  tabelas.clear();
  delecoes.length = 0;
  leituras.length = 0;
  ordenacoes.length = 0;
  // mockReset (não mockClear): um mockRejectedValueOnce não consumido por um
  // teste vazaria para o próximo e o faria falhar por motivo errado.
  storageDelete.mockReset();
  storageDelete.mockImplementation(async () => {});
  tabelas.set(schema.meetings, [REUNIAO]);
  tabelas.set(schema.meetingTranscripts, []);
  tabelas.set(schema.meetingEntities, []);
  tabelas.set(schema.meetingContactSuggestions, []);
  tabelas.set(schema.meetingRecordings, []);
});

describe("Playback — a API entrega a gravação para a tela poder tocar", () => {
  it("gravação dentro do prazo volta com endereço, duração e validade", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 10 * 24 * 60 * 60 * 1000)]);
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording?.url).toBe("/manus-storage/meetings/dona-1/reuniao-1/recording_abc.webm");
    expect(dados?.recording?.durationSeconds).toBe(92);
    expect(dados?.recording?.mimeType).toBe("audio/webm");
    expect(dados?.recordingExpired).toBe(false);
  });

  it("o endereço é o do proxy autenticado, nunca o do bucket", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording?.url.startsWith("/manus-storage/")).toBe(true);
  });

  it("a chave do bucket NÃO vai para a tela", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording).not.toHaveProperty("storageKey");
  });

  it("reunião sem áudio devolve nada, sem alarde", async () => {
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(false);
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("a transcrição e as sugestões continuam vindo como antes", async () => {
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados).toHaveProperty("transcript");
    expect(dados).toHaveProperty("entities");
    expect(dados).toHaveProperty("suggestions");
  });
});

describe("Retenção — os 30 dias deixam de ser promessa e viram ação", () => {
  it("gravação vencida não é servida, e o arquivo é apagado do bucket", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA - 1)]);
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(true);
    expect(storageDelete).toHaveBeenCalledWith("meetings/dona-1/reuniao-1/recording_abc.webm");
    expect(tabelasApagadas()).toContain(schema.meetingRecordings);
  });

  it("o storage fora do ar não derruba a leitura da reunião", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA - 1)]);
    storageDelete.mockRejectedValueOnce(new Error("bucket fora do ar"));
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recordingExpired).toBe(true);
    expect(dados?.meeting).toBeTruthy();
  });

  it("bucket falhou: a LINHA fica, senão o áudio some do banco e vive no bucket para sempre", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA - 1)]);
    storageDelete.mockRejectedValueOnce(new Error("bucket fora do ar"));
    await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(tabelasApagadas()).not.toContain(schema.meetingRecordings);
  });

  it("depois de descartada, a tela continua sabendo que EXPIROU — não vira 'nunca houve áudio'", async () => {
    // sem linha, mas a reunião é mais velha que o prazo
    tabelas.set(schema.meetings, [{ ...REUNIAO, createdAt: AGORA - TTL_MS - 1 }]);
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(true);
  });

  it("reunião recente sem áudio não é confundida com expirada", async () => {
    const dados = await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(dados?.recordingExpired).toBe(false);
  });

  it("a leitura da gravação é ordenada: sem unique por reunião, a escolha não pode ficar ao acaso", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    await servico.getPrivateMeeting("dona-1", "reuniao-1");
    expect(ordenacoes.length).toBeGreaterThan(0);
  });
});

describe("Retenção — a varredura faz os 30 dias valerem sem depender de alguém abrir a tela", () => {
  it("apaga arquivo e linha das gravações vencidas", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA - 1)]);
    const resultado = await servico.limparGravacoesVencidas();
    expect(resultado).toEqual({ encontradas: 1, apagadas: 1 });
    expect(storageDelete).toHaveBeenCalledWith("meetings/dona-1/reuniao-1/recording_abc.webm");
    expect(tabelasApagadas()).toContain(schema.meetingRecordings);
  });

  it("bucket falhou: conta como não apagada e a linha permanece para a próxima rodada", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA - 1)]);
    storageDelete.mockRejectedValueOnce(new Error("bucket fora do ar"));
    const resultado = await servico.limparGravacoesVencidas();
    expect(resultado).toEqual({ encontradas: 1, apagadas: 0 });
    expect(tabelasApagadas()).not.toContain(schema.meetingRecordings);
  });

  it("a varredura filtra por expiresAt — não sai apagando a base inteira", async () => {
    tabelas.set(schema.meetingRecordings, []);
    await servico.limparGravacoesVencidas();
    const leitura = leituras.find(operacao => operacao.tabela === schema.meetingRecordings);
    expect(leitura?.colunas).toContain("expires_at");
  });
});

describe("Exclusão — apagar a reunião apaga a VOZ, não só a linha", () => {
  it("o arquivo de áudio sai do bucket", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    await servico.deletePrivateMeeting("dona-1", "reuniao-1");
    expect(storageDelete).toHaveBeenCalledWith("meetings/dona-1/reuniao-1/recording_abc.webm");
  });

  it("as TRADUÇÕES da transcrição também saem — senão o conteúdo sobrevive em nove idiomas", async () => {
    await servico.deletePrivateMeeting("dona-1", "reuniao-1");
    expect(tabelasApagadas()).toContain(schema.meetingTranscriptTranslations);
  });

  it("todo delete da exclusão é escopado por dona", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    await servico.deletePrivateMeeting("dona-1", "reuniao-1");
    for (const operacao of delecoes) {
      expect(operacao.colunas).toContain("owner_id");
    }
  });

  it("o áudio sai ANTES da linha: é ela que diz onde o arquivo está", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const fonte = readFileSync(join(__dirname, "meeting-service.ts"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export async function deletePrivateMeeting"));
    const posicaoArquivo = corpo.indexOf("apagarArquivoDaGravacao");
    const posicaoLinha = corpo.indexOf("delete(meetingRecordings)");
    expect(posicaoArquivo).toBeGreaterThan(-1);
    expect(posicaoArquivo).toBeLessThan(posicaoLinha);
  });

  it("falha no bucket não impede a reunião de ser excluída", async () => {
    tabelas.set(schema.meetingRecordings, [gravacaoCom(AGORA + 1000)]);
    storageDelete.mockRejectedValueOnce(new Error("bucket fora do ar"));
    await expect(servico.deletePrivateMeeting("dona-1", "reuniao-1")).resolves.toBe(true);
    expect(tabelasApagadas()).toContain(schema.meetings);
  });

  it("reunião de outra dona não apaga nada", async () => {
    tabelas.set(schema.meetings, []);
    expect(await servico.deletePrivateMeeting("dona-2", "reuniao-1")).toBe(false);
    expect(storageDelete).not.toHaveBeenCalled();
    expect(tabelasApagadas()).toHaveLength(0);
  });
});
