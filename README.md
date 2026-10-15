# WRW — Women Rocking the World

> A marca passou a WRW em 15/09/2026. O nome técnico MMM (Mulheres que Movem o Mundo, nome anterior da marca) continua em alguns nomes de infraestrutura.

Uma empresária entra na plataforma e cadastra a base de contatos que ela já tem na
agenda. Para cada contato, anota duas coisas: **o que aquela pessoa tem** para
oferecer e **o que aquela pessoa procura**. A IA cruza esses dois lados — dentro da
rede dela e, com autorização, entre as redes de outras membras — e avisa quando
existe negócio possível. Quando as duas partes querem seguir, abre-se uma sala
privada de negociação, e o movimento fica com uma comissão sobre o que fechar.

É um CRM de networking, não uma rede social: **ninguém navega nos contatos de
ninguém**. O cruzamento é feito pelo sistema e só o resultado aparece.

## Situação

| | |
|---|---|
| **No ar** | https://wrwglobal.org, no Render (o serviço técnico ainda se chama `mmm-gud5`), com banco MySQL no Aiven e arquivos no Backblaze B2 |
| **Entregue** | 16/09/2026 (PR #135): etapas 1 a 11 |
| **Em andamento e próximo** | no quadro de trabalho do Notion, aba Agora |
| **Precisa de decisão** | aba Decisões do Notion e [docs/arquitetura/decisoes-em-aberto.md](./docs/arquitetura/decisoes-em-aberto.md) |
| **Fora do site, por decisão** | pagamento pelo site (ajuste A14) e aplicativo móvel (repositório à parte; o lugar dele ainda vai ser decidido) |

O escopo detalhado, quem está com cada item, status e prazos ficam no **Notion**,
não aqui. Este repositório é para código e desenho técnico.

## Quem é quem

- **Roberto** (`Movits`) lidera o projeto e fala com a cliente.
- **Nicolas** (`nicolasriber19`), **Gabriel** (`DevGabriel03`) e **Lucas Yan**
  (`pacocateamo123-max`) desenvolvem. Cada um instrui o próprio Claude, e é por isso
  que o [CLAUDE.md](./CLAUDE.md) existe: ele é lido por todas essas máquinas.
- **Gabryel** (`gabryelns`) colaborou até a entrega e está fora do time por enquanto.
  As PRs e revisões dele seguem no histórico.
- **Dra. Glenda** é a cliente e dona do produto. As decisões dela nascem no grupo de
  WhatsApp do time e nem sempre chegam ao Notion — quando pedido, Notion e grupo se
  contradizem, pare e pergunte.
- **Dr. Ronei** cuida do jurídico contratual e a **Cris** dos textos legais. Nenhum
  dos dois está no repositório.

Todo o texto do repositório — documentação, commits, PRs, comentários — é em
**português**. Siga o padrão.

## Como o produto funciona, na prática

1. **Entrar e montar o perfil.** A usuária diz quem é, o que a empresa dela faz, o
   que oferece e o que procura, e aceita os termos. O aceite não é um `checkbox` na
   tela: vira linha em `consents`, com IP, navegador e o hash do texto que estava no
   ar naquele instante.
2. **Cadastrar a rede particular.** Ela cadastra os contatos dela e, para cada um,
   as tags de **possui** e **procura**. Pode registrar também *onde conheceu* cada
   pessoa (o "contexto": um evento, uma indicação, uma viagem) e conversar com um
   assistente que enriquece o cadastro — telefone, empresa, cargo — a partir do que
   ela conta. Nada que a IA extrai entra sozinho: tudo nasce como sugestão e espera
   confirmação.
3. **Gravar uma reunião.** O áudio sobe, é transcrito, e o sistema extrai pessoas,
   empresas e assuntos, sugerindo contatos novos a partir do que foi dito.
4. **Receber matches.** Três motores convivem: contato × contato dentro da rede da
   mesma dona, perfil × perfil entre usuárias (só quando **as duas** autorizaram o
   cruzamento) e recomendação de oportunidades. A regra da direção — "exportar
   vinho" casa com "importar vinho", e duas pontas que querem exportar são
   concorrentes — é do **motor de contatos** (`server/match-service.ts`), que zera
   o par antes de qualquer outro critério. O **motor de perfis**
   (`server/matching.ts`) ainda não a aplica: ali "exportar" × "exportar" conta
   como necessidade atendida, e a nota é uma soma de seis dimensões —
   complementaridade 30, setor 20, investimento 20, especialidade 15, valores 10 e
   localização 5 — em que a complementaridade, a de maior peso, é justamente a que
   sobe com esse par; com corte em 40, a nota passa sem nenhum termo cruzado. A
   diferença é conhecida, não é descuido de leitura: está descrita em "Regras que
   não são estilo", no [CLAUDE.md](./CLAUDE.md).
5. **Publicar uma oportunidade.** Uma membra Ouro ou a presidência valida antes de
   ir ao ar, e uma análise automática sugere que documentação aquele negócio pede.
6. **Negociar.** Quem se interessa abre uma **Sala de Negociação**, que só destrava
   depois das duas partes aceitarem o acordo de confidencialidade. O registro do
   negócio fechado — valor, honorários da intermediação e aviso de comissão — **ainda não
   está no ar**: é o ajuste A11, em rascunho na PR #94, e depende de decisões
   comerciais da cliente que seguem em aberto.

## Os três níveis, que são regra de banco e não de tela

**Bronze** é quem entrou. **Prata** completou o perfil. **Ouro** é o grupo restrito
— presidente e administradoras — e vem com o painel de governança: validar
oportunidade, conceder Ouro a outra, nomear líder regional.

A privacidade é aplicada **na consulta**, nunca escondendo coisas no front-end:

- o nível público lê só id, país e cidade, e devolve identificador opaco;
- o acervo Ouro exige, ao mesmo tempo, contato marcado como compartilhável, termo
  vigente aceito pela dona, papel Ouro no procedimento e registro de auditoria —
  com uma ressalva que vale conhecer antes de confiar na lista: **enquanto não há
  versão vigente do termo publicada**, o consentimento não trava nada
  (`hasValidConsent` responde "sim" para todas), e é a única porta do sistema que
  libera sem consentimento. As outras três exigências continuam de pé; publicar o
  termo é o que liga a primeira.

Esconder no React não conta. Se a consulta seleciona a coluna, o dado vazou.

## Comece aqui

1. Leia a seção 1 do [guia de entrada](./docs/guia-de-entrada.md): como uma tarefa
   anda, do cartão ao "Concluído".
2. Prepare a máquina pelo guia: Git Bash (no Windows, com o `script-shell` do pnpm
   apontando para ele), Node 20, pnpm, MariaDB 11.4 local e Claude Code.
3. `pnpm install`, `cp .env.example .env` (só valores locais) e, com o banco local do
   guia, `DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/criar-banco.mjs`.
   Os scripts `.mjs` de banco não leem o `.env` (exceto o `checar-producao` e o
   `importar-participantes`, que recebem o arquivo em `--env`), por isso a variável vai
   na linha de comando.
4. Siga as seções 4 a 6 do guia (banco, `.env` e o Termo Geral publicado no banco
   local; sem ele o cadastro trava) e então `pnpm dev` (http://localhost:3000).
5. As palavras do projeto (Ouro, distribuidor, demanda expressa, carimbo…) estão no
   [glossário](./docs/README.md#glossário).

## A stack, e onde cada coisa mora

Aplicação full-stack TypeScript num **único pacote**: front e API na mesma origem,
sem proxy de desenvolvimento.

| Camada | Tecnologia |
|---|---|
| Front | React 19, Vite 7, Tailwind 4 (configurado no próprio CSS), shadcn/ui, wouter |
| API | tRPC 11 sobre Express 4, tipos ponta a ponta sem escrever cliente HTTP |
| Banco | MySQL via Drizzle ORM (57 tabelas, migrações versionadas) |
| IA | qualquer endpoint compatível com a API da OpenAI (Gemini em produção) |
| Arquivos | storage compatível com S3 (Backblaze B2), servido por proxy autenticado |
| Idiomas | 10, com o mesmo conjunto de chaves em todos |

```
client/src/
  pages/         as telas, roteadas em App.tsx
  components/    componentes; ui/ é shadcn
  i18n/locales/  os 10 JSONs de tradução
server/
  _core/         infraestrutura herdada do Manus: entrada, auth por cookie, LLM, storage, e-mail
  routers/       um arquivo por área de negócio, agregados em routers.ts
  db.ts          a camada única de acesso a dados
  security.ts    sessões, auditoria e cofre
drizzle/         schema.ts + as migrações SQL versionadas
shared/          o que client e servidor usam juntos
scripts/         ferramentas de linha de comando (ver scripts/README.md)
docs/            guia de entrada, desenho, termos e histórico (índice em docs/README.md)
vitrine/         página estática publicada no GitHub Pages — NÃO é a aplicação
```

A entrada real do servidor é `server/_core/index.ts`. Em produção ele roda as
migrações pendentes **antes** de aceitar tráfego: se a migração falhar, a subida
aborta e o Render mantém a versão anterior no ar.

## Como trabalhamos

Já houve push na `main` com a tarefa marcada "concluída" no Notion e o código não
resolvendo o que dizia. Por isso:

1. A `main` é protegida e todo merge nela **vira deploy em produção**. Trabalhe em
   branch (`feat/`, `fix/`, `docs/`, `chore/`) e abra PR.
2. **Quem mescla é quem revisou.** A proteção da `main` pede duas coisas: uma
   aprovação de quem **não** é autor da PR e o check "Tipos, banco do zero e testes"
   verde. Não há restrição de pessoa — os quatro têm permissão de escrita, então
   depois de aprovar você já pode mesclar, sem esperar pelo Roberto. Só por
   `gh pr merge`: o botão do site passa ao largo do hook.
3. Antes de começar, leia o que entrou (`git log`, `gh pr list`), confira o quadro
   do Notion e o grupo de WhatsApp, e registre a conferência com
   `node .claude/hooks/carimbo.mjs --carimbar --github "…" --notion "…" --whatsapp "…"`.
   O texto de `--github` cita o commit atual de `origin/main`, e o `/comecar-tarefa` do
   Claude faz o registro com você. Se o seu Claude não lê o grupo, você conta a ele o
   que houve lá, e ele registra isso sem inventar. Sem carimbo válido, o hook recusa
   `git commit`, `git push`, `git merge` e `gh pr merge` pedidos ao Claude (é um hook
   do Claude Code: no seu terminal nada é bloqueado). É disciplina, não portaria.
4. Rode o que o CI roda: `pnpm check`, `pnpm test`, `pnpm build`;
   `node scripts/conferir-locales.mjs` se tocou em texto de tela; e `pnpm db:generate`
   não pode gerar arquivo se você mexeu no schema.
5. A PR diz **o que mudou, por quê e como verificar**. Título de commit não é
   evidência.
6. **"Feito (a validar)" no Notion é trabalho à espera de validação por OUTRA
   pessoa**, não "Concluído". Quem fez não conclui. Validar item de colega faz parte
   do trabalho.

O passo a passo, com o comando do Claude para cada etapa, está no
[guia de entrada](./docs/guia-de-entrada.md). As regras valem para pessoas tanto
quanto para as máquinas e estão no [CLAUDE.md](./CLAUDE.md).

## Testes

`pnpm test` roda dois projetos: `server` (Node) e `client` (jsdom + Testing
Library). Lógica nova em `server/` ganha ou atualiza um `*.test.ts` ao lado; teste
de front fica junto do componente, em `*.test.tsx`.

Duas armadilhas que já custaram caro:

- **A suíte nunca lê `DATABASE_URL`.** Ela é trocada por `DATABASE_URL_TESTES`, um
  banco descartável, porque o `.env` de trabalho já apontou para produção e
  `pnpm test` chegou a promover uma usuária real.
- **Ninguém checa os tipos dos testes.** O `tsconfig` exclui `*.test.ts` e o Vitest
  só transpila: um dublê com a forma errada passa em silêncio. Escreva o mock a
  partir do tipo real e prefira asserções que discriminem comportamento.

Teste automatizado não dispensa o smoke manual: abra cada tela afetada, logada com
o nível certo, e confira o console sem erro. A PR traz uma seção "Como verifiquei"
listando as telas.

## Produção

Merge na `main` dispara o deploy no Render (Docker, pelo `Dockerfile`; as variáveis
vivem no painel). Banco MySQL no Aiven, arquivos no Backblaze B2, vitrine no GitHub
Pages.

Depois de **todo** deploy, quem tem o `.env.producao` (hoje, o Roberto) roda o exame
de saúde:

```bash
node scripts/checar-producao.mjs --env .env.producao
```

Ele faz login de verdade com duas contas QA que cria e apaga na hora, prova
isolamento entre contas com controle positivo, exercita o storage de ponta a ponta
e devolve uma linha por checagem com o veredito no fim — `PULADO` é bloco **não
provado** e volta no resumo, para "passou" nunca ser confundido com "não foi
testado". O código de saída é 0 só quando nada reprova, então serve em automação.
Os efeitos colaterais de cada execução (chamadas de IA, um e-mail para endereço
`.invalid`, a oportunidade QA visível por alguns segundos) estão no cabeçalho do
próprio script, junto com as outras opções. Mapa das ferramentas:
[scripts/README.md](./scripts/README.md).

## Regras que não são estilo

- **Nunca commitar** `.env`, chave de API, senha de banco, dump do banco ou dado
  pessoal de usuária ou contato. O dump tem e-mails e senhas de pessoas reais e vive
  só no repositório privado de backup.
- **Nunca rodar script contra o banco de produção sem autorização explícita do
  Roberto.**
- **`sql.raw` é proibido.** Havia 21 pontos de SQL por concatenação, um deles
  permitia execução arbitrária no banco, e todos foram eliminados. Um `sql.raw` num
  diff é sinal de alerta.
- **Mudança de schema só via `pnpm db:generate` + `pnpm db:migrate`.** Editar o
  `schema.ts` sem gerar a migração já quebrou produção: a coluna existia no código e
  não no banco. Nunca edite SQL de migração à mão.
- **Nada extraído por IA entra sozinho.** Toda extração carrega origem e confiança e
  espera confirmação da usuária antes de virar dado.

## Documentação

O índice de toda a documentação, com o glossário, está em
[docs/README.md](./docs/README.md). Para começar, leia o
[guia de entrada](./docs/guia-de-entrada.md). As ferramentas de linha de comando estão em
[scripts/README.md](./scripts/README.md).

**`docs/arquitetura/` é referência de projeto, não retrato do código.** Ela descreve
para onde o sistema vai, assume Postgres com RLS, e nem tudo desenhado existe — o
código roda MySQL.
