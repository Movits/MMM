---
name: abrir-pr
description: "Prepara e abre a PR da branch atual: traz a main, roda o que o CI roda, procura segredo, dado pessoal e sql.raw, passa a revisão por IA, escreve a descrição no modelo do time e abre a PR. Nunca aprova nem mescla."
disable-model-invocation: true
argument-hint: "[cartão do Notion, se ainda não foi dito]"
allowed-tools:
  - "Bash(git status *)"
  - "Bash(git branch --show-current)"
  - "Bash(git fetch *)"
  - "Bash(git log *)"
  - "Bash(git diff *)"
  - "Bash(git rev-parse *)"
  - "Bash(git rev-list *)"
  - "Bash(git remote get-url *)"
  - "Bash(git switch *)"
  - "Bash(git pull --ff-only)"
  - "Bash(git merge origin/main)"
  - "Bash(node .claude/hooks/carimbo.mjs *)"
  - "Bash(node scripts/conferir-locales.mjs)"
  - "Bash(pnpm db:generate)"
  - "Bash(DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate)"
  - "Bash(pnpm check)"
  - "Bash(node --check *)"
  - "Bash(pnpm test)"
  - "Bash(pnpm build)"
  - "Bash(git push -u origin *)"
  - "Bash(gh pr create *)"
  - "Bash(gh run list *)"
  - "Bash(true)"
  - "mcp__github__create_pull_request"
---
!`git status -sb || true`
!`node .claude/hooks/carimbo.mjs --status || true`

Cartão: $ARGUMENTS

**Nuvem × computador.** Na nuvem não há `.env` nem MySQL, `gh pr` dá 403 (a PR sai por `mcp__github__create_pull_request`) e não dá para abrir as telas: escreva "smoke não feito" na PR. No computador (Windows: Git Bash e, uma vez por computador, `pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"`), a PR sai por `gh pr create` e as telas se abrem com `pnpm dev` antes de começar. Antes do `pnpm dev`, confirme que o `DATABASE_URL` do `.env` aponta para banco local, sem mostrar o valor (o aviso de início de sessão diz a classe: local, Aiven ou remoto); se não for local, pare e pergunte.

1. Na `main`, recuse: "crie a branch com /comecar-tarefa".
2. **Carimbo.** `git fetch --prune origin` e `node .claude/hooks/carimbo.mjs --status`. Inválido (venceu ou a `main` andou): leia os passos 7 a 9 em `.claude/skills/comecar-tarefa/SKILL.md` e siga só eles (não invoque a skill: ela troca e cria branch). O passo 9 diz como carimbar com a branch atrás da `main` e voltar para a branch anotada. O que não foi commitado vai junto na troca; se o git recusar, pare e pergunte.
3. Mudança não commitada: pergunte se entra na PR e, se entra, commite (mensagem em português: o que mudou e por quê).
4. **Trazer a main:** `git merge origin/main`; nunca rebase (a branch pode já estar no GitHub). Conflito em `drizzle/`: leia o passo 6 de `.claude/skills/mudar-schema/SKILL.md` e siga-o. Outro conflito: pare e pergunte.
5. **O que o CI roda**, na ordem de `.github/workflows/testes.yml` (se esta lista divergir do arquivo, vale o arquivo). Falha não se tolera: se a mesma falha acontece na `main`, pare e avise a pessoa (vira cartão); não abra a PR como verde.
   1. `node scripts/conferir-locales.mjs`
   2. `pnpm db:generate`, e `git status --porcelain drizzle/` tem de sair vazio. Sem `.env` (nuvem): `DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate`, escrito exatamente assim (é a forma do `allowed-tools`; se mesmo assim pedir permissão, é esperado); o generate não conecta, a variável só precisa existir.
   3. Banco do zero (`criar-banco.mjs` e depois `nivelar-banco.mjs` dizendo "Nada a nivelar"): só se a PR toca `drizzle/` e há MariaDB ou MySQL local descartável. Senão, escreva "banco do zero fica com o CI".
   4. `pnpm check`
   5. `for f in scripts/*.mjs scripts/*/*.mjs .claude/hooks/*.mjs; do node --check "$f" || exit 1; done`
   6. `pnpm test`
   7. `pnpm build`
6. **Varredura** das linhas que a PR acrescenta:
   `git diff origin/main...HEAD -- . ':!pnpm-lock.yaml' | grep -nE '^\+.*(mysql://[^ ]*:[^ ]*@|aivencloud|AIza|-----BEGIN|sql\.raw|[A-Za-z0-9+/_=-]{40,})' || true`
   - olhe também e-mails e telefones de pessoas reais nas linhas com `+`;
   - `git diff --name-status origin/main...HEAD`: nada de `.env*` (fora o `.env.example`) nem dump; em `drizzle/` só `A` (arquivo novo), nunca `M` num `.sql` que já estava na `main`. Achou algo: pare e mostre à pessoa antes de seguir.
7. **Revisão por IA:** rode `/code-review origin/main...HEAD` (a branch inteira contra a `main`, com ou sem upstream), sem `ultra` (esse gasta créditos). Corrija o que for real, em commit novo, e rode de novo o que a correção afetar.
8. **Descrição** pelo `.github/pull_request_template.md`. Se ele não existir, use as seções: O que muda / Por quê (cartão e decisão) / Como verifiquei / Como validar (para quem revisa) / Riscos e o que fica de fora / Conferência (a saída de `node .claude/hooks/carimbo.mjs --status`). Em "Como verifiquei": cada comando com o resultado, as telas abertas com o nível da conta (bronze, prata, ouro, admin) e o que NÃO foi verificado. Salve num arquivo temporário fora do repositório.
9. **Publicar.** `git push -u origin <nome da branch>`, com o nome escrito (o hook confere o carimbo; a forma com `HEAD` pede confirmação). Computador: `gh pr create --base main --title "<tipo>: <o que muda>" --body-file <arquivo>`. Nuvem: `mcp__github__create_pull_request` com `base: main` e a branch atual como `head` (owner e repo do fim de `git remote get-url origin`). Mostre o link.
10. **CI:** acompanhe com `gh run list --branch <branch> --limit 3`. Vermelho: corrija antes de pedir validação.
11. **Cartão:** com o CI verde e o ok da pessoa, mova o cartão conforme a regra de status do CLAUDE.md, com o link da PR, e diga a quem pedir a validação (outra pessoa do time; quem fez não valida).
12. Nunca aprove, mescle nem marque "Concluído": quem marca "Concluído" é outra pessoa, conforme a regra de status do quadro no CLAUDE.md.
