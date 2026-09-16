import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * "O que preciso — Demandas e necessidades" (Rosber, sócio da Glenda, 14/09
 * 21:24; complemento das 21:34: nenhum texto novo diz "match"):
 *   1. as 17 categorias, com emoji, título e descrição da mensagem, sem
 *      "Consultoria";
 *   2. a validação mínima de cada demanda, igual na tela e no servidor: a
 *      descrição é obrigatória (a seleção sozinha não gera conexão) e, em
 *      "Especialistas / Serviços", o serviço também;
 *   3. a gravação: cada demanda separada em `whatINeedDetails`, `whatINeed`
 *      mantido para compatibilidade, e o Onboarding em cache (sem as demandas)
 *      segue gravando como antes.
 * Os motores têm arquivo próprio (o-que-preciso-nos-motores.test.ts).
 */

const upsertFalso = vi.fn(async (_userId: number, _dados: Record<string, unknown>) => {});
const atualizacoes: Array<{ tabela: unknown; dados: Record<string, unknown> }> = [];
const dbFalso = {
  update: (tabela: unknown) => ({
    set: (dados: Record<string, unknown>) => {
      atualizacoes.push({ tabela, dados });
      return { where: async () => {} };
    },
  }),
};
vi.mock("./db", () => ({
  exigirDb: async () => dbFalso,
  getUserProfile: vi.fn(async () => null),
  upsertUserProfile: (userId: number, dados: Record<string, unknown>) => upsertFalso(userId, dados),
}));
vi.mock("./matching", () => ({ generateMatchesForUser: vi.fn(async () => {}) }));
vi.mock("./termo-geral-de-uso", () => ({ exigirAceiteDoTermoGeral: vi.fn(async () => ({ id: "termo-v1", version: 1 })) }));
// A declaração de maioridade tem teste próprio (maioridade.test.ts); aqui a
// checagem é a real e só a linha de auditoria não é gravada.
vi.mock("./maioridade", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarDeclaracaoDeMaioridade: vi.fn(async () => {}),
}));
vi.mock("./nivel-do-perfil", () => ({ reavaliarNivelPeloPerfil: async () => ({ promovidaAPrata: false }) }));

const compartilhado = await import("@shared/o-que-preciso");
const {
  CATEGORIAS_O_QUE_PRECISO, CATEGORIAS_QUE_SO_VALEM_PELA_DEMANDA, LIMITE_DE_DEMANDAS, LIMITE_DE_DEMANDAS_POR_CATEGORIA,
  categoriasPendentes, chavesQueValemComoNecessidade, demandasParaGravar, lerDemandas, necessidadesDasDemandas,
  problemaDaDemanda, qualificadoresDaDemanda, rotuloDoQuePreciso,
} = compartilhado;
const { prepararOQuePreciso } = await import("./o-que-preciso");
const { profileRouter } = await import("./routers/profile");
const { userProfiles } = await import("../drizzle/schema");

const ctx = { user: { id: 7, openId: "open-7", email: "dona@exemplo.com", role: "bronze" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;
const chamadora = () => profileRouter.createCaller(ctx);
const onboardingBase = { displayName: "Dona", city: "Lisboa", country: "PT", declaraMaioridade: true };
const gravadoNoPerfil = () => atualizacoes.find(a => a.tabela === userProfiles)?.dados ?? {};

beforeEach(() => {
  upsertFalso.mockClear();
  atualizacoes.length = 0;
});

// A lista da mensagem, transcrita: se a tela mudar, este teste precisa mudar junto.
const DA_MENSAGEM: Array<[string, string, string, string]> = [
  ["compradores", "🛒", "Compradores / Clientes", "Encontrar quem precisa do que eu vendo ou ofereço."],
  ["distribuidores", "📦", "Distribuidores / Representantes", "Distribuição, representação comercial e canais de venda."],
  ["fornecedores", "🏭", "Fornecedores / Fabricantes", "Produtos, insumos, indústria e produção."],
  ["parceiros", "🤝", "Parceiros Estratégicos", "Joint ventures, alianças, sócios e parceiros comerciais."],
  ["investidores", "💰", "Investidores", "Investimento, equity, fundos e capital privado."],
  ["financiamento", "🏦", "Crédito / Financiamento", "Bancos, linhas de crédito e financiamento de projetos."],
  ["expansao_internacionalizacao", "🌎", "Expansão / Internacionalização", "Entrar em novos estados, países ou mercados."],
  ["conexoes_institucionais", "🏛️", "Conexões Institucionais", "Entidades, associações, câmaras de comércio e interlocução institucional."],
  ["licencas", "📋", "Licenças / Regulação", "Licenças, registros, certificações e aprovações."],
  ["tecnologia", "💡", "Tecnologia / Inovação", "Sistemas, IA, tecnologia, inovação e transformação digital."],
  ["especialistas_servicos", "👩‍💼", "Especialistas / Serviços", "Jurídico, tributário, contábil, regulatório, marketing, comércio exterior e outros serviços especializados."],
  ["talentos_equipe", "👥", "Talentos / Equipe", "Executivos, profissionais e competências específicas."],
  ["imoveis_estrutura", "🏢", "Imóveis / Estrutura", "Áreas, imóveis, plantas industriais, escritórios e infraestrutura."],
  ["logistica_comercio_exterior", "🚚", "Logística / Comércio Exterior", "Transporte, armazenagem, importação, exportação e operações internacionais."],
  ["midia_visibilidade", "📣", "Mídia / Visibilidade", "Comunicação, eventos, imprensa, posicionamento e divulgação."],
  ["conhecimento_mentoria", "🎓", "Conhecimento / Mentoria", "Especialistas, capacitação, conselho e experiência."],
  ["outra_necessidade", "➕", "Outra necessidade", "Descreva livremente o que você procura."],
];

describe("as 17 categorias", () => {
  it("são as da mensagem, na ordem, com emoji, título e descrição; 'Consultoria' saiu da lista", () => {
    expect(CATEGORIAS_O_QUE_PRECISO.map(c => [c.chave, c.emoji, c.titulo, c.descricao])).toEqual(DA_MENSAGEM);
    expect(CATEGORIAS_O_QUE_PRECISO.some(c => c.titulo === "Consultoria")).toBe(false);
    // Perfil antigo: "consultoria" continua lida e exibida.
    expect(rotuloDoQuePreciso("consultoria")).toBe("Consultoria");
    expect(rotuloDoQuePreciso("texto livre antigo")).toBe("texto livre antigo");
  });

  it("as perguntas e os campos obrigatórios de Especialistas / Serviços e de Outra necessidade", () => {
    const servico = CATEGORIAS_O_QUE_PRECISO.find(c => c.chave === "especialistas_servicos")!;
    expect(servico.pergunta).toBe("Qual serviço ou especialista você precisa contratar?");
    const opcoes = servico.campos.find(campo => campo.campo === "service");
    expect(opcoes).toMatchObject({ tipo: "opcoes", obrigatorio: true });
    expect((opcoes as { opcoes: Array<{ rotulo: string }> }).opcoes.map(o => o.rotulo)).toEqual([
      "Jurídico", "Tributário", "Contábil", "Regulatório", "Comércio Exterior", "Marketing", "Tecnologia", "Estratégia",
      "Financeiro", "Recursos Humanos", "Engenharia", "Arquitetura", "Outro",
    ]);
    expect(compartilhado.ROTULOS_DOS_CAMPOS.descricaoDoServico).toBe("Descreva exatamente o serviço de que você precisa.");
    expect(CATEGORIAS_O_QUE_PRECISO.find(c => c.chave === "outra_necessidade")!.pergunta).toBe("Conte-nos exatamente o que você precisa.");
  });

  it("toda categoria tem descrição; as nove novas só valem pela demanda, as oito antigas reaproveitadas seguem como antes", () => {
    for (const categoria of CATEGORIAS_O_QUE_PRECISO) {
      expect(categoria.campos.filter(campo => campo.tipo === "descricao"), categoria.chave).toHaveLength(1);
    }
    expect([...CATEGORIAS_QUE_SO_VALEM_PELA_DEMANDA].sort()).toEqual([
      "conexoes_institucionais", "conhecimento_mentoria", "especialistas_servicos", "expansao_internacionalizacao",
      "imoveis_estrutura", "logistica_comercio_exterior", "midia_visibilidade", "outra_necessidade", "talentos_equipe",
    ]);
    expect(chavesQueValemComoNecessidade(["compradores", "especialistas_servicos", "consultoria", "expansao_internacionalizacao"]))
      .toEqual(["compradores", "consultoria"]);
  });

  it("nenhum texto novo, em nenhum dos 10 idiomas, diz 'match' (Rosber, 21:34)", () => {
    const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src", "i18n", "locales");
    const arquivos = readdirSync(pasta).filter(arquivo => arquivo.endsWith(".json"));
    expect(arquivos).toHaveLength(10);
    for (const arquivo of arquivos) {
      const oQuePreciso = JSON.parse(readFileSync(path.join(pasta, arquivo), "utf8")).oQuePreciso;
      expect(oQuePreciso, arquivo).toBeTruthy();
      expect(JSON.stringify(oQuePreciso), arquivo).not.toMatch(/match/i);
      expect(Object.keys(oQuePreciso.categorias), arquivo).toEqual(DA_MENSAGEM.map(([chave]) => chave));
    }
  });
});

describe("a validação mínima de uma demanda", () => {
  const demanda = (extra: Record<string, unknown>) => ({ id: "d1", category: "compradores", ...extra }) as compartilhado.DemandaDetalhada;

  it("a descrição é obrigatória em toda categoria, com pelo menos 10 caracteres", () => {
    expect(problemaDaDemanda(demanda({ product: "Café", sector: "Alimentos" }))).toBe("descricao-curta");
    expect(problemaDaDemanda(demanda({ description: "  Café   " }))).toBe("descricao-curta");
    expect(problemaDaDemanda(demanda({ description: "Redes de supermercados no Chile" }))).toBeNull();
  });

  it("Especialistas / Serviços pede o serviço E a descrição", () => {
    const servico = (extra: Record<string, unknown>) => demanda({ category: "especialistas_servicos", ...extra });
    expect(problemaDaDemanda(servico({ description: "Advogado tributarista para revisar o ICMS" }))).toBe("servico-obrigatorio");
    expect(problemaDaDemanda(servico({ service: "tributario" }))).toBe("descricao-curta");
    expect(problemaDaDemanda(servico({ service: "tributario", description: "Advogado tributarista para revisar o ICMS" }))).toBeNull();
    expect(problemaDaDemanda(servico({ service: "astrologia", description: "Advogado tributarista para revisar o ICMS" }))).toBe("opcao-invalida");
  });

  it("categoria marcada sem demanda válida fica pendente; a categoria antiga tolerada não", () => {
    const valida = demanda({ description: "Redes de supermercados no Chile" });
    expect(categoriasPendentes([], [])).toEqual([]);
    expect(categoriasPendentes(["compradores"], [])).toEqual(["compradores"]);
    expect(categoriasPendentes(["compradores"], [demanda({})])).toEqual(["compradores"]); // em branco não conta
    expect(categoriasPendentes(["compradores"], [valida])).toEqual([]);
    expect(categoriasPendentes(["compradores"], [valida, demanda({ id: "d2", product: "Café" })])).toEqual(["compradores"]); // começada e inválida
    expect(categoriasPendentes(["compradores", "consultoria"], [valida])).toEqual([]); // chave antiga não é das 17
    expect(categoriasPendentes(["fornecedores"], [], ["fornecedores"])).toEqual([]);
  });

  it("gravar: só as demandas das categorias marcadas, sem as em branco, com texto aparado", () => {
    const lista = [
      demanda({ description: "  Redes de supermercados no Chile  ", sector: "  " }),
      demanda({ id: "d2" }),
      demanda({ id: "d3", category: "fornecedores", description: "Embalagens de vidro certificadas" }),
    ];
    expect(demandasParaGravar(["compradores"], lista)).toEqual([{ id: "d1", category: "compradores", description: "Redes de supermercados no Chile" }]);
  });

  it("leitura defensiva da coluna JSON: texto do MariaDB, lixo e categoria desconhecida", () => {
    expect(lerDemandas(null)).toEqual([]);
    expect(lerDemandas("não é json")).toEqual([]);
    expect(lerDemandas(JSON.stringify([{ category: "investidores", description: "Capital para a fábrica nova", estimatedValue: "R$ 2 mi" }])))
      .toEqual([{ id: "demanda-1", category: "investidores", description: "Capital para a fábrica nova", estimatedValue: "R$ 2 mi" }]);
    expect(lerDemandas([{ category: "consultoria", description: "Qualquer coisa escrita" }, 42, null])).toEqual([]);
  });

  it("as necessidades para os motores: só a descrição, só de demanda válida de categoria marcada", () => {
    const detalhes = [
      { id: "a", category: "especialistas_servicos", service: "tributario", description: "Advogado tributarista para revisar o ICMS" },
      { id: "b", category: "especialistas_servicos", service: "juridico" }, // sem descrição: genérica
      { id: "c", category: "distribuidores", description: "Parceiro para distribuir medicamentos na África Oriental", region: "África Oriental" },
    ];
    expect(necessidadesDasDemandas(["especialistas_servicos", "distribuidores"], detalhes)).toEqual([
      "Advogado tributarista para revisar o ICMS", "Parceiro para distribuir medicamentos na África Oriental",
    ]);
    expect(necessidadesDasDemandas(["distribuidores"], detalhes)).toEqual(["Parceiro para distribuir medicamentos na África Oriental"]);
    expect(qualificadoresDaDemanda(detalhes[2] as compartilhado.DemandaDetalhada)).toEqual(["País/região: África Oriental"]);
    expect(qualificadoresDaDemanda(detalhes[0] as compartilhado.DemandaDetalhada)).toEqual(["Serviço: Tributário"]);
  });

  it("a descrição de 'Compradores / Clientes' é o que a membra vende: não vira necessidade, e a chave continua valendo", () => {
    const vende = { id: "a", category: "compradores", description: "Consultoria tributária para indústrias farmacêuticas do Nordeste" };
    const distribuidor = { id: "b", category: "distribuidores", description: "Parceiro para distribuir medicamentos na África Oriental", region: "África Oriental" };
    expect(necessidadesDasDemandas(["compradores", "distribuidores"], [vende, distribuidor])).toEqual(["Parceiro para distribuir medicamentos na África Oriental"]);
    expect(necessidadesDasDemandas(["compradores"], [vende])).toEqual([]);
    expect(chavesQueValemComoNecessidade(["compradores"])).toEqual(["compradores"]);
  });
});

describe("prepararOQuePreciso", () => {
  it("sem as demandas no pedido (Onboarding em cache): whatINeed como veio e as demandas intocadas", () => {
    expect(prepararOQuePreciso(["consultoria", "fornecedores"], undefined)).toEqual({ whatINeed: ["consultoria", "fornecedores"] });
    expect(prepararOQuePreciso(undefined, undefined)).toEqual({});
  });

  it("demanda de categoria desmarcada sai; ids repetidos viram únicos", () => {
    const r = prepararOQuePreciso(["expansao_internacionalizacao"], [
      { id: "x", category: "expansao_internacionalizacao", description: "Expandir operação farmacêutica para Moçambique" },
      { id: "x", category: "expansao_internacionalizacao", description: "Encontrar distribuidor na Nigéria" },
      { id: "y", category: "midia_visibilidade", description: "Imprensa internacional para a marca" },
    ]);
    expect(r.whatINeed).toEqual(["expansao_internacionalizacao"]);
    expect(r.whatINeedDetails?.map(d => [d.id, d.description])).toEqual([
      ["x", "Expandir operação farmacêutica para Moçambique"], ["x-2", "Encontrar distribuidor na Nigéria"],
    ]);
  });

  it("recusa a demanda começada e inválida, com mensagem em português", () => {
    expect(() => prepararOQuePreciso(["especialistas_servicos"], [{ category: "especialistas_servicos", description: "Advogado tributarista" }]))
      .toThrow(/Escolha o serviço ou especialista em "Especialistas \/ Serviços"/);
    expect(() => prepararOQuePreciso(["compradores"], [{ category: "compradores", product: "Café" }]))
      .toThrow(/a categoria sozinha não gera conexões/);
  });

  it(`no máximo ${LIMITE_DE_DEMANDAS_POR_CATEGORIA} demandas por categoria`, () => {
    const muitas = Array.from({ length: LIMITE_DE_DEMANDAS_POR_CATEGORIA + 1 }, (_, i) => ({ id: `d${i}`, category: "compradores", description: `Comprador número ${i} no Chile` }));
    expect(() => prepararOQuePreciso(["compradores"], muitas)).toThrow(/No máximo/);
  });
});

describe("profile.completeOnboarding e profile.update", () => {
  const demandas = [
    { id: "d1", category: "especialistas_servicos", service: "tributario", description: "  Procuro assessoria tributária para indústria  " },
    { id: "d2", category: "especialistas_servicos" }, // em branco: descartada
    { id: "d3", category: "investidores", subcategory: "equity", estimatedValue: "R$ 2 milhões", description: "Capital para ampliar a fábrica" },
  ];

  it("onboarding grava whatINeed e cada demanda separada em whatINeedDetails", async () => {
    await chamadora().completeOnboarding({ ...onboardingBase, whatINeed: ["especialistas_servicos", "investidores"], whatINeedDetails: demandas });
    expect(gravadoNoPerfil().whatINeed).toEqual(["especialistas_servicos", "investidores"]);
    expect(gravadoNoPerfil().whatINeedDetails).toEqual([
      { id: "d1", category: "especialistas_servicos", service: "tributario", description: "Procuro assessoria tributária para indústria" },
      { id: "d3", category: "investidores", subcategory: "equity", estimatedValue: "R$ 2 milhões", description: "Capital para ampliar a fábrica" },
    ]);
  });

  it("onboarding em cache, sem as demandas: grava whatINeed como antes e não toca em whatINeedDetails", async () => {
    await chamadora().completeOnboarding({ ...onboardingBase, whatINeed: ["fornecedores", "consultoria"] });
    expect(gravadoNoPerfil().whatINeed).toEqual(["fornecedores", "consultoria"]);
    expect(gravadoNoPerfil()).not.toHaveProperty("whatINeedDetails");
  });

  it("demanda inválida: BAD_REQUEST e nada gravado", async () => {
    await expect(chamadora().completeOnboarding({
      ...onboardingBase, whatINeed: ["especialistas_servicos"], whatINeedDetails: [{ id: "d1", category: "especialistas_servicos", description: "Advogado tributarista para o ICMS" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsertFalso).not.toHaveBeenCalled();
    expect(atualizacoes).toEqual([]);
  });

  it("contra abuso: categoria desconhecida, descrição enorme e demandas demais são recusadas pelo zod", async () => {
    const caller = chamadora();
    await expect(caller.completeOnboarding({ ...onboardingBase, whatINeedDetails: [{ category: "qualquer", description: "Uma descrição qualquer" }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.update({ whatINeed: ["compradores"], whatINeedDetails: [{ category: "compradores", description: "x".repeat(1001) }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    const demais = Array.from({ length: LIMITE_DE_DEMANDAS + 1 }, (_, i) => ({ category: "compradores", description: `Comprador número ${i}` }));
    await expect(caller.update({ whatINeed: ["compradores"], whatINeedDetails: demais })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsertFalso).not.toHaveBeenCalled();
  });

  it("perfil: grava as demandas junto; sem elas no pedido, a coluna não vai ao upsert", async () => {
    await chamadora().update({ whatINeed: ["investidores", "consultoria"], whatINeedDetails: demandas.slice(2) });
    expect(upsertFalso.mock.calls[0][1]).toMatchObject({
      whatINeed: ["investidores", "consultoria"],
      whatINeedDetails: [{ id: "d3", category: "investidores", subcategory: "equity", estimatedValue: "R$ 2 milhões", description: "Capital para ampliar a fábrica" }],
    });
    upsertFalso.mockClear();
    await chamadora().update({ bio: "Só a bio" });
    expect(upsertFalso.mock.calls[0][1]).not.toHaveProperty("whatINeedDetails");
    expect(upsertFalso.mock.calls[0][1]).not.toHaveProperty("whatINeed");
  });
});
