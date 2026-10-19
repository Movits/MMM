---
name: conferir-producao
description: "Exame de saúde da produção (wrwglobal.org) depois de um ou mais merges: confirma que o deploy saiu, roda scripts/checar-producao.mjs com o .env.producao e registra o veredito na PR e no cartão. Só no computador de quem tem o .env.producao; nunca na nuvem."
disable-model-invocation: true
argument-hint: "[--com-ia]"
allowed-tools:
  - "Bash(printenv CLAUDE_CODE_REMOTE)"
  - "Bash(test -f .env.producao)"
  - "Bash(git fetch *)"
  - "Bash(git log *)"
  - "Bash(git rev-parse *)"
---

Argumento: $ARGUMENTS (vazio = sem `--com-ia`)

O comando do exame fica fora do `allowed-tools` de propósito: ele cria e apaga dados em produção. Peça o sim da pessoa naquela hora, antes de cada execução, mesmo que as permissões do computador não perguntem, e registre o resultado na PR e no cartão.

**Nuvem × computador.** Na nuvem esta skill recusa (passo 1). No computador com Windows, rode no Git Bash, a partir da raiz do repositório: o caminho de `--env` é relativo à pasta atual.

1. `printenv CLAUDE_CODE_REMOTE`: se imprimir `true`, recuse ("o exame só roda no computador de quem tem o `.env.producao`").
2. **Quem roda:** só quem tem o `.env.producao` (hoje o Roberto). `test -f .env.producao`, sem abrir o arquivo; nunca leia, mostre ou copie o conteúdo dele. Se faltar, ou se a permissão recusar o teste, pergunte à pessoa e pare.
3. **Escopo.** `git fetch --prune origin`. Pergunte o SHA do último exame registrado (ou procure o último resumo do exame, a linha `N OK, N falha(s)...`, nos comentários das PRs e na Comprovação dos cartões) e liste `git log --first-parent --oneline <sha>..origin/main`. Um exame cobre o lote todo.
4. **O deploy saiu?** Com os Build Filters do Render, merge que só mexe em `docs/`, `*.md`, `.claude/`, `.github/` ou `vitrine/` não faz deploy, então o SHA esperado no ar é o do último merge que mexe em código: `git log -1 --first-parent --format=%h origin/main -- . ':!docs' ':!*.md' ':!.claude' ':!.github' ':!vitrine'` (compare os 7 primeiros caracteres). A pessoa confirma "Deploy live" no Render para esse merge. Sem acesso ao Render, vale a linha `INFO commit no ar` do exame: ela tem de trazer esse SHA ou, com os Build Filters desligados, um merge posterior a ele (`git log --first-parent --format=%h <esse>..origin/main`); senão, o exame olhou a versão anterior e não vale para o lote.
5. **Rodar:** `node scripts/checar-producao.mjs --env .env.producao`. Acrescente `--com-ia` só se algum merge do lote mexeu em IA: gasta cota. O que o exame faz em produção, e a pessoa precisa saber antes de aprovar:
   - cria e apaga 2 contas QA (`qa_exame_presidente` e `qa_exame_prata`), com login de verdade;
   - faz até 2 chamadas de IA mesmo sem `--com-ia`: o compliance da oportunidade QA, sempre, e o alerta de compatibilidade quando ela é aprovada e há conta Ouro, presidente ou admin real com perfil; o prompt do alerta leva setor, possui e procura dessas contas reais ao Gemini;
   - o Smart Match dispara um e-mail para o endereço `.invalid` da conta QA;
   - marca um contato QA como 'ouro' por poucos segundos e deixa uma oportunidade QA (confidencial, ativa) visível para contas Ouro reais até o fim da execução: dezenas de segundos; mais de 2 min com `--com-ia` ou quando a sondagem do alerta espera os 120 s;
   - deixa na trilha de auditoria as linhas `GOLD_ACERVO_READ` e `REVOKED_SESSION_ACCESS_ATTEMPT` das contas QA (decisão do Roberto, 02/09/2026);
   - gasta cerca de 70 das 100 requisições por minuto do IP: não rode da mesma rede de quem está usando o site.
   Confira na linha `INFO exame de ...` que o endereço examinado é o da produção.
6. **Ler o veredito.** A última linha diz `N OK, N falha(s), N pulado(s) | veredito`.
   - Conte OK, FALHA, ALERTA e PULADO. ALERTA conta como falha.
   - PULADO não é "passou": liste cada um (o resumo os repete como NÃO PROVADO).
   - "limpeza incompleta" ou execução interrompida: rode `node scripts/checar-producao.mjs --env .env.producao --somente-faxina`, que só apaga resíduos QA, e avise o Roberto.
7. **Com falha:** avise o autor da PR e o Roberto, e mova o cartão conforme a regra de status do CLAUDE.md. Nada de consertar direto em produção: o conserto é uma PR nova.
8. **Sem falha:** cole o resumo, com o SHA examinado e só contagens e nomes de checagem (nunca dado pessoal), na PR e no campo Comprovação do cartão, e mova o cartão conforme a regra de status do CLAUDE.md (avise quem validou).
