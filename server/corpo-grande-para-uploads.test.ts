import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corpoGrandeParaUploads, procedimentosDaUrl } from "./_core/corpo-grande-para-uploads";

// A URL de lote do httpBatchLink ("a,b") não casa com o mount por caminho
// ("/api/trpc/a"): sem este middleware, um upload dentro de um lote caía no
// parser global de 5 MB e voltava 413 antes de o tRPC validar.

describe("procedimentosDaUrl", () => {
  it("lê o procedimento isolado e a lista do lote", () => {
    expect(procedimentosDaUrl("/api/trpc/dealRoom.uploadDocument")).toEqual(["dealRoom.uploadDocument"]);
    expect(procedimentosDaUrl("/api/trpc/dealRoom.uploadDocument,dealRoom.listDocuments")).toEqual([
      "dealRoom.uploadDocument",
      "dealRoom.listDocuments",
    ]);
  });

  it("ignora o que não é rota do tRPC", () => {
    expect(procedimentosDaUrl("/manus-storage/x")).toEqual([]);
    expect(procedimentosDaUrl("/")).toEqual([]);
  });
});

describe("corpoGrandeParaUploads", () => {
  let servidor: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    // Mesma ordem de server/_core/index.ts: o recorte antes do parser global.
    app.use(corpoGrandeParaUploads);
    app.use(express.json({ limit: "5mb" }));
    app.post("/api/trpc/*", (req, res) => {
      res.json({ bytes: JSON.stringify(req.body).length });
    });
    servidor = createServer(app);
    await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    base = typeof endereco === "object" && endereco ? `http://127.0.0.1:${endereco.port}` : "";
  });

  afterAll(async () => {
    await new Promise<void>(resolve => servidor.close(() => resolve()));
  });

  const corpoDe = (megabytes: number) => JSON.stringify({ json: { fileBase64: "a".repeat(megabytes * 1024 * 1024) } });

  const enviar = (caminho: string, corpo: string) =>
    fetch(base + caminho, { method: "POST", headers: { "content-type": "application/json" }, body: corpo });

  it("aceita 7 MB num lote que contém um procedimento com arquivo", async () => {
    const r = await enviar("/api/trpc/dealRoom.uploadDocument,dealRoom.listDocuments", corpoDe(7));
    expect(r.status).toBe(200);
  });

  it("aceita 7 MB no procedimento com arquivo sozinho", async () => {
    const r = await enviar("/api/trpc/sivc.uploadDocument", corpoDe(7));
    expect(r.status).toBe(200);
  });

  it("mantém os 5 MB do parser global para os demais procedimentos", async () => {
    const r = await enviar("/api/trpc/dealRoom.listDocuments", corpoDe(7));
    expect(r.status).toBe(413);
  });
});
