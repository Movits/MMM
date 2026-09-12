import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const AQUI_TESTE: string = (import.meta as { dirname?: string }).dirname ?? ".";

/**
 * A carga da base de participantes (scripts/importacao/planilha.mjs), que é o
 * primeiro item do escopo de 16/09: "carregar a base de gente no primeiro dia,
 * com as conexões funcionando".
 *
 * O teste mora aqui, e não em scripts/, pelo mesmo motivo de
 * server/exame-de-producao.test.ts: o módulo é PURO, então a regra pode ser
 * executada sem banco, sem arquivo e sem planilha de verdade.
 *
 * O que ele protege, em ordem de dano:
 *
 * 1. NINGUÉM SOME. E-mail repetido na planilha é recusa com o número das duas
 *    linhas, nunca "a última ganha" — escolher em silêncio perde uma pessoa.
 * 2. SENHA NÃO ENTRA POR PLANILHA. Coluna de senha recusa o arquivo inteiro.
 * 3. O QUE CARREGA TEM DE CONECTAR. Linha sem possui e sem procura entra, mas
 *    com aviso contado no resumo: "carregou mas não cruza" é o pior resultado
 *    possível e não pode passar calado.
 * 4. A TAG SOBREVIVE INTEIRA. "exportação de vinho" é UMA tag; quebrar em
 *    palavras destrói o cruzamento, que exige termo exato.
 */

import {
  achatar, lerCsv, mapearCabecalho, normalizarEmail, emailValido, normalizarPais,
  separarTags, completude, validarLinha, prepararImportacao, resumo, classificarTags,
  COLUNAS, OBRIGATORIAS, PROIBIDAS, VOCABULARIO_POSSUI, VOCABULARIO_PROCURA,
} from "../scripts/importacao/planilha.mjs";

const CABECALHO = "nome;email;empresa;cargo;setor;pais;cidade;possui;procura";

function planilha(...linhas: string[]) {
  return [CABECALHO, ...linhas].join("\n");
}

// ═════════════════════════ 1. leitura do arquivo ═════════════════════════════
describe("lerCsv — o arquivo como ele chega do Excel", () => {
  it("detecta o ponto e vírgula, que é o separador do Excel em português", () => {
    const { separador, linhas } = lerCsv("a;b;c\n1;2;3");
    expect(separador).toBe(";");
    expect(linhas).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("detecta a vírgula quando é ela que separa", () => {
    expect(lerCsv("a,b,c\n1,2,3").separador).toBe(",");
  });

  it("campo entre aspas guarda o separador, a aspas dobrada e a quebra de linha", () => {
    const { linhas } = lerCsv('nome;bio\n"Silva; Maria";"disse ""oi"" e\nseguiu"');
    expect(linhas[1][0]).toBe("Silva; Maria");
    expect(linhas[1][1]).toBe('disse "oi" e\nseguiu');
  });

  it("engole o BOM do Windows e o CRLF", () => {
    const { linhas } = lerCsv("﻿nome;email\r\nMaria;maria@x.com\r\n");
    expect(linhas[0][0]).toBe("nome");
    expect(linhas[1]).toEqual(["Maria", "maria@x.com"]);
  });

  it("linha vazia no fim não vira participante", () => {
    expect(lerCsv("nome;email\nMaria;maria@x.com\n\n;\n").linhas).toHaveLength(2);
  });

  it("arquivo vazio não explode", () => {
    expect(lerCsv("").linhas).toEqual([]);
    expect(lerCsv("   ").linhas).toEqual([]);
  });
});

// ═════════════════════════ 2. cabeçalho ══════════════════════════════════════
describe("mapearCabecalho — o nome da coluna como a pessoa escreveu", () => {
  it("aceita acento, maiúscula e espaço a mais", () => {
    const { mapa, faltando } = mapearCabecalho(["  NOME Completo ", "E-Mail", "País", "Área de Atuação"]);
    expect(faltando).toEqual([]);
    expect(mapa.nome).toBe(0);
    expect(mapa.email).toBe(1);
    expect(mapa.pais).toBe(2);
    expect(mapa.setor).toBe(3);
  });

  it("diz quais colunas obrigatórias faltam, em vez de importar torto", () => {
    expect(mapearCabecalho(["empresa", "cidade"]).faltando).toEqual(OBRIGATORIAS);
  });

  it("coluna que não existe no cadastro é ignorada, e avisada", () => {
    const { mapa, desconhecidas } = mapearCabecalho(["nome", "email", "indicada por"]);
    expect(desconhecidas).toEqual(["indicada por"]);
    expect(Object.keys(mapa)).toHaveLength(2);
  });

  it("coluna de senha é sinalizada (o arquivo inteiro será recusado)", () => {
    expect(mapearCabecalho(["nome", "email", "Senha"]).proibidas).toEqual(["Senha"]);
    for (const proibida of PROIBIDAS) {
      expect(mapearCabecalho(["nome", "email", proibida]).proibidas).toHaveLength(1);
    }
  });

  it("coluna repetida usa a primeira, não a última", () => {
    expect(mapearCabecalho(["email", "nome", "e-mail"]).mapa.email).toBe(0);
  });
});

// ═════════════════════════ 3. normalizações ══════════════════════════════════
describe("as normalizações que decidem se a conexão acontece", () => {
  it("achatar compara sem acento e sem maiúscula, mas nunca é o que se grava", () => {
    expect(achatar(" Alimentação  E  Bebidas ")).toBe("alimentacao e bebidas");
  });

  it("e-mail vira minúsculo e sem espaço, porque users.email é único", () => {
    expect(normalizarEmail("  Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
  });

  it.each([
    ["maria@exemplo.com", true],
    ["maria@exemplo.com.br", true],
    ["maria arroba exemplo", false],
    ["maria@exemplo", false],
    ["@exemplo.com", false],
    ["maria@exemplo.c", false],
    ["duas@vir,gulas.com", false],
  ])("emailValido(%s) = %s", (email, esperado) => {
    expect(emailValido(email)).toBe(esperado);
  });

  it("país aceita nome, sigla e acento; o que não conhece vira null (não palpite)", () => {
    expect(normalizarPais("Brasil")).toBe("BR");
    expect(normalizarPais("brasil")).toBe("BR");
    expect(normalizarPais("br")).toBe("BR");
    expect(normalizarPais("Estados Unidos")).toBe("US");
    expect(normalizarPais("França")).toBe("FR");
    expect(normalizarPais("Moçambique")).toBe("MZ");
    expect(normalizarPais("Nárnia")).toBeNull();
    expect(normalizarPais("")).toBeNull();
  });

  it("sigla desconhecida de duas letras passa em maiúscula (é código ISO)", () => {
    expect(normalizarPais("nz")).toBe("NZ");
  });
});

// ═════════════════════════ 4. as tags ═══════════════════════════════════════
describe("separarTags — a tag sobrevive inteira", () => {
  it("ponto e vírgula separa, e o termo de três palavras continua UM termo", () => {
    expect(separarTags("exportação de vinho; rótulo próprio")).toEqual(["exportação de vinho", "rótulo próprio"]);
  });

  it("barra vertical e quebra de linha também separam", () => {
    expect(separarTags("vinho|azeite")).toEqual(["vinho", "azeite"]);
    expect(separarTags("vinho\nazeite")).toEqual(["vinho", "azeite"]);
  });

  it("a vírgula só separa quando não há ; nem | no campo", () => {
    expect(separarTags("vinho, azeite")).toEqual(["vinho", "azeite"]);
    // Com ponto e vírgula presente, a vírgula é parte do termo.
    expect(separarTags("exportação de vinho, azeite; logística")).toEqual(["exportação de vinho, azeite", "logística"]);
  });

  it("repetida com acento ou caixa diferente entra uma vez", () => {
    expect(separarTags("Vinho; vinho; VINHO; Vinhó")).toEqual(["Vinho"]);
  });

  it("campo vazio devolve lista vazia, não [\"\"]", () => {
    expect(separarTags("")).toEqual([]);
    expect(separarTags("  ;  ; ")).toEqual([]);
  });

  it("tem teto, para uma célula gigante não virar 500 tags", () => {
    const muitas = Array.from({ length: 90 }, (_, i) => `tag ${i}`).join(";");
    expect(separarTags(muitas)).toHaveLength(30);
  });
});

// ═════════════════════════ 5. linha a linha ═════════════════════════════════
describe("validarLinha", () => {
  const mapa = { nome: 0, email: 1, empresa: 2, cargo: 3, setor: 4, pais: 5, cidade: 6, possui: 7, procura: 8 };
  const linha = (...v: string[]) => v;

  it("linha completa vira participante com as tags separadas", () => {
    const r = validarLinha(
      linha("Maria Silva", "Maria@Exemplo.com", "Vinícola Serra", "Sócia", "Alimentação", "Brasil", "Bento Gonçalves", "exportação de vinho", "distribuidor na Europa"),
      mapa, 2, new Map(),
    );
    expect(r.ok).toBe(true);
    expect(r.participante).toMatchObject({
      nome: "Maria Silva", email: "maria@exemplo.com", pais: "BR",
      setor: "Alimentação", possui: ["exportação de vinho"], procura: ["distribuidor na Europa"],
    });
    expect(r.avisos).toEqual([]);
  });

  it("nome vazio e e-mail inválido são recusa com o motivo, não conta pela metade", () => {
    const r = validarLinha(linha("", "nao-e-email", "", "", "", "", "", "", ""), mapa, 7, new Map());
    expect(r.ok).toBe(false);
    expect(r.numero).toBe(7);
    expect(r.erros.join(" ")).toMatch(/nome vazio/);
    expect(r.erros.join(" ")).toMatch(/inválido/);
  });

  it("e-mail repetido cita a linha onde apareceu antes", () => {
    const vistos = new Map([["maria@exemplo.com", 2]]);
    const r = validarLinha(linha("Maria", "maria@exemplo.com", "", "", "", "", "", "", ""), mapa, 9, vistos);
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toContain("linha 2");
  });

  it("sem possui e sem procura: entra, mas com o aviso de que não vai conectar", () => {
    const r = validarLinha(linha("Maria", "m@x.com", "", "", "Saúde", "BR", "", "", ""), mapa, 3, new Map());
    expect(r.ok).toBe(true);
    expect(r.avisos.join(" ")).toContain("nunca gera conexão");
  });

  it("país que não existe avisa e grava null, em vez de inventar o código", () => {
    const r = validarLinha(linha("Maria", "m@x.com", "", "", "", "Nárnia", "", "vinho", ""), mapa, 4, new Map());
    expect(r.ok).toBe(true);
    expect(r.participante!.pais).toBeNull();
    expect(r.avisos.join(" ")).toContain("Nárnia");
  });

  it("nome e cargo são cortados no tamanho da coluna do banco", () => {
    const r = validarLinha(linha("N".repeat(300), "m@x.com", "", "C".repeat(400), "", "", "", "x", ""), mapa, 5, new Map());
    expect(r.participante!.nome).toHaveLength(100);
    expect(r.participante!.cargo).toHaveLength(200);
  });
});

// ═════════════════════════ 6. completude ════════════════════════════════════
describe("completude — a carga não finge perfil completo", () => {
  it("só nome e e-mail é 15%", () => {
    expect(completude({ nome: "Maria", possui: [], procura: [] })).toBe(15);
  });

  it("planilha cheia passa de 90%", () => {
    expect(completude({
      nome: "Maria", empresa: "X", cargo: "Sócia", setor: "Saúde",
      pais: "BR", cidade: "Recife", possui: ["a"], procura: ["b"], bio: "oi",
    })).toBe(100);
  });

  it("possui e procura valem mais que cidade, porque são o que cruza", () => {
    const comTags = completude({ nome: "M", possui: ["a"], procura: ["b"] });
    const comCidade = completude({ nome: "M", cidade: "Recife", possui: [], procura: [] });
    expect(comTags).toBeGreaterThan(comCidade);
  });
});

// ═════════════════════════ 7. a planilha inteira ════════════════════════════
describe("prepararImportacao — o arquivo inteiro", () => {
  it("separa válidas, recusadas e avisos com o número da linha do arquivo", () => {
    const r = prepararImportacao(planilha(
      "Maria Silva;maria@exemplo.com;Vinícola;Sócia;Alimentação;Brasil;Bento;exportação de vinho;distribuidor",
      ";sem-nome@exemplo.com;;;;;;;",
      "Ana Costa;ana@exemplo.pt;Costa;Diretora;Logística;Portugal;Lisboa;;",
      "Repetida;MARIA@exemplo.com;;;;;;;",
    ));
    expect(r.erroFatal).toBeUndefined();
    expect(r.participantes.map(p => p.email)).toEqual(["maria@exemplo.com", "ana@exemplo.pt"]);
    expect(r.participantes[0].numero).toBe(2);
    expect(r.recusadas.map(x => x.numero)).toEqual([3, 5]);
    expect(r.recusadas[1].erros[0]).toContain("repetido");
    expect(r.avisos.find(a => a.email === "ana@exemplo.pt")!.aviso).toContain("nunca gera conexão");
  });

  it("planilha com coluna de senha é recusada inteira, e o motivo explica o que fazer", () => {
    const r = prepararImportacao("nome;email;senha\nMaria;m@x.com;123456");
    expect(r.erroFatal).toMatch(/senha/i);
    expect(r.erroFatal).toMatch(/Esqueci minha senha/);
    expect(r.participantes).toEqual([]);
  });

  it("sem a coluna de e-mail, recusa dizendo o cabeçalho que leu", () => {
    const r = prepararImportacao("nome;empresa\nMaria;Vinícola");
    expect(r.erroFatal).toContain("email");
    expect(r.erroFatal).toContain("nome | empresa");
  });

  it("planilha vazia recusa sem explodir", () => {
    expect(prepararImportacao("").erroFatal).toMatch(/vazia/);
  });

  it("planilha só com cabeçalho não importa ninguém e não é erro fatal", () => {
    const r = prepararImportacao(CABECALHO);
    expect(r.erroFatal).toBeUndefined();
    expect(r.participantes).toEqual([]);
  });

  it("500 linhas válidas passam, e a ordem é preservada", () => {
    const linhas = Array.from({ length: 500 }, (_, i) =>
      `Participante ${i};p${i}@exemplo.com;Empresa ${i};Sócia;Saúde;Brasil;Recife;tecnologia;investidores`);
    const r = prepararImportacao(planilha(...linhas));
    expect(r.participantes).toHaveLength(500);
    expect(r.recusadas).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.participantes[499].email).toBe("p499@exemplo.com");
    // Tag do vocabulário entra como id: é isso que o cruzamento lê.
    expect(r.participantes[0].idsPossui).toEqual(["tecnologia"]);
    expect(r.participantes[0].idsProcura).toEqual(["investidores"]);
  });
});

// ═════════════════════════ 8. o resumo ══════════════════════════════════════
describe("resumo", () => {
  it("conta as sem cruzamento à parte, porque é o risco silencioso", () => {
    const r = prepararImportacao(planilha(
      "Maria;maria@exemplo.com;;;;;;vinho;azeite",
      "Ana;ana@exemplo.com;;;;;;;",
    ));
    const texto = resumo({ ...r, novas: 2, existentes: 0 });
    expect(texto).toContain("2 linha(s) válida(s)");
    expect(texto).toContain("1 sem possui/procura");
    expect(texto).toContain("2 conta(s) nova(s)");
  });

  it("sem consulta ao banco, não inventa contagem de contas novas", () => {
    const texto = resumo({ participantes: [], recusadas: [], avisos: [] });
    expect(texto).not.toContain("nova(s)");
  });
});

// ═════════════════════════ 9. o formato documentado ════════════════════════
describe("o modelo que o script imprime casa com o que ele aceita", () => {
  it("as colunas do exemplo são todas reconhecidas", () => {
    const exemplo = "nome;email;empresa;cargo;setor;pais;cidade;possui;procura;linkedin;bio";
    const { faltando, desconhecidas } = mapearCabecalho(exemplo.split(";"));
    expect(faltando).toEqual([]);
    expect(desconhecidas).toEqual([]);
  });

  it("todo campo conhecido tem pelo menos um nome aceito, e nenhum nome se repete entre campos", () => {
    const todos: string[] = [];
    for (const [campo, nomes] of Object.entries(COLUNAS)) {
      expect(nomes.length, campo).toBeGreaterThan(0);
      todos.push(...nomes);
    }
    expect(new Set(todos).size).toBe(todos.length);
  });
});

// ════════ 10. o INSERT do script conferido contra o drizzle/schema.ts ════════
// Não dá para executar o INSERT aqui: esta máquina não tem MySQL local nem
// Docker, e o `.env` de trabalho aponta para a produção. O que dá para provar
// sem banco é o que mais quebra numa carga: coluna que não existe, contagem de
// `?` diferente da contagem de colunas, e coluna obrigatória esquecida — os
// três erros que o teste da exclusão pegou quando rodou contra o MySQL de
// verdade. Mesmo método do teste da limpeza do exame: ler o schema como texto.
describe("o INSERT da carga casa com o schema", () => {
  const AQUI = (import.meta as { dirname?: string }).dirname ?? ".";
  const raiz = pathResolve(AQUI, "..");
  const fonteScript = readFileSync(pathResolve(raiz, "scripts", "importar-participantes.mjs"), "utf8");
  const fonteSchema = readFileSync(pathResolve(raiz, "drizzle", "schema.ts"), "utf8");

  /** Recorte entre dois marcadores literais: sem regex montada em texto. */
  function entre(fonte: string, abre: string, fecha: string, de = 0) {
    const inicio = fonte.indexOf(abre, de);
    if (inicio < 0) return null;
    const fim = fonte.indexOf(fecha, inicio + abre.length);
    if (fim < 0) return null;
    return { texto: fonte.slice(inicio + abre.length, fim), fim };
  }

  function colunasDaTabela(nomeSql: string) {
    const bloco = entre(fonteSchema, 'mysqlTable("' + nomeSql + '", {', "\n}");
    expect(bloco, `tabela ${nomeSql} não encontrada no schema`).not.toBeNull();
    const colunas = new Map<string, string>();
    for (const m of bloco!.texto.matchAll(/^[ \t]+(\w+):[ \t]*([^\n]+)/gm)) {
      const nomeNoBanco = /\(\s*"([^"]+)"/.exec(m[2])?.[1] ?? m[1];
      colunas.set(nomeNoBanco, m[2]);
    }
    return colunas;
  }

  /** As colunas e os `?` do INSERT daquela tabela, como o script os escreve. */
  function insertDoScript(tabela: string) {
    const lista = entre(fonteScript, "INSERT INTO `" + tabela + "` (", ")");
    expect(lista, `INSERT em ${tabela} não encontrado no script`).not.toBeNull();
    const valoresCru = entre(fonteScript, "VALUES (", ")", lista!.fim);
    expect(valoresCru, `VALUES de ${tabela} não encontrado`).not.toBeNull();
    const colunas = [...lista!.texto.matchAll(/`([^`]+)`/g)].map(x => x[1]);
    const valores = valoresCru!.texto.split(",").map(v => v.trim()).filter(Boolean);
    return { colunas, valores };
  }

  it.each(["users", "user_profiles"])("todas as colunas do INSERT em %s existem no schema", (tabela) => {
    const doSchema = colunasDaTabela(tabela);
    const { colunas } = insertDoScript(tabela);
    expect(colunas.length).toBeGreaterThan(5);
    for (const coluna of colunas) {
      expect(doSchema.has(coluna), `${tabela}.${coluna} está no INSERT e não existe no schema`).toBe(true);
    }
  });

  it.each(["users", "user_profiles"])("em %s, a contagem de colunas é igual à de valores", (tabela) => {
    const { colunas, valores } = insertDoScript(tabela);
    expect(valores).toHaveLength(colunas.length);
  });

  it.each(["users", "user_profiles"])("nenhuma coluna obrigatória de %s fica de fora", (tabela) => {
    const doSchema = colunasDaTabela(tabela);
    const { colunas } = insertDoScript(tabela);
    const obrigatorias: string[] = [];
    for (const [nome, definicao] of doSchema) {
      if (!definicao.includes(".notNull()")) continue;
      if (/default|autoincrement|generatedAlwaysAs/.test(definicao)) continue;
      obrigatorias.push(nome);
    }
    for (const coluna of obrigatorias) {
      expect(colunas.includes(coluna), `${tabela}.${coluna} é obrigatória e não está no INSERT`).toBe(true);
    }
  });

  it("a conta nasce sem senha, prata e com onboarding pendente — igual ao registerUser", () => {
    const { colunas } = insertDoScript("users");
    expect(colunas).toContain("passwordHash");
    expect(fonteScript).toMatch(/VALUES \(\?, \?, \?, NULL,/);   // passwordHash nulo
    expect(fonteScript).toContain("'silver'");
    expect(fonteScript).toContain('"email_" + crypto.randomBytes(16).toString("hex")');
  });

  it("grava os dois nomes de cada campo duplicado, senão metade do produto fica cega", () => {
    const { colunas } = insertDoScript("user_profiles");
    for (const par of [["sector", "sectors"], ["company", "currentCompany"], ["jobTitle", "currentRole"]]) {
      for (const coluna of par) expect(colunas, `falta ${coluna}`).toContain(coluna);
    }
    // whatIHave e whatINeed são o que o cruzamento lê: sem eles a carga não conecta.
    expect(colunas).toContain("whatIHave");
    expect(colunas).toContain("whatINeed");
  });
});

// ══ 11. a instrução da carga é a MESMA que a tela de login dá ═══════════════
// A conta importada nasce sem senha, então a primeira coisa que a participante
// faz é "Esqueci minha senha". Se o script instruir uma coisa e o login
// responder outra, ela fica sem saída — foi o que acontecia com a mensagem
// antiga, que mandava tentar com Google num produto sem login por provedor.
describe("carga e login dizem a mesma coisa sobre a conta sem senha", () => {
  it("a mensagem do login cita Esqueci minha senha, e o script também", async () => {
    const { MENSAGEM_CONTA_SEM_SENHA } = await import("./auth");
    expect(MENSAGEM_CONTA_SEM_SENHA).toContain("Esqueci minha senha");
    expect(MENSAGEM_CONTA_SEM_SENHA).not.toMatch(/Google|provedor/);

    const AQUI = (import.meta as { dirname?: string }).dirname ?? ".";
    const fonte = readFileSync(pathResolve(AQUI, "..", "scripts", "importar-participantes.mjs"), "utf8");
    expect(fonte).toContain("Esqueci minha senha");
  });
});


// ══ 12. o vocabulário fechado do cruzamento ══════════════════════════════════
// Achado da revisão adversarial de 12/09, confirmado por dois verificadores:
// server/matching.ts cruza por ID, não por texto. Gravar texto livre em
// whatIHave/whatINeed fazia a complementaridade (30% do score) cair para 20 —
// PIOR que os 50 de um perfil vazio. Toda a base carregada ficaria abaixo de
// quem não preencheu nada, e o patamar mútuo seria inalcançável.
describe("as tags viram os ids que o cruzamento entende", () => {
  it("traduz o que a pessoa escreveu, casando no começo da palavra", () => {
    expect(classificarTags(["exportação de vinho"], VOCABULARIO_POSSUI).ids).toEqual(["commodities"]);
    expect(classificarTags(["distribuidor na Europa"], VOCABULARIO_PROCURA).ids).toEqual(["distribuidores"]);
    expect(classificarTags(["Armazém alfandegado"], VOCABULARIO_POSSUI).ids).toEqual(["logistica"]);
  });

  // ── A REGRESSÃO QUE ESTE BLOCO EXISTE PARA IMPEDIR ────────────────────────
  // A primeira versão de classificarTags casava por `includes` solto. O termo
  // "ti" (de tecnologia) mora DENTRO de logística, certificação, têxtil,
  // alimentício, ativos e "rede de investidores": as seis viravam `tecnologia`
  // em silêncio, porque tag que "casa" não gera aviso nenhum no ensaio. Cada
  // linha abaixo é um caso que o verificador rodou e viu sair errado.
  it.each([
    ["logística própria", "logistica"],
    ["certificação ISO 9001", "licencas"],
    ["certificado de origem", "licencas"],
    ["rede de investidores", "investidores"],
    ["plantação de soja", "fazenda"],
    ["plantio de café", "fazenda"],
    ["planta industrial", "industria"],
    ["fábrica de embalagens", "industria"],
    ["TI", "tecnologia"],
    ["app próprio", "tecnologia"],
  ])("'%s' vira '%s', e não tecnologia por causa das letras 'ti'", (tag, id) => {
    expect(classificarTags([tag], VOCABULARIO_POSSUI).ids).toEqual([id]);
  });

  it.each([["têxtil"], ["alimentício"], ["artigos de vestuário"], ["atividade rural"], ["ativos imobiliários"]])(
    "'%s' não casa com nada e volta como não reconhecida, em vez de virar tecnologia",
    tag => {
      const r = classificarTags([tag], VOCABULARIO_POSSUI);
      expect(r.ids).toEqual([]);
      expect(r.naoReconhecidas).toEqual([tag]);
    },
  );

  it("ganha o termo mais longo, então a ordem das chaves do vocabulário não decide", () => {
    // "planta" (industria) é prefixo de "plantacao" (fazenda), e industria vem
    // antes no objeto. Com o primeiro-que-casa, a plantação virava indústria.
    expect(classificarTags(["plantação de soja"], VOCABULARIO_POSSUI).ids).toEqual(["fazenda"]);
  });

  it("empate entre ids diferentes não vira chute: sai como ambígua", () => {
    const vocabulario = { primeiro: ["alfa"], segundo: ["beta"] };
    const r = classificarTags(["alfa e beta"], vocabulario);
    expect(r.ids).toEqual([]);
    expect(r.ambiguas).toEqual(["alfa e beta"]);
    expect(r.naoReconhecidas).toEqual([]);
  });

  it("importação e exportação são direção do negócio, não ativo: não roubam a tag do objeto", () => {
    // A regra da cliente é cruzar pelo OBJETO ("exportar vinho" × "importar
    // vinho"), então "exportacao" não pode vencer "vinho" por ser mais longa.
    expect(classificarTags(["exportação de vinho"], VOCABULARIO_POSSUI).ids).toEqual(["commodities"]);
    expect(classificarTags(["importação de azeite"], VOCABULARIO_POSSUI).ids).toEqual(["commodities"]);
  });

  it("o que não casa não é inventado nem jogado fora: volta como não reconhecida", () => {
    const r = classificarTags(["rótulo próprio", "tecnologia"], VOCABULARIO_POSSUI);
    expect(r.ids).toEqual(["tecnologia"]);
    expect(r.naoReconhecidas).toEqual(["rótulo próprio"]);
  });

  it("id repetido entra uma vez só", () => {
    expect(classificarTags(["software", "sistema", "plataforma"], VOCABULARIO_POSSUI).ids).toEqual(["tecnologia"]);
  });

  it("todo id do vocabulário existe no motor de cruzamento", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(pathResolve(AQUI_TESTE, "matching.ts"), "utf8");
    const mapa = fonte.slice(fonte.indexOf("const HAVE_SATISFIES_NEED"), fonte.indexOf("/** Quantas necessidades"));
    for (const id of Object.keys(VOCABULARIO_POSSUI)) {
      expect(mapa, `possui '${id}' não existe em HAVE_SATISFIES_NEED`).toContain(`${id}:`);
    }
    for (const id of Object.keys(VOCABULARIO_PROCURA)) {
      expect(mapa, `procura '${id}' não é satisfeito por nada`).toContain(`"${id}"`);
    }
  });

  it("linha com tags fora do vocabulário entra NEUTRA, não penalizada", () => {
    const r = prepararImportacao(planilha(
      "Maria;maria@exemplo.com;;;;;;coisa que ninguém mapeou;outra coisa estranha",
    ));
    const p = r.participantes[0];
    expect(p.idsPossui).toEqual([]);
    expect(p.idsProcura).toEqual([]);
    // O texto não se perde: sai no aviso, e o script grava em currentResources.
    expect(p.possui).toEqual(["coisa que ninguém mapeou"]);
    expect(r.avisos.some(a => a.aviso.startsWith("nenhuma tag foi reconhecida"))).toBe(true);
  });

  it("a completude conta o que o cruzamento lê, não o que foi digitado", () => {
    const comIds = completude({ nome: "M", possui: ["tecnologia"], procura: ["investidores"], idsPossui: ["tecnologia"], idsProcura: ["investidores"] });
    const soTexto = completude({ nome: "M", possui: ["algo estranho"], procura: ["outro"], idsPossui: [], idsProcura: [] });
    expect(comIds).toBeGreaterThan(soTexto);
  });
});

// ══ 13. o modelo que o script imprime é lido certo por ele mesmo ═════════════
// Achado da revisão: o exemplo tinha ';' dentro de campo num CSV de ';', sem
// aspas — e o próprio script lia a demanda da Maria como o LinkedIn dela, em
// silêncio, com completude de 100%. O teste antigo redigitava o cabeçalho num
// literal em vez de importar a constante, então não pegava nada disso.
describe("o MODELO de verdade, lido pelo próprio parser", () => {
  it("cada campo do exemplo cai na coluna certa", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(pathResolve(AQUI_TESTE, "..", "scripts", "importar-participantes.mjs"), "utf8");
    const inicio = fonte.indexOf("const MODELO = `") + "const MODELO = `".length;
    const modelo = fonte.slice(inicio, fonte.indexOf("`;", inicio));

    const r = prepararImportacao(modelo);
    expect(r.erroFatal).toBeUndefined();
    expect(r.recusadas).toEqual([]);
    expect(r.participantes).toHaveLength(2);

    const maria = r.participantes[0];
    expect(maria.email).toBe("maria@exemplo.com.br");
    expect(maria.empresa).toBe("Vinícola Serra");
    expect(maria.cargo).toBe("Sócia-fundadora");
    expect(maria.cidade).toBe("Bento Gonçalves");
    expect(maria.possui).toEqual(["exportação de vinho", "rótulo próprio"]);
    expect(maria.procura).toEqual(["distribuidor na Europa", "logística refrigerada"]);
    expect(maria.linkedin).toBe("linkedin.com/in/exemplo");
    expect(maria.bio).toContain("vinho fino");
    expect(maria.idsPossui.length).toBeGreaterThan(0);
  });
});
