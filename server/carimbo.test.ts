import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// O hook do carimbo (.claude/hooks/carimbo.mjs) decide o que trava sem
// conferência: commit, push, merge na main, escrita pelo `gh api`. O CI só faz
// `node --check` nele, então uma regressão na detecção passava verde (revisão
// de 19/10 da #161, que achou `gh api -iX PUT .../merge` e
// `git merge -m --abort feat/outra` liberados sem carimbo). Este teste roda o
// autoteste do próprio hook, com a lista de casos que mora lá.
//
// Roda como processo à parte, do jeito que o Claude Code chama o hook: o
// módulo executa o modo pedido em process.argv ao ser carregado, e importá-lo
// aqui rodaria esse modo dentro do Vitest.
const AQUI: string = (import.meta as { dirname?: string }).dirname ?? path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(AQUI, "..", ".claude", "hooks", "carimbo.mjs");

describe("hook do carimbo (--testar)", () => {
  // O autoteste também confere se o .claude/carimbo.local.json do clone é JSON
  // válido. O carimbo de quem roda a suíte não é assunto dela: a raiz do
  // projeto aponta para uma pasta vazia, sem carimbo nenhum.
  const raizVazia = mkdtempSync(path.join(tmpdir(), "carimbo-"));
  afterAll(() => rmSync(raizVazia, { recursive: true, force: true }));

  it("dá o esperado em todos os casos da lista do hook", () => {
    const r = spawnSync(process.execPath, [HOOK, "--testar"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: raizVazia },
      timeout: 30_000,
    });
    const linhas = (r.stdout || "").split(/\r?\n/).filter(Boolean);
    // As linhas com ERRO dizem qual comando saiu diferente do esperado.
    expect(linhas.filter(l => l.startsWith("ERRO"))).toEqual([]);
    expect(r.stderr).toBe("");
    expect(linhas.at(-1)).toBe("Autoteste verde.");
    expect(r.status).toBe(0);
    // Uma lista que encolhe sem querer também é regressão: os casos da
    // revisão de 19/10 precisam estar entre os que rodaram.
    for (const caso of [
      '"gh api -iX PUT repos/o/r/pulls/1/merge" -> merge',
      '"gh api -iXPUT repos/o/r/pulls/1/merge" -> merge',
      '"gh api repos/o/r/merges -iF base=main -iF head=x" -> merge',
      '"gh api --method=PUT repos/o/r/pulls/1/merge" -> merge',
      '"gh api repos/o/r/merges --field base=main --field head=x" -> merge',
      '"gh api -X PATCH repos/o/r/merges" -> merge',
      '"git merge -m --abort feat/outra" [branch fix/x] -> merge',
      '"git merge --abort origin/x" [branch fix/x] -> merge',
      '"gh api repos/o/r/pulls/1 --jq \'.merged\'" -> null',
      '"gh api \'repos/o/r/pulls?state=closed\' --jq \'.[].merged_at\'" -> null',
      '"git merge --abort" -> null',
      '"git merge origin/main" [branch fix/x] -> null',
    ]) {
      expect(linhas.some(l => l.startsWith(`ok   ${caso} `))).toBe(true);
    }
  });
});
