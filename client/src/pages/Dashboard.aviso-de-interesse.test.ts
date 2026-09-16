import { describe, expect, it } from "vitest";
import { CODIGOS, opcoesBase } from "@/i18n";

/**
 * O que a pessoa lê DEPOIS de demonstrar interesse (vídeo do Rosber,
 * 14/09/2026, 21:12: "aqui já pós-cadastro deu um match, ele clicou indicando
 * interesse… em breve nosso consultor fará contato, ao invés de 'esperando
 * pela sua atenção', porque aqui não tem mais o que ele fazer, ele vai aguardar
 * o contato do consultor de negócios").
 *
 * O cartão do pedido em análise dizia "Em análise pelo distribuidor": um
 * estado do nosso processo interno, com o nome de um papel que a membra nem
 * sabe que existe, num botão desabilitado em que ela não tem mais nada a fazer.
 * Passa a dizer que o consultor fará contato, nos 10 idiomas.
 *
 * O que NÃO muda, de propósito: o aviso de novidades do topo
 * ("X novas conexões sugeridas esperando pela sua atenção") continua como
 * está, porque ali ainda há ação dela — são sugestões que ela ainda não abriu.
 */

type Dicionario = Record<string, unknown>;

function texto(idioma: string, chave: string): string {
  const recursos = opcoesBase().resources as Record<string, { translation: Dicionario }>;
  const valor = chave
    .split(".")
    .reduce<unknown>((no, parte) => (no as Dicionario)?.[parte], recursos[idioma].translation);
  if (typeof valor !== "string") throw new Error(`${idioma}: a chave ${chave} não existe`);
  return valor;
}

const CONSULTOR_FARA_CONTATO: Record<string, string> = {
  "pt-BR": "Em breve nosso consultor fará contato",
  en: "Our consultant will contact you soon",
  es: "Nuestro consultor se pondrá en contacto pronto",
  fr: "Notre consultant vous contactera bientôt",
  de: "Unser Berater meldet sich in Kürze bei Ihnen",
  ar: "سيتواصل معك مستشارنا قريبًا",
  hi: "हमारा सलाहकार जल्द ही आपसे संपर्क करेगा",
  ja: "まもなく担当コンサルタントからご連絡します",
  ru: "Наш консультант скоро свяжется с вами",
  zh: "我们的顾问将尽快与您联系",
};

/** O papel interno, como ele apareceria em cada idioma. */
const PAPEL_INTERNO =
  /distribuidor|distributor|distributeur|verteiler|распределител|موزع|वितरक|分配者|分发人|配信担当者|ディストリビューター/i;

describe("o pedido em análise avisa que o consultor fará contato", () => {
  it("os 10 idiomas estão neste teste (idioma novo não passa despercebido)", () => {
    expect([...CODIGOS].sort()).toEqual(Object.keys(CONSULTOR_FARA_CONTATO).sort());
  });

  it.each(CODIGOS)("%s: o cartão do interesse enviado fala do consultor", (idioma) => {
    expect(texto(idioma, "dashboard.interestInReview"), idioma).toBe(CONSULTOR_FARA_CONTATO[idioma]);
  });

  it.each(CODIGOS)("%s: o texto não expõe o papel interno de quem distribui", (idioma) => {
    expect(texto(idioma, "dashboard.interestInReview"), idioma).not.toMatch(PAPEL_INTERNO);
  });

  it.each(CODIGOS)("%s: o aviso de novidades do topo continua pedindo a atenção dela", (idioma) => {
    // Ali há ação da pessoa (sugestões ainda não abertas); a troca do vídeo é
    // só do estado em que ela não tem mais o que fazer.
    expect(texto(idioma, "dashboard.greetingUnseenSuffix").length, idioma).toBeGreaterThan(0);
    expect(texto(idioma, "dashboard.greetingUnseenSuffix"), idioma).not.toBe(
      CONSULTOR_FARA_CONTATO[idioma],
    );
  });
});
