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
node scripts/checar-producao.mjs --env .env.producao   # exame de saúde da produção (pós-deploy); --com-ia inclui as checagens de IA
node scripts/gerar-cidades.mjs --ibge  # regera client/src/data/cidades/BR.json do arquivo do IBGE
node scripts/gerar-cidades.mjs --entrada <pasta com o dump do GeoNames descompactado>  # demais países
node scripts/semear-rede-de-teste.mjs   # contatos fictícios na rede de uma usuária; --limpar desfaz
node scripts/definir-senha-local.mjs    # senha de conta em banco LOCAL (sem Resend em dev)
node .claude/hooks/carimbo.mjs --status # estado da conferência (ver "Fluxo de trabalho")
```

- **No Windows, use Git Bash**: `dev` e `start` definem `NODE_ENV` com sintaxe
  POSIX e falham no PowerShell. Se `pnpm` não estiver no PATH, `corepack pnpm`.
- **Os scripts `.mjs` de banco NÃO leem o `.env`** (revisão do Nicolas na #97:
  preencher o arquivo não basta). São `criar-banco.mjs`, `migrar.mjs`
  (`pnpm db:migrate`, `--simular`) e `nivelar-banco.mjs`: leem
  `process.env.DATABASE_URL` e param se ela não estiver no ambiente, cada um com a
  sua mensagem — `criar-banco.mjs` imprime "DATABASE_URL não definida." seguida de
  um exemplo de linha de comando; `migrar.mjs` e `nivelar-banco.mjs` imprimem
  "Defina DATABASE_URL." (o `migrar.mjs` com o exemplo na linha seguinte). Passe na
  linha de comando — `DATABASE_URL='mysql://...' node scripts/criar-banco.mjs` — ou
  exporte o arquivo inteiro antes, no Git Bash: `set -a; . ./.env; set +a` (ali o
  `.env` vira script do shell, então valor com espaço, `{` ou `#` precisa estar
  entre aspas no arquivo). **`pnpm db:generate` é a exceção**: o
  `drizzle.config.ts` também só lê `process.env.DATABASE_URL`, mas a CLI do
  drizzle-kit carrega o `.env` do diretório atual (ela embute o `dotenv/config`)
  antes de abrir a configuração, então para ele o arquivo basta; sem a variável em
  lugar nenhum a mensagem é "DATABASE_URL is required to run drizzle commands", que
  vem da configuração, não do script. Quem mais carrega o `.env` sozinho: o
  servidor (`dotenv` em `server/_core/index.ts`, logo `pnpm dev` e `pnpm start`), a
  suíte (`import "dotenv/config"` em `vitest.config.ts`) e o `checar-producao.mjs`,
  que recebe o arquivo em `--env`.
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

**Depois do merge**: espere o deploy do Render e rode
`node scripts/checar-producao.mjs --env .env.producao`. Só então mova a tarefa no Notion
para "Feito (a validar)", com a comprovação (link da PR, saída do exame). Quem fez não
conclui: outra pessoa do time valida no link de teste e só ela marca "Concluído".

## Testes

O CI (`.github/workflows/testes.yml`, toda PR e push na `main`) roda, nesta ordem:
`conferir-locales.mjs` (10 idiomas com as mesmas chaves) → `pnpm db:generate` (falha
se criar arquivo em `drizzle/`) → banco do zero em MariaDB 11.4 com `criar-banco.mjs`
→ `nivelar-banco.mjs` exigindo "Nada a nivelar" → `pnpm check` → `node --check` nos
scripts (`scripts/*.mjs`, `scripts/exame/*.mjs`, `.claude/hooks/*.mjs`) → `pnpm test` →
`pnpm build`. Rode o mesmo antes da PR.

**Servidor.** Lógica nova em `server/` ganha ou atualiza um `*.test.ts` ao lado
(fora os dois `*.integracao.test.ts`). Padrão: `vi.mock` das dependências; credencial ausente se auto-pula com
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

**Entrada e boot.** A entrada real é `server/_core/index.ts`. Ordem: migrações no
boot (só em produção, ver "Banco"), helmet,
compression, cabeçalhos de segurança, bloqueio de scanners, rate limit global, body
parsers (5 MB por padrão e 15 MB em SEIS procedimentos de upload —
`meetings.submitRecording`, `contexts.uploadMedia`, `network.uploadPhoto`,
`network.uploadCard`, `dealRoom.uploadDocument` e `sivc.uploadDocument`. A lista
cresceu por partes: `submitRecording` veio do resgate do Manus (25/08),
`contexts.uploadMedia` entrou na etapa 5 (01/09), as duas da rede na #58 (03/09) e
as do Deal Room e do SIVC na #59 (04/09) — só entre 01/09 e 03/09 foram dois.
Antes deles vem `corpoGrandeParaUploads` (#79, 06/09), que reconhece esses mesmos
procedimentos quando chegam dentro de um LOTE do tRPC — `/api/trpc/a,b` não casa com
nenhum recorte por caminho),
proxy de storage, tRPC em `/api/trpc`, e por fim Vite em middleware (dev) ou
estático de `dist/public` (prod). Não há proxy de dev: front e API na mesma origem.

**Fluxo de tipos ponta a ponta (tRPC).** Cada área de negócio tem um router em
`server/routers/`, agregados em `server/routers.ts` (atenção aos apelidos: `matches`
no appRouter é o `profileMatchesRouter`; `routers/matches.ts` entra como
`intelligentMatches`). O client consome tudo tipado via `client/src/lib/trpc.ts` +
React Query. As procedures base ficam em `server/routers/_procedures.ts`:
`adminProcedure`, `presidentProcedure` e `goldProcedure`, e **as três aceitam o mesmo
conjunto {admin, president, gold}**. `server/_core/trpc.ts` exporta só `router`,
`publicProcedure` e `protectedProcedure` (o `adminProcedure` estrito saiu na limpeza
do Manus, commit 5bce2aa). É a regra "Ouro = Presidente = administradora", pedida pela
cliente e confirmada pelo Roberto em 02/09/2026: toda conta Ouro tem o painel
administrativo. Consequência: contas Ouro criadas só para teste (inclusive a do
Roberto) precisam voltar a Prata antes da entrega.

**Distribuidor do Smart Match é um PODER, não um nível.** `users.isDistributor`
(migração 0010) marca a pessoa real que confere cada pedido de interesse antes de
encaminhá-lo à outra pessoa. `distribuidorProcedure` (em `_procedures.ts`) exige
`ctx.user.isDistributor === true` e não olha `role`: Ouro sem a flag leva 403, Prata
com a flag passa. Quem concede e revoga é `distribuicao.conceder/revogar`
(`presidentProcedure`; auditoria `DISTRIBUTOR_GRANTED`/`DISTRIBUTOR_REVOKED` de risco
alto e aviso `system` no sino), na aba Distribuição do Painel Ouro. O painel e o item
de menu abrem também para quem tem a flag, mas só essa aba.

**O pedido de interesse passa pelo distribuidor.** `connections.status` (migração 0011):
`in_review` (nasceu; espera o distribuidor) → `pending` (encaminhado; espera a
destinatária) → `accepted` | `declined`; ou `in_review` → `not_forwarded` (não
encaminhado). `reciprocatedAt` marca que a destinatária também clicou durante a análise
(uma linha por par; a aprovação já vira `accepted` e revela os dois nomes). A
destinatária NÃO vê `in_review` nem `not_forwarded` — o predicado `pedidoVisivelPara`
em `db.ts` tira a linha do join em `getMatchesForUser` e do WHERE em
`getConnectionsForUser` (regra de consulta, não de tela). A decisão
(`distribuicao.decidir`) é um UPDATE com `status = 'in_review'` no WHERE: 0 linhas =
CONFLICT, sem efeito; `respondToConnection` e o interesse mútuo em
`sendConnectionRequest` também levam o status no WHERE. Sem distribuidor ativo o
pedido FICA esperando e a presidência recebe o aviso: mesclar a fila só depois de
conceder o poder em produção. Detalhes em docs/arquitetura/fluxos.md e privacidade.md.

**Cadastro não concluído não usa a plataforma.** `profile.completeOnboarding` exige o
Termo Geral de Uso aceito (`server/termo-geral-de-uso.ts`) e é quem marca
`users.onboardingCompleted`; o `protectedProcedure` (e, por herança, admin, Ouro e
distribuidor) passa por `exigirCadastroConcluido` (`server/cadastro-concluido.ts`), que
responde PRECONDITION_FAILED a quem tem `onboardingCompleted = false` fora de `auth`,
`consent`, `conta`, `assistenteTexto`, `system`, `profile.get` e
`profile.completeOnboarding`. Procedimento novo que a tela de Onboarding chame entra
nessa lista; procedimento público novo entra em `PUBLICOS` de
`server/cadastro-concluido.test.ts`, que varre o appRouter inteiro. No client, o
`ProtectedRoute` manda para /onboarding (só a rota do cadastro liga
`permitirCadastroIncompleto`). O Termo Geral não se revoga à parte (`consent.revoke`
recusa): quem não o aceita mais exclui a conta. Contas que concluíram o cadastro antes
do termo existir não são obrigadas a aceitá-lo: isso depende de decisão de produto.

**Mas Ouro NÃO é staff em tudo.** São QUATRO os pontos em que admin e president valem
mais que Ouro — a frase "a única assimetria é `isStaff`" era falsa e virou revisão do
Nicolas (#97); antes de repetir qualquer contagem aqui, rode
`grep -rn "role ===\|role !==\|users.role" server --include=*.ts` e confira:

1. **Abrir oportunidade que não é sua**: `isStaff` em `oportunidade-acesso.ts` — uma
   conta Ouro APROVA uma oportunidade pendente e leva 403 ao tentar ABRI-LA.
2. **Rastreabilidade das conexões**: `plataformaProcedure` em
   `routers/networkInteligente.ts` (a lista de conexões registradas de todas as donas e
   a apuração de comissão, com auditoria `NETWORK_CONNECTIONS_READ`; a aba some do
   Painel Ouro para Ouro sem cargo).
3. **Bloqueio automático por eventos críticos**: `checkAutoLockThreshold` em
   `server/security.ts` isenta president e admin — conta Ouro é desativada como
   qualquer outra ao cruzar o limite.
4. **Quem é avisada**: os destinatários de "oportunidade aguardando análise"
   (`routers/opportunities.ts`) e de "não há distribuidor" (`idsDaPresidenciaAtiva`
   em `db.ts`) são president e admin; Ouro não recebe nenhum dos dois, embora possa
   agir sobre o primeiro.

Some-se outra armadilha:
`grantGoldAccess` grava `role = "gold"` por cima do que havia, e `revokeGoldAccess`
grava o nível que o perfil sustenta (`"silver"` se `avaliarQualificacaoDoPerfil` o
qualifica, `"bronze"` se não) sem olhar o papel anterior — conceder Ouro a uma
presidente a REBAIXA, e revogar a joga em Prata ou Bronze. Checagens "Ouro ou acima" ainda
estão repetidas inline em `routers/dealRoom.ts`, `routers/matching.ts`,
`routers/opportunities.ts`, `_core/storageProxy.ts` e no client (`ProtectedRoute`,
`AppHeader`, `Connections`).

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
objeto do termo → 100, mesmo núcleo → 100, o mesmo serviço escrito de outro jeito → 100
(só para serviço: a mesma especialidade na mesma família, entre consultoria e assessoria, no
apoio que nomeia a profissão, na assessoria sobre área da profissão — "Assessoria tributária"
diante da advocacia ou da contabilidade tributária — ou os dois lados só com a família,
"Contabilidade" × "Contador" e "Serviços contábeis" × "Contador", também com a oferta
dirigida só a um destinatário comum, "Contabilidade para pequenas empresas" × "Contador",
`mesmaFamiliaEEspecialidade`),
necessidade que nomeia só a família do serviço → 60 (`necessidadeGenericaNomeiaOServico`, que inclui a
oferta GENÉRICA diante da necessidade da mesma família com só público ou finalidade — "Contabilidade" ×
"Contador para pequenas empresas", "Logística" × "logística para exportar meu café": dava 0 e virou 60 na
revisão do Nicolas de 15/09; dar 100 quando o público está em `DESTINATARIOS_COMUNS` é decisão em aberto),
necessidade que declara o ASSUNTO do serviço sem nomeá-lo → 60 com tipo `semantic`
(`necessidadeDeclaraOAssuntoDoServico`: vocabulário curado de tributário, internacionalização e
regulatório sanitário, e a necessidade tem de pedir ajuda ou uma ação, sem pedir no resto a
contraparte, o capital ou o registro de marca: "Entrada de investidor internacional" não casa),
mesma categoria → 60 (para serviço, só no par que a regra não lê num idioma novo,
`regraNaoLeOPar`); o critério semântico
vale 45, abaixo do limiar 50, logo está desligado por construção e o texto não sai
para embeddings. `server/matching.ts` cruza perfis de usuárias em 6 dimensões
ponderadas, com LLM só no insight. `routers/profileMatches.ts` expõe esses matches no
Dashboard com trava de consentimento dos dois lados. **Regra da demanda expressa
(12/09/2026), nos três motores e nos prompts:** item de "o que tenho" classificado como
SERVIÇO (`shared/tipo-da-oferta.ts`) só casa com necessidade DECLARADA em "o que
preciso" — no motor privado a categoria em comum não vale para serviço (salvo a exceção dos
idiomas novos, abaixo); no de perfis o
par sustentado só por serviço sem demanda expressa dá zero, não é gravado e a leitura da
lista esconde a linha antiga (sem apagá-la, para a dispensa da dona sobreviver), e com
"o que tenho" vazio a especialidade e a área de atuação são a oferta; nos dois
prompts de `routers/matching.ts` o modelo classifica o item,
cita o trecho da oportunidade que declara a necessidade e
`server/portao-da-demanda-expressa.ts` confere a citação, e que ela pede um serviço que o
perfil oferece, antes de exibir (citação de contraparte — distribuidor, investidor —, de
autodescrição da empresa ou de assunto que nenhum serviço do perfil presta é barrada);
oportunidade que OFERECE serviço só vai a quem declarou
algo que possa ser aquele serviço. Em "O que você busca?" (12 opções, `shared/o-que-busca.ts`)
nenhuma opção libera serviço sozinha — "Serviço Especializado" é genérica — e o texto de
"Outra necessidade" (`seekingOtherNeed`) vale como "o que preciso". A categoria digitada ainda decide o tipo quando o texto
não decide (decisão do time em 14/09). **Logística, transporte, frete e armazenagem são
serviço** (decisão do Nicolas, 14/09), inclusive a opção fixa "Logística"; galpão, armazém
e frota continuam imóvel e ativo. Família de serviço é lema, não área,
e a equivalência é ESTRITA: só casa o que as listas entendem (palavra desconhecida precisa
aparecer igual dos dois lados; na IA, o que o texto não entende fica com o modelo). Exceção
da revisão de 14/09 da #127 (portada em 15/09): em fr, de, ru, hi, ar, zh e ja, onde as listas
são curtas, o par que só não casa por palavra que elas não leem NÃO é bloqueado nos motores
determinísticos — vale a categoria em comum, nunca 0 por falta de regra (`regraNaoLeOPar`);
onde há regra no idioma (lema curado, marcador de pedido, chinês e japonês lidos pelo fim do
termo) o motor decide como em português, o pedido precisa pedir o serviço e o que ele entende
continua barrado. pt, en e es seguem estritos, também dentro de rótulo bilíngue. Entrada
nova no vocabulário de assunto entra com o teste negativo dela
(`server/demanda-expressa-exemplos-da-spec.test.ts`). Produtos,
ativos, investimento, conexões, tecnologia e imóveis não mudam.

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

**Reunião que falha na IA se reprocessa pelo áudio guardado.** `processMeetingRecording`
guarda o áudio no bucket antes da IA; `meetings.reprocess` (`iniciarReprocessamento` em
`server/meeting-service.ts`) lê esses bytes de volta (`storageGetBytes`) e roda de novo
transcrição e extração, sem gravar áudio nem renovar os 30 dias. Cada execução tem uma
FICHA: o `updated_at` que ela grava ao tomar a reunião para `processing` (UPDATE
condicional a partir de `recording` no envio e de `failed` no reprocesso). Releitura,
`ready` e `failed` exigem `status = 'processing' AND updated_at = ficha`: quem tomou a
reunião por último (reprocesso novo, ou a varredura de interrompidas, que grava
`updated_at` novo) vence, e a execução velha sai sem escrever. O reprocesso responde na
hora e segue em segundo plano (a tela consulta a cada 5 s); o trabalho nunca rejeita,
porque rejeição solta derruba o processo. Os derivados da tentativa anterior só saem
depois de a IA dar certo, e decidir sobre sugestão ou entidade com a reunião em
`processing` dá CONFLICT. Teto brando de 3 reprocessos aceitos por dona a cada 10 min.

**Client.** Não há AuthContext: `useAuth` é `trpc.auth.me` no cache do React Query.
`ProtectedRoute` aplica `requireAdmin`, `requireGold` e `requireOpportunities`; páginas
em `client/src/pages/` roteadas com wouter em `App.tsx`; shadcn/ui em
`components/ui/`; Tailwind 4 configurado no próprio CSS (`client/src/index.css`, não
há `tailwind.config`); o tema escuro está desligado. i18n: 10 JSONs em
`client/src/i18n/locales/` com o mesmo conjunto de chaves (`conferir-locales.mjs`
garante); `AdminPanel`, `PresidentPanel` e `LegalPage` continuam em pt-BR fixo, e a
maioria dos componentes compartilhados não traduz.

**Cidade é busca sobre lista gerada, não texto solto.** `CampoDeCidade` (usado por
`Onboarding` e `Profile`) sugere cidade de QUALQUER país que tenha lista em
`client/src/data/cidades/<CC>.json` — hoje 230 países e 70.221 cidades —, casando o que
foi digitado contra uma chave que já
traz os apelidos nos 10 idiomas, sem acento e em minúsculas. Escolher da lista grava o
NOME CANÔNICO; digitar livre continua valendo, e país sem lista cai em texto livre. As
listas saem de `scripts/gerar-cidades.mjs` — nada de cidade escrita à mão, e nome que
não caiba no `varchar(100)` de `user_profiles.city` é descartado com aviso. O Brasil
vem do IBGE (5.571 municípios) e o resto do mundo do GeoNames: a rodada mundial do
gerador PULA o BR de propósito, senão trocaria a lista do IBGE pelos 4.422 registros
brasileiros do dump. A
normalização existe DUAS vezes (`shared/normalizar-cidade.ts` para o navegador,
`scripts/cidades/montagem.mjs` para o gerador, que é .mjs e não importa .ts): se elas
divergirem a busca para de achar em silêncio, e `server/cidades-montagem.test.ts` é o
que segura isso — mudou uma, muda a outra. A pontuação entra na chave nas DUAS formas
("xique xique|xiquexique"), porque a normalização só troca hífen e apóstrofo por
espaço e quem digita emendado não achava nada. O cabeçalho do arquivo gerado guarda a
ORIGEM do dado (`fonte`, `fonteUrl`) e nenhuma data, para regerar dar o mesmo arquivo —
`server/cidades-geradas.test.ts` remonta o `BR.json`, exige que bata e recalcula a
chave das 70.221 cidades dos 230 arquivos. Dados do
GeoNames são CC BY 4.0 e exigem crédito em tela: `CampoDeCidade` mostra a `fonte` do
país como link embaixo do campo. Ver `docs/arquitetura/cidades.md`, inclusive a decisão
em aberto sobre o nome canônico do GeoNames vir em inglês ("Lisbon", "Munich").

Código morto conhecido (não construa sobre ele): `ComponentShowcase` e `AIChatBox`
(importado só por ele).

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
`0000_fundacao`). Todas as tabelas, incluindo as `sivc_*`, estão no schema.

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
vitrine no GitHub Pages. Depois de todo deploy:
`node scripts/checar-producao.mjs --env .env.producao` (o exame só precisa de
`DATABASE_URL`; nunca do `JWT_SECRET`). Passo a passo e tabela de variáveis em
`docs/deploy.md`.

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
  basta (ver `docs/arquitetura/privacidade.md`). **Ressalva no consentimento** (revisão
  do Nicolas, #89): ele só trava quando existe versão VIGENTE do termo publicada. Sem
  linha `isCurrent` em `document_versions`, `hasValidConsent` e
  `usersComConsentimento` (`server/routers/consent.ts`) respondem "sim" para todas —
  é a única porta que libera sem consentimento, e vale para todo termo, não só o do
  acervo. Cai só essa trava: nível 'ouro' no contato, `goldProcedure` e auditoria
  seguem valendo. Publicar o termo (`scripts/publicar-documento.mjs`) é o que liga a
  exigência.
- **Match nunca cruza por palavra solta — e isso hoje só vale no motor privado.**
  A regra da spec é essa: tag exata, mesmo objeto ou mesmo núcleo em direções
  OPOSTAS (`shared/direcao-do-termo.ts`), ou mesma categoria; duas pontas que
  querem a mesma coisa são concorrentes ("exportar vinho" × "importar vinho"
  casam; "exportar" × "exportar" não). Quem a aplica é `scoreMatch`
  (`server/match-service.ts`), que chama `saoConcorrentes` ANTES de qualquer outro
  critério e zera o par. **O motor de perfis (`server/matching.ts`) não aplica**
  (revisão do Nicolas, #97): `satisfaz` devolve `true` já no `have === need` e no
  slug igual, sem passar por `saoConcorrentes`, então "exportar" × "exportar"
  conta como necessidade atendida e ainda SOBE a complementaridade. E a
  complementaridade é a dimensão de MAIOR peso da nota: seis dimensões somam 100
  (complementaridade 30, setor 20, investimento 20, especialidade 15, valores 10,
  localização 5), com corte em 40 — lá um par vira match sem nenhum termo cruzado.
  Uniformizar os dois é decisão de produto, não ajuste local — a nota do motor de
  perfis mudaria para todas.
- **Serviço só casa com necessidade declarada.** Setor, porte, localização, cargo,
  atividade econômica, problemas típicos do segmento, obrigações legais ou "poderia se
  beneficiar" não são necessidade (pedido do Nicolas, 12/09/2026: "não fazemos match
  porque alguém poderia precisar; fazemos match porque alguém declarou que precisa").
  A IA não pode inferir o que ninguém declarou; essas informações só sobem a nota de um
  match que já passou pelo portão. A restrição é específica do tipo SERVIÇO — os outros
  tipos seguem as regras de sempre. Palavra igual não é serviço igual ("Consultoria
  jurídica" não atende "Consultoria em marketing"), e a mesma coisa escrita de outro
  jeito é a mesma necessidade ("Advogado tributarista" × "Advocacia tributária"). Os
  limites aceitos da regra estão em `docs/arquitetura/README.md` §2c. Ver
  `shared/tipo-da-oferta.ts` e `server/portao-da-demanda-expressa.ts`.
- **Nada extraído por IA entra sozinho**: toda extração carrega origem e confiança
  e exige confirmação da usuária antes de virar dado. No enriquecimento, só
  sugestões com `confidence >= 0.7` viram pendência (`routers/enrichment.ts`);
  entidades e sugestões de reunião nascem `pending`; o SIVC pondera a fonte em
  `CONFIDENCE_WEIGHTS`.
