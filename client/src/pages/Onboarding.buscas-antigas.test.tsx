import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { rotuloDaBusca } from "@/lib/interesses";
import {
  BUSCA_LEGADA_EQUIVALENTE,
  BUSCAS_LEGADAS_SEM_EQUIVALENTE,
  CHAVE_QUERO_MENTORAR,
  VALORES_ACEITOS_EM_SEEKING_TYPES,
} from "@shared/o-que-busca";

import ar from "@/i18n/locales/ar.json";
import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import hi from "@/i18n/locales/hi.json";
import ja from "@/i18n/locales/ja.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import ru from "@/i18n/locales/ru.json";
import zh from "@/i18n/locales/zh.json";

/**
 * Limpeza das 5 opções antigas de "O que você busca?" (pedido do Roberto, 15/09).
 *
 * As 12 opções novas entraram em 14/09 (Lucas) sem migrar dado: perfis gravados
 * antes seguem com a chave antiga. A limpeza é de RÓTULO, não de dado:
 *
 *  - `investor`, `strategic_partner` e `team` têm equivalente novo, e
 *    `rotuloDaBusca` troca a chave ANTES de procurar tradução: o rótulo antigo
 *    deles não tinha como aparecer em tela nenhuma, e saiu dos 10 idiomas;
 *  - `job` e `mentor` não têm equivalente e continuam sendo exibidos com o
 *    rótulo antigo — ficam;
 *  - a DESCRIÇÃO antiga (`*_desc`) só é lida numa chave literal, `be_mentor_desc`
 *    (o botão "Quero também mentorar", que é oferta e não busca). As demais
 *    saíram: nenhuma tela mostra descrição de valor legado.
 *
 * O servidor continua ACEITANDO as 5 chaves antigas: é compatibilidade com dado
 * já gravado, não cache de deploy (ver shared/o-que-busca.ts).
 */

const IDIOMAS: Record<string, unknown> = { ar, de, en, es, fr, hi, ja, "pt-BR": ptBR, ru, zh };

const seekingDe = (idioma: unknown) =>
  (idioma as { onboarding: { seeking: Record<string, string> } }).onboarding.seeking;

const pt = ptBR as unknown as { oQueBusca: { opcoes: Record<string, { titulo: string }> } };

const t = (chave: string, opcoes?: Record<string, unknown>) => i18n.t(chave, opcoes) as string;

const SAIRAM = [
  "investor", "investor_desc",
  "strategic_partner", "strategic_partner_desc",
  "team", "team_desc",
  // descrições órfãs: o título fica, a descrição nunca foi lida
  "job_desc", "mentor_desc", "commercial_partner_desc", "advisor_desc",
];

const FICARAM = ["job", "mentor", "commercial_partner", "advisor", "be_mentor", "be_mentor_desc"];

describe("rótulos antigos que nenhuma tela usa saíram dos 10 idiomas", () => {
  it("os 10 arquivos perderam exatamente as mesmas chaves", () => {
    expect(Object.keys(IDIOMAS)).toHaveLength(10);
    for (const [nome, idioma] of Object.entries(IDIOMAS)) {
      const seeking = seekingDe(idioma);
      for (const chave of SAIRAM) expect(Object.keys(seeking), `${nome}.${chave}`).not.toContain(chave);
      for (const chave of FICARAM) expect(Object.keys(seeking), `${nome}.${chave}`).toContain(chave);
    }
  });

  it("investor, strategic_partner e team já saíam com o rótulo da opção nova", () => {
    for (const [antiga, nova] of Object.entries(BUSCA_LEGADA_EQUIVALENTE)) {
      expect(rotuloDaBusca(t, antiga), antiga).toBe(pt.oQueBusca.opcoes[nova].titulo);
    }
    expect(rotuloDaBusca(t, "investor")).toBe("Investimento / Capital");
  });
});

describe("o que continua sendo exibido", () => {
  it("job e mentor mantêm o rótulo antigo: é o que o perfil antigo mostra", () => {
    expect(BUSCAS_LEGADAS_SEM_EQUIVALENTE).toEqual(["job", "mentor"]);
    expect(rotuloDaBusca(t, "job")).toBe("Emprego/Projeto");
    expect(rotuloDaBusca(t, "mentor")).toBe("Mentor");
    // Opções da lista da era Manus, retiradas da tela antes das 12 novas.
    expect(rotuloDaBusca(t, "commercial_partner")).toBe("Parceiro comercial");
    expect(rotuloDaBusca(t, "advisor")).toBe("Advisor");
    // Valor que nunca existiu não inventa rótulo.
    expect(rotuloDaBusca(t, "chave_que_nao_existe")).toBeNull();
  });

  it("'Quero também mentorar' é oferta, não busca, e segue com título e descrição", () => {
    expect(CHAVE_QUERO_MENTORAR).toBe("be_mentor");
    expect(t("onboarding.seeking.be_mentor")).toBe("Quero também mentorar");
    expect(t("onboarding.seeking.be_mentor_desc")).toMatch(/experiência/);
  });
});

describe("o servidor continua aceitando as 5 chaves antigas", () => {
  it("compatibilidade de DADO já gravado: nenhum perfil antigo deixa de salvar", () => {
    for (const chave of ["job", "mentor", "investor", "team", "strategic_partner"]) {
      expect(VALORES_ACEITOS_EM_SEEKING_TYPES, chave).toContain(chave);
    }
  });

  it("o script que normaliza o dado repete as MESMAS equivalências", () => {
    // scripts/*.mjs não importa TypeScript, então o mapa está escrito duas
    // vezes; esta é a trava contra as duas versões divergirem em silêncio.
    // O texto do script, nunca o módulo: importá-lo abriria conexão com o banco.
    // `pnpm test` roda da raiz do repositório (é o que o CI faz).
    const script = readFileSync("scripts/normalizar-buscas-antigas.mjs", "utf8");
    for (const [antiga, nova] of Object.entries(BUSCA_LEGADA_EQUIVALENTE)) {
      expect(script, `${antiga} -> ${nova}`).toContain(`${antiga}: "${nova}"`);
    }
    for (const chave of BUSCAS_LEGADAS_SEM_EQUIVALENTE) {
      expect(script, chave).toContain(`"${chave}"`);
    }
    // Simula por padrão: só grava com --aplicar.
    expect(script).toContain('process.argv.includes("--aplicar")');
  });
});
