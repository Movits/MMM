---
name: mudar-schema
description: "Como mudar o banco: editar só drizzle/schema.ts, gerar a migração com pnpm db:generate, ler o SQL gerado, aplicar só em banco local e resolver conflito de migração com outra PR. Use ao criar ou alterar tabela, coluna, índice ou enum, ou quando houver conflito em drizzle/."
paths:
  - "drizzle/**"
allowed-tools:
  - "Bash(pnpm db:generate)"
  - "Bash(pnpm db:generate *)"
  - "Bash(DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate)"
  - "Bash(DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate *)"
  - "Bash(git status *)"
  - "Bash(git diff *)"
  - "Bash(pnpm check)"
  - "Bash(true)"
---

!`git status --short drizzle/ || true`

**Nuvem × computador.** Na nuvem não há `.env` nem MySQL: gere com a URL fictícia do passo 2 e deixe o passo 4 com o CI (que cria o banco do zero em MariaDB), dizendo isso na PR. No computador com Windows, use o Git Bash: a sintaxe `VAR='...' comando` não funciona no PowerShell.

0. **Mudança destrutiva** (apagar ou renomear tabela ou coluna, estreitar tipo, `NOT NULL` sem default em tabela com dados) só com decisão do Roberto registrada no cartão. A migração roda sozinha no boot da produção e não volta.
1. Edite só `drizzle/schema.ts`. Nunca edite à mão `drizzle/*.sql`, `drizzle/meta/*_snapshot.json` nem `drizzle/meta/_journal.json`.
2. `pnpm db:generate --name <assunto-em-kebab>` (no padrão de `0013_rede-inteligente-e-termo-geral.sql`). No computador ele lê o `.env` sozinho. Sem `.env`: `DATABASE_URL=mysql://x:x@127.0.0.1:3306/x pnpm db:generate --name <assunto>`, escrito exatamente assim (é a forma do `allowed-tools`; se mesmo assim pedir permissão, é esperado); o generate não conecta, a variável só precisa existir. Nascem o `.sql`, o snapshot e uma entrada no journal.
3. **Leia o SQL gerado** e diga à pessoa, em português, o que ele faz. Errado? Desfaça só o que este generate criou (`git restore drizzle/meta/_journal.json` e apague o `.sql` e o snapshot novos que `git status --short drizzle/` mostra), corrija o `schema.ts` e gere de novo.
4. **Aplique só em banco local.** Os scripts de banco não leem o `.env`: a URL vai no comando, e o host TEM de ser `127.0.0.1` ou `localhost` (nunca o Aiven). Primeiro `DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/migrar.mjs --simular`, depois o mesmo sem `--simular`. As permissões do projeto perguntam antes; mostre a URL inteira à pessoa ao pedir.
5. Rode `pnpm check` e os testes da área. Rode `pnpm db:generate` de novo: ele tem de responder "No schema changes" e não criar mais nada.
6. **A `main` ganhou migração antes da sua** (conflito em `drizzle/` no `git merge origin/main`):
   - apague as suas migrações (o `.sql` e o snapshot que só existem na sua branch);
   - `git checkout origin/main -- drizzle/meta 'drizzle/*.sql'`;
   - resolva o `schema.ts` mantendo as duas mudanças;
   - gere de novo com `pnpm db:generate --name <assunto>` (sai com o número seguinte) e confira que o `_journal.json` só ganhou entradas em relação à `main`.
7. **Tabela ou coluna nova com dado pessoal** entra em `scripts/exame/limpeza.mjs` (faxina do exame de produção) e em `server/exclusao-de-conta.ts` (exclusão da conta). Os testes `server/exame-de-producao.test.ts` e `server/exclusao-de-conta.test.ts` conferem os dois contra o schema. Privacidade é regra de consulta: o nível público nunca seleciona coluna pessoal.
8. **Na PR**, em "Riscos": "Migração 00NN: o que faz em produção, quanto tempo pode travar a tabela, se é reversível". Em produção ela roda no boot: se falhar, a subida aborta e o Render mantém a versão anterior no ar.
