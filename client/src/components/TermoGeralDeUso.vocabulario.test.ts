import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Colisão de vocabulário no Termo Geral de Uso (achado dos revisores, 15/09/2026).
 *
 * A troca de MATCH por CONEXÃO (pedido do Rosber) criou um TERMO DEFINIDO —
 * "CONEXÃO", a potencial compatibilidade identificada pelo SMART MATCH, Cláusula
 * 2 — que passou a conviver, no mesmo texto, com a palavra comum "conexão". O
 * resultado eram frases que se mordem: "o negócio decorrer da conexão ou
 * aproximação originada por CONEXÃO realizada por seu intermédio".
 *
 * A regra que este arquivo guarda, e que resolve a ambiguidade sem tocar em
 * numeração nem em remissão:
 *
 *   1. quando o texto fala do EVENTO da plataforma, escreve CONEXÃO/CONEXÕES em
 *      caixa alta, como todo termo definido deste documento;
 *   2. quando fala do sentido comum (vínculo, relacionamento, aproximação,
 *      contato), usa a outra palavra em português, e não "conexão";
 *   3. a única exceção é o nome próprio "Certificado da Conexão" (Cláusula 17),
 *      que é o rótulo do registro eletrônico e já vem entre aspas no texto.
 *
 * O teste vive ao lado de TermoGeralDeUso.tsx porque é essa a tela que exibe o
 * documento: o que a última etapa do cadastro mostra é exatamente este arquivo,
 * depois de publicado.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const termo = () =>
  readFileSync(path.resolve(AQUI, "..", "..", "..", "docs", "termos", "termo-geral-de-uso.md"), "utf8")
    .replace(/\r\n/g, "\n");

/** Nome próprio do registro eletrônico: fica de fora da regra de caixa alta. */
const NOME_DO_CERTIFICADO = /CERTIFICADO DA CONEXÃO|Certificado da Conexão/g;

describe("A) a palavra 'conexão' não convive mais com o termo definido CONEXÃO", () => {
  it("fora do nome próprio 'Certificado da Conexão', só sobra CONEXÃO/CONEXÕES em caixa alta", () => {
    const sobra = termo().replace(NOME_DO_CERTIFICADO, "");
    const ocorrencias = sobra.match(/[\p{L}]*conex[\p{L}]*/giu) ?? [];
    expect(ocorrencias.length).toBeGreaterThan(0);
    const minusculas = [...new Set(ocorrencias.filter(o => o !== "CONEXÃO" && o !== "CONEXÕES"))];
    expect(minusculas, `a palavra comum ainda aparece: ${minusculas.join(", ")}`).toEqual([]);
  });

  it("o nome próprio do registro eletrônico continua no texto, como o Dr. Ronei escreveu", () => {
    const texto = termo();
    expect(texto).toContain("## 17. REGISTROS ELETRÔNICOS, PROVA E CERTIFICADO DA CONEXÃO");
    expect(texto).toContain("“Certificado da Conexão”");
    expect(texto).toContain("17.3. O Certificado da Conexão e os demais registros");
  });
});

describe("B) cada frase reescrita, uma a uma (para o Dr. Ronei conferir)", () => {
  const ANTES_E_DEPOIS: { onde: string; antes: string; depois: string }[] = [
    {
      onde: "1.2",
      antes: "destinado à aproximação, conexão, interação e desenvolvimento de relacionamentos",
      depois: "destinado à aproximação, ao contato, à interação e ao desenvolvimento de relacionamentos",
    },
    {
      onde: "1.2 (a)",
      antes: "potenciais compatibilidades, conexões, parceiros e oportunidades",
      depois: "potenciais compatibilidades, CONEXÕES, parceiros e oportunidades",
    },
    {
      onde: "1.2 (b)",
      antes: "demais conexões profissionais ou negociais",
      depois: "demais vínculos profissionais ou negociais",
    },
    {
      onde: "1.2 (e)",
      antes: "inclusive para desenvolvimento de conexões e tratativas decorrentes",
      depois: "inclusive para o desenvolvimento de relacionamentos e tratativas decorrentes",
    },
    {
      onde: "1.2 (g)",
      antes: "histórico de oportunidades, demandas, conexões, reuniões",
      depois: "histórico de oportunidades, demandas, CONEXÕES, reuniões",
    },
    {
      onde: "1.2 (h)",
      antes: "decorrentes das conexões realizadas por intermédio da PLATAFORMA",
      depois: "decorrentes das CONEXÕES realizadas por intermédio da PLATAFORMA",
    },
    {
      onde: "1.2 (j)",
      antes: "o desenvolvimento de conexões e oportunidades compatíveis",
      depois: "o desenvolvimento de CONEXÕES e oportunidades compatíveis",
    },
    {
      onde: "2, definição de DEMANDA",
      antes: "por meio das funcionalidades de conexão da PLATAFORMA",
      depois: "por meio das funcionalidades de aproximação da PLATAFORMA",
    },
    {
      onde: "2, definição de NEGÓCIO DECORRENTE DA CONEXÃO",
      antes: "cuja identificação, conexão ou aproximação tenha ocorrido em razão de compatibilidade",
      depois: "cuja identificação, apresentação ou aproximação tenha ocorrido em razão de compatibilidade",
    },
    {
      onde: "5-A.1",
      antes: "desenvolvimento de negócios e conexões profissionais ou institucionais",
      depois: "desenvolvimento de negócios e vínculos profissionais ou institucionais",
    },
    {
      onde: "5-A.4",
      antes: "demais elementos pertinentes à lógica de conexão",
      depois: "demais elementos pertinentes à lógica de aproximação",
    },
    {
      onde: "9.5",
      antes: "as Conexões realizadas ou as informações de contato",
      depois: "as CONEXÕES realizadas ou as informações de contato",
    },
    {
      onde: "12.1",
      antes: "à aproximação e conexão de potenciais parceiros negociais",
      depois: "à aproximação e apresentação de potenciais parceiros negociais",
    },
    {
      onde: "12.3",
      antes: "a atividade de identificação, conexão ou aproximação resultar em negócio",
      depois: "a atividade de identificação, apresentação ou aproximação resultar em negócio",
    },
    {
      onde: "13.1",
      antes: "decorrer da conexão ou aproximação originada por CONEXÃO realizada por seu intermédio",
      depois: "decorrer da apresentação ou aproximação originada por CONEXÃO realizada por seu intermédio",
    },
    {
      onde: "13.2",
      antes: "negócio originado da conexão estabelecida por CONEXÃO",
      depois: "negócio originado da aproximação estabelecida por CONEXÃO",
    },
    {
      onde: "15.1",
      antes: "cuja identificação, conexão ou aproximação tenha ocorrido por meio da CONEXÃO",
      depois: "cuja identificação, apresentação ou aproximação tenha ocorrido por meio da CONEXÃO",
    },
    {
      onde: "17.1",
      antes: "processamento pelo SMART MATCH; conexão; validações",
      depois: "processamento pelo SMART MATCH; CONEXÃO; validações",
    },
  ];

  it.each(ANTES_E_DEPOIS)("$onde: sai a redação antiga, entra a nova", ({ antes, depois }) => {
    const texto = termo();
    expect(texto, `ainda tem a redação antiga: "${antes}"`).not.toContain(antes);
    expect(texto, `falta a redação nova: "${depois}"`).toContain(depois);
  });
});

/**
 * Achado do Roberto (15/09), lendo a primeira troca: resolver a colisão de
 * vocabulário não podia ENCURTAR cláusula nenhuma — e encurtou cinco.
 *
 * Onde o Dr. Ronei listou três hipóteses ("cuja identificação, conexão ou
 * aproximação tenha ocorrido") ou duas ("decorrer da conexão ou aproximação
 * originada por MATCH"), a primeira troca simplesmente APAGOU a do meio, por
 * ser a palavra que colidia. Isso muda o alcance da obrigação, não o
 * vocabulário: três dessas cláusulas são de dinheiro (a definição de NEGÓCIO
 * DECORRENTE DA CONEXÃO, a 12.3 e a 15.1), e nelas uma hipótese a menos é uma
 * hipótese de remuneração a menos.
 *
 * A correção é conservadora: a hipótese genérica volta, escrita com a palavra
 * comum que o PRÓPRIO Termo já usa nas cláusulas de não circunvenção —
 * "apresentação" (15.2, "terceiros que não tenham sido identificados ou
 * apresentados pela PLATAFORMA"; 15.3 (a), "contraparte identificada ou
 * apresentada pela PLATAFORMA") —, enquanto o evento da plataforma fica com o
 * termo definido em caixa alta. Numeração e remissões não mudam.
 */
describe("D) a troca de palavra não encurtou nenhuma cláusula", () => {
  const HIPOTESES: {
    onde: string;
    /** Como o Dr. Ronei escreveu, com MATCH e com a palavra comum "conexão". */
    noDrRonei: string;
    hipotesesDoDrRonei: string[];
    /** Como ficou na primeira troca, com uma hipótese a menos. */
    encurtada: string;
    /** Como fica agora: mesmas hipóteses, sem a palavra repetida em dois sentidos. */
    final: string;
    hipotesesRestauradas: string[];
  }[] = [
    {
      onde: "2, definição de NEGÓCIO DECORRENTE DA CONEXÃO",
      noDrRonei: "cuja identificação, conexão ou aproximação tenha ocorrido em razão de compatibilidade",
      hipotesesDoDrRonei: ["identificação", "conexão", "aproximação"],
      encurtada: "cuja identificação ou aproximação tenha ocorrido em razão de compatibilidade",
      final: "cuja identificação, apresentação ou aproximação tenha ocorrido em razão de compatibilidade",
      hipotesesRestauradas: ["identificação", "apresentação", "aproximação"],
    },
    {
      onde: "12.1",
      noDrRonei: "à aproximação e conexão de potenciais parceiros negociais",
      hipotesesDoDrRonei: ["aproximação", "conexão"],
      encurtada: "à aproximação entre potenciais parceiros negociais",
      final: "à aproximação e apresentação de potenciais parceiros negociais",
      hipotesesRestauradas: ["aproximação", "apresentação"],
    },
    {
      onde: "12.3",
      noDrRonei: "a atividade de identificação, conexão ou aproximação resultar em negócio",
      hipotesesDoDrRonei: ["identificação", "conexão", "aproximação"],
      encurtada: "a atividade de identificação ou aproximação resultar em negócio",
      final: "a atividade de identificação, apresentação ou aproximação resultar em negócio",
      hipotesesRestauradas: ["identificação", "apresentação", "aproximação"],
    },
    {
      onde: "13.1",
      noDrRonei: "decorrer da conexão ou aproximação originada por MATCH realizado por seu intermédio",
      hipotesesDoDrRonei: ["conexão", "aproximação"],
      encurtada: "decorrer da aproximação originada por CONEXÃO realizada por seu intermédio",
      final: "decorrer da apresentação ou aproximação originada por CONEXÃO realizada por seu intermédio",
      hipotesesRestauradas: ["apresentação", "aproximação"],
    },
    {
      onde: "15.1",
      noDrRonei: "cuja identificação, conexão ou aproximação tenha ocorrido por meio do MATCH",
      hipotesesDoDrRonei: ["identificação", "conexão", "aproximação"],
      encurtada: "cuja identificação ou aproximação tenha ocorrido por meio da CONEXÃO",
      final: "cuja identificação, apresentação ou aproximação tenha ocorrido por meio da CONEXÃO",
      hipotesesRestauradas: ["identificação", "apresentação", "aproximação"],
    },
  ];

  it.each(HIPOTESES)("$onde: a hipótese apagada volta ao texto", ({ encurtada, final }) => {
    const texto = termo();
    expect(texto, `a redação encurtada ainda está no texto: "${encurtada}"`).not.toContain(encurtada);
    expect(texto, `falta a redação restaurada: "${final}"`).toContain(final);
  });

  it.each(HIPOTESES)("$onde: a lista tem o mesmo tamanho da do Dr. Ronei", ({ hipotesesDoDrRonei, final, hipotesesRestauradas }) => {
    expect(hipotesesRestauradas).toHaveLength(hipotesesDoDrRonei.length);
    for (const hipotese of hipotesesRestauradas) {
      expect(final, `a hipótese "${hipotese}" sumiu da redação final`).toContain(hipotese);
    }
  });

  it.each(HIPOTESES)("$onde: a redação do Dr. Ronei, com a palavra repetida, não voltou", ({ noDrRonei }) => {
    expect(termo(), `a redação com a palavra em dois sentidos voltou: "${noDrRonei}"`).not.toContain(noDrRonei);
  });

  it("a palavra comum escolhida é a que o próprio Termo já usava na não circunvenção", () => {
    const texto = termo();
    expect(texto).toContain("terceiros que não tenham sido identificados ou apresentados pela PLATAFORMA");
    expect(texto).toContain("contratar diretamente com a contraparte identificada ou apresentada pela PLATAFORMA");
  });
});

describe("C) a redação mudou, a estrutura não", () => {
  it("as cláusulas reescritas continuam com o mesmo número", () => {
    const texto = termo();
    for (const marcador of ["1.2.", "5-A.1.", "5-A.4.", "9.5.", "12.1.", "12.3.", "13.1.", "13.2.", "15.1.", "17.1."]) {
      expect(texto, `sumiu o marcador da cláusula ${marcador}`).toContain(`\n${marcador} `);
    }
  });

  it("as remissões entre cláusulas continuam apontando para o mesmo lugar", () => {
    const texto = termo();
    expect(texto).toContain("nos termos das Cláusulas 13 e 14");
    expect(texto).toContain("observado o regime da Cláusula 15");
    expect(texto).toContain("sem prejuízo do disposto na Cláusula 15");
    expect(texto).toContain("conforme previsto na Cláusula 5-A");
  });

  it("os 27 títulos de cláusula e o nome do produto ficam onde estavam", () => {
    const texto = termo();
    expect(texto.match(/^## .+$/gm) ?? []).toHaveLength(27);
    expect(texto.match(/SMART MATCH/g) ?? []).toHaveLength(29);
    expect(texto.trimEnd().split("\n").at(-1)).toBe(
      "☐ LI E ACEITO integralmente este Termo Geral de Uso, Proteção de Dados e Intermediação Digital.",
    );
  });
});
