import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjetoAusenteNoStorageError, ObjetoGrandeDemaisError, storageGetBytes } from "./storage";

/**
 * storageGetBytes — ler de volta o áudio guardado no bucket, para reprocessar
 * uma reunião que falhou na IA.
 *
 * Sem bucket real: as variáveis STORAGE_* são falsas e definidas aqui (o
 * storage.ts as lê a cada chamada), e o `send` do cliente S3 é dublado. O que
 * se trava:
 * - devolve os bytes, da chave normalizada, com prazo (abortSignal);
 * - acima do limite, o corpo nem é lido; sem ContentLength, confere depois;
 * - NoSuchKey e 404 viram ObjetoAusenteNoStorageError; o resto passa como veio;
 * - corpo vazio é erro, não áudio de 0 bytes;
 * - o prazo corta um bucket travado;
 * - sem configuração, o erro nomeia as variáveis certas.
 */

const VARIAVEIS = ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_ENDPOINT", "STORAGE_REGION"] as const;
const guardadas: Partial<Record<(typeof VARIAVEIS)[number], string | undefined>> = {};
const LIMITE = 10;

function corpoCom(bytes: number[]) {
  return { transformToByteArray: vi.fn(async () => new Uint8Array(bytes)), destroy: vi.fn() };
}

type Chamada = [{ input: { Bucket: string; Key: string } }, { abortSignal?: AbortSignal } | undefined];
let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const nome of VARIAVEIS) guardadas[nome] = process.env[nome];
  process.env.STORAGE_BUCKET = "bucket-de-teste";
  process.env.STORAGE_ACCESS_KEY_ID = "id-de-teste";
  process.env.STORAGE_SECRET_ACCESS_KEY = "segredo-de-teste";
  process.env.STORAGE_ENDPOINT = "https://s3.exemplo.invalid";
  delete process.env.STORAGE_REGION;
  send = vi.fn();
  vi.spyOn(S3Client.prototype, "send").mockImplementation(((...args: unknown[]) => send(...args)) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("storageGetBytes — o áudio guardado volta inteiro", () => {
  it("devolve os bytes da chave normalizada, com prazo na chamada", async () => {
    send.mockResolvedValue({ ContentLength: 5, Body: corpoCom([1, 2, 3, 4, 5]) });

    const bytes = await storageGetBytes("/meetings/dona-1/reuniao-1/recording_abc12345.webm", LIMITE);

    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(send).toHaveBeenCalledTimes(1);
    const [comando, opcoes] = send.mock.calls[0] as Chamada;
    expect(comando.input).toEqual({ Bucket: "bucket-de-teste", Key: "meetings/dona-1/reuniao-1/recording_abc12345.webm" });
    expect(opcoes?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(opcoes?.abortSignal?.aborted).toBe(false);
  });

  it("no limite exato passa", async () => {
    send.mockResolvedValue({ ContentLength: LIMITE, Body: corpoCom(Array.from({ length: LIMITE }, (_, i) => i)) });
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).resolves.toHaveLength(LIMITE);
  });
});

describe("storageGetBytes — o teto de tamanho", () => {
  it("ContentLength acima do limite: o corpo é descartado sem ser lido", async () => {
    const corpo = corpoCom([1]);
    send.mockResolvedValue({ ContentLength: LIMITE + 1, Body: corpo });

    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toBeInstanceOf(ObjetoGrandeDemaisError);
    expect(corpo.destroy).toHaveBeenCalledTimes(1);
    expect(corpo.transformToByteArray).not.toHaveBeenCalled();
  });

  it("sem ContentLength, o tamanho é conferido depois de ler", async () => {
    send.mockResolvedValue({ Body: corpoCom(Array.from({ length: LIMITE + 1 }, () => 7)) });
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toBeInstanceOf(ObjetoGrandeDemaisError);
  });
});

describe("storageGetBytes — o que pode dar errado no bucket", () => {
  it("NoSuchKey vira ObjetoAusenteNoStorageError", async () => {
    send.mockRejectedValue(Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" }));
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toBeInstanceOf(ObjetoAusenteNoStorageError);
  });

  it("404 sem o código também vira ObjetoAusenteNoStorageError", async () => {
    send.mockRejectedValue(Object.assign(new Error("UnknownError"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toBeInstanceOf(ObjetoAusenteNoStorageError);
  });

  it("qualquer outro erro passa como veio (quem chama decide a frase da tela)", async () => {
    const negado = Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    send.mockRejectedValue(negado);
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toBe(negado);
  });

  it("corpo vazio ou ausente é erro, não um áudio de 0 bytes", async () => {
    send.mockResolvedValueOnce({ ContentLength: 0, Body: corpoCom([]) });
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toThrow(/sem conteúdo/);
    send.mockResolvedValueOnce({ ContentLength: 3 });
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toThrow(/sem conteúdo/);
  });

  it("o prazo corta um bucket travado", async () => {
    send.mockImplementation((_comando: unknown, opcoes?: { abortSignal?: AbortSignal }) => new Promise((_resolver, rejeitar) => {
      opcoes?.abortSignal?.addEventListener("abort", () => rejeitar(opcoes.abortSignal?.reason));
    }));
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE, 20)).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("sem variáveis, o erro nomeia as variáveis certas e nada sai para a rede", async () => {
    delete process.env.STORAGE_BUCKET;
    await expect(storageGetBytes("meetings/d/r/a.webm", LIMITE)).rejects.toThrow(/STORAGE_BUCKET/);
    expect(send).not.toHaveBeenCalled();
  });
});
