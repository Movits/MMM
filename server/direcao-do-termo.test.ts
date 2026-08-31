import { describe, expect, it } from "vitest";
import { analisarTermo, direcaoEfetiva, saoConcorrentes } from "@shared/direcao-do-termo";
import { scoreMatch } from "./match-service";

const possui = (label: string, category = "Comércio exterior") =>
  ({ slug: label.toLowerCase().replace(/\s+/g, "-"), label, category });

describe("Etapa 11 — direção mora no campo, nunca na palavra parecida", () => {
  it("separa o verbo do objeto quando o termo começa por verbo de direção", () => {
    expect(analisarTermo("Exportar vinho")).toEqual({ direcao: "oferta", objeto: "vinho", verbo: "exportar" });
    expect(analisarTermo("Importar vinho")).toEqual({ direcao: "demanda", objeto: "vinho", verbo: "importar" });
    expect(analisarTermo("Importação de vinho")).toEqual({ direcao: "demanda", objeto: "vinho", verbo: "importacao" });
  });

  it("deixa neutro o termo sem verbo na cabeça, que é a esmagadora maioria", () => {
    expect(analisarTermo("Soja em grande volume").direcao).toBe("neutro");
    expect(analisarTermo("Armazenagem refrigerada").direcao).toBe("neutro");
    expect(analisarTermo("Aporte para expansão").direcao).toBe("neutro");
  });

  it("não confunde ator com direção: substantivo não é verbo", () => {
    // "Compradores no exterior" é uma coisa que alguém pode ter para oferecer.
    // Se atores contassem como direção, este match — que funciona hoje — morria.
    expect(analisarTermo("Compradores no exterior").direcao).toBe("neutro");
    expect(analisarTermo("Fornecedores homologados").direcao).toBe("neutro");
    expect(analisarTermo("Investidores anjo").direcao).toBe("neutro");
  });

  it("só lê o verbo na cabeça do termo, não no meio", () => {
    // Quem oferece assessoria em exportação não está exportando nada.
    expect(analisarTermo("Assessoria em exportação").direcao).toBe("neutro");
    expect(analisarTermo("Seguro de crédito à exportação").direcao).toBe("neutro");
  });

  it("o campo manda quando a palavra é neutra, e a palavra manda quando existe", () => {
    expect(direcaoEfetiva("Vinho tinto", "demanda")).toBe("demanda");
    expect(direcaoEfetiva("Exportar vinho", "demanda")).toBe("oferta");
  });

  it("verbos ambíguos ficam de fora de propósito", () => {
    // "Alugar" serve para quem cede e para quem toma. Classificar seria chutar.
    expect(analisarTermo("Alugar galpão").direcao).toBe("neutro");
  });
});

describe("Etapa 11 — palavras que só anunciam, e não são a coisa", () => {
  it("tira da frente o marcador e revela o objeto", () => {
    // Encontrado em produção: "Terras raras" contra "procura terras raras"
    // dava 60, porque o objeto de um era `terras-raras` e o do outro
    // `procura-terras-raras`. É a mesma coisa dita de dois jeitos.
    expect(analisarTermo("procura terras raras").objeto).toBe("terras-raras");
    expect(analisarTermo("Terras raras").objeto).toBe("terras-raras");
    expect(analisarTermo("possui terras").objeto).toBe("terras");
    expect(analisarTermo("precisa de terras").objeto).toBe("terras");
  });

  it("marcador NÃO é verbo de direção, e por isso nunca acusa concorrência", () => {
    // Uma recrutadora que OFERECE "Procura de talentos" e uma empresa que
    // PROCURA "Procura de talentos" são o negócio, não concorrentes. Se
    // "procura" marcasse direção, as duas seriam lidas como demanda e o motor
    // deixaria de apresentar exatamente quem devia.
    expect(analisarTermo("Procura de talentos").direcao).toBe("neutro");
    expect(saoConcorrentes("Procura de talentos", "Procura de talentos")).toBe(false);
    expect(scoreMatch(possui("Procura de talentos", "RH"), possui("Procura de talentos", "RH")).score).toBe(100);
  });

  it("verbo de direção depois do marcador é quem manda", () => {
    // "Procuro exportar vinho" é oferta: quem escreveu disse o que pretende
    // fazer, e o marcador só anunciava que vinha alguma coisa.
    expect(analisarTermo("procuro exportar vinho")).toEqual({ direcao: "oferta", objeto: "vinho", verbo: "exportar" });
    expect(analisarTermo("procura importar vinho")).toEqual({ direcao: "demanda", objeto: "vinho", verbo: "importar" });
  });

  it("a regra do vinho continua valendo com marcador na frente", () => {
    expect(scoreMatch(possui("Exportar vinho"), possui("procura importar vinho")).score).toBe(100);
    expect(scoreMatch(possui("Exportar vinho"), possui("procura exportar vinho")))
      .toHaveProperty("bloqueio", "concorrentes");
  });

  it("marcador sozinho não vira objeto vazio", () => {
    // Descascar até não sobrar nada faria "Procura" casar com "Possui", e com
    // qualquer outro termo igualmente descascado até o osso.
    expect(analisarTermo("Procura").objeto).toBe("procura");
    expect(analisarTermo("Possui").objeto).toBe("possui");
    expect(scoreMatch(possui("Possui", "A"), possui("Procura", "B")).score).toBe(0);
  });
});

describe("Etapa 11 — lugar não é produto", () => {
  // Achados numa revisão adversarial: todos davam 100, o score máximo, que até
  // então era reservado a quem tem literalmente a mesma coisa. Em comércio
  // exterior o complemento do termo quase sempre é o destino, não a mercadoria,
  // então o erro não era raro — era o caso comum. E 100 passa de
  // EMAIL_THRESHOLD, então o par ainda saía por e-mail como oportunidade.
  const pares: [string, string][] = [
    ["Exportação para a China", "Importação da China"],
    ["Distribuição no Nordeste", "Compras no Nordeste"],
    ["Exportação para o Mercosul", "Compras no Mercosul"],
    ["Venda para o varejo", "Compra no varejo"],
    ["Exportação em grande volume", "Importação em grande volume"],
  ];

  it.each(pares)("%s x %s não vira 100: não têm produto em comum", (ativo, necessidade) => {
    expect(scoreMatch(possui(ativo), possui(necessidade)).score).toBeLessThan(100);
  });

  it("preposição de lugar impede a extração do objeto", () => {
    // "para", "em", "no" apresentam destino ou canal. O genitivo apresenta a
    // coisa — e continua funcionando.
    expect(analisarTermo("Exportação para a China").objeto).toBe("exportacao-para-a-china");
    expect(analisarTermo("Exportação de vinho").objeto).toBe("vinho");
  });

  it("o par que a regra existe para achar continua em 100", () => {
    expect(scoreMatch(possui("Exportar vinho"), possui("Importar vinho")).score).toBe(100);
    expect(scoreMatch(possui("Exportação de vinho"), possui("Vinho")).score).toBe(100);
  });
});

describe("Etapa 11 — o critério semântico está desligado, e isso tem consequência", () => {
  it("nem a similaridade máxima possível chega a virar sugestão", () => {
    // TRIPWIRE. Este teste falha de propósito no dia em que alguém religar o
    // critério semântico — e é aí que se deve reler o termo de consentimento:
    // enquanto ele está desligado, `docs/termos/termo-smart-match.md` afirma
    // que nenhum dado sai da plataforma, e o recálculo nem chama o provedor de
    // embeddings. Religar sem republicar o termo transforma o documento numa
    // afirmação falsa. Se você chegou aqui de propósito, atualize os dois.
    expect(scoreMatch(possui("Câmaras frias em Santos", "Logística"),
                      possui("Terrenos licenciados", "Imóveis"), 1).score).toBeLessThan(50);
  });
});

describe("Etapa 11 — a regra dentro do motor de match", () => {
  it("nunca apresenta duas pontas que querem a mesma coisa", () => {
    // A Bodega escreveu no campo de PROCURA, mas o texto diz "exportar": ela
    // está oferecendo. Duas exportadoras são concorrentes.
    const resultado = scoreMatch(possui("Exportar vinho"), possui("Exportar vinho"));
    expect(resultado.score).toBe(0);
    expect(resultado).toHaveProperty("bloqueio", "concorrentes");
  });

  it("bloqueia mesmo com a categoria idêntica, que antes valia 60", () => {
    const resultado = scoreMatch(
      { slug: "importar-vinho", label: "Importar vinho", category: "Comércio exterior" },
      { slug: "importacao-de-uva", label: "Importação de uva", category: "Comércio exterior" },
    );
    expect(resultado.score).toBe(0);
  });

  it("bloqueia mesmo com o texto idêntico, que antes valia 100", () => {
    expect(scoreMatch(possui("Exportar vinho"), possui("Exportar vinho")).score).toBe(0);
  });

  it("dá o score máximo ao par oposto — é onde existe negócio", () => {
    // Mesmo objeto, direções contrárias. Antes disto o par valia só os 60 da
    // categoria, abaixo do par concorrente que valia 100.
    expect(scoreMatch(possui("Exportar vinho"), possui("Importar vinho")))
      .toEqual({ score: 100, type: "exact" });
  });

  it("casa o verbo com o substantivo do mesmo objeto", () => {
    expect(scoreMatch(possui("Exportação de vinho"), possui("Vinho")).score).toBe(100);
  });

  it("não bloqueia quando só uma ponta traz verbo: falta evidência", () => {
    // O campo já separou as duas. Sem verbo dos dois lados não há conflito
    // declarado, e barrar aqui tiraria matches legítimos.
    expect(scoreMatch(possui("Vinho"), possui("Importar vinho")).score).toBe(100);
    expect(scoreMatch(possui("Exportar vinho"), possui("Vinho")).score).toBe(100);
    // Objeto diferente ainda cai na categoria, como sempre caiu — o que importa
    // aqui é que nada foi barrado. "Vinho tinto" não é "vinho": casar sinônimo e
    // variação é o trabalho do vocabulário canônico, não desta regra.
    expect(scoreMatch(possui("Vinho tinto"), possui("Importar vinho")).score).toBe(60);
  });

  it("não mexe em nada que não traga verbo de direção", () => {
    // Os 10 contatos da rede de teste seguem exatamente como antes.
    expect(scoreMatch(
      { slug: "compradores-no-exterior", label: "Compradores no exterior", category: "Comércio exterior" },
      { slug: "compradores-no-exterior", label: "Compradores no exterior", category: "Comércio exterior" },
    )).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(
      { slug: "armazenagem-refrigerada", label: "Armazenagem refrigerada", category: "Logística" },
      { slug: "galpao-alfandegado", label: "Galpão alfandegado", category: "logistica" },
    )).toEqual({ score: 60, type: "category" });
  });

  it("termo que é só o verbo não vira objeto vazio casando com qualquer um", () => {
    // "Exportação" e "Importação" não têm objeto. Se o objeto virasse "", os
    // dois casariam em 100 sem ter nada em comum.
    expect(saoConcorrentes("Exportação", "Exportação")).toBe(true);
    expect(scoreMatch(possui("Exportação"), possui("Importação")).score).toBe(60);
  });
});
