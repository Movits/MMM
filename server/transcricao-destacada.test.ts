import { describe, expect, it } from "vitest";
import { segmentarTranscricao } from "@/lib/transcricao-destacada";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O segmentador que pinta a transcrição da reunião (etapa 3): cada nome,
 * empresa e número que a IA extraiu vira um trecho marcado com o seu tipo,
 * para a leitura não precisar adivinhar "qual é qual".
 *
 * Vive em client/src/lib (a tela usa direto), mas é função pura — testada
 * aqui porque o vitest do projeto colhe testes só de server/**.
 */

const TEXTO =
  "Hoje eu me reuni com a Ana Beatriz, diretora da Solar Andes. " +
  "Ela está procurando investidores para projetos de energia solar em Portugal.";

const remontado = (segs: ReturnType<typeof segmentarTranscricao>) => segs.map(s => s.texto).join("");

describe("Transcrição destacada — cada entidade com o seu tipo", () => {
  it("marca pessoa, empresa e cargo sem perder uma letra do texto", () => {
    const segs = segmentarTranscricao(TEXTO, [
      { entityType: "person", value: "Ana Beatriz" },
      { entityType: "company", value: "Solar Andes" },
      { entityType: "role", value: "diretora" },
    ]);

    expect(remontado(segs)).toBe(TEXTO);
    expect(segs.find(s => s.texto === "Ana Beatriz")?.tipo).toBe("person");
    expect(segs.find(s => s.texto === "Solar Andes")?.tipo).toBe("company");
    expect(segs.find(s => s.texto === "diretora")?.tipo).toBe("role");
  });

  it("ignora caixa e acento na busca, mas devolve o trecho como está no texto", () => {
    const segs = segmentarTranscricao("Falei com a ANA BEATRIZ sobre a feira de São Paulo.", [
      { entityType: "person", value: "ana beatriz" },
      { entityType: "company", value: "Sao Paulo" },
    ]);

    expect(segs.find(s => s.tipo === "person")?.texto).toBe("ANA BEATRIZ");
    expect(segs.find(s => s.tipo === "company")?.texto).toBe("São Paulo");
  });

  it("quando uma entidade contém a outra, a mais longa vence", () => {
    const segs = segmentarTranscricao("A Solar Andes fica nos Andes.", [
      { entityType: "opportunity", value: "Andes" },
      { entityType: "company", value: "Solar Andes" },
    ]);

    expect(segs.find(s => s.texto === "Solar Andes")?.tipo).toBe("company");
    // a segunda menção, sozinha, ainda é marcada pela entidade curta
    expect(segs.filter(s => s.texto === "Andes" && s.tipo === "opportunity")).toHaveLength(1);
  });

  it("marca todas as ocorrências, mas nunca no meio de uma palavra", () => {
    const segs = segmentarTranscricao("A Ana falou; Anastácia não. Depois a Ana ligou.", [
      { entityType: "person", value: "Ana" },
    ]);

    expect(segs.filter(s => s.tipo === "person")).toHaveLength(2);
    expect(segs.find(s => s.texto.includes("Anastácia"))?.tipo).toBeUndefined();
  });

  it("entidade ausente do texto e tipo desconhecido não marcam nada", () => {
    const segs = segmentarTranscricao("Uma conversa sem nomes.", [
      { entityType: "person", value: "Beatriz" },
      { entityType: "alienigena", value: "conversa" },
    ]);

    expect(segs).toEqual([{ texto: "Uma conversa sem nomes." }]);
  });

  it("texto sem entidades volta inteiro num segmento só", () => {
    expect(segmentarTranscricao(TEXTO, [])).toEqual([{ texto: TEXTO }]);
    expect(segmentarTranscricao("", [{ entityType: "person", value: "Ana" }])).toEqual([]);
  });

  it("valor de 1 caractere é ignorado — senão todo artigo 'a' viraria pessoa", () => {
    const segs = segmentarTranscricao("A Ana e a bola.", [{ entityType: "person", value: "A" }]);
    expect(segs).toEqual([{ texto: "A Ana e a bola." }]);
  });

  it("mesmo valor com dois tipos: a prioridade fixa decide (pessoa vence)", () => {
    const paraLa = segmentarTranscricao("A Aurora chegou.", [
      { entityType: "company", value: "Aurora" },
      { entityType: "person", value: "Aurora" },
    ]);
    const paraCa = segmentarTranscricao("A Aurora chegou.", [
      { entityType: "person", value: "Aurora" },
      { entityType: "company", value: "Aurora" },
    ]);
    expect(paraLa.find(s => s.texto === "Aurora")?.tipo).toBe("person");
    expect(paraCa.find(s => s.texto === "Aurora")?.tipo).toBe("person");
  });
});
