import { beforeEach, describe, expect, it, vi } from "vitest";
import { BancoIndisponivel } from "./banco-indisponivel";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Governança (14/09/2026): a promoção Bronze → Prata depois de gravar o perfil.
 *
 * O que este arquivo guarda:
 *  1. Só Bronze é avaliada. Prata, Ouro, presidente e admin não custam nem uma
 *     leitura, e ninguém é rebaixado.
 *  2. Perfil que não atende à régua não muda nada.
 *  3. Perfil que atende: UPDATE condicional, auditoria e aviso no sino.
 *  4. Se o UPDATE condicional não pegou linha (o nível mudou no meio), não há
 *     auditoria nem aviso de uma promoção que não aconteceu.
 *  5. O aviso falhar não desfaz a promoção; banco fora do ar sobe como erro.
 *  6. A reavaliação ÚNICA da Prata automática antiga (script, não fluxo): simular
 *     não escreve; Prata com origem registrada nem é lida; só quem não atende à
 *     régua é rebaixada, por UPDATE condicional e com auditoria.
 */

const dubles = vi.hoisted(() => ({
  getUserProfile: vi.fn<(id: number) => Promise<unknown>>(),
  promoverBronzeAPrata: vi.fn<(id: number) => Promise<boolean>>(),
  listarPrataParaReavaliacao: vi.fn<(acoes: readonly string[]) => Promise<Array<{ id: number; origemRegistrada: boolean }>>>(),
  rebaixarPrataABronze: vi.fn<(id: number) => Promise<boolean>>(),
  createNotification: vi.fn<(dados: Record<string, unknown>) => Promise<void>>(),
  createAuditLog: vi.fn<(dados: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("./db", () => ({
  getUserProfile: (id: number) => dubles.getUserProfile(id),
  promoverBronzeAPrata: (id: number) => dubles.promoverBronzeAPrata(id),
  listarPrataParaReavaliacao: (acoes: readonly string[]) => dubles.listarPrataParaReavaliacao(acoes),
  rebaixarPrataABronze: (id: number) => dubles.rebaixarPrataABronze(id),
  createNotification: (dados: Record<string, unknown>) => dubles.createNotification(dados),
}));
vi.mock("./security", () => ({
  createAuditLog: (dados: Record<string, unknown>) => dubles.createAuditLog(dados),
}));

const { reavaliarNivelPeloPerfil, reavaliarPrataAutomaticaAntiga } = await import("./nivel-do-perfil");

const PERFIL_QUALIFICADO = {
  userId: 5,
  displayName: "Ana Souza",
  city: "Lisboa",
  activityArea: "Comércio exterior",
  bio: "Advogada tributarista, atendo empresas familiares que exportam café para a Europa.",
  whatIHave: ["canais_comerciais"],
  whatINeed: ["fornecedores"],
};

beforeEach(() => {
  for (const duble of Object.values(dubles)) duble.mockReset();
  dubles.getUserProfile.mockResolvedValue(PERFIL_QUALIFICADO);
  dubles.promoverBronzeAPrata.mockResolvedValue(true);
  dubles.createNotification.mockResolvedValue(undefined);
  dubles.createAuditLog.mockResolvedValue(undefined);
});

describe("reavaliarNivelPeloPerfil", () => {
  it.each(["silver", "gold", "president", "admin"])("%s não é avaliada: nenhuma leitura, nenhuma escrita", async (role) => {
    const r = await reavaliarNivelPeloPerfil({ id: 5, role });
    expect(r).toEqual({ promovidaAPrata: false });
    expect(dubles.getUserProfile).not.toHaveBeenCalled();
    expect(dubles.promoverBronzeAPrata).not.toHaveBeenCalled();
    expect(dubles.createAuditLog).not.toHaveBeenCalled();
  });

  it("Bronze com perfil incompleto continua Bronze", async () => {
    dubles.getUserProfile.mockResolvedValue({ ...PERFIL_QUALIFICADO, whatINeed: [] });
    const r = await reavaliarNivelPeloPerfil({ id: 5, role: "bronze" });
    expect(r).toEqual({ promovidaAPrata: false });
    expect(dubles.getUserProfile).toHaveBeenCalledWith(5);
    expect(dubles.promoverBronzeAPrata).not.toHaveBeenCalled();
    expect(dubles.createNotification).not.toHaveBeenCalled();
  });

  it("Bronze sem perfil gravado continua Bronze", async () => {
    dubles.getUserProfile.mockResolvedValue(null);
    expect(await reavaliarNivelPeloPerfil({ id: 5, role: "bronze" })).toEqual({ promovidaAPrata: false });
    expect(dubles.promoverBronzeAPrata).not.toHaveBeenCalled();
  });

  it("Bronze com perfil qualificado vira Prata, com auditoria e aviso no sino", async () => {
    const r = await reavaliarNivelPeloPerfil({ id: 5, role: "bronze" });

    expect(r).toEqual({ promovidaAPrata: true });
    expect(dubles.promoverBronzeAPrata).toHaveBeenCalledWith(5);
    expect(dubles.createAuditLog).toHaveBeenCalledTimes(1);
    expect(dubles.createAuditLog.mock.calls[0][0]).toMatchObject({
      userId: 5,
      action: "LEVEL_PROMOTED_BY_PROFILE_QUALITY",
      resource: "users",
      resourceId: "5",
      details: { previousRole: "bronze", newRole: "silver", criterio: "2026-09-14" },
      status: "success",
    });
    expect(dubles.createNotification).toHaveBeenCalledTimes(1);
    const aviso = dubles.createNotification.mock.calls[0][0];
    expect(aviso).toMatchObject({ userId: 5, type: "system", actionUrl: "/profile" });
    // Texto novo usa "conexão", e Prata não é plano pago.
    expect(String(aviso.body)).toMatch(/conexões/);
    expect(String(aviso.body)).not.toMatch(/match/i);
    expect(String(aviso.body)).toMatch(/não tem mensalidade/);
  });

  it("o UPDATE condicional não pegou linha (nível mudou no meio): sem auditoria nem aviso", async () => {
    dubles.promoverBronzeAPrata.mockResolvedValue(false);
    const r = await reavaliarNivelPeloPerfil({ id: 5, role: "bronze" });
    expect(r).toEqual({ promovidaAPrata: false });
    expect(dubles.createAuditLog).not.toHaveBeenCalled();
    expect(dubles.createNotification).not.toHaveBeenCalled();
  });

  it("o aviso falhar por outro motivo não desfaz a promoção já gravada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    dubles.createNotification.mockRejectedValue(new Error("coluna estranha"));
    expect(await reavaliarNivelPeloPerfil({ id: 5, role: "bronze" })).toEqual({ promovidaAPrata: true });
  });

  it("banco fora do ar no aviso é erro, não silêncio", async () => {
    dubles.createNotification.mockRejectedValue(new BancoIndisponivel());
    await expect(reavaliarNivelPeloPerfil({ id: 5, role: "bronze" })).rejects.toBeInstanceOf(BancoIndisponivel);
  });

  it("banco fora do ar na leitura do perfil sobe, sem promover", async () => {
    dubles.getUserProfile.mockRejectedValue(new BancoIndisponivel());
    await expect(reavaliarNivelPeloPerfil({ id: 5, role: "bronze" })).rejects.toBeInstanceOf(BancoIndisponivel);
    expect(dubles.promoverBronzeAPrata).not.toHaveBeenCalled();
  });
});

describe("reavaliarPrataAutomaticaAntiga (reavaliação única, por script)", () => {
  const PERFIL_SEM_BIO_NEM_NECESSIDADE = { ...PERFIL_QUALIFICADO, bio: "", whatINeed: [] };

  beforeEach(() => {
    // 10: Prata que veio de decisão (Ouro revogado, mudança auditada); 11: Prata
    // automática com perfil bom; 12: Prata automática sem bio e sem O que preciso.
    dubles.listarPrataParaReavaliacao.mockResolvedValue([
      { id: 10, origemRegistrada: true },
      { id: 11, origemRegistrada: false },
      { id: 12, origemRegistrada: false },
    ]);
    dubles.getUserProfile.mockImplementation(async (id: number) =>
      id === 12 ? PERFIL_SEM_BIO_NEM_NECESSIDADE : PERFIL_QUALIFICADO);
    dubles.rebaixarPrataABronze.mockResolvedValue(true);
  });

  it("pede à listagem as quatro ações de auditoria que mudam nível", async () => {
    await reavaliarPrataAutomaticaAntiga("simular");
    expect(dubles.listarPrataParaReavaliacao).toHaveBeenCalledTimes(1);
    expect([...dubles.listarPrataParaReavaliacao.mock.calls[0][0]].sort()).toEqual([
      "ADMIN_UPDATE_USER_ROLE",
      "LEVEL_PROMOTED_BY_PROFILE_QUALITY",
      "PRESIDENT_GRANT_GOLD",
      "PRESIDENT_REVOKE_GOLD",
    ]);
  });

  it("simular classifica e não escreve nada", async () => {
    const r = await reavaliarPrataAutomaticaAntiga("simular");

    expect(r).toEqual({
      modo: "simular",
      avaliadas: 3,
      origemRegistrada: [10],
      qualificadas: [11],
      naoQualificadas: [{ userId: 12, pendencias: ["apresentacao", "oQuePreciso"] }],
      rebaixadas: [],
      nivelMudouNoMeio: [],
    });
    expect(dubles.rebaixarPrataABronze).not.toHaveBeenCalled();
    expect(dubles.createAuditLog).not.toHaveBeenCalled();
    expect(dubles.createNotification).not.toHaveBeenCalled();
  });

  it("Prata com origem registrada não custa nem a leitura do perfil", async () => {
    await reavaliarPrataAutomaticaAntiga("aplicar");
    expect(dubles.getUserProfile).not.toHaveBeenCalledWith(10);
    expect(dubles.rebaixarPrataABronze).not.toHaveBeenCalledWith(10);
  });

  it("aplicar rebaixa só a que não atende à régua, com auditoria e sem aviso no sino", async () => {
    const r = await reavaliarPrataAutomaticaAntiga("aplicar");

    expect(dubles.rebaixarPrataABronze).toHaveBeenCalledTimes(1);
    expect(dubles.rebaixarPrataABronze).toHaveBeenCalledWith(12);
    expect(r.rebaixadas).toEqual([12]);
    expect(r.qualificadas).toEqual([11]);
    expect(r.nivelMudouNoMeio).toEqual([]);
    expect(dubles.createAuditLog).toHaveBeenCalledTimes(1);
    expect(dubles.createAuditLog.mock.calls[0][0]).toMatchObject({
      userId: 12,
      action: "LEVEL_DEMOTED_BY_GOVERNANCE_REVIEW",
      resource: "users",
      resourceId: "12",
      details: {
        previousRole: "silver",
        newRole: "bronze",
        criterio: "2026-09-14",
        pendencias: ["apresentacao", "oQuePreciso"],
      },
      status: "success",
    });
    expect(dubles.createNotification).not.toHaveBeenCalled();
  });

  it("o UPDATE condicional não pegou linha (nível mudou no meio): sem auditoria", async () => {
    dubles.rebaixarPrataABronze.mockResolvedValue(false);
    const r = await reavaliarPrataAutomaticaAntiga("aplicar");
    expect(r.rebaixadas).toEqual([]);
    expect(r.nivelMudouNoMeio).toEqual([12]);
    expect(dubles.createAuditLog).not.toHaveBeenCalled();
  });

  it("sem conta Prata, nada é lido nem escrito", async () => {
    dubles.listarPrataParaReavaliacao.mockResolvedValue([]);
    const r = await reavaliarPrataAutomaticaAntiga("aplicar");
    expect(r.avaliadas).toBe(0);
    expect(dubles.getUserProfile).not.toHaveBeenCalled();
    expect(dubles.rebaixarPrataABronze).not.toHaveBeenCalled();
  });

  it("banco fora do ar na leitura do perfil sobe, sem rebaixar ninguém", async () => {
    dubles.getUserProfile.mockRejectedValue(new BancoIndisponivel());
    await expect(reavaliarPrataAutomaticaAntiga("aplicar")).rejects.toBeInstanceOf(BancoIndisponivel);
    expect(dubles.rebaixarPrataABronze).not.toHaveBeenCalled();
  });
});
