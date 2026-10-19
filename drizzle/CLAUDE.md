# drizzle/

<!-- Carregado quando o Claude lê ou edita um arquivo de drizzle/. Este arquivo não
atrapalha as ferramentas: o drizzle-kit, o scripts/migrar.mjs e os testes só leem
schema.ts, os *.sql listados no meta/_journal.json e os meta/*_snapshot.json. -->

Schema e migrações do banco (MySQL via Drizzle). `schema.ts` tem todas as tabelas,
inclusive as `sivc_*`; `shared/types.ts` reexporta os tipos dele. As migrações são SQL
versionado (`00NN_nome.sql`), com baseline `0000_fundacao`, mais `meta/_journal.json` e um
`meta/00NN_snapshot.json` por migração. A configuração do drizzle-kit fica na raiz
(`drizzle.config.ts`).

## Mudança de schema: só por generate + migrate

1. Edite `drizzle/schema.ts`.
2. `pnpm db:generate`: o drizzle-kit compara o schema com o último snapshot e escreve a
   migração, o snapshot e a entrada do journal. Leia o SQL gerado.
3. `DATABASE_URL='mysql://...' pnpm db:migrate` num banco LOCAL (`scripts/migrar.mjs`;
   `node scripts/migrar.mjs --simular` só relata). Rode `pnpm db:generate` de novo: não
   pode criar arquivo.

A skill `/mudar-schema` conduz esses passos.

- **Nunca edite à mão** SQL de migração, snapshot ou `_journal.json`. Editar o `schema.ts`
  sem gerar a migração já quebrou produção uma vez (a coluna existia no código e não no
  banco). O CI cria um banco do zero em MariaDB 11.4 (`criar-banco.mjs`), exige
  "Nada a nivelar" do `nivelar-banco.mjs` nele e falha se `pnpm db:generate` produzir
  arquivo.
- **Migração que já está na `main` não muda:** o `migrar.mjs` anota cada uma em
  `_migracoes` e não a roda de novo. Corrigir é migração nova.
- **Duas PRs com migração:** a segunda a mesclar traz a `main` e gera a dela de novo sobre
  ela. Conflito em `drizzle/meta/` nunca se resolve à mão: na branch da PR #100, um merge
  assim apagou em silêncio as migrações 0009 a 0011 do journal.
- O journal não pode ter BOM: o boot de produção faz `JSON.parse` dele
  (`server/etapa10-acervo-ouro.test.ts` confere).

## Como as migrações rodam

- `scripts/migrar.mjs` usa a tabela própria `_migracoes` (não a do drizzle-kit) e lê
  `drizzle/meta/_journal.json`. Três caminhos: banco vazio aplica tudo; banco antigo em
  dia adota o baseline; banco antigo desviado é recusado com a lista dos desvios, e
  `node scripts/nivelar-banco.mjs --aplicar` cria o que falta, sem nunca apagar.
- **Em produção as migrações rodam no boot:** `server/_core/index.ts` executa
  `scripts/migrar.mjs` como processo filho antes de aceitar tráfego; falha aborta a subida
  e o Render mantém a versão anterior no ar. Escreva a migração pensando nas linhas que
  já existem em produção.
- Nunca rode script contra o banco de produção (Aiven) sem autorização explícita do
  Roberto. `criar-banco.mjs`, `migrar.mjs` e `nivelar-banco.mjs` não leem o `.env`: ver
  `scripts/CLAUDE.md`.

## Tabela ou coluna nova com dado de usuária

Toda coluna de usuária do schema precisa de destino declarado em dois planos, e os testes
ficam vermelhos até alguém decidir o que acontece com ela:

- **exclusão de conta:** `server/exclusao-de-conta.ts`, cobrado por
  `server/exclusao-de-conta.test.ts`;
- **limpeza do exame de produção:** `scripts/exame/limpeza.mjs`, cobrado por
  `server/exame-de-producao.test.ts`.
