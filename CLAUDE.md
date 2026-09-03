# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O projeto

MMM: Mulheres que Movem o Mundo: CRM de networking em que cada usuária mantém uma
base privada de contatos e a IA cruza o que cada contato **possui** com o que cada
contato **procura** para gerar oportunidades. Todo o texto do repositório (docs,
commits, PRs) é em português; siga o padrão.

Time: Roberto (Movits) lidera; Nicolas, Gabriel e Lucas desenvolvem instruindo os
próprios Claudes, então este arquivo é lido por todos eles. Cliente: Glenda. A gestão
do projeto (escopo das 13 seções, responsáveis, status, prazos) fica no **Notion**,
não aqui; as decisões da cliente nascem no grupo do time e nem sempre chegam ao
Notion. O repositório é para código e desenho técnico. Commit e PR dizem o que
mudou, por quê e como verificar, em português claro.

## Comandos

Requisitos: Node 20+, pnpm e um MySQL acessível.

```bash
pnpm install
cp .env.example .env   # preencher as variáveis
node scripts/criar-banco.mjs   # banco novo do zero (via migrações)
pnpm db:generate       # edite drizzle/schema.ts e gere a migração
pnpm db:migrate        # aplica as migrações pendentes (scripts/migrar.mjs)
node scripts/migrar.mjs --simular   # só relata o que aplicaria
node scripts/nivelar-banco.mjs      # banco antigo desalinhado: relata; --aplicar cria o que falta
pnpm dev               # http://localhost:3000
pnpm check             # tsc --noEmit (não compila os *.test.ts)
pnpm test              # vitest run (server em Node + client em jsdom)
pnpm vitest run server/match-service.test.ts   # um teste só
pnpm build             # vite build + esbuild do servidor → dist/
pnpm start             # roda o build de produção
pnpm format            # prettier --write .
node scripts/conferir-locales.mjs   # os 10 idiomas têm as mesmas chaves (o CI também roda)
node scripts/checar-producao.mjs    # exame de saúde da produção (pós-deploy); --com-ia inclui as checagens de IA
node scripts/semear-rede-de-teste.mjs   # contatos fictícios na rede de uma usuária; --limpar desfaz
node scripts/definir-senha-local.mjs    # senha de conta em banco LOCAL (sem Resend em dev)
node .claude/hooks/carimbo.mjs --status # estado da conferência (ver "Fluxo de trabalho")
```

- **No Windows, use Git Bash**: `dev` e `start` definem `NODE_ENV` com sintaxe
  POSIX e falham no PowerShell. Se `pnpm` não estiver no PATH, `corepack pnpm`.
- `JWT_SECRET` é obrigatória: o servidor se recusa a iniciar sem ela
  (`requireSecret()` em `server/_core/env.ts`, chamado ao carregar `server/auth.ts`).
  `VAULT_ENCRYPTION_KEY` deve existir em produção, mas o código não a exige: sem ela,
  `server/security.ts` e `server/matching.ts` derivam a chave do cofre do `JWT_SECRET`.
  Sem `DATABASE_URL` o servidor SOBE, e todo acesso ao banco responde "Banco de dados
  indisponível" (ver "Acesso a dados"). Não há valores padrão de propósito.
  `LLM_API_URL` também não tem fallback.
- Com `.env` completo (banco + chave do Gemini), a suíte passa inteira; testes
  que dependem de credencial ausente (ex.: Resend) se auto-pulam com `skipIf`.
  Falha na suíte é regressão, sem exceções toleradas.

## Fluxo de trabalho

Vale para qualquer pessoa, e qualquer Claude, que mexa neste repositório. Já houve
push na `main` com a tarefa marcada "concluída" no Notion e o código não resolvendo o
que dizia: título de commit não é evidência.

**Antes de começar uma tarefa**

1. `git fetch --prune` e confira que sua base é a `main` atual (`git status -sb`).
   Trabalhe em branch (`feat/...`, `fix/...`, `docs/...`): a `main` é protegida e
   cada merge nela vira deploy automático em produção.
2. Leia o que entrou desde a última vez: `git log --oneline -15 origin/main`,
   `gh pr list --state all --limit 10`, `gh run list --limit 5`. Para cada commit ou
   PR que toque na sua área, abra o diff (`gh pr diff N`) e confirme que o código faz
   o que a mensagem diz e o que a tarefa pedia.
3. Confira o quadro do Notion (concluído, removido, adicionado, notificações; "Feito
   (a validar)" é trabalho à espera de validação por OUTRA pessoa, não "Concluído";
   validar item de colega faz parte do trabalho) e as decisões no grupo de WhatsApp "Projetos IA",
   canal principal do time. **Se o seu Claude não tem acesso a eles, diga isso e
   pergunte a quem tem; nunca declare que conferiu sem ter aberto.**
4. Registre a conferência (é o que destrava commit e push):
   `node .claude/hooks/carimbo.mjs --carimbar --github "..." --notion "..." --whatsapp "..."`.
   O texto de `--github` precisa citar o commit atual de `origin/main`. O carimbo vale
   6 h e vence quando `origin/main` muda.
5. Só então planeje e implemente. Contradição entre pedido, Notion e grupo: pare e
   pergunte.

**Antes de commitar ou empurrar**

- Repita o passo 1: a `main` pode ter andado. Traga-a para a branch antes da PR.
- Rode o que o CI roda: `pnpm check`, `pnpm test`, `pnpm build`; se tocou em
  `drizzle/schema.ts`, `pnpm db:generate` não pode criar arquivo; se tocou em texto
  de tela, `node scripts/conferir-locales.mjs`. Ver "Testes".
- Confira o diff contra segredos e dados pessoais.
- O hook `.claude/settings.json` + `.claude/hooks/carimbo.mjs` recusa `git commit`,
  `git push`, `git merge` e `gh pr merge` sem carimbo válido. Ele não prova que o
  Notion e o grupo foram lidos; prova que a conferência foi registrada. O botão
  "Merge" do site passa ao largo, por isso merge só por `gh pr merge`.

**Depois do merge**: espere o deploy do Render e rode `node scripts/checar-producao.mjs`.
Só então mova a tarefa no Notion para "Feito (a validar)", com a comprovação (link da
PR, saída do exame). Quem fez não conclui: outra pessoa do time valida no link de
teste e só ela marca "Concluído".

## Testes

O CI (`.github/workflows/testes.yml`, toda PR e push na `main`) roda, nesta ordem:
`conferir-locales.mjs` (10 idiomas com as mesmas chaves) → `pnpm db:generate` (falha
se criar arquivo em `drizzle/`) → banco do zero em MariaDB 11.4 com `criar-banco.mjs`
→ `nivelar-banco.mjs` exigindo "Nada a nivelar" → `pnpm check` → `pnpm test` →
`pnpm build`. Rode o mesmo antes da PR.

**Servidor.** Lógica nova em `server/` ganha ou atualiza um `*.test.ts` ao lado
(41 hoje). Padrão: `vi.mock` das dependências; credencial ausente se auto-pula com
`skipIf`; a suíte NUNCA lê `DATABASE_URL` (`server/test/setup-banco.ts` a troca por
`DATABASE_URL_TESTES`, um banco descartável; sem ela o `*.integracao.test.ts` se pula),
porque o `.env` de trabalho já apontou para produção e `pnpm test` chegou a promover
uma usuária real; `RUN_LIVE_CREDENTIAL_TESTS=true` liga os testes que falam com a API
real do Gemini (fora dele, `pnpm test` não gasta cota). Ninguém checa os tipos dos testes: o `tsconfig`
exclui `*.test.ts` e `*.test.tsx` do `pnpm check`, e o Vitest só transpila (esbuild
remove os tipos sem conferir). Um mock com a forma errada passa em silêncio; escreva o
dublê a partir do tipo real e prefira asserções que discriminem comportamento.

**Front.** Há runner: `vitest.workspace.ts` divide a suíte em dois projetos, `server`
(Node) e `client` (jsdom + Testing Library), e `pnpm test` roda os dois. Teste de
front fica em `client/src/**/*.test.tsx`, ao lado do componente (padrão:
`client/src/components/ProtectedRoute.test.tsx`, que mocka `useAuth` com `vi.mock` e
troca `window.location` por um dublê para ler o redirecionamento sem navegar);
`client/src/test/setup.ts` carrega o jest-dom, limpa o DOM entre testes e fixa o i18n
em pt-BR. O `tsconfig` exclui `*.test.tsx` como exclui `*.test.ts`. Teste automatizado
não dispensa o smoke manual: "testado" no front continua significando `pnpm check` e
`pnpm build` verdes; `conferir-locales` se tocou em texto; abrir cada tela afetada com
`pnpm dev`, logado com o nível certo (bronze, prata, ouro, admin) quando a tela depende
de nível, exercitar a mudança e conferir o console sem erro; e uma seção "Como
verifiquei" na PR listando as telas. Função pura do client pode ser testada em
`server/*.test.ts` (padrão: `server/transcricao-destacada.test.ts`) ou, sem JSX, em
`client/src/**/*.test.ts`, que o projeto `client` também colhe.

## Arquitetura

Aplicação full-stack TypeScript num único pacote: React 19 + Vite no client,
tRPC 11 sobre Express 4 no servidor, MySQL via Drizzle.

**Entrada e boot.** A entrada real é `server/_core/index.ts` (`server/index.ts` é um
resto morto). Ordem: migrações no boot (só em produção, ver "Banco"), helmet,
compression, cabeçalhos de segurança, bloqueio de scanners, rate limit global, body
parsers (15 MB só em `meetings.submitRecording` e `contexts.uploadMedia`, 5 MB no
resto), proxy de storage, tRPC em `/api/trpc`, e por fim Vite em middleware (dev) ou
estático de `dist/public` (prod). Não há proxy de dev: front e API na mesma origem.

**Fluxo de tipos ponta a ponta (tRPC).** Cada área de negócio tem um router em
`server/routers/` (auth, network, matches, opportunities, dealRoom, meetings, sivc,
president, consent…), agregados em `server/routers.ts`. O client consome tudo tipado
via `client/src/lib/trpc.ts` + React Query. **Há duas camadas de procedures base**:
`server/_core/trpc.ts` tem `publicProcedure`, `protectedProcedure` e um
`adminProcedure` estrito (só `role === "admin"`); `server/routers/_procedures.ts` tem
`adminProcedure`, `presidentProcedure` e `goldProcedure`, e **as três aceitam o mesmo
conjunto {admin, president, gold}**: é a regra "Ouro = Presidente = administradora",
pedida pela cliente e confirmada pelo Roberto em 02/09/2026: toda conta Ouro tem o
painel administrativo. Consequência: contas Ouro criadas só para teste (inclusive a do
Roberto) precisam voltar a Prata antes da entrega. Checagens "Ouro ou acima" ainda
estão repetidas inline em `dealRoom.ts`, `matching.ts`, `opportunities.ts`,
`storageProxy.ts` e no client.

**Acesso a dados.** `server/db.ts` é a camada única (usuárias, oportunidades, Ouro,
segurança, matches, rede privada, contextos, enriquecimento). Banco fora do ar é ERRO,
nunca "sem dados": todo helper abre com `exigirDb()`, que lança `BancoIndisponivel`
(classe em `server/banco-indisponivel.ts`) quando não há `DATABASE_URL`. Em produção a
variável existe sempre e `drizzle(url)` não conecta ao criar o pool, então a queda real
chega na primeira query como erro de conexão do driver (`DrizzleQueryError` com
`cause.code` ECONNREFUSED, ETIMEDOUT, PROTOCOL_CONNECTION_LOST...);
`ehErroDeBancoIndisponivel()` reconhece os dois casos na cadeia de `cause`. O middleware
de `server/_core/trpc.ts` traduz qualquer um deles, em todo procedimento, num
`INTERNAL_SERVER_ERROR` com `MENSAGEM_BANCO_INDISPONIVEL` (em português), e o
`errorFormatter` do mesmo arquivo mascara os demais erros do driver ("Erro ao consultar
o banco de dados") para o SQL nunca chegar ao navegador. Se a sessão não pôde ser lida
por isso, `createContext` marca `ctx.bancoIndisponivel`, `auth.me` lança em vez de
devolver `null` e o `ProtectedRoute` mostra "tentar de novo" em vez de mandar ao login.
Exceções deliberadas: `system.health` (responde `ok:false` com HTTP 503) e
`stats.platform` (zeros na página inicial) degradam em vez de lançar. Não crie novo
`catch` que devolva vazio: se precisar de um, relance quando `ehErroDeBancoIndisponivel`.

**Três motores de match convivem.** `server/match-service.ts` cruza contatos da mesma
dona: `scoreMatch` aplica, nesta ordem, concorrentes → 0, slug exato → 100, mesmo
objeto do termo → 100, mesmo núcleo → 100, mesma categoria → 60; o critério semântico
vale 45, abaixo do limiar 50, logo está desligado por construção e o texto não sai
para embeddings. `server/matching.ts` cruza perfis de usuárias em 6 dimensões
ponderadas, com LLM só no insight. `routers/profileMatches.ts` expõe esses matches no
Dashboard com trava de consentimento dos dois lados.

**`server/_core/` é a infraestrutura herdada do Manus** (o projeto nasceu na
plataforma Manus e foi extraído: ver `docs/recuperacao-do-manus.md`): entrada, auth
por cookie HttpOnly (`sdk.ts`), e-mail (Resend), storage S3 com URLs assinadas, Vite
em dev. As chamadas de IA passam por `server/_core/llm.ts`, que aceita qualquer
endpoint compatível com a API da OpenAI via `fetch` (não há SDK de IA no projeto), configurado
por `LLM_API_URL`, `LLM_API_KEY` e `LLM_MODEL`; retenta 4 vezes com backoff. Use sempre
um modelo CONCRETO (ex.: `gemini-3.5-flash`), nunca um alias como
`gemini-flash-latest`: o alias já apontou para um modelo com cota gratuita de 20
requisições/dia e derrubou a IA em produção. `server/gemini.ts` (transcrição e
embeddings) distingue cota esgotada (`GeminiCotaEsgotadaError`) de sobrecarga e cai
para um modelo reserva. Arquivos (áudio de reunião, documentos, mídia de contexto)
vão para storage compatível com S3 (`STORAGE_*`; Backblaze B2 em produção), servidos
pelo proxy autenticado `/manus-storage/*`, que exige sessão e posse; esse prefixo
está gravado nas URLs do banco, não renomeie sem migração de dados.

**Client.** Não há AuthContext: `useAuth` é `trpc.auth.me` no cache do React Query.
`ProtectedRoute` aplica `requireAdmin`, `requireGold` e `requireOpportunities`; páginas
em `client/src/pages/` roteadas com wouter em `App.tsx`; shadcn/ui em
`components/ui/`; Tailwind 4 configurado no próprio CSS (`client/src/index.css`, não
há `tailwind.config`); o tema escuro está desligado. i18n: 10 JSONs em
`client/src/i18n/locales/` com o mesmo conjunto de chaves (`conferir-locales.mjs`
garante); só 13 de 37 telas usam `useTranslation`, as mais novas têm pt-BR fixo.
Código morto conhecido (não construa sobre ele): `ComponentShowcase`, `AuthModal`,
`Map`, `ManusDialog`, `AIChatBox`, `server/index.ts`.

**`shared/`** tem constantes e tipos usados por client e servidor, inclusive
`direcao-do-termo.ts` (direção oferta/demanda de um termo) e `types.ts`, que
reexporta os tipos do schema.

**`docs/arquitetura/` é a referência de projeto, não o retrato do código.** Ela
descreve para onde o sistema vai, assume Postgres com RLS, e nem tudo desenhado
existe; o código atual roda MySQL (decisão D6 em
`docs/arquitetura/decisoes-em-aberto.md`: esse arquivo lista o que trava
implementação e precisa de decisão de produto). As `docs/spec-*.md` são as specs
por etapa vindas do Manus.

**`vitrine/`** é uma página estática publicada no GitHub Pages pelo workflow
`.github/workflows/pages.yml`. Não é a aplicação.

## Banco e migrações

Schema e migrações em `drizzle/` (`schema.ts` + SQL versionado, com baseline
`0000_fundacao`). Todas as 50 tabelas, incluindo as `sivc_*`, estão no schema.

- **Mudança de schema SÓ via `pnpm db:generate` + `pnpm db:migrate`.** Editar o
  `schema.ts` sem gerar a migração já quebrou produção uma vez (coluna existia
  no código e não no banco). Nunca edite SQL de migração à mão. O CI cria um banco
  do zero e falha se `db:generate` produzir arquivo.
- `scripts/migrar.mjs` usa a tabela própria `_migracoes` (não a do drizzle-kit) e lê
  `drizzle/meta/_journal.json`. Três caminhos: banco vazio aplica tudo; banco antigo
  em dia adota o baseline; banco antigo desviado é recusado com a lista dos desvios,
  e `node scripts/nivelar-banco.mjs --aplicar` cria o que falta, sem nunca apagar.
- **Em produção as migrações rodam no boot**: `server/_core/index.ts` executa
  `scripts/migrar.mjs` como processo filho antes de aceitar tráfego; falha aborta a
  subida e o Render mantém a versão anterior no ar.
- Nunca rode script contra o banco de produção (Aiven) sem autorização explícita do
  Roberto.

## Produção

Merge na `main` = deploy automático no Render (runtime Docker pelo `Dockerfile`; não
há `render.yaml`, as variáveis vivem no painel; o plano gratuito hiberna e a primeira
visita leva 30-60 s). Banco MySQL no Aiven; arquivos no Backblaze B2 via `STORAGE_*`;
vitrine no GitHub Pages. Depois de todo deploy: `node scripts/checar-producao.mjs`.
Passo a passo e tabela de variáveis em `docs/deploy.md`.

## Regras que não são estilo

- **`sql.raw` é proibido.** Havia 21 pontos de SQL por concatenação (um deles
  permitia execução arbitrária no banco); todos foram eliminados. Um `sql.raw` num
  diff é sinal de alerta. Toda query nova é parametrizada ou via ORM.
- **Nunca commitar** `.env`, chave de API, senha de banco, dump do banco (contém
  e-mails e senhas de usuárias reais; vive só no repositório privado de backup) ou
  dado pessoal de usuária ou contato.
- **Privacidade é regra de consulta, não de tela.** O nível público nunca seleciona
  colunas pessoais: `listVitrineColetiva` em `server/db.ts` lê só id, país e cidade e
  devolve id opaco; `listAcervoOuro` exige nível 'ouro' no contato, consentimento da
  dona ao termo, `goldProcedure` e registro de auditoria. Esconder no front-end não
  basta (ver `docs/arquitetura/privacidade.md`).
- **Match nunca cruza por palavra solta.** Hoje as tags de possui/procura são
  texto livre, mas o cruzamento exige tag exata, mesmo objeto em direções
  opostas (`shared/direcao-do-termo.ts`: exportar × importar) ou mesma
  categoria: a spec da cliente veta match por palavra parecida
  ("exportar vinho" × "importar vinho" casam; "exportar" × "exportar" nunca).
- **Nada extraído por IA entra sozinho**: toda extração carrega origem e confiança
  e exige confirmação da usuária antes de virar dado. No enriquecimento, só
  sugestões com `confidence >= 0.7` viram pendência (`routers/enrichment.ts`);
  entidades e sugestões de reunião nascem `pending`; o SIVC pondera a fonte em
  `CONFIDENCE_WEIGHTS`.
