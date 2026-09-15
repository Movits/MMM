import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerDuracaoNoNavegador, PRAZO_DA_LEITURA_DA_DURACAO_MS } from "./duracao-no-navegador";

/**
 * A tela de Reuniões conferia o limite de 10 minutos com a duração que o
 * navegador lia do arquivo e, sem leitura (erro, ou `Infinity` num .webm do
 * MediaRecorder), assumia 60 s: um áudio de 25 minutos passava e seguia para o
 * servidor declarado como 1 minuto. Aqui a leitura nunca inventa um valor.
 *
 * O jsdom não carrega mídia: o elemento <audio> é um dublê que dispara os
 * mesmos eventos, na ordem do Chrome.
 */

type AudioFalso = {
  duration: number;
  preload: string;
  src: string;
  currentTime: number;
  onloadedmetadata: (() => void) | null;
  ondurationchange: (() => void) | null;
  onerror: (() => void) | null;
};

let audio: AudioFalso;
const criarAudio = () => audio as unknown as HTMLAudioElement;
const arquivo = new Blob(["x"], { type: "audio/webm" });

beforeEach(() => {
  audio = { duration: Number.NaN, preload: "", src: "", currentTime: 0, onloadedmetadata: null, ondurationchange: null, onerror: null };
  URL.createObjectURL = vi.fn(() => "blob:reuniao");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe("lerDuracaoNoNavegador", () => {
  it("duração no cabeçalho: arredonda para cima e libera a URL", async () => {
    const leitura = lerDuracaoNoNavegador(arquivo, criarAudio);
    expect(audio.src).toBe("blob:reuniao");
    audio.duration = 95.2;
    audio.onloadedmetadata?.();
    await expect(leitura).resolves.toBe(96);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reuniao");
  });

  it(".webm do MediaRecorder (Infinity): vai ao fim do arquivo e usa a duração real, não 60 s", async () => {
    const leitura = lerDuracaoNoNavegador(arquivo, criarAudio);
    audio.duration = Number.POSITIVE_INFINITY;
    audio.onloadedmetadata?.();
    expect(audio.currentTime).toBeGreaterThan(1e9);
    audio.duration = 1500.4;
    audio.ondurationchange?.();
    await expect(leitura).resolves.toBe(1501);
  });

  it("um durationchange ainda sem número não encerra a leitura", async () => {
    const leitura = lerDuracaoNoNavegador(arquivo, criarAudio);
    audio.duration = Number.POSITIVE_INFINITY;
    audio.onloadedmetadata?.();
    audio.ondurationchange?.();
    audio.duration = 42;
    audio.ondurationchange?.();
    await expect(leitura).resolves.toBe(42);
  });

  it("erro ao abrir o arquivo: null, nunca um valor assumido", async () => {
    const leitura = lerDuracaoNoNavegador(arquivo, criarAudio);
    audio.onerror?.();
    await expect(leitura).resolves.toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reuniao");
  });

  it("o navegador nunca chega a uma duração: null quando o prazo acaba", async () => {
    vi.useFakeTimers();
    const leitura = lerDuracaoNoNavegador(arquivo, criarAudio);
    audio.duration = Number.POSITIVE_INFINITY;
    audio.onloadedmetadata?.();
    vi.advanceTimersByTime(PRAZO_DA_LEITURA_DA_DURACAO_MS);
    await expect(leitura).resolves.toBeNull();
  });
});
