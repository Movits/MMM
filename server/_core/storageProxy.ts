// Serve os arquivos guardados no storage — /manus-storage/{chave} — com as duas
// perguntas que a versão anterior nunca fazia: QUEM é você, e este arquivo é
// SEU?
//
// A versão anterior redirecionava qualquer requisição, sem sessão, para a URL
// assinada. Documento de Deal Room sob NDA e RG do SIVC ficavam a um GET
// anônimo de distância: a chave na URL era a única proteção, e chave gravada em
// banco, colada em chat ou guardada em histórico não é segredo.
//
// A ordem das checagens importa:
//   1. sessão válida (senão 401) — anônimo não descobre nem se a chave existe
//   2. posse da chave (senão 403) — regra por prefixo, DENY por padrão
//   3. só então a URL assinada de 5 minutos, com 307
//
// As regras por prefixo espelham as políticas dos routers que criam cada tipo
// de arquivo — o proxy não inventa política, repete a que já existe no tRPC.

import type { Express } from "express";
import { eq } from "drizzle-orm";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { dealRooms } from "../../drizzle/schema";
import { storageGetSignedUrl } from "../storage";

type Usuaria = { id: number; openId: string; role: string | null };
type Sala = { ownerId: number; interestedId: number } | null;
export type BuscarSala = (roomId: number) => Promise<Sala>;

// Mesma régua do dealRoom.ts: Ouro, presidente e admin acessam qualquer sala.
// Se a decisão de produto sobre a Deal Room mudar isso, muda lá e aqui junto.
const ehOuroOuAcima = (role?: string | null) =>
  role === "gold" || role === "president" || role === "admin";

/**
 * A chave pode ser baixada por esta usuária?
 *
 * Prefixos conhecidos e suas regras — qualquer coisa fora disto é NEGADA:
 *
 *   meetings/{openId}/...     só a dona da reunião (meeting-service.ts:219)
 *   sivc/{userId}/...         só a dona dos documentos (sivc.ts:397)
 *   deal-rooms/{roomId}/...   partes da sala, ou Ouro+ (dealRoom.ts:306)
 *   generated/...             qualquer usuária logada — são imagens geradas
 *                             exibidas em listas públicas do app
 */
export async function podeBaixarChave(
  usuaria: Usuaria,
  chave: string,
  buscarSala: BuscarSala,
): Promise<boolean> {
  const partes = chave.split("/");

  if (partes[0] === "meetings") {
    return partes.length >= 2 && partes[1] === usuaria.openId;
  }

  if (partes[0] === "sivc") {
    return partes.length >= 2 && partes[1] === String(usuaria.id);
  }

  if (partes[0] === "deal-rooms") {
    const roomId = Number(partes[1]);
    if (!Number.isInteger(roomId) || roomId <= 0) return false;
    if (ehOuroOuAcima(usuaria.role)) return true;
    const sala = await buscarSala(roomId);
    if (!sala) return false;
    return sala.ownerId === usuaria.id || sala.interestedId === usuaria.id;
  }

  if (partes[0] === "generated") {
    return true; // já passou pela autenticação; imagem gerada não tem dona
  }

  // Prefixo desconhecido: negar. Um tipo novo de arquivo só passa a ser servido
  // quando alguém escrever a regra de posse dele aqui — nunca por omissão.
  return false;
}

async function buscarSalaNoBanco(roomId: number): Promise<Sala> {
  const db = await getDb();
  if (!db) return null;
  const [sala] = await db
    .select({ ownerId: dealRooms.ownerId, interestedId: dealRooms.interestedId })
    .from(dealRooms)
    .where(eq(dealRooms.id, roomId))
    .limit(1);
  return sala ?? null;
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // 1. Quem é você? Sem sessão não há resposta nenhuma sobre o arquivo.
    let usuaria: Usuaria;
    try {
      const autenticada = await sdk.authenticateRequest(req);
      usuaria = { id: autenticada.id, openId: autenticada.openId, role: autenticada.role };
    } catch {
      res.status(401).send("Não autenticado");
      return;
    }

    // 2. O arquivo é seu?
    try {
      if (!(await podeBaixarChave(usuaria, key, buscarSalaNoBanco))) {
        res.status(403).send("Sem acesso a este arquivo");
        return;
      }
    } catch (err) {
      console.error("[StorageProxy] verificação de posse falhou:", err);
      res.status(500).send("Erro ao verificar o acesso");
      return;
    }

    // 3. Só agora a URL assinada.
    try {
      const url = await storageGetSignedUrl(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] falhou:", err);
      res.status(503).send("Storage não configurado ou indisponível");
    }
  });
}
