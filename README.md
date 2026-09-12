# MMM — Mulheres que Movem o Mundo

Uma empresária entra na plataforma e cadastra a base de contatos que ela já tem na
agenda. Para cada contato, anota duas coisas: **o que aquela pessoa tem** para
oferecer e **o que aquela pessoa procura**. A IA cruza esses dois lados — dentro da
rede dela e, com autorização, entre as redes de outras membras — e avisa quando
existe negócio possível. Quando as duas partes querem seguir, abre-se uma sala
privada de negociação, e o movimento fica com uma comissão sobre o que fechar.

É um CRM de networking, não uma rede social: **ninguém navega nos contatos de
ninguém**. O cruzamento é feito pelo sistema e só o resultado aparece.

## Situação em 12/09/2026

| | |
|---|---|
| **Entrega** | 16/09/2026 |
| **No ar** | https://mmm-gud5.onrender.com (plano gratuito: a primeira visita leva 30-60 s) |
| **Escopo da entrega** | a plataforma com a base de participantes carregada e as conexões funcionando. **Fora**: pagamento pelo site e aplicativo móvel. **Talvez**: verificação completa de documentos |
| **Etapas 1 a 11** | prontas e validadas |
| **Etapa 12** (corretor de negócios) | aguardando decisão da cliente sobre quem é o corretor |
| **Etapa 13** (acordo de intermediação) | parcial |

O escopo detalhado, quem está com cada item, status e prazos ficam no **Notion**,
não aqui. Este repositório é para código e desenho técnico.

## Quem é quem

- **Roberto** (`Movits`) lidera o projeto e fala com a cliente.
- **Nicolas** (`nicolasriber19`), **Gabriel** (`DevGabriel03`) e **Lucas Yan**
  (`pacocateamo123-max`) desenvolvem. Cada um instrui o próprio Claude, e é por isso
  que o [CLAUDE.md](./CLAUDE.md) existe: ele é lido por todas essas máquinas.
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
   cruzamento) e recomendação de oportunidades. O cruzamento nunca é por palavra
   parecida: "exportar vinho" casa com "importar vinho", mas "exportar" nunca casa
   com "exportar".
5. **Publicar uma oportunidade.** Uma membra Ouro ou a presidência valida antes de
   ir ao ar, e uma análise automática sugere que documentação aquele negócio pede.
6. **Negociar.** Quem se interessa abre uma **Sala de Negociação**, que só destrava
   depois das duas partes aceitarem o acordo de confidencialidade. O registro do
   negócio fechado — valor, lucro declarado e aviso de comissão — **ainda não
   está no ar**: é o ajuste A11, em rascunho na PR #94, e depende de decisões
   comerciais da cliente que seguem em aberto.

## Os três níveis, que são regra de banco e não de tela

**Bronze** é quem entrou. **Prata** completou o perfil. **Ouro** é o grupo restrito
— presidente e administradoras — e vem com o painel de governança: validar
oportunidade, conceder Ouro a outra, nomear líder regional.

A privacidade é aplicada **na consulta**, nunca escondendo coisas no front-end:

- o nível público lê só id, país e cidade, e devolve identificador opaco;
- o acervo Ouro exige, ao mesmo tempo, contato marcado como compartilhável, termo
  vigente aceito pela dona, papel Ouro no procedimento e registro de auditoria.

Esconder no React não conta. Se a consulta seleciona a coluna, o dado vazou.

## Comece aqui (15 minutos)

Requisitos: Node 20+, `pnpm` e um MySQL acessível. **No Windows, use o Git Bash**:
`dev` e `start` definem `NODE_ENV` com sintaxe POSIX e falham no PowerShell.

```bash
pnpm install
cp .env.example .env            # preencha as variáveis
node scripts/criar-banco.mjs    # banco novo do zero, pelas migrações
pnpm dev                        # http://localhost:3000
```

`JWT_SECRET` é obrigatória — o servidor se recusa a subir sem ela, em vez de cair
para um padrão inseguro. Sem `DATABASE_URL` o servidor **sobe**, e todo acesso a
dados responde "Banco de dados indisponível": banco fora do ar é erro, nunca "sem
dados". Em desenvolvimento não há `STORAGE_*` nem Resend, então upload e e-mail não
funcionam, e isso é esperado.

Depois de subir, abra estas três telas para entender o produto em cinco minutos:
`/network` (a rede particular, com possui e procura), `/contexts` (onde cada pessoa
foi conhecida) e `/dashboard` (os matches). Para as telas que dependem de nível,
crie a conta e ajuste o papel no banco — `scripts/definir-senha-local.mjs` define
senha em banco local, já que não há e-mail em desenvolvimento.

## A stack, e onde cada coisa mora

Aplicação full-stack TypeScript num **único pacote**: front e API na mesma origem,
sem proxy de desenvolvimento.

| Camada | Tecnologia |
|---|---|
| Front | React 19, Vite 7, Tailwind 4 (configurado no próprio CSS), shadcn/ui, wouter |
| API | tRPC 11 sobre Express 4, tipos ponta a ponta sem escrever cliente HTTP |
| Banco | MySQL via Drizzle ORM (51 tabelas, migrações versionadas) |
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
docs/            desenho do sistema e specs por etapa
vitrine/         página estática publicada no GitHub Pages — NÃO é a aplicação
```

A entrada real do servidor é `server/_core/index.ts`. Em produção ele roda as
migrações pendentes **antes** de aceitar tráfego: se a migração falhar, a subida
aborta e o Render mantém a versão anterior no ar.

## Como trabalhamos

Já houve push na `main` com a tarefa marcada "concluída" no Notion e o código não
resolvendo o que dizia. Por isso:

1. A `main` é protegida e todo merge nela **vira deploy em produção**. Trabalhe em
   branch (`feat/`, `fix/`, `docs/`) e abra PR.
2. **Quem mescla é quem revisou.** A proteção da `main` pede duas coisas: uma
   aprovação de quem **não** é autor da PR e o check "Tipos, banco do zero e testes"
   verde. Não há restrição de pessoa — os quatro têm permissão de escrita, então
   depois de aprovar você já pode mesclar, sem esperar pelo Roberto. Só por
   `gh pr merge`: o botão do site passa ao largo do hook.
3. Antes de começar, leia o que entrou (`git log`, `gh pr list`), confira o quadro
   do Notion e o grupo de WhatsApp, e registre a conferência com
   `node .claude/hooks/carimbo.mjs --carimbar`. Sem carimbo válido, o hook recusa
   `git commit`, `git push`, `git merge` e `gh pr merge` — para todo mundo igual, no
   seu próprio clone: o hook não sabe quem está rodando, é disciplina e não portaria.
4. Rode o que o CI roda: `pnpm check`, `pnpm test`, `pnpm build`;
   `node scripts/conferir-locales.mjs` se tocou em texto de tela; e `pnpm db:generate`
   não pode gerar arquivo se você mexeu no schema.
5. A PR diz **o que mudou, por quê e como verificar**. Título de commit não é
   evidência.
6. **"Feito (a validar)" no Notion é trabalho à espera de validação por OUTRA
   pessoa**, não "Concluído". Quem fez não conclui. Validar item de colega faz parte
   do trabalho.

O detalhe de cada passo está no [CLAUDE.md](./CLAUDE.md) — que vale para pessoas
tanto quanto para as máquinas.

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

Depois de **todo** deploy, rode o exame de saúde:

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

| Documento | Conteúdo |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | o guia de trabalho completo, lido por pessoas e por Claudes |
| [docs/arquitetura/](./docs/arquitetura/) | o desenho do sistema: camadas, princípios, modelo de dados, fluxos |
| [docs/arquitetura/privacidade.md](./docs/arquitetura/privacidade.md) | os três níveis de acesso, em detalhe |
| [docs/arquitetura/decisoes-em-aberto.md](./docs/arquitetura/decisoes-em-aberto.md) | o que trava implementação e precisa de decisão de produto |
| [docs/deploy.md](./docs/deploy.md) | passo a passo do deploy e a tabela de variáveis |
| [docs/recuperacao-do-manus.md](./docs/recuperacao-do-manus.md) | o projeto nasceu na plataforma Manus; como o código foi extraído e o que mudou |
| [scripts/README.md](./scripts/README.md) | o mapa das ferramentas de linha de comando |
| [CHANGELOG.md](./CHANGELOG.md) | histórico de versões da documentação |

**`docs/arquitetura/` é referência de projeto, não retrato do código.** Ela descreve
para onde o sistema vai, assume Postgres com RLS, e nem tudo desenhado existe — o
código roda MySQL. As `docs/spec-*.md` são as especificações por etapa, como
vieram do Manus.
