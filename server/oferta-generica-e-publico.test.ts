import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * A OFERTA GENÉRICA ATENDE A NECESSIDADE DA MESMA FAMÍLIA COM PÚBLICO — pela
 * nota da família, nunca pela de serviço igual.
 *
 * É a metade "60" do item 4 da revisão do Nicolas na #135 (15/09). O que havia
 * antes não era uma nota baixa: era ZERO com bloqueio, porque `cobrePublico`
 * percorre as especialidades da OFERTA e a oferta genérica não tem nenhuma —
 * `.some()` sobre lista vazia é falso. Duas consequências:
 *
 *   1. o mesmo fato com os lados trocados dava notas opostas: "Contabilidade
 *      para pequenas empresas" × "Contador" valia 100, e "Contabilidade" ×
 *      "Contador para pequenas empresas" valia 0;
 *   2. "Logística" × "preciso de logística para exportar meu café" tinha caído
 *      de 60 (main) para 0, que foi a regressão que ele apontou.
 *
 * A outra metade do item 4 — dar 100 quando o público é um dos destinatários
 * comuns — continua sendo decisão do Roberto, e por isso NÃO está aqui: 100
 * dispara e-mail, e a lista `DESTINATARIOS_COMUNS` está marcada no próprio
 * código como a confirmar com ele. Os casos abaixo travam os dois lados disso:
 * o que passou a valer 60 e o que continua valendo 0.
 */

const { scoreMatch, slugifyMatchTag } = await import("./match-service");
const { mesmaFamiliaEEspecialidade, necessidadeGenericaNomeiaOServico } = await import("@shared/tipo-da-oferta");

const item = (label: string, category: string | null = null) =>
  ({ slug: slugifyMatchTag(label), label, category });

const nota = (oferta: string, necessidade: string) => scoreMatch(item(oferta), item(necessidade)).score;

describe("oferta genérica diante de necessidade com público ou finalidade", () => {
  it("'Contabilidade' × 'Contador para pequenas empresas' vale a nota da família", () => {
    expect(nota("Contabilidade", "Contador para pequenas empresas")).toBe(60);
    expect(necessidadeGenericaNomeiaOServico("Contabilidade", null, "Contador para pequenas empresas")).toBe(true);
    expect(mesmaFamiliaEEspecialidade("Contabilidade", null, "Contador para pequenas empresas")).toBe(false);
  });

  it("o público incomum vale o mesmo que o comum, porque a diferença ainda é decisão em aberto", () => {
    expect(nota("Contabilidade", "Contador para MEI")).toBe(60);
    expect(nota("Contabilidade", "Contador para clínicas veterinárias")).toBe(60);
  });

  it("a regressão da logística desfeita: o par voltou a valer o que valia", () => {
    expect(nota("Logística", "Preciso de logística para exportar meu café")).toBe(60);
  });

  it("os lados trocados continuam coerentes: quem nomeia só a família dos dois lados vale 100", () => {
    expect(nota("Contabilidade", "Contador")).toBe(100);
    expect(nota("Contabilidade para pequenas empresas", "Contador")).toBe(100);
  });
});

describe("o que a regra NÃO passou a casar", () => {
  it("oferta com especialidade não atende público de outra: 'palavra igual não é serviço igual'", () => {
    expect(nota("Advocacia tributária", "Advogado para divórcio")).toBe(0);
    expect(nota("Consultoria trabalhista", "Consultoria para segurança do trabalho")).toBe(0);
    expect(nota("Engenharia civil", "Engenheiro para aviação civil")).toBe(0);
  });

  it("família diferente continua sem casar, com oferta genérica ou não", () => {
    expect(nota("Consultoria jurídica", "Advogado para startups")).toBe(0);
    expect(nota("Consultoria jurídica", "Consultoria para advogados")).toBe(0);
  });

  it("necessidade com ESPECIALIDADE (e não público) segue exigindo a especialidade na oferta", () => {
    expect(nota("Advocacia", "Advogado tributarista")).toBe(0);
  });
});
