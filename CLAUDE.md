# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O projeto

MMM — Mulheres que Movem o Mundo: CRM de networking em que cada usuária mantém uma
base privada de contatos e a IA cruza o que cada contato **possui** com o que cada
contato **procura** para gerar oportunidades. Todo o texto do repositório (docs,
commits, PRs) é em português; siga o padrão.

A gestão do projeto (escopo das 13 seções, responsáveis, status, prazos) fica no
**Notion**, não aqui. O repositório é para código e desenho técnico.

## Comandos

Requisitos: Node 20+, pnpm e um MySQL acessível.

```bash
pnpm install
cp .env.example .env   # preencher as variáveis
pnpm db:push           # drizzle-kit generate + migrate
pnpm dev               # http://localhost:3000
pnpm check             # tsc --noEmit
pnpm test              # vitest run
pnpm vitest run server/match-service.test.ts   # um teste só
pnpm build             # vite build + esbuild do servidor → dist/
pnpm start             # roda o build de produção
pnpm format            # prettier --write .
```

- **No Windows, use Git Bash** — `dev` e `start` definem `NODE_ENV` com sintaxe
  POSIX e falham no PowerShell.
- `DATABASE_URL`, `JWT_SECRET` e `VAULT_ENCRYPTION_KEY` são obrigatórias: o servidor
  se recusa a iniciar sem elas (`requireSecret()` em `server/_core/env.ts`). Não há
  valores padrão de propósito.
- Parte dos testes depende do `.env`, não do código. Num clone sem `.env`, 6
  falham: 3 do Gemini (`GOOGLE_API_KEY`), as checagens de credencial do Resend e
  da Anthropic, e 1 de `critical.test.ts` que precisa de banco (`getDb()` nulo).
  Com banco e Gemini configurados, restam só as 2 checagens de
  `RESEND_API_KEY`/`ANTHROPIC_API_KEY` — o estado registrado em
  `docs/recuperacao-do-manus.md`. Falha fora desse conjunto é regressão.

## Arquitetura

Aplicação full-stack TypeScript num único pacote: React 19 + Vite no client,
tRPC 11 sobre Express 4 no servidor, MySQL via Drizzle.

**Fluxo de tipos ponta a ponta (tRPC).** Cada área de negócio tem um router em
`server/routers/` (auth, network, matches, opportunities, dealRoom, meetings,
sivc, president, vault…), agregados em `server/routers.ts`. As procedures base
(pública, autenticada, admin, president) estão em `server/routers/_procedures.ts`.
O client consome tudo tipado via `client/src/lib/trpc.ts` + React Query.
Atenção: `presidentProcedure` trata **qualquer conta Ouro como Presidente** — é
regra de negócio deliberada (registrada em `docs/recuperacao-do-manus.md`), não bug.

**`server/_core/` é a infraestrutura herdada do Manus** (o projeto nasceu na
plataforma Manus e foi extraído — ver `docs/recuperacao-do-manus.md`): entrada
(`index.ts`), auth/OAuth, cookies, e-mail (Resend), storage S3 com URLs assinadas,
integração com o Vite em dev. As chamadas de IA passam por `server/_core/llm.ts`,
que aceita qualquer endpoint compatível com a API da OpenAI — Gemini por padrão,
configurado por `BUILT_IN_FORGE_API_URL`, `GOOGLE_API_KEY` e `LLM_MODEL`. A API da
Anthropic é usada só pelo recurso de Memória.

**Banco.** Schema e migrações em `drizzle/` (`schema.ts` + SQL versionado).
Exceção conhecida: as tabelas `sivc_*` foram criadas direto no MySQL e nunca
declaradas no schema — o SIVC usa SQL parametrizado escrito à mão, fora do ORM.

**`shared/`** tem constantes e tipos usados por client e servidor. **`client/src/`**:
páginas em `pages/` (roteadas com wouter em `App.tsx`), shadcn/ui em
`components/ui/`, i18n com 10 idiomas em `i18n/`.

**`docs/arquitetura/` é a referência de projeto, não o retrato do código.** Ela
descreve para onde o sistema vai, assume Postgres com RLS, e nem tudo desenhado
existe; o código atual roda MySQL (decisão D6 em
`docs/arquitetura/decisoes-em-aberto.md` — esse arquivo lista o que trava
implementação e precisa de decisão de produto). As `docs/spec-*.md` são as specs
por etapa vindas do Manus.

**`vitrine/`** é uma página estática publicada no GitHub Pages pelo workflow
`.github/workflows/pages.yml`. Não é a aplicação — a aplicação precisa de Node e
MySQL e não roda em hospedagem estática.

Os scripts Python na raiz (`fix_*.py`, `update_texts.py`, `add_*.py`) são
utilitários pontuais de i18n, fora do build.

## Regras que não são estilo

- **`sql.raw` é proibido.** Havia 21 pontos de SQL por concatenação (um deles
  permitia execução arbitrária no banco); todos foram eliminados. Um `sql.raw` num
  diff é sinal de alerta. Toda query nova é parametrizada ou via ORM.
- **Nunca commitar** `.env`, chave de API, senha de banco, dump do banco (contém
  e-mails e senhas de usuárias reais; vive só no repositório privado de backup) ou
  dado pessoal de usuária ou contato.
- **Privacidade é regra de consulta, não de tela.** O nível público nunca seleciona
  colunas pessoais — esconder no front-end não basta (ver
  `docs/arquitetura/privacidade.md`).
- **Match só cruza taxonomia controlada** (`taxonomia_item`), nunca texto livre.
- **Nada extraído por IA entra sozinho**: toda extração carrega origem (trecho,
  posição, confiança) e exige confirmação do usuário antes de virar dado.
