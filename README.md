# MMM (Mulheres que Movem o Mundo)

CRM inteligente de networking: cada usuária mantém sua base privada de
relacionamentos estratégicos, e a IA cruza **o que cada contato possui** com **o que
cada contato procura** para gerar oportunidades de negócio.

## Estado do repositório

O código saiu do Manus e está aqui. Esta versão foi recuperada do backup, adaptada
para rodar fora da plataforma de origem e revisada antes de entrar no repositório
público. O detalhamento está em [docs/recuperacao-do-manus.md](./docs/recuperacao-do-manus.md).

O **desenho do sistema** em `docs/arquitetura/` continua sendo a referência: ele
descreve para onde o projeto vai, e nem tudo que está desenhado já existe no código.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura/](./docs/arquitetura/) | Visão geral, camadas e princípios |
| [docs/arquitetura/modelo-de-dados.md](./docs/arquitetura/modelo-de-dados.md) | Entidades e DDL |
| [docs/arquitetura/fluxos.md](./docs/arquitetura/fluxos.md) | Assistente de Reuniões e Smart Match |
| [docs/arquitetura/privacidade.md](./docs/arquitetura/privacidade.md) | Os três níveis de acesso |
| [docs/arquitetura/decisoes-em-aberto.md](./docs/arquitetura/decisoes-em-aberto.md) | O que trava implementação |
| [docs/recuperacao-do-manus.md](./docs/recuperacao-do-manus.md) | Como o código foi recuperado e o que mudou |
| [docs/deploy.md](./docs/deploy.md) | Como colocar no ar, e por que não no GitHub Pages |

As specs por etapa (perfil estratégico, contextos, enriquecimento, assistente de
reuniões, rede privada) estão soltas em `docs/`, como vieram do Manus.

## Exame de saúde de produção

Depois de qualquer deploy, confirme em um comando que o site no ar está inteiro:

```bash
node scripts/checar-producao.mjs --env .env.producao                   # bateria padrão
node scripts/checar-producao.mjs --env .env.producao --com-ia          # inclui FAQ, memória e as checagens de IA
node scripts/checar-producao.mjs --env .env.producao --somente-faxina  # só apaga resíduos de uma execução interrompida
```

O exame precisa só da `DATABASE_URL` da produção, num arquivo `.env.producao`
separado do `.env` de trabalho (o `.gitignore` já cobre todo `.env.*`); `JWT_SECRET`
não é mais necessário, porque o exame faz login de verdade. Sem `--env` ele lê
`.env.producao` se existir, senão o `.env`, com aviso. `EXAME_BASE_URL` (opcional, no
arquivo ou no ambiente, que vence) aponta para outro endereço, como
`http://localhost:3000`; o padrão é `https://mmm-gud5.onrender.com`.

O que o exame prova: site, cache e migrações em dia; login real com duas contas QA
(uma presidente, uma Prata) que ele cria e apaga na hora; isolamento entre contas
com controle positivo (a dona vê os próprios dados, a outra vê zero e o acesso
direto é barrado); storage B2 de ponta a ponta (upload, download pela URL assinada,
posse e exclusão no bucket); consentimento do Smart Match, quando há termo
publicado; conceder e revogar Ouro com trilha de auditoria; vitrine coletiva e
acervo Ouro por nível de acesso. Saída: uma linha por checagem (OK, FALHA, PULADO,
ALERTA, LIMITE, INFO, EXCECAO e LIMPEZA COM ERRO) e o veredito no fim; PULADO é
bloco não provado e volta no resumo. O código de saída é 0 só sem falha (ALERTA
conta como falha), exceção, limite de requisições ou erro de limpeza, então dá
para usar em automação. Em `--somente-faxina` o ALERTA de resíduo encontrado é
informativo, porque achar resíduo é o serviço desse modo: só erro de limpeza ou
exceção devolvem 1.

Efeitos colaterais conhecidos de cada execução, mesmo sem `--com-ia`: até duas
chamadas de IA (o compliance na criação da oportunidade QA, sempre; o alerta de
compatibilidade só quando a oportunidade é aprovada e há ao menos uma conta Ouro,
presidente ou admin real com perfil, e o prompt dele leva setor, possui e procura
dessas contas; o exame imprime esse número como INFO antes de criar); um e-mail do
Smart Match para endereço `.invalid`, cuja entrega não é verificada; o contato QA
marcado 'ouro' por poucos segundos e a oportunidade QA (confidencial, ativa) visível
para contas Ouro reais até o fim da execução (dezenas de segundos, mais de dois
minutos com `--com-ia` ou quando a sondagem do alerta espera os 120 s); e as linhas
`GOLD_ACERVO_READ` e `REVOKED_SESSION_ACCESS_ATTEMPT` das contas QA, preservadas na
trilha de auditoria.

## O que já está implementado

- **Matches por IA**: perfil analisado em cinco dimensões, com score de
  compatibilidade e uma explicação do porquê da conexão fazer sentido.
- **Oportunidades**: com análise automática de compliance que sugere a
  documentação necessária e atribui um índice de confiabilidade.
- **Deal Rooms**: sala privada liberada só depois das duas partes assinarem o NDA.
- **Rede particular**: base de contatos privada, com registro de onde e como cada
  pessoa foi conhecida e um assistente que enriquece o cadastro por conversa.
- **Reuniões**: gravação, transcrição e extração de entidades, com sugestão de
  novos contatos a partir do que foi falado.
- **SIVC**: verificação de identidade por documentos, com leitura automática.
- **Governança**: níveis Bronze, Prata e Ouro, com painel de validação de
  oportunidades e nomeação de líderes regionais.

Interface em 10 idiomas.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 19, Vite 7, Tailwind 4, shadcn/ui, wouter |
| API | tRPC 11 sobre Express 4, com tipos ponta a ponta |
| Banco | MySQL via Drizzle ORM |
| IA | API compatível com OpenAI (Google Gemini por padrão) |
| Arquivos | S3 com URLs assinadas |

## Rodando localmente

Requisitos: Node.js 20+, pnpm e um MySQL acessível.

```bash
pnpm install
cp .env.example .env   # preencha as variáveis
pnpm db:migrate        # cria as tabelas
pnpm dev               # http://localhost:3000
```

`DATABASE_URL`, `JWT_SECRET` e `VAULT_ENCRYPTION_KEY` são obrigatórias: o servidor
se recusa a iniciar sem elas, em vez de cair para um valor padrão inseguro.

```bash
pnpm check    # checagem de tipos
pnpm test     # testes (Vitest)
pnpm build    # gera dist/
pnpm start    # roda o build de produção
```

No Windows, use o Git Bash: os scripts `dev` e `start` definem `NODE_ENV` com
sintaxe POSIX e falham no PowerShell.

## Estrutura

```
client/src/
  pages/         páginas
  components/    componentes reutilizáveis e shadcn/ui
  i18n/          traduções
server/
  routers/       procedimentos tRPC, um arquivo por área
  db.ts          consultas
  security.ts    sessões, auditoria e cofre
  _core/         infraestrutura (auth, LLM, storage, e-mail)
drizzle/         schema e migrações
shared/          constantes e tipos usados nos dois lados
```

## Hospedagem

A aplicação precisa de um servidor Node e de um MySQL. Hospedagens de arquivos
estáticos (GitHub Pages e afins) não conseguem rodá-la, porque login, IA, cofre e
uploads dependem de chaves que nunca podem ir para o navegador. Railway, Render,
Fly.io, Cloud Run ou um VPS resolvem.

O repositório traz um `Dockerfile` pronto. O passo a passo, a lista de variáveis
de ambiente e o que continua quebrado depois do deploy estão em
[docs/deploy.md](./docs/deploy.md).

O histórico de versões da documentação está no [CHANGELOG](./CHANGELOG.md).

## Gestão do projeto

O escopo (as 13 seções), quem está com cada item, status e prazos ficam no Notion,
não aqui. Este repositório é para código e desenho técnico.

## Antes de commitar

Nunca suba `.env`, chave de API, senha de banco ou dado pessoal de usuário ou
contato. O `.gitignore` cobre os casos comuns; confira o diff antes de cada commit.

Duas regras que valem a pena conhecer:

- O dump do banco **não entra aqui**. Ele tem e-mails e senhas de usuárias reais e
  fica só no repositório privado de backup.
- Nenhuma query monta SQL por concatenação de texto. Se um `sql.raw` aparecer num
  diff, é sinal de alerta: foram todos eliminados de propósito.
