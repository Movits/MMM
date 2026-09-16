import { describe, expect, it } from "vitest";
import {
  BUSCA_LEGADA_EQUIVALENTE,
  CHAVES_O_QUE_BUSCA,
  OPCOES_O_QUE_BUSCA,
  chaveAtualDaBusca,
  opcaoDaBusca,
  outraNecessidadeValida,
  textoDaOutraNecessidade,
  VALORES_ACEITOS_EM_SEEKING_TYPES,
} from "../shared/o-que-busca";

/**
 * "O que você busca?" (Lucas, grupo "Projetos IA", 14/09 20:58): 12 opções com
 * título, descrição e emoji EXATOS. As chaves são valor gravado no banco e o
 * motor de conexões as lê — trocar uma aqui quebra dado e motor, então o teste
 * congela a lista inteira.
 */
describe("as 12 opções", () => {
  it("chave, emoji, título e descrição exatamente como pedidos, nesta ordem", () => {
    expect(OPCOES_O_QUE_BUSCA.map(o => [o.chave, o.emoji, o.titulo, o.descricao])).toEqual([
      ["expandir_negocio", "🌎", "Expandir meu negócio", "Novos mercados, cidades ou países"],
      ["parceiro_estrategico", "🤝", "Parceiro estratégico", "Sócios, parceiros comerciais ou institucionais"],
      ["investimento_capital", "💰", "Investimento / Capital", "Investidores, fundos ou acesso a capital"],
      ["clientes_compradores", "📈", "Clientes / Compradores", "Quem precisa do que você oferece"],
      ["fornecedores_produtos", "🏭", "Fornecedores / Produtos", "Produtos, insumos, fabricantes ou distribuidores"],
      ["internacionalizacao", "🌐", "Internacionalização", "Entrar ou expandir em outros países"],
      ["conexoes_institucionais", "🏛️", "Conexões Institucionais", "Entidades, associações e ambientes estratégicos"],
      ["tecnologia_solucoes", "💡", "Tecnologia / Soluções", "Tecnologia, inovação ou soluções para o negócio"],
      ["talentos_especialistas", "👥", "Talentos / Especialistas", "Profissionais ou competências específicas"],
      ["servico_especializado", "🎯", "Serviço Especializado", "Jurídico, tributário, regulatório, marketing etc."],
      ["visibilidade_posicionamento", "📣", "Visibilidade / Posicionamento", "Eventos, mídia, marca e conexões estratégicas"],
      ["outra_necessidade", "✨", "Outra necessidade", "Descreva exatamente o que você procura"],
    ]);
  });

  it("o rótulo pt-BR da tela (i18n) é o mesmo do arquivo compartilhado", async () => {
    const { default: ptBR } = await import("../client/src/i18n/locales/pt-BR.json");
    const opcoes = (ptBR as unknown as { oQueBusca: { opcoes: Record<string, { titulo: string; descricao: string }> } }).oQueBusca.opcoes;
    for (const opcao of OPCOES_O_QUE_BUSCA) {
      expect(opcoes[opcao.chave]).toEqual({ titulo: opcao.titulo, descricao: opcao.descricao });
    }
  });
});

describe("dados antigos (sem migração)", () => {
  it("investor, strategic_partner e team apontam para a opção nova; job e mentor ficam como estão", () => {
    expect(BUSCA_LEGADA_EQUIVALENTE).toEqual({
      investor: "investimento_capital",
      strategic_partner: "parceiro_estrategico",
      team: "talentos_especialistas",
    });
    expect(opcaoDaBusca("investor")?.titulo).toBe("Investimento / Capital");
    expect(chaveAtualDaBusca("job")).toBe("job");
    expect(opcaoDaBusca("mentor")).toBeNull();
  });

  it("seekingTypes aceita as novas, be_mentor e as 5 antigas — e nada além", () => {
    for (const chave of [...CHAVES_O_QUE_BUSCA, "be_mentor", "job", "team", "investor", "mentor", "strategic_partner"]) {
      expect(VALORES_ACEITOS_EM_SEEKING_TYPES).toContain(chave);
    }
    expect(VALORES_ACEITOS_EM_SEEKING_TYPES).not.toContain("commercial_partner");
  });
});

describe("Outra necessidade", () => {
  it("marcada exige texto (3 a 500 caracteres); desmarcada não exige nada", () => {
    expect(outraNecessidadeValida(["outra_necessidade"], "")).toBe(false);
    expect(outraNecessidadeValida(["outra_necessidade"], "  ab ")).toBe(false);
    expect(outraNecessidadeValida(["outra_necessidade"], "Armazém em Santos")).toBe(true);
    expect(outraNecessidadeValida(["outra_necessidade"], "x".repeat(501))).toBe(false);
    expect(outraNecessidadeValida(["expandir_negocio"], "")).toBe(true);
    expect(outraNecessidadeValida(undefined, undefined)).toBe(true);
  });

  it("o texto gravado é aparado, e vira null sem a opção marcada", () => {
    expect(textoDaOutraNecessidade(["outra_necessidade"], "  Armazém  ")).toBe("Armazém");
    expect(textoDaOutraNecessidade(["expandir_negocio"], "sobrou")).toBeNull();
    expect(textoDaOutraNecessidade(["outra_necessidade"], "   ")).toBeNull();
  });
});
