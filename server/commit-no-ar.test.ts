import { afterEach, describe, expect, it } from "vitest";
import { commitNoAr } from "./_core/systemRouter";

// O health check expõe o SHA curto do commit que o Render construiu, para o
// exame de produção responder "o deploy já saiu?" sem comparar hashes de bundle.
const original = process.env.RENDER_GIT_COMMIT;

afterEach(() => {
  if (original === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = original;
});

describe("commitNoAr", () => {
  it("devolve os 7 primeiros caracteres do SHA que o Render injeta", () => {
    process.env.RENDER_GIT_COMMIT = "87fec88a1b2c3d4e5f60718293a4b5c6d7e8f901";
    expect(commitNoAr()).toBe("87fec88");
  });

  it("devolve null fora do Render (variável ausente ou vazia)", () => {
    delete process.env.RENDER_GIT_COMMIT;
    expect(commitNoAr()).toBeNull();
    process.env.RENDER_GIT_COMMIT = "   ";
    expect(commitNoAr()).toBeNull();
  });
});
