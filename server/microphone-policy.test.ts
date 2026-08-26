import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Política de microfone para reuniões", () => {
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), "server/_core/index.ts"), "utf8");

  it("permite microfone somente para o próprio domínio", () => {
    expect(serverSource).toContain("microphone=(self)");
    expect(serverSource).not.toContain("microphone=*");
  });

  it("preserva o limite ampliado somente no upload de reuniões", () => {
    expect(serverSource).toContain('app.use("/api/trpc/meetings.submitRecording", express.json({ limit: "15mb" }))');
    expect(serverSource).toContain('app.use(express.json({ limit: "5mb" }))');
  });
});
