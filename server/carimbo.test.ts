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
      // Revisão independente de 19/10: git e gh em qualquer posição, embrulhos,
      // .exe, --dry-run como valor, opção global com valor e runners.
      '"git status; if ($?) { git commit -m x }" -> commit',
      '"timeout 60 git push" -> push',
      '"git.exe commit -m x" -> commit',
      '"gh.exe pr merge 12" -> merge',
      '"x=$(git commit -m y)" -> commit',
      '"git commit -m --dry-run" -> commit',
      '"git push -o -n origin main" -> push',
      '"git --git-dir .git push" -> push',
      '"git -c alias.p=push p origin main" -> merge',
      '"echo \\"git push\\" | bash" -> push',
      '"bash mescla.sh" -> merge',
      '"gh api \'-\'X PUT repos/o/r/pulls/1/merge" -> merge',
      '"Pop-Location; git merge origin/main" [branch fix/x] -> merge',
      '"git push --dry-run origin feat/x" -> null',
      '"grep -n bash LEIAME.md" -> null',
      '"pnpm exec tsx scripts/x.ts --nota \'git push feito\'" -> null',
      '"cat > notas.md <<\'EOF\'\\nRode git push -u origin feat/x\\nEOF" -> null',
      // Segunda rodada: comentário, aspa escapada, $( ) em aspas, here-string,
      // script por -File, revert/pull e desempenho.
      '"git fetch --prune\\n# traz a main (git merge origin/main) antes da PR\\ngit merge --no-edit origin/main" [branch fix/x] -> null',
      '"# Nicolas\'s review ok\\ngit push -u origin feat/x" -> push',
      '"saida=\\"$(git push -u origin feat/x 2>&1)\\"\\necho \\"$saida\\"" -> push',
      '"git status && echo \\"a \\\\\\" b\\" && gh pr merge 12 --squash" -> merge',
      '"gh pr create --title x --body @\'\\nIt\'s ready\\n\'@\\ngh pr merge --auto --squash" [PowerShell] -> merge',
      '"powershell -ExecutionPolicy Bypass -File publica.ps1" [PowerShell] -> push',
      '"git revert --no-edit HEAD" -> commit',
      '"gh pr update-branch 161" -> push',
      '"if ($?) { git push -u origin feat/x } else { Write-Host \'falhou\' -n }" [PowerShell] -> push',
      // Terceira rodada: redirecionamento, string do runner com o shell dele,
      // script gravado e rodado na mesma chamada, gh com -R antes do grupo.
      '"git merge origin/main 2>&1" [branch fix/x] -> null',
      '"bash -c \'git pull --ff-only\'" -> null',
      '"git ls-files \'*.md\' | xargs grep -l \\"git push\\"" -> null',
      '"cat > novo.sh <<\'EOF\'\\nset -e\\ngh pr merge 161 --merge --admin\\nEOF\\nbash novo.sh" -> merge',
      '"gh --repo Movits/MMM pr merge 161 --squash" -> merge',
      '"gh api repos/o/r/issues/161/comments -f body=\'Revisado: pronto para merge quando o CI ficar verde.\'" -> null',
      "desempenho: heredoc de 130 mil linhas para o bash -> push",
      "desempenho: 25 mil git merge numa linha -> merge",
    ]) {
      expect(linhas.some(l => l.startsWith(`ok   ${caso} `))).toBe(true);
    }
  });
});
