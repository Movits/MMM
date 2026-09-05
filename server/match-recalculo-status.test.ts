import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Reverificação de 04/09 (MAJOR): a sugestão dispensada era reaproveitada para
 * uma razão nova. O índice único (dona, par) força uma linha por par; na
 * atualização, `values` reescrevia razão, texto e nota, mas nunca o status —
 * um par dispensado por "Vinho" cuja razão sumiu e para o qual nasceu "Café"
 * ficava "dispensado" com o texto do café: a dona nunca via a oportunidade nova.
 * E o e-mail de "nova oportunidade" saía para par dispensado que subia de nota.
 *
 * Decisão do Nicolas (04/09): par dispensado (ou aceito) que ganha razão
 * TOTALMENTE nova volta a pendente; com qualquer razão em comum, a decisão da
 * usuária permanece. O par só VISTO segue a mesma regra (revisão adversarial
 * de 05/09): o que ela viu foi a razão antiga.
 */

// Banco falso por identidade de tabela (padrão de match-escritas-nao-latinas):
// devolve as linhas da tabela pedida e captura o que foi inserido e atualizado
// — inclusive as colunas citadas no WHERE, como em exclusao-e-nucleo-sem-fantasma,
// para provar que o carimbo de notificação filtra por status e por dona.
type Atualizacao = { tabela: unknown; valores: Record<string, unknown>; colunas: string[] };
const estado = vi.hoisted(() => ({
  linhas: new Map<unknown, unknown[]>(),
  inseridos: [] as Array<Record<string, unknown>>,
  atualizacoes: [] as Array<{ tabela: unknown; valores: Record<string, unknown>; colunas: string[] }>,
  apagados: 0,
}));

/** Nomes das colunas dentro de uma condição do drizzle (varre os chunks). */
function colunasDe(condicao: unknown): string[] {
  const achadas: string[] = [];
  const visitados = new Set<unknown>();
  const visitar = (no: unknown) => {
    if (!no || typeof no !== "object" || visitados.has(no)) return;
    visitados.add(no);
    const alvo = no as Record<string, unknown>;
    // Coluna: registra e PARA — descer nela chega à tabela inteira e todo
    // predicado passaria a "conter" qualquer coluna.
    if (typeof alvo.name === "string" && alvo.table) { achadas.push(alvo.name); return; }
    for (const valor of Object.values(alvo)) {
      if (Array.isArray(valor)) valor.forEach(visitar);
      else if (valor && typeof valor === "object") visitar(valor);
    }
  };
  visitar(condicao);
  return achadas;
}

vi.mock("./db", () => ({
  exigirDb: async () => ({
    select: () => ({ from: (tabela: unknown) => ({ where: async () => estado.linhas.get(tabela) ?? [] }) }),
    insert: (_t: unknown) => ({ values: async (v: Record<string, unknown>) => { estado.inseridos.push(v); } }),
    update: (tabela: unknown) => ({
      set: (valores: Record<string, unknown>) => ({
        where: async (condicao: unknown) => { estado.atualizacoes.push({ tabela, valores, colunas: colunasDe(condicao) }); },
      }),
    }),
    delete: () => ({ where: async () => { estado.apagados += 1; } }),
  }),
}));
const email = vi.hoisted(() => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("./_core/email", () => email);

const { recalculatePrivateMatches, slugifyMatchTag } = await import("./match-service");
const { aiMatchSuggestions, contactAssets, contactNeeds, privateContacts } = await import("../drizzle/schema");

const ANA = 1; const BIA = 2;
const t = 1000;
const razao = (label: string) => ({ slug: slugifyMatchTag(label), label });
const termo = (id: number, contactId: number, tagLabel: string, category: string | null = null) =>
  ({ id, ownerId: "dona", contactId, tagSlug: slugifyMatchTag(tagLabel), tagLabel, category, description: null, createdAt: t, updatedAt: t });

/** A linha do par Ana:Bia como ficou depois da decisão da dona. */
function linhaDoPar(status: "pending" | "viewed" | "accepted" | "dismissed", matchScore: number, assets: string[], needs: string[]) {
  return {
    id: "sugestao-1", ownerId: "dona", contactAId: ANA, contactBId: BIA, pairLowContactId: ANA, pairHighContactId: BIA,
    matchScore, matchType: matchScore === 60 ? "category" : "exact",
    matchedAssets: assets.map(razao), matchedNeeds: needs.map(razao), reasonText: "razão antiga",
    status, notifiedAt: null,
    viewedAt: status === "viewed" ? t : null,
    acceptedAt: status === "accepted" ? t : null,
    dismissedAt: status === "dismissed" ? t : null,
    createdAt: t, updatedAt: t,
  };
}

const atualizacoesDeSugestao = (): Atualizacao[] => estado.atualizacoes.filter(a => a.tabela === aiMatchSuggestions);
const patchDoPar = () => atualizacoesDeSugestao().find(a => "matchScore" in a.valores)?.valores;

beforeEach(() => {
  estado.linhas.clear();
  estado.inseridos = [];
  estado.atualizacoes = [];
  estado.apagados = 0;
  email.sendEmail.mockClear();
  estado.linhas.set(privateContacts, [{ id: ANA, fullName: "Ana" }, { id: BIA, fullName: "Bia" }]);
});

describe("recalculatePrivateMatches — par dispensado que ganha razão totalmente nova", () => {
  it("volta a pendente: a razão que a dona dispensou sumiu e nasceu outra sem nada em comum", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("dismissed", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café")]);

    const r = await recalculatePrivateMatches("dona");
    expect(r).toEqual({ created: 0, updated: 1, removed: 0, total: 1 });
    expect(estado.inseridos).toEqual([]);

    const patch = patchDoPar();
    expect(patch?.status).toBe("pending");
    expect(patch?.viewedAt).toBeNull();
    expect(patch?.notifiedAt).toBeNull();
    expect(patch?.reasonText).toBe("Ana possui Café, que Bia procura.");
    // a decisão anterior fica como histórico: o patch não toca em dismissedAt
    expect(patch).not.toHaveProperty("dismissedAt");
    expect(patch).not.toHaveProperty("acceptedAt");
    // e a atualização continua presa à dona
    expect(atualizacoesDeSugestao()[0].colunas).toContain("owner_id");
  });

  it("NÃO reabre quando alguma razão continua: a decisão da dona vale para o par", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("dismissed", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Vinho"), termo(2, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(3, BIA, "Vinho"), termo(4, BIA, "Café")]);

    const r = await recalculatePrivateMatches("dona", "dona@exemplo.com");
    expect(r.updated).toBe(1);
    const patch = patchDoPar();
    expect(patch).toBeDefined();
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("viewedAt");
    // razão nova somada à antiga não é "nova oportunidade" para quem dispensou o par
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it("a razão antiga gravada com slug vazio (linha anterior ao conserto da escrita) ainda conta como interseção", async () => {
    const antiga = linhaDoPar("dismissed", 100, ["Vinho"], ["Vinho"]);
    antiga.matchedAssets = [{ slug: "", label: "Vinho" }];
    antiga.matchedNeeds = [{ slug: "", label: "Vinho" }];
    estado.linhas.set(aiMatchSuggestions, [antiga]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Vinho")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Vinho")]);

    await recalculatePrivateMatches("dona");
    expect(patchDoPar()).not.toHaveProperty("status");
  });

  it("par aceito com razão totalmente nova também volta a pendente, e acceptedAt fica como histórico", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("accepted", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café")]);

    await recalculatePrivateMatches("dona");
    const patch = patchDoPar();
    expect(patch?.status).toBe("pending");
    expect(patch).not.toHaveProperty("acceptedAt");
  });

  it("par só VISTO com razão totalmente nova volta a pendente sem viewedAt, e conta como nova para o e-mail", async () => {
    // A dona viu a razão antiga; a nova ela não viu nem foi anunciada. Antes o
    // par ficava "visto" com o texto novo e, com a nota antiga já em 100, nem
    // entrava no e-mail (revisão adversarial de 05/09).
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("viewed", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café")]);

    await recalculatePrivateMatches("dona", "dona@exemplo.com");
    const patch = patchDoPar();
    expect(patch?.status).toBe("pending");
    expect(patch?.viewedAt).toBeNull();
    expect(patch?.notifiedAt).toBeNull();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining("1 nova(s) oportunidade(s)") });
  });

  it("par visto que mantém alguma razão continua visto, e a mesma razão não vira e-mail", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("viewed", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Vinho"), termo(2, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(3, BIA, "Vinho"), termo(4, BIA, "Café")]);

    await recalculatePrivateMatches("dona", "dona@exemplo.com");
    expect(patchDoPar()).not.toHaveProperty("status");
    expect(patchDoPar()).not.toHaveProperty("viewedAt");
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe("recalculatePrivateMatches — o e-mail de 'nova oportunidade' só sai para o que a dona ainda vai decidir", () => {
  it("dispensada que sobe de 60 para 100 pela mesma razão não manda e-mail nem ganha carimbo", async () => {
    // Antes: previous.matchScore < 70 e o novo >= 70 contavam sem olhar o
    // status — a dona recebia "1 nova(s) oportunidade(s)" e na tela nada mudava.
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("dismissed", 60, ["Café especial"], ["Café"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café", "Agro")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café", "Agro")]);

    const r = await recalculatePrivateMatches("dona", "dona@exemplo.com");
    expect(r.updated).toBe(1);
    expect(patchDoPar()?.matchScore).toBe(100);
    expect(patchDoPar()).not.toHaveProperty("status");
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(atualizacoesDeSugestao().some(a => "notifiedAt" in a.valores && !("matchScore" in a.valores))).toBe(false);
  });

  it("par reaberto com nota alta é oportunidade nova: entra no e-mail, e o carimbo filtra por status e por dona", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("dismissed", 100, ["Vinho"], ["Vinho"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café")]);

    await recalculatePrivateMatches("dona", "dona@exemplo.com");
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toMatchObject({ to: "dona@exemplo.com", subject: expect.stringContaining("1 nova(s) oportunidade(s)") });
    const carimbo = atualizacoesDeSugestao().find(a => "notifiedAt" in a.valores && !("matchScore" in a.valores));
    expect(carimbo).toBeDefined();
    expect(carimbo?.valores.notifiedAt).toEqual(expect.any(Number));
    expect(carimbo?.colunas).toContain("status");
    expect(carimbo?.colunas).toContain("owner_id");
    expect(carimbo?.colunas).toContain("match_score");
  });

  it("pendente que sobe de 60 para 100 continua contando, como sempre contou", async () => {
    estado.linhas.set(aiMatchSuggestions, [linhaDoPar("pending", 60, ["Café especial"], ["Café"])]);
    estado.linhas.set(contactAssets, [termo(1, ANA, "Café", "Agro")]);
    estado.linhas.set(contactNeeds, [termo(2, BIA, "Café", "Agro")]);

    await recalculatePrivateMatches("dona", "dona@exemplo.com");
    expect(patchDoPar()).not.toHaveProperty("status");
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });
});
