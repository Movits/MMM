import { describe, expect, it } from "vitest";
import {
  decodeMeetingAudio,
  MAX_MEETING_AUDIO_BYTES,
  MAX_MEETING_DURATION_SECONDS,
  MEETING_TRANSCRIPT_LANGUAGES,
} from "./meeting-service";

describe("Assistente de Reuniões — validação de áudio", () => {
  it("aceita áudio WebM em base64 dentro do limite", () => {
    const audio = decodeMeetingAudio(Buffer.from("audio de teste").toString("base64"), "audio/webm");
    expect(audio.toString()).toBe("audio de teste");
  });

  it("aceita o cabeçalho com codecs produzido pelo MediaRecorder", () => {
    const encoded = Buffer.from("audio gravado").toString("base64");
    const audio = decodeMeetingAudio(`data:audio/webm;codecs=opus;base64,${encoded}`, "audio/webm");
    expect(audio.toString()).toBe("audio gravado");
  });

  it("aceita MP3 enviado como alternativa à gravação do microfone", () => {
    const audio = decodeMeetingAudio(Buffer.from("audio mp3 de teste").toString("base64"), "audio/mpeg");
    expect(audio.toString()).toBe("audio mp3 de teste");
  });

  it("rejeita formatos não suportados", () => {
    expect(() => decodeMeetingAudio("dGVzdGU=", "video/mp4")).toThrow("Formato de áudio");
  });

  it("mantém os limites de segurança do modo por solicitação", () => {
    expect(MAX_MEETING_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_MEETING_DURATION_SECONDS).toBe(10 * 60);
  });

  it("disponibiliza os dez idiomas do MMM para a tradução", () => {
    expect(MEETING_TRANSCRIPT_LANGUAGES).toEqual(["pt-BR", "en", "es", "fr", "de", "ar", "zh", "hi", "ja", "ru"]);
  });
});
