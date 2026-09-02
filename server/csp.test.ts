import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import helmet from "helmet";
import { montarDiretivasCsp } from "./_core/csp";

/**
 * A Content-Security-Policy por ambiente.
 *
 * Existe porque a política nasceu com 'unsafe-inline' e 'unsafe-eval' no
 * script-src "temporariamente" e assim foi para produção. O build de produção
 * não tem script inline nem eval (prova no comentário de _core/csp.ts), então
 * produção fica estrita e só o desenvolvimento, onde o Vite em middleware
 * injeta script inline, mantém as duas liberações.
 */

const semEnvironment = (diretivas: Record<string, string[]>) => {
  const { scriptSrc: _ignorado, ...resto } = diretivas;
  return resto;
};

describe("CSP: script-src por ambiente", () => {
  it("produção: script-src é só 'self', sem 'unsafe-inline' nem 'unsafe-eval'", () => {
    const producao = montarDiretivasCsp(false);
    expect(producao.scriptSrc).toEqual(["'self'"]);
    expect(producao.scriptSrc.join(" ")).not.toMatch(/unsafe-/);
  });

  it("desenvolvimento: mantém 'unsafe-inline' e 'unsafe-eval' para o Vite em middleware", () => {
    const dev = montarDiretivasCsp(true);
    expect(dev.scriptSrc).toContain("'self'");
    expect(dev.scriptSrc).toContain("'unsafe-inline'");
    expect(dev.scriptSrc).toContain("'unsafe-eval'");
  });

  it("o resto da política não muda com o ambiente", () => {
    expect(semEnvironment(montarDiretivasCsp(false))).toEqual(
      semEnvironment(montarDiretivasCsp(true))
    );
  });

  it("as fontes do Google seguem liberadas e style-src continua com 'unsafe-inline'", () => {
    const producao = montarDiretivasCsp(false);
    expect(producao.styleSrc).toContain("https://fonts.googleapis.com");
    expect(producao.styleSrc).toContain("'unsafe-inline'");
    expect(producao.fontSrc).toContain("https://fonts.gstatic.com");
    expect(producao.imgSrc).toEqual(["'self'", "data:", "https:", "blob:"]);
    expect(producao.connectSrc).toEqual(["'self'", "wss:", "https:"]);
    expect(producao.frameAncestors).toEqual(["'none'"]);
  });
});

describe("CSP: o cabeçalho que o helmet emite em produção", () => {
  it("script-src 'self' e nenhum unsafe-* fora do style-src", async () => {
    const app = express();
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: montarDiretivasCsp(false),
          useDefaults: false,
        },
      })
    );
    app.get("/", (_req, res) => res.send("ok"));

    const servidor = createServer(app);
    await new Promise<void>(resolve =>
      servidor.listen(0, "127.0.0.1", resolve)
    );
    try {
      const { port } = servidor.address() as AddressInfo;
      const resposta = await fetch(`http://127.0.0.1:${port}/`);
      const csp = resposta.headers.get("content-security-policy") ?? "";

      const diretivas = Object.fromEntries(
        csp
          .split(";")
          .map(d => d.trim())
          .filter(Boolean)
          .map(d => {
            const [nome, ...valores] = d.split(/\s+/);
            return [nome, valores.join(" ")];
          })
      );

      expect(diretivas["script-src"]).toBe("'self'");
      expect(diretivas["style-src"]).toContain("https://fonts.googleapis.com");
      expect(diretivas["font-src"]).toContain("https://fonts.gstatic.com");
      for (const [nome, valor] of Object.entries(diretivas)) {
        if (nome === "style-src") continue;
        expect(valor, `${nome} não pode liberar unsafe-*`).not.toMatch(
          /unsafe-/
        );
      }
    } finally {
      await new Promise<void>(resolve => servidor.close(() => resolve()));
    }
  });
});
