import { describe, expect, it } from "vitest";
import { chaveDeRede, ipDaCliente } from "./ip-da-cliente";

/**
 * O IP que limita. Em produção (medido em 16/09): o primeiro item do
 * X-Forwarded-For é o que o cliente escrever, e `req.ip` (trust proxy 1) é um
 * proxy interno do Render dividido por todas as visitantes. O CF-Connecting-IP
 * é gravado pela Cloudflare e só vale no Render.
 */
const NO_RENDER = { RENDER: "true" } as NodeJS.ProcessEnv;
const FORA_DO_RENDER = {} as NodeJS.ProcessEnv;

describe("ipDaCliente", () => {
  it("no Render, usa o CF-Connecting-IP mesmo com X-Forwarded-For e req.ip diferentes", () => {
    const req = {
      headers: { "cf-connecting-ip": "198.51.100.23", "x-forwarded-for": "203.0.113.7, 198.51.100.23, 10.226.0.9" },
      ip: "10.226.0.9",
    };
    expect(ipDaCliente(req, NO_RENDER)).toBe("198.51.100.23");
  });

  it("no Render, aceita IPv6 e apara espaços", () => {
    expect(ipDaCliente({ headers: { "cf-connecting-ip": " 2001:db8::1 " }, ip: "10.0.0.1" }, NO_RENDER)).toBe("2001:db8::1");
  });

  it("no Render, valor que não é um IP cai em req.ip", () => {
    for (const invalido of ["abc", "1.2.3.4, 5.6.7.8", "", "999.1.1.1"]) {
      expect(ipDaCliente({ headers: { "cf-connecting-ip": invalido }, ip: "10.0.0.5" }, NO_RENDER)).toBe("10.0.0.5");
    }
  });

  it("fora do Render, ignora o CF-Connecting-IP (ninguém o sobrescreve e qualquer um o forjaria)", () => {
    expect(ipDaCliente({ headers: { "cf-connecting-ip": "198.51.100.23" }, ip: "127.0.0.1" }, FORA_DO_RENDER)).toBe("127.0.0.1");
    expect(ipDaCliente({ headers: { "cf-connecting-ip": "198.51.100.23" }, ip: "127.0.0.1" }, { RENDER: "false" } as NodeJS.ProcessEnv)).toBe("127.0.0.1");
  });

  it("nunca lê X-Forwarded-For nem True-Client-IP", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.7", "true-client-ip": "203.0.113.50" },
      ip: "10.0.0.5",
    };
    expect(ipDaCliente(req, NO_RENDER)).toBe("10.0.0.5");
    expect(ipDaCliente(req, FORA_DO_RENDER)).toBe("10.0.0.5");
  });

  it("sem req.ip usa o endereço do socket (é o que os testes com createCaller montam), e por fim 'unknown'", () => {
    expect(ipDaCliente({ headers: {}, socket: { remoteAddress: "10.0.0.8" } }, FORA_DO_RENDER)).toBe("10.0.0.8");
    expect(ipDaCliente({ headers: {} }, FORA_DO_RENDER)).toBe("unknown");
  });
});

describe("chaveDeRede", () => {
  it("IPv4 fica como está; IPv4 mapeado em IPv6 vira o IPv4", () => {
    expect(chaveDeRede("198.51.100.23")).toBe("198.51.100.23");
    expect(chaveDeRede("::ffff:198.51.100.23")).toBe("198.51.100.23");
  });

  it("IPv6 da mesma /56 dá a mesma chave (trocar de endereço não abre balde novo); outra /56, outra chave", () => {
    const a = chaveDeRede("2001:db8:abcd:1200::1");
    expect(chaveDeRede("2001:db8:abcd:12ff:ffff:ffff:ffff:fffe")).toBe(a);
    expect(chaveDeRede("2001:db8:abcd:1300::1")).not.toBe(a);
  });
});
