import { describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

/**
 * O nome da pessoa sugerida pela reunião passa pelo portão da fonte, como o
 * telefone e o e-mail (spec da Glenda de 14/09, item 6: nunca inventar nome).
 * O card PessoaSugeridaNaReuniao marca o nome com ✓; sem o portão, um
 * sobrenome que o modelo completou ia para o contato criado e para a
 * pendência de nome do "Vincular". A integração (a sugestão grava o nome
 * reduzido, ou não entra) está em reuniao-audio-mp4-e-falha.test.ts.
 */
const { nomeSustentadoPelaTranscricao } = await import("./meeting-service");

describe("nomeSustentadoPelaTranscricao", () => {
  it("nome inteiro na fala passa como veio, com acento e caixa do modelo", () => {
    expect(nomeSustentadoPelaTranscricao("Ana Souza", "conversei com a ana souza sobre vinhos")).toBe("Ana Souza");
    expect(nomeSustentadoPelaTranscricao("José D'Ávila", "O Jose d'Avila distribui café.")).toBe("José D'Ávila");
  });

  it("sobrenome que a fala não diz sai; o que ela diz fica", () => {
    expect(nomeSustentadoPelaTranscricao("Carlos Mendes", "Falei com o Carlos sobre o galpão.")).toBe("Carlos");
    expect(nomeSustentadoPelaTranscricao("Maria da Silva Costa", "a Maria da Silva exporta café")).toBe("Maria da Silva");
  });

  it("palavra curta que sobra na ponta depois do corte sai junto", () => {
    expect(nomeSustentadoPelaTranscricao("Carlos de Mendes", "o Carlos de Curitiba")).toBe("Carlos");
    expect(nomeSustentadoPelaTranscricao("Dr. Carlos Lima", "o dr carlos ligou")).toBe("Carlos");
  });

  it("nenhuma palavra de 3+ letras sustentada: devolve vazio, e a sugestão não entra", () => {
    expect(nomeSustentadoPelaTranscricao("Carlos Mendes", "A diretora tem um galpão.")).toBe("");
    expect(nomeSustentadoPelaTranscricao("Li", "eu li o contrato")).toBe("");
    expect(nomeSustentadoPelaTranscricao("   ", "qualquer coisa")).toBe("");
  });

  it("palavra parecida não é a mesma palavra: 'Ana' não se sustenta em 'banana' nem 'Souza' em 'Sousa'", () => {
    expect(nomeSustentadoPelaTranscricao("Ana Souza", "comprei banana da Sousa")).toBe("");
  });

  it("chinês e japonês, que não separam palavras: basta o nome aparecer no texto", () => {
    expect(nomeSustentadoPelaTranscricao("李明", "我和李明谈了仓库的事")).toBe("李明");
    expect(nomeSustentadoPelaTranscricao("田中 太郎", "田中さんと倉庫について話しました")).toBe("田中");
    expect(nomeSustentadoPelaTranscricao("王芳", "我和李明谈了仓库的事")).toBe("");
  });
});
