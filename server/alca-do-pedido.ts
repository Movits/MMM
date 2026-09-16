import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { requireSecret } from "./_core/env";

/**
 * A alça do pedido na fila de distribuição: o que a tela recebe NO LUGAR do
 * `connections.id`.
 *
 * O id da conexão é sequencial. Com ele à mostra na fila ("Pedido #18") e no
 * histórico, a distribuidora que também recebe pedidos juntava os números que via e
 * achava nos buracos da sequência o pedido que está oculto para ela (revisão da #115,
 * item 2 do Roberto). Responder igual em `decidir` não bastava: o buraco aparecia
 * sem chamar `decidir`.
 *
 * A alça é o id cifrado com AES-256-GCM, presa à conta que leu a fila. Não tem
 * ordem, não repete entre leituras (IV aleatório) e não se forja: alça adulterada,
 * inventada ou lida por outra conta não abre. Como a fila nunca traz pedido de que
 * quem consulta é parte, uma alça que abre é, por construção, de pedido de
 * terceiros que esta conta já viu — por isso `decidir` pode separar na trilha a
 * alça forjada (bloqueio) da alça velha de um pedido que outra pessoa já decidiu
 * (clique em fila desatualizada), sem virar oráculo.
 *
 * A chave deriva do JWT_SECRET, que o servidor já exige para subir. Trocar o
 * segredo só invalida as alças das filas abertas: a tela recarrega e ganha outras.
 */

const PROPOSITO = "mmm:alca-do-pedido-de-match:v1";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const TAMANHO_CLARO = 8; // conta (4 bytes) + conexão (4 bytes)

function chave() {
  return createHmac("sha256", requireSecret("JWT_SECRET")).update(PROPOSITO).digest();
}

function uint32(valor: number) {
  return Number.isInteger(valor) && valor >= 0 && valor <= 0xffffffff;
}

/** A alça do pedido `connectionId` para a conta `distribuidorId`. */
export function selarAlcaDoPedido(connectionId: number, distribuidorId: number): string {
  if (!uint32(connectionId) || !uint32(distribuidorId)) throw new Error("Id fora da faixa para a alça do pedido.");
  const claro = Buffer.alloc(TAMANHO_CLARO);
  claro.writeUInt32BE(distribuidorId, 0);
  claro.writeUInt32BE(connectionId, 4);
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  const corpo = Buffer.concat([cifra.update(claro), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]).toString("base64url");
}

/**
 * O id do pedido, ou null quando a alça não foi entregue a esta conta pela fila:
 * adulterada, inventada, cortada ou selada para outra distribuidora.
 */
export function abrirAlcaDoPedido(alca: string, distribuidorId: number): number | null {
  const bruto = Buffer.from(alca, "base64url");
  if (bruto.length !== TAMANHO_IV + TAMANHO_TAG + TAMANHO_CLARO || bruto.toString("base64url") !== alca) return null;
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave(), bruto.subarray(0, TAMANHO_IV));
    decifra.setAuthTag(bruto.subarray(TAMANHO_IV, TAMANHO_IV + TAMANHO_TAG));
    const claro = Buffer.concat([decifra.update(bruto.subarray(TAMANHO_IV + TAMANHO_TAG)), decifra.final()]);
    if (claro.readUInt32BE(0) !== distribuidorId) return null;
    return claro.readUInt32BE(4);
  } catch {
    return null; // a etiqueta não confere: a alça não saiu deste servidor
  }
}
