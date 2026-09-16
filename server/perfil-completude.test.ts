import { describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * O "Perfil completo" do Dashboard (`computeProfileCompleteness`, server/db.ts).
 *
 * Achado da revisão de 15/09: a conta tinha DEZ campos, e dois deles —
 * `workStyle` e `values` — foram suprimidos do cadastro (Rosber, 14/09 21:08) e
 * nunca existiram na tela de Perfil. Ninguém conseguia preenchê-los, então a
 * barra parava em 80% para quem tivesse respondido TUDO o que a plataforma
 * pergunta, e a usuária ficava procurando um campo que não existe. É esse
 * teto invisível que os testes daqui travam.
 */

import { CAMPOS_DA_COMPLETUDE_DO_PERFIL, computeProfileCompleteness } from "./db";
import { userProfiles } from "../drizzle/schema";

/** Tudo o que `salvarPerfil` (client/src/pages/Onboarding.tsx) envia e conta. */
const PERFIL_DO_CADASTRO_INTEIRO = {
  displayName: "Ana Souza",
  city: "Porto Alegre",
  primarySpecialty: "tech",
  sector: "tech",
  seekingTypes: ["expandir_negocio"],
  incomeRange: "7k_15k",
  bio: "Exporto vinho do Sul para a Europa.",
  experienceYears: 12,
};

describe("quem respondeu o cadastro inteiro chega a 100%", () => {
  it("o perfil completo do cadastro fecha a barra", () => {
    expect(computeProfileCompleteness(PERFIL_DO_CADASTRO_INTEIRO)).toBe(100);
  });

  it("estilo de trabalho e valores principais não somam nem subtraem", () => {
    // Perfil ANTIGO, que ainda tem os dois campos gravados de antes da
    // supressão: continua 100%, porque o que conta é o que a tela pergunta.
    expect(computeProfileCompleteness({
      ...PERFIL_DO_CADASTRO_INTEIRO,
      workStyle: "remote",
      values: ["innovation", "integrity"],
    })).toBe(100);

    // E a ausência deles não pode custar nada a quem se cadastrou agora.
    expect(CAMPOS_DA_COMPLETUDE_DO_PERFIL).not.toContain("workStyle");
    expect(CAMPOS_DA_COMPLETUDE_DO_PERFIL).not.toContain("values");
  });

  it("um campo a menos fica logo abaixo de 100, e só um degrau abaixo", () => {
    const umDegrauAbaixo = Math.round(((CAMPOS_DA_COMPLETUDE_DO_PERFIL.length - 1) / CAMPOS_DA_COMPLETUDE_DO_PERFIL.length) * 100);
    const { bio: _bio, ...semBio } = PERFIL_DO_CADASTRO_INTEIRO;
    expect(computeProfileCompleteness(semBio)).toBe(umDegrauAbaixo);
    expect(umDegrauAbaixo).toBeLessThan(100);
  });
});

describe("o que conta como preenchido", () => {
  it("perfil inexistente é 0, e perfil vazio também", () => {
    expect(computeProfileCompleteness(null)).toBe(0);
    expect(computeProfileCompleteness(undefined)).toBe(0);
    expect(computeProfileCompleteness({})).toBe(0);
  });

  it("texto em branco, nulo e lista vazia não contam", () => {
    const vazios = Object.fromEntries(
      CAMPOS_DA_COMPLETUDE_DO_PERFIL.map((campo, i) => [campo, i % 3 === 0 ? "" : i % 3 === 1 ? null : []]),
    );
    expect(computeProfileCompleteness(vazios)).toBe(0);
  });

  it("zero anos de experiência CONTA: é resposta, não campo em branco", () => {
    expect(computeProfileCompleteness({ experienceYears: 0 })).toBeGreaterThan(0);
  });
});

describe("a lista de campos", () => {
  it("só tem coluna que existe em user_profiles (a leitura é por nome, sem tipo)", () => {
    const colunas = Object.keys(getTableColumns(userProfiles));
    for (const campo of CAMPOS_DA_COMPLETUDE_DO_PERFIL) expect(colunas).toContain(campo);
  });

  it("não tem campo repetido", () => {
    expect(new Set(CAMPOS_DA_COMPLETUDE_DO_PERFIL).size).toBe(CAMPOS_DA_COMPLETUDE_DO_PERFIL.length);
  });
});
