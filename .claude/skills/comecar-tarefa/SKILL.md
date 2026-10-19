---
name: comecar-tarefa
description: "Começa uma tarefa ou só põe a pasta em dia. Sem argumento: atualiza a main, oferece apagar branches locais já mescladas, resume o que entrou (commits, PRs, CI) e volta para a branch onde estava. Com o cartão do Notion ou o assunto: também lê o cartão e a aba Decisões, pergunta o que houve no grupo do WhatsApp, registra o carimbo da conferência e cria a branch."
when_to_use: "No início de qualquer tarefa, ao retomar um cartão, ao voltar depois de dias fora ou quando pedirem para atualizar a pasta local."
argument-hint: "[cartão do Notion ou assunto; vazio = só pôr a pasta em dia]"
allowed-tools:
  - "Bash(git status *)"
  - "Bash(git log *)"
  - "Bash(git diff *)"
  - "Bash(git fetch *)"
  - "Bash(git branch --show-current)"
  - "Bash(git branch --merged *)"
  - "Bash(git branch -vv)"
  - "Bash(git rev-parse *)"
  - "Bash(git rev-list *)"
  - "Bash(git remote get-url *)"
  - "Bash(git switch *)"
  - "Bash(git pull --ff-only)"
  - "Bash(git merge origin/main)"
  - "Bash(pnpm install)"
  - "Bash(gh run list *)"
  - "Bash(gh pr list *)"
  - "Bash(gh pr diff *)"
  - "Bash(node .claude/hooks/carimbo.mjs *)"
  - "Bash(true)"
  - "mcp__github__list_pull_requests"
  - "mcp__github__pull_request_read"
---
!`git status -sb || true`
!`git log --oneline -1 origin/main || true`
!`node .claude/hooks/carimbo.mjs --status || true`

Cartão ou assunto: $ARGUMENTS

**Nuvem × computador.** Na nuvem (claude.ai/code) a sessão já tem uma branch `claude/...` e fica nela; `gh pr` dá 403, então use as ferramentas `mcp__github__*` (owner e repo saem do fim de `git remote get-url origin`); não há MySQL; o clone é novo e não tem carimbo. No computador com Windows, rode no Git Bash e, uma vez por computador, `pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"` (sem isso o pnpm roda os scripts no cmd); sem `pnpm` no PATH, use `corepack pnpm`.

## Pôr a pasta em dia (sempre)
1. Há mudança não commitada? Pare e pergunte o que fazer. Nada de `stash` por conta própria.
2. `git fetch --prune origin`.
3. Anote a branch atual (`git branch --show-current`). Computador, pasta limpa: anote `git rev-parse --short main`, rode `git switch main && git pull --ff-only` e compare (`git diff --name-only <antes> HEAD`). Numa worktree (a `main` presa na pasta principal), troque o `git switch main && git pull --ff-only` por `git fetch --prune origin` e compare com `origin/main`. Se o `--ff-only` recusar, a `main` local tem commit que não está no GitHub: pare e pergunte. Na nuvem, não troque de branch agora.
   - mudou `pnpm-lock.yaml`: rode `pnpm install`;
   - mudou `drizzle/`: lembre de aplicar as migrações no banco LOCAL (leia o passo 4 de `.claude/skills/mudar-schema/SKILL.md`);
   - mudou `.env.example`: liste só os NOMES das variáveis novas.
4. Branches locais: as de `git branch --merged origin/main --no-contains origin/main` (o `--no-contains` tira as branches recém-criadas, que ainda não têm commit) e as marcadas `: gone]` em `git branch -vv`. Ignore a `main`, a atual (`*`), a anotada no passo 3 e as abertas em outra worktree (`+`). Ofereça apagar cada uma com `git branch -d <nome>`, uma por vez e só com o sim da pessoa. Nunca `-D`. Merge por squash não aparece em `--merged` e o `-d` recusa: mostre o motivo e deixe a decisão com a pessoa.
5. O que entrou: `git log --oneline -15 origin/main`, `gh run list --limit 5` e as PRs (`gh pr list --state all --limit 10` no computador; `mcp__github__list_pull_requests` com `state: all` na nuvem). PR que toca a área da tarefa: leia o diff e diga se o código faz o que o título diz.
6. **Sem argumento, pare aqui.** Se o passo 3 saiu de outra branch, volte para ela (`git switch <branch anotada>`) e diga quantos commits ela está atrás (`git rev-list --count HEAD..origin/main`); se ela já entrou na `main`, diga isso (trabalho novo pede branch nova). Depois, um resumo de 5 linhas: onde está a `main`, o que entrou, o CI, as PRs abertas esperando validação e as branches apagadas ou pendentes.

## Com o cartão ou o assunto
7. **Notion.** Com o conector, leia o cartão e a aba Decisões. Sem ele, diga isso e peça à pessoa o texto do cartão e das decisões que importam. Nunca diga que leu o que não abriu.
8. **Grupo "Projetos IA".** Se você não tem como ler o grupo, pergunte à pessoa o que houve lá desde a última conferência (decisões, pedidos da cliente); nunca invente. Decisão que só existe no grupo: peça que ela seja anotada no cartão ou na aba Decisões antes de implementar. Pedido, cartão e grupo em contradição: pare e pergunte.
9. **Carimbo.** O registro exige `HEAD` em dia com `origin/main`. Se a branch ficou atrás de `origin/main` (`git rev-list --count HEAD..origin/main` não dá 0, no computador ou na nuvem): anote a branch (`git branch --show-current`), `git switch main && git pull --ff-only`, carimbe, volte com `git switch <branch anotada>` e rode `git merge origin/main`. Numa worktree, onde a `main` está presa na pasta principal e o `git switch main` falha, use `git switch --detach origin/main` no lugar dele e volte do mesmo jeito. Nunca rebase de branch já empurrada. O registro:
   `node .claude/hooks/carimbo.mjs --carimbar --github "..." --notion "..." --whatsapp "..."`
   - cada texto com 20 caracteres ou mais; o de `--github` cita o SHA curto de `origin/main` (`git rev-parse --short origin/main`) e diz o que você viu;
   - `--notion`: "cartão X lido pelo conector em <DD/MM>: <resumo>" ou "texto do cartão colado por <pessoa> em <DD/MM>: <resumo>";
   - `--whatsapp`: "informado por <pessoa> em <DD/MM>: <resumo>" (ou "...: nada novo"). Nunca escreva "conferido" sem ter lido;
   - o comando faz `git fetch` e recusa se a `main` andou ou se a branch atual está atrás dela; vale 6 h e vence quando `origin/main` muda; sem carimbo válido, o hook recusa `git commit`, `git push`, `git merge` e `gh pr merge`.
10. **Branch.**
    - Tarefa nova, no computador: `git switch -c <feat|fix|docs|chore>/<assunto-curto> --no-track origin/main` (o `--no-track` evita que a branch nova siga a `main`; o `git push -u` da `/abrir-pr` acerta o destino).
    - Cartão com branch existente: `git switch <branch>` e `git merge origin/main` (o carimbo do passo 9 libera).
    - Nuvem: fique na `claude/...` e rode `git merge origin/main` se ela estiver atrás.
    - Conflito em `drizzle/`: leia o passo 6 de `.claude/skills/mudar-schema/SKILL.md` e siga-o. Outro conflito: pare e pergunte.
11. Responda com o plano em 3 a 5 linhas e o bloco **Conferência** para a PR: `origin/main` em `<sha>`, PRs vistas, cartão, decisões e o que o grupo trouxe (com quem informou).
