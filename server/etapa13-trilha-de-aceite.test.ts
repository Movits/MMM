import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Etapa 13 (prontidão) — a trilha de auditoria do aceite e o metadado que
 * separa "sem perfis compatíveis" de "a rede ainda está autorizando".
 *
 * O recado de 03/09 no card da etapa 13 mediu o problema em produção: o aceite
 * do NDA gravava só um booleano e uma data — sem IP, sem registro de qual
 * texto a pessoa viu — e, numa disputa sobre comissão, isso vale perto de
 * zero. Estes testes provam que agora:
 *   1. aceitar o NDA grava linha em nda_acceptances com papel, IP do servidor,
 *      user-agent, idioma e o hash SHA-256 do texto exibido;
 *   2. a trilha vem ANTES do estado: sem INSERT não há aceite;
 *   3. consent.accept carimba o textHash da versão vigente;
 *   4. matches.redeAguardando conta os matches ocultos por falta de aceite do
 *      OUTRO lado — o que a primeira aceitante precisa ver no lugar de
 *      "nenhum perfil compatível".
 */

import { consents, dealRooms, documentVersions, ndaAcceptances } from "../drizzle/schema";

// ── Dublê do banco: roteia select/insert/update pela TABELA alvo ─────────────
const leituras = new Map<unknown, unknown[][]>();
const inserido = vi.fn(async () => {});
const tabelasInseridas: unknown[] = [];
const atualizado = vi.fn(async () => {});

function proximaLeitura(tabela: unknown): unknown[] {
  const fila = leituras.get(tabela);
  if (!fila || fila.length === 0) return [];
  return fila.length === 1 ? fila[0] : (fila.shift() as unknown[]);
}

const dbFalso = {
  select: (_campos?: unknown) => ({
    from: (tabela: unknown) => ({
      // O drizzle encerra a consulta ora com .limit(n), ora aguardando o
      // próprio where() (usersComConsentimento) — o dublê atende os dois.
      where: () => ({
        limit: async () => proximaLeitura(tabela),
        then: (aceita: (v: unknown[]) => void, rejeita?: (e: unknown) => void) =>
          Promise.resolve().then(() => proximaLeitura(tabela)).then(aceita, rejeita),
      }),
    }),
  }),
  insert: (tabela: unknown) => {
    tabelasInseridas.push(tabela);
    return { values: inserido };
  },
  update: (_tabela: unknown) => ({ set: (vals: unknown) => ({ where: () => atualizado(vals) }) }),
};

vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    // "then" NÃO pode virar função: profileMatches faz `await import("../db")`
    // e um namespace "thenable" congela o import para sempre.
    if (typeof prop === "symbol" || prop === "then" || prop === "default") return undefined;
    if (prop === "exigirDb") return async () => dbFalso;
    if (prop === "createNotification") return async () => {};
    if (prop === "getMatchesForUser") return (...args: unknown[]) => getMatchesForUser(...(args as [number, number]));
    return async () => {};
  },
}));
vi.mock("./bloqueio-de-contato", () => ({ exigirTextoSemContato: async () => {} }));
vi.mock("./storage", () => ({ storagePut: async () => ({ url: "" }) }));

const getMatchesForUser = vi.fn(async (_userId: number, _limit: number) => [] as Array<{ matchedUserId: number | null }>);

const { dealRoomRouter } = await import("./routers/dealRoom");
const { consentRouter } = await import("./routers/consent");
const { profileMatchesRouter } = await import("./routers/profileMatches");

const ctx = (id: number) => ({
  user: { id, openId: `dona-${id}`, email: "t@local", role: "silver" },
  req: {
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Vitest/1.0" },
    socket: { remoteAddress: "127.0.0.1" },
  },
  res: { cookie: () => {} },
}) as never;

const SALA = { id: 7, ownerId: 1, interestedId: 2, opportunityId: 3, status: "awaiting_nda", ndaAcceptedByOwner: false, ndaAcceptedByInterested: false };

beforeEach(() => {
  leituras.clear();
  inserido.mockClear();
  atualizado.mockClear();
  tabelasInseridas.length = 0;
  getMatchesForUser.mockReset();
  getMatchesForUser.mockResolvedValue([]);
});

describe("dealRoom.acceptNDA — trilha de auditoria", () => {
  it("grava papel, IP do servidor, user-agent, idioma e hash do texto exibido", async () => {
    leituras.set(dealRooms, [[SALA], [{ ...SALA, ndaAcceptedByOwner: true }]]);
    const texto = "Cláusula 1. Sigilo.\nCláusula 2. Antiburla.";

    await dealRoomRouter.createCaller(ctx(1)).acceptNDA({ roomId: 7, locale: "pt-BR", textoExibido: texto });

    expect(tabelasInseridas).toContain(ndaAcceptances);
    const trilha = inserido.mock.calls[tabelasInseridas.indexOf(ndaAcceptances)][0] as Record<string, unknown>;
    expect(trilha).toMatchObject({
      dealRoomId: 7,
      userId: 1,
      papel: "owner",
      // Primeiro IP do x-forwarded-for — nunca o que o cliente afirmar no corpo.
      ipAddress: "203.0.113.7",
      userAgent: "Vitest/1.0",
      locale: "pt-BR",
      textoExibido: texto,
      textoHash: createHash("sha256").update(texto).digest("hex"),
    });
  });

  it("quem não é dona aceita como 'interested', e sem texto o hash fica nulo", async () => {
    leituras.set(dealRooms, [[SALA], [{ ...SALA, ndaAcceptedByInterested: true }]]);

    await dealRoomRouter.createCaller(ctx(2)).acceptNDA({ roomId: 7 });

    const trilha = inserido.mock.calls[tabelasInseridas.indexOf(ndaAcceptances)][0] as Record<string, unknown>;
    expect(trilha).toMatchObject({ papel: "interested", userId: 2, textoExibido: null, textoHash: null });
  });

  it("a trilha vem antes do estado: INSERT falhou ⇒ o booleano não muda", async () => {
    leituras.set(dealRooms, [[SALA]]);
    inserido.mockRejectedValueOnce(new Error("banco caiu"));

    await expect(dealRoomRouter.createCaller(ctx(1)).acceptNDA({ roomId: 7 })).rejects.toThrow("banco caiu");
    expect(atualizado).not.toHaveBeenCalled();
  });
});

describe("consent.accept — hash do texto da versão vigente", () => {
  it("carimba o SHA-256 do texto que valia no instante do aceite", async () => {
    const doc = { id: "v-uuid-1", type: "termo_smart_match", version: 1, text: "# Termo\nTexto vigente." };
    // getCurrentDocument lê a vigente; hasValidConsent lê a vigente E os
    // consentimentos (vazio = ainda não aceitou).
    leituras.set(documentVersions, [[doc]]);
    leituras.set(consents, [[]]);

    await consentRouter.createCaller(ctx(1)).accept({ type: "termo_smart_match" });

    expect(tabelasInseridas).toContain(consents);
    const linha = inserido.mock.calls[tabelasInseridas.indexOf(consents)][0] as Record<string, unknown>;
    expect(linha).toMatchObject({
      userId: 1,
      documentVersionId: "v-uuid-1",
      textHash: createHash("sha256").update(doc.text).digest("hex"),
    });
  });
});

describe("matches.redeAguardando — a causa certa para o vazio", () => {
  it("sem consentimento próprio: nada a contar", async () => {
    // Termo vigente existe e a usuária NÃO aceitou.
    leituras.set(documentVersions, [[{ id: "v-uuid-1" }]]);
    leituras.set(consents, [[]]);

    await expect(profileMatchesRouter.createCaller(ctx(1)).redeAguardando()).resolves.toEqual({ ocultas: 0 });
    expect(getMatchesForUser).not.toHaveBeenCalled();
  });

  it("conta só os matches cujo OUTRO lado ainda não aceitou", async () => {
    // A própria usuária aceitou (consents devolve linha); das 3 contrapartes,
    // usersComConsentimento só confirma a 101.
    leituras.set(documentVersions, [[{ id: "v-uuid-1" }]]);
    leituras.set(consents, [[{ id: 1 }], [{ userId: 101 }]]);
    getMatchesForUser.mockResolvedValue([
      { matchedUserId: 101 },
      { matchedUserId: 102 },
      { matchedUserId: 103 },
      { matchedUserId: null },
    ]);

    await expect(profileMatchesRouter.createCaller(ctx(1)).redeAguardando()).resolves.toEqual({ ocultas: 2 });
  });
});
