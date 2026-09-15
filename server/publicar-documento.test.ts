import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMANDO_PUBLICAR_TERMO_GERAL } from "../scripts/exame/relatorio.mjs";

/**
 * scripts/publicar-documento.mjs não exporta nada: leitura dos argumentos, trava
 * de host e publicação ficam no fluxo principal, colados ao banco. Por isso este
 * arquivo guarda a regra pelo texto-fonte, o mesmo recurso que
 * termo-geral-de-uso.test.ts já usa para o mesmo script.
 *
 * Regra (janela A da lista do Nicolas na PR #135): publicar o Termo Geral de Uso
 * NUNCA dispara o aviso no sino, com ou sem --sem-aviso. Só a última etapa do
 * /onboarding pede esse aceite; quem já tem conta não tem tela para aceitá-lo, e
 * o aviso a mandaria ao /dashboard sem o que fazer. Antes, esquecer a flag
 * inseria uma notificação para TODAS as contas.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ler = (...partes: string[]) =>
  readFileSync(path.resolve(AQUI, "..", ...partes), "utf8").replace(/\r\n/g, "\n");

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
