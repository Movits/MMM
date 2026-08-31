// server/matching.ts:12 resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";

import { describe, expect, it } from "vitest";
import { calculateCompatibilityScore } from "./matching";
import type { UserProfile } from "../drizzle/schema";

/**
 * Etapa 2 — o perfil estratégico ("o que possui / o que procura") passa a pesar
 * no match, com o princípio da direção da etapa 11: quem TEM o que a outra
 * PROCURA pontua alto; querer/ter a mesma coisa é concorrência, não boost.
 *
 * Primeiro teste a exercitar calculateCompatibilityScore. Perfis mínimos (só os
 * campos estratégicos) isolam a nova dimensão: com todo o resto nulo, as outras
 * cinco dimensões ficam nos defaults e o overall vira 0.30*complementaridade +
 * 25.5 — então os overalls são determinísticos e batem exatos.
 */
const perfil = (whatIHave: string[] | null, whatINeed: string[] | null) =>
  ({ whatIHave, whatINeed } as unknown as UserProfile);

describe("Etapa 2 — dimensão de complementaridade", () => {
  it("mútuo (cada uma tem o que a outra procura) é o sinal mais forte", () => {
    // Ids-identidade, independe do mapa curado.
    const r = calculateCompatibilityScore(
      perfil(["tecnologia"], ["investidores"]),
      perfil(["investidores"], ["tecnologia"]),
    );
    expect(r.complementarity).toBeGreaterThanOrEqual(75);
    expect(r.overall).toBe(48);
  });

  it("perfil estratégico vazio é neutro, não premia nem pune", () => {
    const r = calculateCompatibilityScore(perfil(null, null), perfil(null, null));
    expect(r.complementarity).toBe(50);
    expect(r.overall).toBe(41);
  });

  it("ter/querer a mesma coisa é concorrência: pontua baixo, sem boost", () => {
    const r = calculateCompatibilityScore(
      perfil(["commodities"], []),
      perfil(["commodities"], []),
    );
    expect(r.complementarity).toBe(20);
    expect(r.overall).toBe(32);
  });

  it("mútuo (48) > neutro (41) > concorrência (32)", () => {
    const mutuo = calculateCompatibilityScore(perfil(["tecnologia"], ["investidores"]), perfil(["investidores"], ["tecnologia"])).overall;
    const neutro = calculateCompatibilityScore(perfil(null, null), perfil(null, null)).overall;
    const concorrencia = calculateCompatibilityScore(perfil(["commodities"], []), perfil(["commodities"], [])).overall;
    expect(mutuo).toBeGreaterThan(neutro);
    expect(neutro).toBeGreaterThan(concorrencia);
  });

  it("cross-vocabulário pelo mapa curado: ter commodities satisfaz precisar de fornecedores", () => {
    // Uma via: A supre B, B não supre A. Trava o mapa (ids diferentes).
    const r = calculateCompatibilityScore(
      perfil(["commodities"], []),
      perfil([], ["fornecedores"]),
    );
    expect(r.complementarity).toBe(60); // 45 + 15*1
    expect(r.complementarity).toBeLessThan(75); // uma via < mútuo
  });

  it("regressão: overlap de seekingTypes não infla mais o overall (objectives peso 0)", () => {
    // Mesmos seekingTypes, nenhuma complementaridade → não pode subir por causa
    // do overlap. Sem have/need → complementaridade neutra (50) → overall 41.
    const r = calculateCompatibilityScore(
      { whatIHave: null, whatINeed: null, seekingTypes: ["investimento"] } as unknown as UserProfile,
      { whatIHave: null, whatINeed: null, seekingTypes: ["investimento"] } as unknown as UserProfile,
    );
    expect(r.overall).toBe(41);
  });

  it("o objeto retornado tem a chave complementarity", () => {
    const r = calculateCompatibilityScore(perfil(["tecnologia"], []), perfil([], ["tecnologia"]));
    expect(r).toHaveProperty("complementarity");
  });
});
