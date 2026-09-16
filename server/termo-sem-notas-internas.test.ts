import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MARCA_NOTAS_INTERNAS,
  notasInternasVazadas,
  recortarCorpoDoTermo,
} from "../scripts/publicar-documento.mjs";

/**
 * Achado do Nicolas (14/09/2026) na PR #135: o script publicava o arquivo .md
 * INTEIRO, então as notas internas do repositório — o comando de publicação, a
 * lista "o que ainda falta" com "a base legal", os nomes de quem escreveu o quê —
 * viravam parte do texto que a dona aceita e que fica guardado como prova do
 * consentimento.
 *
 * A separação agora é explícita no arquivo: o que estiver dentro de um bloco de
 * comentário HTML, e tudo a partir da linha marcadora, fica fora da publicação.
 * O texto jurídico em si não muda.
 *
 * `notasInternasVazadas` é a rede de segurança para o arquivo que AINDA não foi
 * marcado: o script recusa a publicação em vez de gravar a nota como termo.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const lerTermo = (nome: string) =>
  readFileSync(path.resolve(AQUI, "..", "docs", "termos", nome), "utf8");

describe("A) recortarCorpoDoTermo separa o corpo das notas internas", () => {
  it("corta tudo a partir da linha marcadora", () => {
    const corpo = recortarCorpoDoTermo(
      `## Cláusula\n\nTexto que a dona aceita.\n\n${MARCA_NOTAS_INTERNAS}\n\n## O que ainda falta\n\n1. A base legal.\n`,
    );
    expect(corpo).toBe("## Cláusula\n\nTexto que a dona aceita.\n");
    expect(corpo).not.toContain("base legal");
  });

  it("remove o bloco de comentário HTML, mesmo em várias linhas", () => {
    const corpo = recortarCorpoDoTermo(
      "# Termo\n\n<!-- Publicar com:\n     node scripts/publicar-documento.mjs termo_acesso_ouro arquivo.md\n     ---\n-->\n\n## Cláusula\n\nTexto.\n",
    );
    expect(corpo).toBe("# Termo\n\n## Cláusula\n\nTexto.\n");
  });

  it("não mexe no texto jurídico: sem marca e sem comentário, o corpo é o arquivo", () => {
    const original = "# Termo\n\n## Cláusula 1\n\nTexto **em negrito** e uma lista:\n\n- item;\n- outro item.\n";
    expect(recortarCorpoDoTermo(original)).toBe(original);
  });

  it("normaliza CRLF e não deixa buraco de linhas em branco onde a nota saiu", () => {
    const corpo = recortarCorpoDoTermo("# Termo\r\n\r\n<!-- nota -->\r\n\r\n## Cláusula\r\n\r\nTexto.\r\n");
    expect(corpo).toBe("# Termo\n\n## Cláusula\n\nTexto.\n");
  });
});

describe("B) notasInternasVazadas acusa o arquivo que ainda não foi marcado", () => {
  it("acusa o comando de publicação deixado no corpo", () => {
    expect(notasInternasVazadas("# Termo\n\nnode scripts/publicar-documento.mjs termo_acesso_ouro x.md\n"))
      .toContain("o comando de publicação");
  });

  it("acusa comentário aberto e não fechado, que o recorte não teria como remover", () => {
    expect(notasInternasVazadas("# Termo\n\n<!-- nota que ninguém fechou\n\n## Cláusula\n"))
      .toContain("um comentário HTML aberto e não fechado");
  });

  it('acusa a seção "O que ainda falta" fora da marca', () => {
    expect(notasInternasVazadas("# Termo\n\n## O que ainda falta (para a versão 2)\n\n1. A base legal.\n"))
      .toContain('a seção "O que ainda falta"');
  });

  it("corpo limpo não acusa nada", () => {
    expect(notasInternasVazadas("# Termo\n\n## Cláusula\n\nTexto.\n")).toEqual([]);
  });
});

describe("C) o termo de acesso Ouro do repositório sai sem nota interna", () => {
  const corpo = recortarCorpoDoTermo(lerTermo("termo-acesso-ouro-provisorio.md"));

  it("o que a dona aceita não tem o comando de publicação nem a lista do jurídico", () => {
    expect(corpo).not.toContain("publicar-documento.mjs");
    expect(corpo).not.toContain("O que ainda falta");
    expect(corpo).not.toContain("base legal");
    expect(corpo).not.toContain("<!--");
    expect(notasInternasVazadas(corpo)).toEqual([]);
  });

  it("as cláusulas continuam inteiras", () => {
    expect(corpo).toContain("## O que você está autorizando");
    expect(corpo).toContain("## O que elas veem");
    expect(corpo).toContain("## O que elas nunca veem");
    expect(corpo).toContain("## Registro e revogação");
    expect(corpo).toContain("## Vigência e alterações");
  });
});
