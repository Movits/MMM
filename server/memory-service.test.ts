import { describe, expect, it } from "vitest";
import { buildMemoryHash, cosineSimilarity, normalizeVector } from "./memory-service";

describe("Memória Inteligente — vetores e privacidade", () => {
  it("normaliza vetores preservando direção", () => {
    const vector = normalizeVector([3, 4]);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
  });

  it("calcula similaridade cosseno previsível", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("cria hashes determinísticos sem expor conteúdo", () => {
    expect(buildMemoryHash("Contato: Ana")).toBe(buildMemoryHash("Contato: Ana"));
    expect(buildMemoryHash("Contato: Ana")).not.toBe(buildMemoryHash("Contato: Beatriz"));
    expect(buildMemoryHash("Contato: Ana")).toHaveLength(64);
  });
});
