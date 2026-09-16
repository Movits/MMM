import type { IncomingHttpHeaders } from "node:http";
import net from "node:net";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * O IP de quem fez o pedido, para LIMITAR (e para o bloqueio de login por
 * e-mail + IP). Nunca lê X-Forwarded-For nem True-Client-IP.
 *
 * Por que não o X-Forwarded-For: a Cloudflare na frente do Render ACRESCENTA
 * o IP ao cabeçalho que já veio do cliente, então o primeiro item é o que o
 * cliente quiser escrever (era assim no "esqueci a senha", no login e no FAQ).
 * E `req.ip`, com `trust proxy 1`, é o último item: um proxy interno do Render
 * que muda de um pedido para outro e é o mesmo para visitantes de redes
 * diferentes — medido em produção em 16/09, com dois baldes para um cliente só.
 *
 * O CF-Connecting-IP é gravado pela própria Cloudflare (enviá-lo de fora
 * devolveu 403 da borda), por isso só vale no Render (`RENDER=true`, que a
 * plataforma define em todo serviço). Fora dele (dev, testes) ninguém o
 * sobrescreve e qualquer um poderia forjá-lo. Se o cabeçalho sumir, cai em
 * `req.ip`: volta aos baldes divididos, mas nunca a uma chave forjável.
 */
export function ipDaCliente(
  req: { headers: IncomingHttpHeaders; ip?: string; socket?: { remoteAddress?: string } },
  ambiente: NodeJS.ProcessEnv = process.env,
): string {
  if (ambiente.RENDER === "true") {
    const cabecalho = req.headers["cf-connecting-ip"];
    const valor = typeof cabecalho === "string" ? cabecalho.trim() : "";
    if (net.isIP(valor)) return valor;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * A chave de contagem de um IP: IPv6 agrupado no /56 (o mesmo padrão do
 * express-rate-limit), porque quem tem IPv6 costuma ter milhões de endereços
 * e trocaria de endereço a cada tentativa. IPv4 e IPv4 mapeado em IPv6 saem
 * como o próprio IPv4.
 */
export function chaveDeRede(ip: string): string {
  return ipKeyGenerator(ip, 56);
}
