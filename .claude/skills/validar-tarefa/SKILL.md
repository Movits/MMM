---
name: validar-tarefa
description: "Valida a PR ou o cartão de um colega antes do merge: compara o diff com o cartão do Notion (não com o título), confere o CI e o Como verifiquei, roda as checagens, monta o roteiro de telas por nível de conta e redige o parecer. Também valida tarefa sem código (painel, DNS, jurídico) pela comprovação."
when_to_use: "Quando pedirem para validar, revisar ou aprovar a PR ou o cartão de outra pessoa do time. Quem é autor não valida."
argument-hint: "[número da PR ou cartão do Notion]"
allowed-tools:
  - "Bash(gh api user *)"
  - "Bash(gh pr view *)"
  - "Bash(gh pr diff *)"
  - "Bash(gh pr checks *)"
  - "Bash(gh pr checkout *)"
  - "Bash(gh run list *)"
  - "Bash(git fetch *)"
  - "Bash(git branch --show-current)"
  - "Bash(git rev-parse *)"
  - "Bash(git rev-list *)"
  - "Bash(git remote get-url *)"
  - "Bash(git switch *)"
  - "Bash(git pull --ff-only)"
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git diff *)"
  - "Bash(pnpm install)"
  - "Bash(node scripts/conferir-locales.mjs)"
  - "Bash(pnpm db:generate)"
  - "Bash(DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate)"
  - "Bash(pnpm check)"
  - "Bash(pnpm test)"
  - "Bash(pnpm build)"
  - "Bash(node .claude/hooks/carimbo.mjs *)"
  - "Bash(true)"
  - "mcp__github__get_me"
  - "mcp__github__pull_request_read"
---

!`git status -sb || true`

PR ou cartão: $ARGUMENTS

**Nuvem × computador.** Na nuvem `gh pr` dá 403: leia com `mcp__github__pull_request_read` (owner e repo do fim de `git remote get-url origin`); não há banco, então o roteiro de telas fica para a máquina local. No computador (Windows: Git Bash e, uma vez por computador, `pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"`) use `gh pr ...` e `pnpm dev` com banco local. Antes do `pnpm dev`, confirme que o `DATABASE_URL` do `.env` aponta para banco local, sem mostrar o valor (o aviso de início de sessão diz a classe: local, Aiven ou remoto); se não for local, pare e pergunte.

1. **Quem pede.** Descubra o login (`gh api user --jq .login` ou `mcp__github__get_me`). Se for autor da PR ou de commits dela, recuse: quem fez não valida.
2. **Ler a PR inteira.** Computador: `gh pr view N --comments`, `gh pr diff N` e `gh pr checks N`. Nuvem: `mcp__github__pull_request_read` com `get`, `get_diff`, `get_files`, `get_check_runs` (o CI é GitHub Actions, que registra check runs) e `get_review_comments`. Leia o "Como verifiquei" do autor: o que ele diz que conferiu e o que deixou de fora.
3. **Cartão, não título.** Leia o cartão e a aba Decisões pelo conector do Notion; sem conector, diga isso e peça o texto. O diff faz o que o cartão pede, e só isso? Muda comportamento do produto sem cartão nem decisão conhecida (Notion ou grupo): pergunte à pessoa.
4. **Rodar.** Com a pasta limpa (se não estiver, pare e pergunte; nada de `stash`), anote a branch atual (`git branch --show-current`). Computador: `gh pr checkout N`. Nuvem: `git fetch origin pull/N/head:validar-N` e `git switch validar-N`; se o proxy recusar, valide só pela leitura e escreva isso no parecer. Depois: `pnpm install`, `node scripts/conferir-locales.mjs`, `pnpm check`, `pnpm test` e `pnpm build`; se tocou `drizzle/`, também `pnpm db:generate` sem criar arquivo (sem `.env`: `DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate`, escrito exatamente assim; se mesmo assim pedir permissão, é esperado).
5. **Riscos:**
   - migração gerada pelo `db:generate` e não editada; em `drizzle/` só arquivos novos;
   - chave nova nos 10 idiomas, com tradução de verdade;
   - nada de `sql.raw`, segredo ou dado pessoal no diff;
   - tabela nova com dado pessoal entra em `scripts/exame/limpeza.mjs` e em `server/exclusao-de-conta.ts`;
   - as "Regras que não são estilo" do CLAUDE.md continuam de pé.
6. **Roteiro de telas** que a pessoa executa com `pnpm dev`, em banco local: tela | nível da conta (bronze, prata, ouro, admin) | o que fazer | o que esperar | console sem erro.
7. Opcional, com a branch da PR em mãos: `git fetch origin main` e então `/code-review origin/main...HEAD`, sem `ultra` (esse gasta créditos).
8. **Parecer:** "Aprovo: conferi A e B; não conferi C" ou "Peço mudanças: 1, 2". Mostre à pessoa e só poste com o ok dela: computador `gh pr review N --approve` (ou `--request-changes`) com `--body-file`; nuvem `mcp__github__pull_request_review_write` com `method: create`, `event: APPROVE` (ou `REQUEST_CHANGES`) e `body` (sem `event` a revisão fica pendente e ninguém a vê).
9. **Merge:** segue a regra do README (hoje: quem revisou e aprovou mescla). O Claude não aprova nem mescla por conta própria. Se a pessoa pedir, mescla no computador com `gh pr merge N --merge`, com o CI verde e carimbo válido (`node .claude/hooks/carimbo.mjs --status`; inválido: leia os passos 7 a 9 em `.claude/skills/comecar-tarefa/SKILL.md` e siga só eles, sem invocar a skill e sem o `git merge origin/main` na branch da PR, que é do autor). Na nuvem, não mescla: pede à pessoa que mescle do computador. Merge só por `gh pr merge`: o botão do site passa ao largo do carimbo. Depois do merge, avise quem roda a `/conferir-producao` e mova o cartão conforme a regra de status do CLAUDE.md.
10. **Tarefa sem código** (painel, DNS, jurídico): valide pela comprovação do cartão (print, link, resposta do serviço), repita o que der sem credencial de produção e escreva o parecer no cartão.
11. No fim, volte para a branch anotada no passo 4 (`git switch <branch anotada>`).
