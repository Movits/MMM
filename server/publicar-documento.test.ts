import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMANDO_PUBLICAR_TERMO_GERAL } from "../scripts/exame/relatorio.mjs";
import {
  ehMarcaDeNotasInternas,
  notasInternasVazadas,
  recortarCorpoDoTermo,
} from "../scripts/publicar-documento.mjs";

/**
 * De scripts/publicar-documento.mjs só sai o recorte do corpo do termo
 * (exercitado também em termo-sem-notas-internas.test.ts): leitura dos
 * argumentos, trava de host e publicação ficam no fluxo principal, colados ao
 * banco. Por isso este arquivo guarda a regra pelo texto-fonte, o mesmo recurso
 * que termo-geral-de-uso.test.ts já usa para o mesmo script.
 *
 * Regra (janela A da lista do Nicolas na PR #135): publicar o Termo Geral de Uso
 * NUNCA dispara o aviso no sino, com ou sem --sem-aviso. Só a última etapa do
 * /onboarding pede esse aceite; quem já tem conta não tem tela para aceitá-lo, e
 * o aviso a mandaria ao /dashboard sem o que fazer. Antes, esquecer a flag
 * inseria uma notificação para TODAS as contas.
 *
 * Achado dos revisores em 15/09/2026: a marca de notas internas tinha sido
 * aplicada a UM dos três termos publicáveis. Os outros dois continuavam com a
 * nota interna solta no corpo — e, como notasInternasVazadas recusa a
 * publicação, o script tinha passado a RECUSAR os dois. Daí as seções D e E:
 * os três arquivos saem limpos, e a linha marcadora é reconhecida com folga
 * (espaços a mais, caixa qualquer), porque comparação exata de linha quebra no
 * dia em que alguém digita "<!-- Notas Internas -->".
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ler = (...partes: string[]) =>
  readFileSync(path.resolve(AQUI, "..", ...partes), "utf8").replace(/\r\n/g, "\n");
const lerTermo = (nome: string) => ler("docs", "termos", nome);

describe("publicar-documento.mjs: o Termo Geral de Uso nunca avisa no sino", () => {
  const fonte = ler("scripts", "publicar-documento.mjs");

  it("termo_geral_de_uso está na lista de tipos sem aviso", () => {
    const lista = fonte.match(/const TIPOS_SEM_AVISO = new Set\(\[([^\]]*)\]\)/);
    expect(lista, "falta a constante TIPOS_SEM_AVISO").not.toBeNull();
    expect(lista![1]).toMatch(/"termo_geral_de_uso"/);
  });

  it("o silêncio vem da lista de tipos, não só da flag --sem-aviso", () => {
    expect(fonte).toMatch(/const semAviso = [^\n]*TIPOS_SEM_AVISO\.has\(tipo\)/);
  });

  it("o console diz que o aviso foi suprimido para o tipo, e por quê", () => {
    expect(fonte).toMatch(/aviso:\s+SUPRIMIDO para \$\{tipo\}/);
    expect(fonte).toMatch(/motivo:[^\n]*\/onboarding[^\n]*\/dashboard/);
  });

  it("o comando do exame de produção continua com --sem-aviso (redundante, mas explícito)", () => {
    expect(COMANDO_PUBLICAR_TERMO_GERAL).toContain("termo_geral_de_uso");
    expect(COMANDO_PUBLICAR_TERMO_GERAL).toContain("--sem-aviso");
  });
});

/**
 * Os três termos que hoje se publicam a partir de um arquivo do repositório.
 * Cada um carrega nota interna (comando de publicação, recado para o jurídico,
 * quem escreveu o quê) que NÃO é o texto que a dona aceita — e que, sem a marca,
 * ou iria para o banco como prova do consentimento, ou faria o script recusar a
 * publicação inteira.
 */
const TERMOS_PUBLICAVEIS = [
  {
    arquivo: "termo-acesso-ouro-provisorio.md",
    tipo: "termo_acesso_ouro",
    clausulas: ["## O que você está autorizando", "## O que elas nunca veem", "## Vigência e alterações"],
    notas: ["O que ainda falta", "Dra. Glenda", "recortarCorpoDoTermo"],
  },
  {
    arquivo: "contrato-comissao-provisorio.md",
    tipo: "contrato_comissao",
    clausulas: [
      "## 1. Objeto",
      "## 2. Comissionamento",
      "## 3. Vigência e alterações",
      "honorários da intermediação",
      "Diretoria Comercial",
    ],
    notas: ["O que ainda falta", "Dra. Glenda", "onboarding.terms", "Rosber", "versão 2 vira a"],
  },
  {
    arquivo: "termo-smart-match-cris-2026-09-05.md",
    tipo: "termo_smart_match",
    clausulas: [
      "WMW – Women Moving the World, Plataforma Internacional",
      "TERMO DE AUTORIZAÇÃO PARA CRUZAMENTO INTELIGENTE DE DADOS",
      "5. Base legal e tratamento de dados",
      "6. Vigência",
    ],
    notas: ["redação da Cris", "O que precisa ser ajustado", "Não cobre a base particular", "--confirmo-producao"],
  },
];

describe("D) os três termos publicáveis saem sem nota interna", () => {
  it.each(TERMOS_PUBLICAVEIS)("$arquivo ($tipo) tem a marca e passa pelo recorte", ({ arquivo, clausulas, notas }) => {
    const corpo = recortarCorpoDoTermo(lerTermo(arquivo));

    // O que a dona aceita: só o texto jurídico.
    expect(corpo).not.toContain("publicar-documento.mjs");
    expect(corpo).not.toContain("<!--");
    for (const nota of notas) {
      expect(corpo, `${arquivo} publicaria a nota interna "${nota}"`).not.toContain(nota);
    }

    // E o texto jurídico sai inteiro.
    for (const clausula of clausulas) {
      expect(corpo, `${arquivo} perdeu "${clausula}" no recorte`).toContain(clausula);
    }
  });

  it.each(TERMOS_PUBLICAVEIS)("$arquivo não é mais RECUSADO pela rede de segurança", ({ arquivo }) => {
    // Antes da marca, notasInternasVazadas acusava o comando de publicação e a
    // seção "O que ainda falta", e a publicação parava aqui.
    expect(notasInternasVazadas(recortarCorpoDoTermo(lerTermo(arquivo)))).toEqual([]);
  });
});

describe("E) a linha marcadora é reconhecida com folga", () => {
  it.each([
    "<!-- NOTAS INTERNAS -->",
    "   <!-- NOTAS INTERNAS -->   ",
    "<!--NOTAS INTERNAS-->",
    "<!--   notas    internas   -->",
    "<!-- Notas Internas -->",
  ])("aceita %j", linha => {
    expect(ehMarcaDeNotasInternas(linha)).toBe(true);
  });

  it.each([
    "<!-- NOTAS -->",
    "<!-- NOTAS INTERNAS",
    "<!-- NOTAS INTERNAS --> e mais texto",
    "As notas internas ficam no fim do arquivo.",
    "",
  ])("recusa %j", linha => {
    expect(ehMarcaDeNotasInternas(linha)).toBe(false);
  });

  it("o recorte corta na variante escrita à mão, não só na forma canônica", () => {
    const corpo = recortarCorpoDoTermo(
      "## Cláusula\n\nTexto que a dona aceita.\n\n<!--  Notas Internas  -->\n\n## O que ainda falta\n\n1. A base legal.\n",
    );
    expect(corpo).toBe("## Cláusula\n\nTexto que a dona aceita.\n");
  });
});
