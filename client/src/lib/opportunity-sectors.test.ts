import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CHAVES_DE_SETOR,
  ehChaveDeSetor,
  rotuloDoSetor,
  rotulosComLegado,
  setoresTraduzidos,
} from "@shared/setores";
import { OPPORTUNITY_SECTOR_KEYS, opportunitySectorLabel } from "./opportunity-sectors";

const RAIZ = resolve(import.meta.dirname, "..", "..", "..");
const fonte = (caminho: string) => readFileSync(resolve(RAIZ, caminho), "utf8");

// Tradutor de mentira: devolve a própria chave i18n, para o teste enxergar QUAL
// chave a função pediu. Quem precisa do rótulo de verdade usa o de pt-BR.
const tChave = () => vi.fn((chave: string, opcoes?: { defaultValue: string }) => chave || (opcoes?.defaultValue ?? ""));

// Os setores das três listas que existiam antes da fonte única (reteste v4,
// item 7), escritos nas chaves de hoje: nenhum deles pode sumir, porque perfis e
// oportunidades já gravados usam esses valores. A do cadastro vinha com chaves em
// inglês ("agribusiness", "technology"), as outras duas em português.
const SETORES_DO_CADASTRO = [
  "agronegocio", "construcao", "educacao", "energia", "entretenimento",
  "financas", "governo", "industria", "logistica", "saude",
  "tecnologia", "telecom", "turismo", "varejo",
];
const SETORES_DE_INTERESSE = [
  "tecnologia", "saude", "educacao", "financas", "agronegocio", "energia",
  "varejo", "imobiliario", "industria", "servicos", "moda", "alimentacao",
  "turismo", "logistica", "juridico", "belezaCosmeticos", "exportacao",
  "importacao", "infraestrutura", "commodities", "farmaceutico", "consultoria",
  "marketing",
];
const SETORES_DE_OPORTUNIDADE = SETORES_DE_INTERESSE;

describe("fonte única de setores (shared/setores.ts)", () => {
  it("cobre todo setor que existia em qualquer uma das três listas antigas", () => {
    for (const chave of [...SETORES_DO_CADASTRO, ...SETORES_DE_INTERESSE, ...SETORES_DE_OPORTUNIDADE]) {
      expect(CHAVES_DE_SETOR, `o setor "${chave}" sumiu da fonte única`).toContain(chave);
    }
  });

  it("traz os setores que faltavam no reteste v4: tecnologia, sustentabilidade e serviços", () => {
    const rotulos = setoresTraduzidos(tPtBR).map(s => s.rotulo);
    expect(rotulos).toContain("Tecnologia & Software");
    expect(rotulos).toContain("Sustentabilidade & ESG");
    expect(rotulos).toContain("Serviços Profissionais");
  });

  it("não repete chave e ehChaveDeSetor reconhece só o que está na lista", () => {
    expect(new Set(CHAVES_DE_SETOR).size).toBe(CHAVES_DE_SETOR.length);
    expect(ehChaveDeSetor("tecnologia")).toBe(true);
    expect(ehChaveDeSetor("Tecnologia")).toBe(false);
  });

  it("toda chave tem tradução em pt-BR, no espaço setores.*", () => {
    for (const chave of CHAVES_DE_SETOR) {
      expect(setoresPtBR(), `setores.${chave} deveria existir`).toHaveProperty(chave);
    }
  });

  // A fonte única mora num espaço SÓ dela. Pôr as chaves novas dentro de
  // onboarding.sectors faz o Dashboard (optionLabel varre onboarding.<espaço>.
  // <valor>) exibir a ESPECIALIDADE "tecnologia" de uma conexão como o setor
  // "Tecnologia & Software".
  it("não invade onboarding.sectors, que é o vocabulário do dado já gravado", () => {
    const legado = setoresLegadosPtBR();
    expect(Object.keys(legado).sort()).toEqual([
      "agribusiness", "construction", "education", "energy", "entertainment",
      "financial", "government", "health", "industry", "logistics", "other",
      "retail", "technology", "telecom", "tourism",
    ].sort());
  });
});

describe("rotuloDoSetor", () => {
  it("traduz uma chave conhecida pedindo setores.<chave> ao t() da tela", () => {
    const t = vi.fn((chave: string) => (chave === "setores.saude" ? "Salud" : chave));
    expect(rotuloDoSetor(t, "saude")).toBe("Salud");
    expect(t).toHaveBeenCalledWith("setores.saude", { defaultValue: "saude" });
  });

  it("devolve string vazia para valor ausente, sem chamar t()", () => {
    const t = tChave();
    expect(rotuloDoSetor(t, null)).toBe("");
    expect(rotuloDoSetor(t, undefined)).toBe("");
    expect(t).not.toHaveBeenCalled();
  });

  it("valor antigo gravado (o rótulo, não a chave) continua sendo exibido como está", () => {
    const t = tChave();
    // O cadastro sempre gravou o RÓTULO traduzido, e oportunidades anteriores à
    // PR #55 também: nada disso é chave conhecida e tem de voltar intacto.
    expect(rotuloDoSetor(t, "Saúde")).toBe("Saúde");
    expect(rotuloDoSetor(t, "Tecnologia")).toBe("Tecnologia");
    expect(rotuloDoSetor(t, "Energia, Água & Gás")).toBe("Energia, Água & Gás");
    expect(t).not.toHaveBeenCalled();
  });
});

describe("rotulosComLegado", () => {
  it("mostra a lista atual e mantém o setor antigo que a usuária já tinha gravado", () => {
    const lista = rotulosComLegado(tPtBR, ["Tecnologia", "Serviços"]);
    expect(lista).toContain("Tecnologia");
    expect(lista).toContain("Serviços");
    expect(lista).toContain("Tecnologia & Software");
    expect(lista).toContain("Saúde");
  });

  it("não duplica o que já está na lista atual", () => {
    const lista = rotulosComLegado(tPtBR, ["Saúde", "Saúde"]);
    expect(lista.filter(r => r === "Saúde")).toHaveLength(1);
  });
});

describe("as três telas leem a mesma fonte", () => {
  it("o módulo de oportunidades apenas reexporta a fonte única", () => {
    expect([...OPPORTUNITY_SECTOR_KEYS]).toEqual([...CHAVES_DE_SETOR]);
    expect(opportunitySectorLabel(tChave(), "saude")).toBe("setores.saude");
  });

  it("cadastro, perfil e nova oportunidade montam a lista a partir da fonte única", () => {
    const telas: [string, RegExp][] = [
      ["client/src/pages/Onboarding.tsx", /setoresTraduzidos\(t\)/],
      ["client/src/pages/Profile.tsx", /rotulosComLegado\(t, interestSectors\)/],
      ["client/src/pages/NewOpportunity.tsx", /OPPORTUNITY_SECTOR_KEYS\.map/],
    ];
    for (const [caminho, esperado] of telas) {
      expect(fonte(caminho), `${caminho} deveria ler a fonte única`).toMatch(esperado);
    }
  });

  it("nenhuma tela declara mais uma lista de setores própria", () => {
    const onboarding = fonte("client/src/pages/Onboarding.tsx");
    const perfil = fonte("client/src/pages/Profile.tsx");
    // A constante morta INTEREST_SECTORS do cadastro foi apagada.
    expect(onboarding).not.toMatch(/INTEREST_SECTORS/);
    // Listas literais de setor (as três variantes antigas) não podem voltar.
    expect(onboarding).not.toMatch(/"agribusiness",\s*"construction"/);
    expect(perfil).not.toMatch(/"Tecnologia",\s*"Saúde"/);
  });
});

/** Os rótulos da fonte única, no espaço i18n próprio. */
function setoresPtBR(): Record<string, string> {
  return JSON.parse(fonte("client/src/i18n/locales/pt-BR.json")).setores;
}

/** O espaço ANTIGO, que segue existindo para o dado já gravado. */
function setoresLegadosPtBR(): Record<string, string> {
  return JSON.parse(fonte("client/src/i18n/locales/pt-BR.json")).onboarding.sectors;
}

/** Tradutor de verdade: lê os rótulos de pt-BR, como a tela faria. */
function tPtBR(chave: string, opcoes?: { defaultValue: string }): string {
  return setoresPtBR()[chave.replace("setores.", "")] ?? opcoes?.defaultValue ?? chave;
}
