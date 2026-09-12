// Leitura e validação da planilha de participantes, para a carga do primeiro dia.
//
// Módulo PURO: sem mysql2, sem node:fs, sem process.env e sem efeito de topo,
// para o teste (server/importar-participantes.test.ts) provar as regras sem
// banco e sem arquivo — o mesmo desenho de scripts/exame/relatorio.mjs.
//
// Por que existe: a entrega de 16/09 começa com "carregar a base de
// participantes no primeiro dia, com as conexões funcionando", e não havia
// nenhum caminho para isso. `network.create` cadastra UM contato na agenda de
// UMA usuária; `semear-rede-de-teste.mjs` inventa contatos fictícios. Nenhum
// dos dois carrega a base do movimento.
//
// Regras que o formato impõe, e por quê:
//
// 1. O E-MAIL É A IDENTIDADE. `users.email` é único no banco, então é ele que
//    decide se a linha é nova ou já existe. Duas linhas com o mesmo e-mail na
//    mesma planilha são erro da planilha, não do banco: a segunda é recusada
//    com o número da linha, porque escolher silenciosamente uma das duas é
//    como se perde dado de gente.
// 2. NENHUMA SENHA ENTRA AQUI. A conta nasce sem `passwordHash`, e cada
//    participante define a própria senha por "Esqueci minha senha". Planilha
//    com coluna de senha é recusada: senha em planilha circula por e-mail,
//    WhatsApp e backup de Drive.
// 3. O QUE A IA CRUZA TEM DE ESTAR PREENCHIDO. `server/matching.ts` lê setor,
//    possui, procura, país e cidade. Uma linha sem possui e sem procura entra
//    como conta válida, mas nunca gera conexão — então ela é ACEITA COM AVISO,
//    não recusada, e o aviso aparece no relatório com a contagem. "Carregou mas
//    não conecta" é o pior resultado possível e não pode passar em silêncio.
// 4. As tags de possui/procura são texto livre no produto, mas o cruzamento
//    exige tag EXATA, mesmo objeto em direções opostas ou mesma categoria
//    (shared/direcao-do-termo.ts). Por isso a separação por `;` preserva o
//    termo inteiro ("exportação de vinho") em vez de quebrar em palavras: quem
//    quebra em palavras destrói o cruzamento.

/** Os separadores aceitos entre colunas, na ordem em que são testados. */
const SEPARADORES = [";", ",", "\t"];

/** Nomes de coluna aceitos para cada campo. Comparados sem acento e em minúsculas. */
export const COLUNAS = {
  nome: ["nome", "nome completo", "name", "participante", "nome da participante"],
  email: ["email", "e-mail", "e mail", "correio"],
  empresa: ["empresa", "company", "organizacao", "negocio", "razao social"],
  cargo: ["cargo", "funcao", "posicao", "job title", "titulo"],
  setor: ["setor", "area", "area de atuacao", "sector", "segmento"],
  pais: ["pais", "country"],
  cidade: ["cidade", "city", "municipio"],
  possui: ["possui", "o que possui", "o que tem", "oferece", "what i have", "tem"],
  procura: ["procura", "o que procura", "precisa", "busca", "what i need", "necessidade"],
  telefone: ["telefone", "celular", "whatsapp", "phone"],
  linkedin: ["linkedin", "linked in", "perfil linkedin"],
  bio: ["bio", "sobre", "descricao", "apresentacao"],
};

/** Só estas duas são indispensáveis: sem nome e e-mail não há conta. */
export const OBRIGATORIAS = ["nome", "email"];

/** Coluna que faz a planilha inteira ser recusada (ver regra 2). */
export const PROIBIDAS = ["senha", "password", "passwordhash", "hash da senha"];

/**
 * País por nome, para a planilha poder dizer "Brasil" em vez de "BR".
 * `users.country` e `user_profiles.country` são varchar(2), e o globo da tela
 * inicial agrupa por esse código: nome fora desta lista vira aviso, não palpite.
 */
export const PAISES = {
  brasil: "BR", brazil: "BR", br: "BR",
  portugal: "PT", pt: "PT",
  "estados unidos": "US", eua: "US", usa: "US", "united states": "US", us: "US",
  argentina: "AR", ar: "AR", chile: "CL", cl: "CL",
  colombia: "CO", co: "CO", mexico: "MX", mx: "MX",
  espanha: "ES", spain: "ES", es: "ES",
  franca: "FR", france: "FR", fr: "FR",
  alemanha: "DE", germany: "DE", de: "DE",
  italia: "IT", italy: "IT", it: "IT",
  "reino unido": "GB", "united kingdom": "GB", inglaterra: "GB", gb: "GB", uk: "GB",
  angola: "AO", ao: "AO", mocambique: "MZ", mz: "MZ",
  uruguai: "UY", uy: "UY", paraguai: "PY", py: "PY",
  peru: "PE", pe: "PE", canada: "CA", ca: "CA",
  japao: "JP", jp: "JP", china: "CN", cn: "CN",
  india: "IN", in: "IN", "emirados arabes unidos": "AE", ae: "AE",
  "africa do sul": "ZA", za: "ZA", suica: "CH", ch: "CH",
};

/** Tira acento, espaço dobrado e maiúscula: só para COMPARAR, nunca para gravar. */
export function achatar(texto) {
  return String(texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * CSV de verdade: campo entre aspas pode conter o separador, quebra de linha e
 * aspas dobradas. Detecta o separador pela primeira linha (`;` é o que o Excel
 * em português usa) e tolera BOM e CRLF, que é como o arquivo chega do Windows.
 */
export function lerCsv(texto) {
  const limpo = String(texto ?? "").replace(/^﻿/, "");
  if (!limpo.trim()) return { separador: ";", linhas: [] };

  const primeiraLinha = limpo.split(/\r?\n/)[0];
  let separador = SEPARADORES[0], melhor = -1;
  for (const candidato of SEPARADORES) {
    const quantos = primeiraLinha.split(candidato).length;
    if (quantos > melhor) { melhor = quantos; separador = candidato; }
  }

  const linhas = [];
  let campo = "", linha = [], dentroDeAspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') { campo += '"'; i++; }
        else dentroDeAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === separador) { linha.push(campo); campo = ""; continue; }
    if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; continue; }
    if (c === "\r") continue;
    campo += c;
  }
  linha.push(campo);
  linhas.push(linha);

  // Linha totalmente vazia no fim (ou no meio) não é participante.
  return { separador, linhas: linhas.filter(l => l.some(v => String(v).trim() !== "")) };
}

/** Casa o cabeçalho da planilha com os campos conhecidos. */
export function mapearCabecalho(cabecalho) {
  const mapa = {};
  const desconhecidas = [];
  const proibidas = [];

  cabecalho.forEach((bruto, indice) => {
    const nome = achatar(bruto);
    if (!nome) return;
    if (PROIBIDAS.includes(nome)) { proibidas.push(bruto.trim()); return; }
    const campo = Object.keys(COLUNAS).find(c => COLUNAS[c].includes(nome));
    if (campo) { if (!(campo in mapa)) mapa[campo] = indice; }
    else desconhecidas.push(bruto.trim());
  });

  const faltando = OBRIGATORIAS.filter(c => !(c in mapa));
  return { mapa, desconhecidas, faltando, proibidas };
}

const RE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

export function normalizarEmail(bruto) {
  return String(bruto ?? "").trim().toLowerCase();
}

export function emailValido(email) {
  return RE_EMAIL.test(email) && email.length <= 320;
}

/** Devolve o código de duas letras, ou null quando não reconhece. */
export function normalizarPais(bruto) {
  const chave = achatar(bruto);
  if (!chave) return null;
  if (PAISES[chave]) return PAISES[chave];
  if (/^[a-z]{2}$/.test(chave)) return chave.toUpperCase();
  return null;
}

/**
 * Separa as tags preservando o TERMO INTEIRO (ver regra 4). Aceita `;`, `|` e
 * quebra de linha como separadores — nunca espaço, nunca vírgula: "exportação
 * de vinho, azeite" tem duas tags, e "vinho, azeite" viraria três palavras
 * soltas se a vírgula fosse tratada como separador dentro do campo... por isso
 * a vírgula É aceita, mas só quando não há `;` nem `|` no campo, que é o caso
 * em que ela claramente separa itens.
 */
export function separarTags(bruto, limite = 30) {
  const texto = String(bruto ?? "").trim();
  if (!texto) return [];
  const separador = /[;|\n]/.test(texto) ? /[;|\n]+/ : /,/;
  const vistas = new Set();
  const tags = [];
  for (const parte of texto.split(separador)) {
    const tag = parte.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!tag) continue;
    const chave = achatar(tag);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    tags.push(tag);
    if (tags.length >= limite) break;
  }
  return tags;
}


/**
 * O VOCABULÁRIO FECHADO do cruzamento entre perfis, e por que ele existe aqui.
 *
 * Achado da revisão adversarial de 12/09, confirmado por dois verificadores: o
 * motor `server/matching.ts` NÃO cruza texto livre. Ele tem um mapa
 * (HAVE_SATISFIES_NEED) com 11 ids de "possui" e 9 de "procura", os mesmos do
 * onboarding, e id desconhecido não cobre nada.
 *
 * A consequência era pior que "não ajuda": com texto livre gravado, a
 * complementaridade — 30% do score, a maior fatia — cai no ramo "tem dado, sem
 * encaixe" e vale 20, contra os 50 do ramo "neutro" que a MESMA dupla teria com
 * os campos VAZIOS. Ou seja, carregar a base com texto livre deixaria as
 * participantes com score MENOR do que se ninguém tivesse preenchido nada, e o
 * patamar mútuo (75-100) ficaria inalcançável para a base inteira. E a tela do
 * perfil, que só desenha os ids conhecidos, mostraria a seção "o que possuo" em
 * branco.
 *
 * Então a planilha continua aceitando o que a pessoa escreveu, e aqui o texto é
 * TRADUZIDO para os ids. O que não casa não é jogado fora nem forçado: vai para
 * `currentResources`, o campo de texto livre do perfil, e sai no relatório para
 * quem montou a planilha decidir. Linha sem nenhum id reconhecido fica com os
 * campos vazios — neutro, que é melhor que penalizado.
 */
export const VOCABULARIO_POSSUI = {
  industria: ["industria", "fabrica", "manufatura", "producao industrial", "planta"],
  fazenda: ["fazenda", "agro", "agronegocio", "agricultura", "pecuaria", "plantacao", "plantio", "vinicola", "safra"],
  laboratorio: ["laboratorio", "pesquisa", "p&d", "pd", "analise clinica"],
  tecnologia: ["tecnologia", "software", "sistema", "plataforma", "aplicativo", "app", "ti", "dados"],
  investidores: ["investidor", "rede de investidores", "capital", "fundo", "aporte"],
  acesso_governamental: ["governo", "governamental", "setor publico", "licitacao", "prefeitura", "ministerio"],
  commodities: ["commodities", "materia-prima", "materia prima", "insumo", "graos", "minerio", "vinho", "azeite", "cafe", "soja"],
  licencas: ["licenca", "certificacao", "certificado", "registro sanitario", "anvisa", "selo"],
  imoveis: ["imovel", "imoveis", "terreno", "galpao", "sala comercial"],
  logistica: ["logistica", "transporte", "frete", "armazenagem", "armazem", "distribuicao propria", "frota", "alfandeg"],
  // "importacao" e "exportacao" NÃO entram aqui: são a DIREÇÃO do negócio, não
  // o ativo que a pessoa tem. Quem escreve "exportação de vinho" está dizendo
  // que tem vinho — e a regra da cliente é que o match cruza pelo OBJETO do
  // termo (shared/direcao-do-termo.ts: exportar vinho × importar vinho casam).
  // Com elas na lista, o termo mais longo "exportacao" roubava a tag do vinho.
  canais_comerciais: ["canal comercial", "canais comerciais", "rede de lojas", "representante", "ponto de venda", "varejo", "carteira de clientes"],
};

export const VOCABULARIO_PROCURA = {
  fornecedores: ["fornecedor", "fornecedores", "insumo", "materia-prima", "materia prima"],
  investidores: ["investidor", "investidores", "aporte", "capital de risco"],
  compradores: ["comprador", "compradores", "cliente", "clientes", "mercado comprador"],
  distribuidores: ["distribuidor", "distribuidores", "revenda", "revendedor", "importador", "exportador"],
  parceiros: ["parceiro", "parceria", "socio", "joint venture"],
  tecnologia: ["tecnologia", "software", "sistema", "automacao", "digitalizacao"],
  financiamento: ["financiamento", "credito", "emprestimo", "linha de credito", "banco"],
  licencas: ["licenca", "aprovacao", "autorizacao", "registro", "certificacao"],
  consultoria: ["consultoria", "assessoria", "mentoria", "orientacao"],
};

/**
 * Termos que só valem como PALAVRA INTEIRA, mesmo tendo 5 letras ou mais,
 * porque cada um é prefixo de outra coisa: "planta" abre "plantacao" (e roubava
 * a plantação da fazenda para a indústria), "banco" abre "banco de dados",
 * "dados" é genérico demais para valer como começo de palavra.
 */
const TERMOS_SO_EXATOS = new Set(["planta", "banco", "dados"]);

function escaparRegex(termo) {
  return termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Quantas letras o termo casou na tag, ou 0 se não casou.
 *
 * O casamento é ANCORADO NO COMEÇO DA PALAVRA. Termo com menos de 5 letras, e
 * termo de TERMOS_SO_EXATOS, precisa casar a palavra inteira.
 */
function forcaDoTermo(chave, termo) {
  const soExato = termo.length < 5 || TERMOS_SO_EXATOS.has(termo);
  const regex = new RegExp("(^|[^a-z0-9])" + escaparRegex(termo) + (soExato ? "($|[^a-z0-9])" : ""));
  return regex.test(chave) ? termo.length : 0;
}

/**
 * Traduz as tags escritas à mão para os ids que o cruzamento entende.
 *
 * A PRIMEIRA VERSÃO DESTA FUNÇÃO ESTAVA ERRADA, e o erro era silencioso. Ela
 * usava `chave.includes(termo)`, sem âncora: o termo "ti" (de tecnologia)
 * aparece DENTRO de logística, certificação, têxtil, alimentício, ativos e até
 * "rede de investidores" — as seis viravam `tecnologia`. Como a tag "casou",
 * nenhum aviso saía no ensaio (o aviso só existe para tag NÃO reconhecida), e
 * o estrago era o oposto do que esta função existe para evitar: id errado
 * gravado em whatIHave, a mulher de logística cruzando com quem procura
 * tecnologia, e a tela do perfil afirmando um ativo que ela nunca declarou.
 * Pior, `--aplicar` não atualiza e-mail que já existe: arrumar o vocabulário
 * depois não conserta a conta já criada. Achado pela revisão adversarial de
 * 12/09/2026, confirmado por dois verificadores independentes.
 *
 * Três regras, nesta ordem:
 *
 * 1. O termo só casa no COMEÇO de uma palavra — "investidor" continua achando
 *    "investidores", e "ti" não acha mais "logistica".
 * 2. Termo curto, ou da lista TERMOS_SO_EXATOS, casa só como palavra inteira.
 * 3. Ganha o termo MAIS LONGO, não o primeiro do vocabulário: assim a ordem das
 *    chaves deixa de decidir, e "plantacao" (9) vence "planta" (6).
 *
 * Empate entre ids DIFERENTES não vira chute: a tag sai como AMBÍGUA, fica fora
 * dos ids e entra no relatório junto com as não reconhecidas. Preferir o
 * silêncio foi exatamente o defeito anterior.
 */
export function classificarTags(tags, vocabulario) {
  const ids = [];
  const naoReconhecidas = [];
  const ambiguas = [];
  for (const tag of tags) {
    const chave = achatar(tag);
    let melhor = null;
    let empatado = false;
    for (const [id, termos] of Object.entries(vocabulario)) {
      let forca = 0;
      for (const termo of termos) forca = Math.max(forca, forcaDoTermo(chave, termo));
      if (!forca) continue;
      if (!melhor || forca > melhor.forca) { melhor = { id, forca }; empatado = false; }
      else if (forca === melhor.forca && id !== melhor.id) { empatado = true; }
    }
    if (!melhor) naoReconhecidas.push(tag);
    else if (empatado) ambiguas.push(tag);
    else if (!ids.includes(melhor.id)) ids.push(melhor.id);
  }
  return { ids, naoReconhecidas, ambiguas };
}

function cortar(valor, tamanho) {
  const texto = String(valor ?? "").trim().replace(/\s+/g, " ");
  return texto ? texto.slice(0, tamanho) : null;
}

/**
 * Uma linha da planilha vira um participante, ou uma recusa com o motivo.
 * `numero` é o número da linha NO ARQUIVO (contando o cabeçalho), porque é por
 * ele que a pessoa vai achar o erro na planilha dela.
 */
export function validarLinha(linha, mapa, numero, emailsJaVistos) {
  const pegar = campo => (campo in mapa ? linha[mapa[campo]] : undefined);
  const erros = [];
  const avisos = [];

  const nome = cortar(pegar("nome"), 100);
  if (!nome || nome.length < 2) erros.push("nome vazio ou com menos de 2 letras");

  const email = normalizarEmail(pegar("email"));
  if (!email) erros.push("e-mail vazio");
  else if (!emailValido(email)) erros.push(`e-mail inválido: ${email}`);
  else if (emailsJaVistos.has(email)) erros.push(`e-mail repetido na planilha (primeira vez na linha ${emailsJaVistos.get(email)})`);

  if (erros.length) return { ok: false, numero, email: email || null, erros };

  const paisBruto = pegar("pais");
  const pais = normalizarPais(paisBruto);
  if (paisBruto && String(paisBruto).trim() && !pais) avisos.push(`país não reconhecido: "${String(paisBruto).trim()}"`);

  const possui = separarTags(pegar("possui"));
  const procura = separarTags(pegar("procura"));
  if (!possui.length && !procura.length) avisos.push("sem possui e sem procura: a conta entra, mas nunca gera conexão");

  // O que o cruzamento entende, e o que sobrou como texto.
  const classePossui = classificarTags(possui, VOCABULARIO_POSSUI);
  const classeProcura = classificarTags(procura, VOCABULARIO_PROCURA);
  const ambiguas = [...classePossui.ambiguas, ...classeProcura.ambiguas];
  const soltas = [...classePossui.naoReconhecidas, ...classeProcura.naoReconhecidas, ...ambiguas];
  if (classePossui.naoReconhecidas.length || classeProcura.naoReconhecidas.length) {
    const nao = [...classePossui.naoReconhecidas, ...classeProcura.naoReconhecidas];
    avisos.push(`sem equivalente no vocabulário do cruzamento (vai como texto livre no perfil): ${nao.join(", ")}`);
  }
  if (ambiguas.length) {
    avisos.push(`casou com mais de um id, com a mesma força, e por isso NÃO foi classificada (decida na planilha): ${ambiguas.join(", ")}`);
  }
  if ((possui.length || procura.length) && !classePossui.ids.length && !classeProcura.ids.length) {
    avisos.push("nenhuma tag foi reconhecida: o perfil entra NEUTRO no cruzamento, não penalizado");
  }

  const setor = cortar(pegar("setor"), 100);
  if (!setor) avisos.push("sem setor: a dimensão de setor do cruzamento fica neutra");

  return {
    ok: true,
    numero,
    avisos,
    participante: {
      nome, email, pais,
      cidade: cortar(pegar("cidade"), 100),
      empresa: cortar(pegar("empresa"), 200),
      cargo: cortar(pegar("cargo"), 200),
      setor,
      // `possui`/`procura` guardam o que a pessoa escreveu (para o relatório e
      // para o texto livre do perfil); `idsPossui`/`idsProcura` são o que o
      // motor de cruzamento entende e o que vai para whatIHave/whatINeed.
      possui, procura,
      idsPossui: classePossui.ids,
      idsProcura: classeProcura.ids,
      tagsSoltas: soltas,
      telefone: cortar(pegar("telefone"), 40),
      linkedin: cortar(pegar("linkedin"), 512),
      bio: cortar(pegar("bio"), 2000),
    },
  };
}

/**
 * Quanto do perfil a planilha preencheu, na mesma escala de 0 a 100 que a tela
 * usa. Serve para a carga não parecer "perfil completo" quando veio só nome e
 * e-mail — e para o relatório dizer a qualidade da base que entrou.
 */
export function completude(p) {
  const pesos = [
    [Boolean(p.nome), 15], [Boolean(p.empresa), 10], [Boolean(p.cargo), 10],
    [Boolean(p.setor), 15], [Boolean(p.pais), 10], [Boolean(p.cidade), 5],
    // Conta o que o cruzamento entende, não o que foi digitado: perfil cheio de
    // texto que o motor não lê não está completo para o que importa.
    [(p.idsPossui ?? p.possui).length > 0, 15], [(p.idsProcura ?? p.procura).length > 0, 15], [Boolean(p.bio), 5],
  ];
  return pesos.reduce((soma, [tem, peso]) => soma + (tem ? peso : 0), 0);
}

/** Lê a planilha inteira e devolve o que dá para importar e o que não dá. */
export function prepararImportacao(texto) {
  const { separador, linhas } = lerCsv(texto);
  if (!linhas.length) {
    return { erroFatal: "a planilha está vazia", separador, participantes: [], recusadas: [], avisos: [] };
  }

  const [cabecalho, ...corpo] = linhas;
  const { mapa, desconhecidas, faltando, proibidas } = mapearCabecalho(cabecalho);

  if (proibidas.length) {
    return {
      erroFatal: `a planilha tem coluna de senha (${proibidas.join(", ")}). Senha não entra por planilha: cada participante define a dela em "Esqueci minha senha".`,
      separador, participantes: [], recusadas: [], avisos: [], desconhecidas,
    };
  }
  if (faltando.length) {
    return {
      erroFatal: `faltam colunas obrigatórias: ${faltando.join(", ")}. Cabeçalho lido: ${cabecalho.map(c => String(c).trim()).filter(Boolean).join(" | ")}`,
      separador, participantes: [], recusadas: [], avisos: [], desconhecidas,
    };
  }

  const emailsJaVistos = new Map();
  const participantes = [];
  const recusadas = [];
  const avisos = [];

  corpo.forEach((linha, i) => {
    const numero = i + 2; // +1 do cabeçalho, +1 porque planilha começa em 1
    const resultado = validarLinha(linha, mapa, numero, emailsJaVistos);
    if (!resultado.ok) { recusadas.push({ numero: resultado.numero, email: resultado.email, erros: resultado.erros }); return; }
    emailsJaVistos.set(resultado.participante.email, numero);
    participantes.push({ ...resultado.participante, numero, completude: completude(resultado.participante) });
    for (const aviso of resultado.avisos) avisos.push({ numero, email: resultado.participante.email, aviso });
  });

  return { separador, colunasLidas: Object.keys(mapa), desconhecidas, participantes, recusadas, avisos };
}

/** Linha do relatório final, para o script e para o teste concordarem. */
export function resumo({ participantes, recusadas, avisos, novas = null, existentes = null }) {
  const partes = [`${participantes.length} linha(s) válida(s)`, `${recusadas.length} recusada(s)`, `${avisos.length} aviso(s)`];
  if (novas !== null) partes.push(`${novas} conta(s) nova(s)`);
  if (existentes !== null) partes.push(`${existentes} já existia(m)`);
  const semCruzamento = avisos.filter(a => a.aviso.startsWith("sem possui")).length;
  if (semCruzamento) partes.push(`${semCruzamento} sem possui/procura (não geram conexão)`);
  const semVocabulario = avisos.filter(a => a.aviso.startsWith("nenhuma tag foi reconhecida")).length;
  if (semVocabulario) partes.push(`${semVocabulario} com tags fora do vocabulário do cruzamento`);
  return partes.join(" | ");
}
