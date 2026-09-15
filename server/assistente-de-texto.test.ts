import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Gravar áudio" (Rosber, 14/09 19:10) e "Revisar texto" (Roberto, 14/09:
 * Gemini em vez do LanguageTool) nos campos livres.
 *
 * O LLM e o Gemini são dublês: a suíte nunca fala com a API real. O que se
 * prova aqui é o contrato do servidor:
 *   1. a revisão manda o prompt estrito e devolve só uma SUGESTÃO; sugestão que
 *      inventa dado (número, e-mail, link) ou cresce demais é recusada;
 *   2. o ditado transcreve e devolve texto, sem gravar áudio nem texto em lugar
 *      nenhum;
 *   3. os dois têm teto por conta e limite de tamanho, e erro do provedor não
 *      vaza para a tela.
 */

const invokeLLM = vi.fn();
const transcribeWithGemini = vi.fn();
const exigirDb = vi.fn();
const storagePut = vi.fn();

vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));
vi.mock("./gemini", async importOriginal => ({
  ...(await importOriginal<typeof import("./gemini")>()),
  transcribeWithGemini: (...args: unknown[]) => transcribeWithGemini(...args),
}));
// Nem banco nem bucket: se alguém ligar o ditado a um dos dois, o teste acusa.
vi.mock("./db", () => ({ exigirDb: (...args: unknown[]) => exigirDb(...args), createPrivateContact: vi.fn() }));
vi.mock("./storage", () => ({
  storagePut: (...args: unknown[]) => storagePut(...args),
  storageDelete: vi.fn(),
  storageGetBytes: vi.fn(),
  chaveDoStorageDaDona: vi.fn(),
  ObjetoAusenteNoStorageError: class extends Error {},
}));

const { GeminiCotaEsgotadaError } = await import("./gemini");
const {
  DITADOS_POR_JANELA,
  LIMITE_AUDIO_DITADO_BYTES,
  LIMITE_TEXTO_REVISAO,
  PROMPT_DE_REVISAO,
  REVISOES_POR_JANELA,
  LIMITE_DURACAO_DITADO_SEGUNDOS,
  UNIDADES_DE_FALA_POR_SEGUNDO,
  limparRespostaDaRevisao,
  revisaoPreservaConteudo,
  tetoDeDitado,
  tetoDeRevisao,
  transcricaoCabeNaDuracao,
  unidadesDeFala,
} = await import("./assistente-de-texto");
const { assistenteTextoRouter } = await import("./routers/assistenteTexto");

const ctx = (id: number) => ({
  user: { id, openId: `dona-${id}`, email: "t@local", role: "bronze" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const respostaDoLLM = (conteudo: string) => ({ choices: [{ message: { content: conteudo } }] });

beforeEach(() => {
  invokeLLM.mockReset();
  transcribeWithGemini.mockReset();
  exigirDb.mockReset();
  storagePut.mockReset();
  tetoDeRevisao.esquecer();
  tetoDeDitado.esquecer();
});

describe("assistenteTexto.revisar", () => {
  it("manda o prompt estrito, o texto entre marcas e devolve a sugestão", async () => {
    invokeLLM.mockResolvedValue(respostaDoLLM("Tenho uma loja de roupas há 10 anos."));

    const r = await assistenteTextoRouter.createCaller(ctx(1)).revisar({ texto: "  tenho uma loja de roupas a 10 anos  " });

    expect(r).toEqual({ revisado: "Tenho uma loja de roupas há 10 anos.", mudou: true });
    const { messages } = invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(messages[0]).toEqual({ role: "system", content: PROMPT_DE_REVISAO });
    expect(messages[1]).toEqual({ role: "user", content: "<texto>\ntenho uma loja de roupas a 10 anos\n</texto>" });
    // As regras que a decisão exige, com as palavras que importam.
    expect(PROMPT_DE_REVISAO).toMatch(/ortografia, gramática/);
    expect(PROMPT_DE_REVISAO).toMatch(/idioma original/);
    expect(PROMPT_DE_REVISAO).toMatch(/Não acrescente informação/);
    expect(PROMPT_DE_REVISAO).toMatch(/não mude o sentido/);
    expect(PROMPT_DE_REVISAO).toMatch(/Não invente/);
  });

  it("texto que já estava certo volta igual, com mudou=false", async () => {
    invokeLLM.mockResolvedValue(respostaDoLLM("Sou arquiteta em Lisboa."));
    await expect(assistenteTextoRouter.createCaller(ctx(1)).revisar({ texto: "Sou arquiteta em Lisboa." }))
      .resolves.toEqual({ revisado: "Sou arquiteta em Lisboa.", mudou: false });
  });

  it("sugestão que traz número que o texto não tinha é recusada (nada muda)", async () => {
    invokeLLM.mockResolvedValue(respostaDoLLM("Tenho uma loja de roupas há 15 anos."));
    await expect(assistenteTextoRouter.createCaller(ctx(1)).revisar({ texto: "tenho uma loja de roupas faz tempo" }))
      .rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
  });

  it("sugestão que acrescenta frases inteiras é recusada", async () => {
    invokeLLM.mockResolvedValue(respostaDoLLM(
      "Sou consultora. Atuo com excelência, foco em resultados e paixão por inovação em todo o Brasil e no exterior.",
    ));
    await expect(assistenteTextoRouter.createCaller(ctx(1)).revisar({ texto: "sou consultora" }))
      .rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
  });

  it("falha do provedor vira mensagem neutra, sem o corpo da resposta do Google", async () => {
    invokeLLM.mockRejectedValue(new Error("LLM invoke failed: 403 Forbidden – API key AIza-SEGREDO invalid"));
    const erro = await assistenteTextoRouter.createCaller(ctx(1)).revisar({ texto: "texto qualquer" }).catch(e => e);
    expect(erro).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(String(erro.message)).not.toMatch(/AIza|403|API key/);
  });

  it("texto vazio ou acima do limite não chega ao LLM", async () => {
    const caller = assistenteTextoRouter.createCaller(ctx(1));
    await expect(caller.revisar({ texto: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.revisar({ texto: "a".repeat(LIMITE_TEXTO_REVISAO + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("teto por conta: o pedido além do limite da janela não chama o LLM, e outra conta segue livre", async () => {
    invokeLLM.mockResolvedValue(respostaDoLLM("Olá."));
    const caller = assistenteTextoRouter.createCaller(ctx(1));
    for (let i = 0; i < REVISOES_POR_JANELA; i++) await caller.revisar({ texto: "olá" });
    await expect(caller.revisar({ texto: "olá" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(invokeLLM).toHaveBeenCalledTimes(REVISOES_POR_JANELA);
    await expect(assistenteTextoRouter.createCaller(ctx(2)).revisar({ texto: "olá" })).resolves.toBeTruthy();
  });
});

describe("limpeza e guarda da sugestão", () => {
  it("tira cerca de código, marcas <texto> e aspas que o original não tinha", () => {
    expect(limparRespostaDaRevisao("```\nOlá, tudo bem?\n```", "ola tudo bem")).toBe("Olá, tudo bem?");
    expect(limparRespostaDaRevisao("<texto>\nOlá.\n</texto>", "ola")).toBe("Olá.");
    expect(limparRespostaDaRevisao("“Olá.”", "ola")).toBe("Olá.");
    // Aspas que já estavam no original ficam.
    expect(limparRespostaDaRevisao("\"Carpe diem.\"", "\"carpe diem\"")).toBe("\"Carpe diem.\"");
  });

  it("aceita correção de escrita e recusa dado inventado", () => {
    expect(revisaoPreservaConteudo("meu email e ana@loja.com", "Meu e-mail é ana@loja.com.")).toBe(true);
    expect(revisaoPreservaConteudo("meu email e ana@loja.com", "Meu e-mail é ana@loja.com.br.")).toBe(false);
    expect(revisaoPreservaConteudo("site: loja.com", "Site: https://loja.com")).toBe(false);
    expect(revisaoPreservaConteudo("faturamos R$ 5.000,00", "Faturamos R$ 5.000,00.")).toBe(true);
    expect(revisaoPreservaConteudo("qualquer coisa", "")).toBe(false);
  });

  it("aceita o que uma correção de escrita faz: acento, caixa, concordância, grafia, junção e separação", () => {
    const aceitas: Array<[string, string]> = [
      ["Empresa farmaceutica procurando distribuidor para a Africa.", "Empresa farmacêutica procurando distribuidor para a África."],
      ["tenho uma loja de roupas a 10 anos", "Tenho uma loja de roupas há 10 anos."],
      ["concerteza eu gosto trabalhar com exportaçao", "Com certeza, eu gosto de trabalhar com exportação."],
      ["fazem dois anos que nós vende cafe", "Faz dois anos que nós vendemos café."],
      ["tenho interece em parceria derrepente", "Tenho interesse em parceria, de repente."],
      ["vc tem contato de distribuidores?", "Você tem contato de distribuidores?"],
      ["the company are looking for investors", "The company is looking for investors."],
      ["i dont have a distributor", "I don't have a distributor."],
      ["Não tenho socio nem investidor", "Não tenho sócio nem investidor."],
      ["我们公司寻找非洲的经销商", "我们公司寻找非洲的经销商。"],
      ["anti inflamatório natural", "Anti-inflamatório natural."],
      ["agente trabalha encima do prazo", "A gente trabalha em cima do prazo."],
      ["iscola de idiomas procura parceiros", "Escola de idiomas procura parceiros."],
      // Controle do caso do domínio, lá embaixo: sem ".com.br" as mesmas palavras passam.
      ["Nosso site é empresa oficial com br", "Nosso site é empresa-oficial com br."],
    ];
    for (const [original, revisado] of aceitas) {
      expect({ original, aceita: revisaoPreservaConteudo(original, revisado) }).toEqual({ original, aceita: true });
    }
  });

  it("recusa informação acrescentada ou tirada, domínio sem http, número trocado ou tirado e negação mexida", () => {
    const recusadas: Array<[string, string]> = [
      // Os casos da revisão adversarial.
      ["Empresa farmaceutica procurando distribuidor para a Africa.", "Empresa farmacêutica procurando distribuidor e assessoria jurídica para a África."],
      ["Contato pelo site oficial da empresa.", "Contato pelo site oficial da empresa: empresa-oficial.com.br"],
      ["Faturamos 5 milhões com 40 funcionários.", "Faturamos 40 milhões com 5 funcionários."],
      ["Faturamos 5 milhões com 40 funcionários.", "Faturamos 5 milhões com funcionários."],
      // As palavras já estavam lá; o domínio, não.
      ["Nosso site é empresa oficial com br", "Nosso site é empresa-oficial.com.br"],
      ["Faturamos 5000 por mês", "Faturamos 5.000 por mês."],
      ["Vendemos vinho e azeite para a Europa.", "Vendemos vinho para a Europa."],
      ["Exportamos para o Brasil.", "Exportamos para o Chile."],
      // Grafia parecida, sentido oposto: a troca no começo da palavra não é erro de digitação.
      ["Empresa que importa vinho.", "Empresa que exporta vinho."],
      ["Atividade legal", "Atividade ilegal."],
      ["I am unable to invest", "I am able to invest."],
      ["Tenho interesse em sócios.", "Não tenho interesse em sócios."],
      ["Empresa com sócio investidor.", "Empresa sem sócio investidor."],
      ["I do not have a distributor", "I have a distributor."],
      ["我们公司寻找非洲的经销商", "我们公司寻找非洲的经销商和法律咨询"],
    ];
    for (const [original, revisado] of recusadas) {
      expect({ revisado, aceita: revisaoPreservaConteudo(original, revisado) }).toEqual({ revisado, aceita: false });
    }
  });
});

describe("transcricaoCabeNaDuracao", () => {
  it("fala normal cabe; texto de muitos minutos de fala não cabe; ideograma pesa mais que letra", () => {
    // ~2 minutos de fala rápida em português: 360 palavras de 5 letras.
    const doisMinutosRapidos = Array.from({ length: 360 }, () => "vendo").join(" ");
    expect(unidadesDeFala(doisMinutosRapidos)).toBe(1800);
    expect(transcricaoCabeNaDuracao(doisMinutosRapidos, 120)).toBe(true);
    // O dobro disso já passa de 25 letras por segundo.
    expect(transcricaoCabeNaDuracao(`${doisMinutosRapidos} `.repeat(2), 120)).toBe(false);
    // Duração declarada de 1 segundo não autoriza um parágrafo inteiro (piso de 10 s).
    expect(transcricaoCabeNaDuracao("A Maria tem uma distribuidora de medicamentos.", 1)).toBe(true);
    expect(transcricaoCabeNaDuracao(doisMinutosRapidos, 1)).toBe(false);
    expect(unidadesDeFala("経销商, ok")).toBe(3 * 2.5 + 2);
  });
});

describe("assistenteTexto.transcrever", () => {
  const audioDe = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

  it("transcreve o áudio do navegador e devolve só o texto, sem gravar nada", async () => {
    transcribeWithGemini.mockResolvedValue({ text: "  Tenho uma consultoria de exportação.  ", language: "pt-BR", segments: [] });

    const r = await assistenteTextoRouter.createCaller(ctx(1)).transcrever({
      // O MediaRecorder do Chrome manda o cabeçalho com parâmetros.
      audioBase64: `data:audio/webm;codecs=opus;base64,${audioDe(2048)}`,
      mimeType: "audio/webm",
      idioma: "pt-BR",
    });

    expect(r).toEqual({ texto: "Tenho uma consultoria de exportação." });
    const chamada = transcribeWithGemini.mock.calls[0][0] as { audio: Buffer; mimeType: string; language?: string };
    expect(Buffer.isBuffer(chamada.audio)).toBe(true);
    expect(chamada.audio.length).toBe(2048);
    expect(chamada).toMatchObject({ mimeType: "audio/webm", language: "pt-BR" });
    expect(exigirDb).not.toHaveBeenCalled();
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("formato fora da lista ou base64 inválido não chega ao Gemini", async () => {
    const caller = assistenteTextoRouter.createCaller(ctx(1));
    await expect(caller.transcrever({ audioBase64: audioDe(100), mimeType: "video/x-msvideo" as never }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.transcrever({ audioBase64: "isto não é base64 %%%%%%%%%%", mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transcribeWithGemini).not.toHaveBeenCalled();
  });

  it("áudio acima de 3 MB é recusado antes do Gemini", async () => {
    await expect(assistenteTextoRouter.createCaller(ctx(1)).transcrever({
      audioBase64: audioDe(LIMITE_AUDIO_DITADO_BYTES + 3),
      mimeType: "audio/webm",
    })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(assistenteTextoRouter.createCaller(ctx(1)).transcrever({
      audioBase64: audioDe(LIMITE_AUDIO_DITADO_BYTES * 2),
      mimeType: "audio/webm",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transcribeWithGemini).not.toHaveBeenCalled();
  });

  it("áudio pequeno em bytes mas longo em fala (bitrate baixo) não devolve a transcrição", async () => {
    // Opus a 8 kbps põe ~50 minutos em 3 MB: o tamanho passa, o texto denuncia.
    const letrasDeTresMinutos = LIMITE_DURACAO_DITADO_SEGUNDOS * UNIDADES_DE_FALA_POR_SEGUNDO + 5;
    transcribeWithGemini.mockResolvedValue({ text: "a".repeat(letrasDeTresMinutos), language: "pt", segments: [] });
    const erro = await assistenteTextoRouter.createCaller(ctx(4)).transcrever({ audioBase64: audioDe(2048), mimeType: "audio/ogg" }).catch(e => e);
    expect(erro).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(String(erro.message)).toMatch(/2 minutos/);
    expect(String(erro.message)).not.toMatch(/aaaa/);

    // No limite, volta normalmente.
    transcribeWithGemini.mockResolvedValue({ text: "a".repeat(letrasDeTresMinutos - 5), language: "pt", segments: [] });
    await expect(assistenteTextoRouter.createCaller(ctx(4)).transcrever({ audioBase64: audioDe(2048), mimeType: "audio/ogg" }))
      .resolves.toMatchObject({ texto: expect.stringMatching(/^a+$/) });
  });

  it("cota do Gemini esgotada chega à tela com a mensagem do Gemini, não com erro cru", async () => {
    transcribeWithGemini.mockRejectedValue(new GeminiCotaEsgotadaError());
    await expect(assistenteTextoRouter.createCaller(ctx(1)).transcrever({ audioBase64: audioDe(512), mimeType: "audio/ogg" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: new GeminiCotaEsgotadaError().message });
  });

  it("teto por conta de gravações", async () => {
    transcribeWithGemini.mockResolvedValue({ text: "oi", language: "pt", segments: [] });
    const caller = assistenteTextoRouter.createCaller(ctx(3));
    for (let i = 0; i < DITADOS_POR_JANELA; i++) await caller.transcrever({ audioBase64: audioDe(64), mimeType: "audio/webm" });
    await expect(caller.transcrever({ audioBase64: audioDe(64), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(transcribeWithGemini).toHaveBeenCalledTimes(DITADOS_POR_JANELA);
  });
});
