# Guia de entrada

Para quem chega ao projeto ou volta depois de um tempo. Leia a seção 1 inteira. As
outras seguem a ordem de montar a máquina pela primeira vez. O que o produto faz
está no [README](../README.md), e as palavras do projeto estão no
[glossário](./README.md#glossário).

## 1. Como trabalhamos

Já houve push na `main` com a tarefa marcada como concluída no Notion e o código sem
resolver o que dizia. Título de commit não é evidência. Por isso, uma tarefa anda assim:

1. **Cartão.** O andamento das tarefas fica no quadro de trabalho do Notion; se a sua tem cartão, comece por ele.
2. **`/comecar-tarefa`**, no Claude. Ele põe a pasta em dia, mostra o que entrou na
   `main`, lê o cartão e a aba Decisões, pergunta o que houve no grupo e registra a
   conferência (o carimbo, seção 8). Depois cria a branch (`feat/…`, `fix/…`, `docs/…`,
   `chore/…`).
3. **Código**, na branch. PR pequena, um assunto por PR. A `main` é protegida, e cada
   merge nela vira deploy em produção.
4. **`/abrir-pr`.** Traz a `main`, roda o que o CI roda, procura segredos e `sql.raw`,
   escreve a descrição no modelo do time (com "Como verifiquei") e abre a PR.
5. **"Feito (a validar)"** no cartão, com o link da PR, depois de o CI da PR ficar
   verde. Daqui em diante, o trabalho espera OUTRA pessoa.
6. **Um colega valida** com `/validar-tarefa`: compara o diff com o cartão (não com o
   título), abre as telas na máquina dele e aprova no GitHub.
7. **Merge.** Segue a regra do [README](../README.md#como-trabalhamos) (hoje: quem
   revisou e aprovou mescla, por `gh pr merge`). O Claude não aprova nem mescla por
   conta própria. Se a pessoa pedir, ele mescla no computador com `gh pr merge N --merge`
   e carimbo válido. Na nuvem, não mescla: pede à pessoa que mescle do computador.
8. **Deploy automático** no Render. Quem tem o `.env.producao` (hoje, o Roberto) roda
   `/conferir-producao`. Um exame cobre todos os merges desde o anterior.
9. **"Concluído".** Com a PR validada por outra pessoa, na `main` e com o exame sem falha,
   quem validou marca o cartão. Quem fez não conclui. Com falha no exame, o cartão volta
   a "Em andamento". Tarefa sem código (painel, DNS, texto jurídico): "Concluído" quando
   já está em vigor e foi conferida por outra pessoa, com a evidência no cartão.

**Os 6 "nunca"**

- Nunca faça push direto na `main`.
- Nunca rode script contra produção (Aiven, Render, Backblaze, Resend, wrwglobal.org) sem
  autorização explícita do Roberto.
- Nunca ponha segredo num commit ou no chat. Hoje o repositório é público.
- Nunca mude o comportamento do produto sem uma decisão conhecida (cartão, grupo ou o Roberto).
- Nunca aprove a própria PR.
- Nunca diga que leu o Notion ou o grupo sem ter lido. Isso vale para você e para o seu Claude.

**Pare e pergunte quando**

- não está claro de onde veio o pedido (sem cartão e sem decisão no grupo);
- pedido, Notion e grupo se contradizem;
- o Claude pede confirmação para algo que toca produção. A resposta é não até o
  Roberto autorizar.

**Onde perguntar.** Decisão de produto se pergunta no grupo. As decisões da cliente nascem lá e nem
sempre chegam ao Notion (aba Decisões); contradição entre pedido, Notion e grupo: pare e pergunte. O andamento de cada tarefa fica no cartão, a
dúvida sobre código fica na PR, e produção, acessos e custos ficam com o Roberto.

## 2. Acessos

- **GitHub:** uma conta por pessoa, com permissão de escrita dada pelo Roberto. Abra,
  revise e aprove sempre com essa mesma conta.
- **Notion:** acesso ao quadro de trabalho e o conector do Notion ligado na sua conta do
  claude.ai (claude.ai/customize/connectors). Com o Claude Code logado nessa mesma
  conta, o Claude lê o quadro. Para conferir, use `/mcp`.
- **Grupo "Projetos IA"** no WhatsApp: é onde a Dra. Glenda e o time decidem. Na nuvem,
  o Claude não lê o grupo; no computador, só o lê se o WhatsApp Web estiver aberto num
  Chrome ligado ao Claude (a extensão Claude in Chrome).
- **Claude:** a sua conta, num plano que inclua o Claude Code.
- **Chave de IA de desenvolvimento:** peça ao Roberto. Nunca use a de produção.

As credenciais de produção (`.env.producao` e os painéis do Render, do Aiven, do B2 e do
Resend) ficam hoje só com o Roberto.

## 3. Preparar o Windows

1. **Git for Windows**, que traz o **Git Bash**. Ele é obrigatório por dois motivos:
   - `pnpm dev` e `pnpm start` definem `NODE_ENV` com sintaxe POSIX (`NODE_ENV=… comando`),
     que o PowerShell e o cmd não entendem. Só o Git Bash não basta: o pnpm também
     precisa ser apontado para ele (item 3);
   - os comandos do fluxo e as skills são escritos para o Bash. No Windows, a ferramenta
     PowerShell do Claude também fica ligada, com travas próprias no `.claude/settings.json`
     equivalentes às do Bash (push na `main`, push forçado, `git add -f`, ler o `.env`,
     scripts de banco); decisão do Roberto em 19/10. Para desligá-la, use
     `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`.

   Use o Git Bash como terminal para tudo deste guia.
2. **Node 20**, a mesma versão do CI e do `Dockerfile`. Ela saiu de suporte em
   30/04/2026; a troca para a 22 é um cartão.
3. **pnpm.** Rode `corepack enable` uma vez. Se ele reclamar de permissão, rode-o num Git
   Bash aberto como administrador. A versão e a configuração do pnpm ficam para o item 7,
   dentro da pasta do projeto.
4. **Docker Desktop**, para o MariaDB 11.4 igual ao do CI. Um MariaDB 11.4 instalado direto
   no Windows também serve.
5. **Claude Code**, no app ou no terminal, logado com a sua conta do claude.ai.
6. **GitHub CLI**: `gh auth login`, com a sua conta.
7. Clone o repositório (o endereço está no botão "Code" do GitHub) e, **dentro da pasta
   clonada**, no Git Bash:
   ```bash
   pnpm --version            # o projeto fixa a 10.4.1
   pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"   # uma vez por computador
   pnpm install
   ```
   Sem o `script-shell`, o pnpm roda os scripts no cmd mesmo quando chamado do Git Bash, e o
   `pnpm dev` falha. Se o Git estiver em outra pasta, ajuste o caminho. Sem `pnpm` no PATH,
   use `corepack pnpm`.

## 4. Banco local igual ao CI

```bash
docker run -d --name wrw-banco -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=wrw_dev -p 3306:3306 mariadb:11.4
# espere uns 20 s (docker logs wrw-banco mostra "ready for connections")
docker exec wrw-banco mariadb -uroot -proot -e "CREATE DATABASE wrw_testes"
DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/criar-banco.mjs
DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_testes' node scripts/criar-banco.mjs
```

Cada `criar-banco` termina com "Banco pronto." O `wrw_dev` é o banco do `pnpm dev`, e o
`wrw_testes` é o banco descartável da suíte. A senha `root` só serve porque o banco não
sai da sua máquina. Nos outros dias, basta `docker start wrw-banco`.

A `DATABASE_URL` vai na linha de comando porque **os scripts `.mjs` de banco não leem o
`.env`**: `criar-banco.mjs`, `migrar.mjs` (`pnpm db:migrate`), `nivelar-banco.mjs`,
`semear-rede-de-teste.mjs`, `definir-senha-local.mjs` e `publicar-documento.mjs`. Quem
lê o `.env` sozinho é o servidor (`pnpm dev`), a suíte (`pnpm test`) e o `pnpm db:generate`.
O `checar-producao.mjs` e o `importar-participantes.mjs` são diferentes: leem o arquivo
passado em `--env` (o exame, sem `--env`, cai no `.env.producao` ou no `.env`). Passe
sempre `--env`.

## 5. O `.env`

Copie com `cp .env.example .env` e preencha no seu editor. O Claude não lê o `.env`: se
ele precisar de um valor, fale o NOME da variável, nunca o valor.

| Variável | Valor local |
| --- | --- |
| `DATABASE_URL` | `mysql://root:root@127.0.0.1:3306/wrw_dev` |
| `DATABASE_URL_TESTES` | `mysql://root:root@127.0.0.1:3306/wrw_testes` (a suíte nunca lê a `DATABASE_URL`) |
| `JWT_SECRET` | aleatório: `openssl rand -base64 48` no Git Bash |
| `LLM_API_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `LLM_API_KEY` | a chave **de desenvolvimento** que o Roberto passar |
| `STORAGE_*`, `RESEND_API_KEY`, `EMAIL_FROM` | vazios: upload e e-mail não funcionam em desenvolvimento, e isso é esperado |
| `RUN_LIVE_CREDENTIAL_TESTS` | vazio (com `true`, a suíte chama a API real e gasta cota) |
| o resto | vazio |

**Nunca ponha valores de produção no `.env` de trabalho.** Ele já apontou para o banco
de produção uma vez, e um `pnpm test` promoveu uma usuária real.

## 6. Subir

```bash
pnpm dev    # http://localhost:3000 (porta ocupada: ele avisa e usa a próxima)
```

1. **Publique o Termo Geral no banco local.** Sem ele, o cadastro para na última etapa
   com "O Termo Geral de Uso ainda não foi publicado":
   ```bash
   DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/publicar-documento.mjs termo_geral_de_uso docs/termos/termo-geral-de-uso.md
   ```
2. **Crie a conta** em `/register` e conclua o cadastro. Esqueceu a senha? Como não há
   e-mail local, defina outra pelo banco (troque o e-mail e a senha, que precisa de 8
   caracteres ou mais; o script recusa banco que não seja local):
   ```bash
   DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/definir-senha-local.mjs voce@local.test 'uma-senha-nova'
   ```
3. **Mude o nível só no banco local** (`bronze`, `silver`, `gold`, `admin`, `president`)
   e recarregue a página:
   ```bash
   docker exec wrw-banco mariadb -uroot -proot wrw_dev -e "UPDATE users SET role='gold' WHERE email='voce@local.test'"
   ```
4. **Dê contatos para cruzar** (com `--limpar` no fim, o mesmo comando desfaz). **Só em
   banco local:** este script não recusa banco remoto, então confira o host antes do Enter.
   ```bash
   DATABASE_URL='mysql://root:root@127.0.0.1:3306/wrw_dev' node scripts/semear-rede-de-teste.mjs voce@local.test
   ```

Para ver o produto, abra `/network` (a rede particular), `/contexts` e `/dashboard`.

## 7. Rodar o que o CI roda

O CI (`.github/workflows/testes.yml`) é a fonte. Antes da PR, rode:

```bash
node scripts/conferir-locales.mjs          # os 10 idiomas com as mesmas chaves
pnpm db:generate && git status --porcelain drizzle/   # não pode aparecer arquivo
pnpm check
for f in scripts/*.mjs scripts/*/*.mjs .claude/hooks/*.mjs; do node --check "$f" || break; done
pnpm test
pnpm build
```

O `/abrir-pr` roda tudo isso por você. O "banco do zero" do CI só vale a pena localmente
se você mexeu em `drizzle/`. Nesse caso, crie um banco vazio, rode `criar-banco.mjs` nele
e depois `nivelar-banco.mjs`, que precisa responder "Nada a nivelar". Falha na suíte é
regressão: nunca chame de "pré-existente" sem rodar o mesmo teste na `main`.

## 8. Trabalhar com o Claude aqui

**Ao abrir uma sessão**, o Claude recebe um resumo: a branch, quanto ela está atrás da
`main` e o estado do carimbo. Na sua tela aparecem só os avisos ATENÇÃO: no seu
computador, se o `.env` aponta para um banco remoto ou se os testes ao vivo estão
ligados; na nuvem, se a instalação das dependências falhou; nos dois, se você está na
`main`.

**As skills** (digite o nome com `/`):

| Skill | Para quê |
| --- | --- |
| `/comecar-tarefa` | começar ou retomar um cartão; sem argumento, só põe a pasta em dia |
| `/abrir-pr` | preparar e abrir a PR (nunca mescla) |
| `/validar-tarefa` | validar a PR de um colega (recusa se a PR for sua) |
| `/mudar-schema` | mudar o banco: `schema.ts` → `pnpm db:generate` → migração local |
| `/texto-de-tela` | texto que a usuária lê, nos 10 idiomas |
| `/conferir-producao` | exame de produção depois do merge (só quem tem o `.env.producao`) |

**O carimbo e o WhatsApp.** Sem uma conferência registrada, o Claude recusa `git commit`,
`git push`, `git merge` e `gh pr merge`. O carimbo vale 6 h e vence quando a `main` muda.
O `/comecar-tarefa` registra a conferência por você, e o comando por trás é
`node .claude/hooks/carimbo.mjs --carimbar --github "…" --notion "…" --whatsapp "…"`.
Cada um dos três textos tem 20 caracteres ou mais, e o de `--github` cita o SHA curto
de `origin/main` (o que `git rev-parse --short origin/main` mostra). Quando o Claude não
consegue ler o grupo (na nuvem, nunca consegue; no computador, só pelo Chrome ligado a
ele, seção 2), ele pergunta a você o que houve lá, e você conta (ou responde "nada
novo"). Ele registra o que você disse no formato "informado por Lucas em 14/10: nada
novo no grupo", e nunca inventa.

**Branch atrás da `main`.** O carimbo é recusado com "Sua branch (…) está N commit(s)
atrás de origin/main". Anote a branch (`git branch --show-current`), rode
`git switch main && git pull --ff-only`, carimbe, volte com `git switch <branch anotada>`
e rode `git merge origin/main`. Nunca faça rebase de branch já empurrada.

**O que o Claude recusa ou pergunta** (regras em `.claude/settings.json`):

- **Recusa** ler `.env` e `.env.*` (o `.env.example` pode), push na `main`, force push
  (`--force`, `-f`), editar SQL de migração à mão e gravar arquivos direto no GitHub, por
  fora do git.
- **Pergunta antes** de rodar qualquer script que possa tocar um banco (`criar-banco`,
  `migrar`, `nivelar`, `semear`, `definir-senha`, `publicar-documento`, `checar-producao`…),
  de mesclar ou aprovar PR, de `pnpm add/remove/update`, de `git push --force-with-lease`,
  de apagar branch, de `git reset --hard`, `git clean` e `rm -rf`, e de mexer nas
  próprias regras, nos hooks e nos workflows.

O motivo das regras: o `.env` de trabalho já apontou para produção, e um comando de boa-fé
já mexeu em dado real. A pergunta mostra a linha inteira, com o host. Leia antes de dizer sim.

**No seu computador × na nuvem** (claude.ai/code):

| | Computador | Nuvem |
| --- | --- | --- |
| Banco MySQL | o seu, local | não há (o CI cria um) |
| `gh pr …` | funciona | dá 403: o Claude usa as ferramentas do GitHub, mas não mescla (o merge é do computador) |
| Abrir telas (`pnpm dev`) | sim | não: o teste de tela é sempre local |
| `.env.producao` | só quem tem | nunca |

Mais três cuidados:

- Nunca cole senha, chave ou URL de banco no chat.
- O Claude pede confirmação de algo que toca produção? A resposta é não, até o Roberto
  autorizar.
- Para notas pessoais do seu Claude, use um `CLAUDE.local.md` na raiz. Ele já está no
  `.gitignore` e não vai para o repositório.

## 9. Erros comuns

| Você vê | Por quê | O que fazer |
| --- | --- | --- |
| `DATABASE_URL não definida.` (`criar-banco`) ou `Defina DATABASE_URL.` (`migrar`, `nivelar`, `publicar-documento`) | os scripts `.mjs` não leem o `.env` | passe a variável na linha de comando (seção 4) |
| `DATABASE_URL is required to run drizzle commands` | falta `DATABASE_URL` no `.env` | preencha o `.env` (seção 5) |
| `'NODE_ENV' não é reconhecido…` ao rodar `pnpm dev` | o pnpm rodou o script no cmd, o padrão dele no Windows | no Git Bash, rode o `pnpm config set script-shell …` da seção 3 |
| `Variável de ambiente JWT_SECRET não definida.` | `.env` sem `JWT_SECRET` | gere um (seção 5) |
| "Banco de dados indisponível; tente de novo em instantes" na tela | MariaDB parado ou URL errada | `docker start wrw-banco` e confira a `DATABASE_URL` |
| `Não consegui aplicar as migrações: connect ECONNREFUSED` | o banco ainda está subindo ou está parado | espere uns segundos, ou rode `docker start wrw-banco` |
| `port is already allocated` no `docker run` | a porta 3306 já está em uso (outro MySQL) | use `-p 3307:3306` e `:3307` nas URLs |
| Commit recusado com "Conferência … pendente" | o carimbo venceu (6 h) ou a `main` mudou | `/comecar-tarefa` |
| Carimbo recusado com "Sua branch (…) está N commit(s) atrás de origin/main" | a `main` andou depois que você criou a branch | seção 8, "Branch atrás da `main`" |
| "O Termo Geral de Uso ainda não foi publicado" no fim do cadastro | termo ausente no banco local | seção 6, passo 1 |
| Conflito em `drizzle/`, ou CI vermelho em "Schema e migrações concordam" | migração gerada em paralelo com outra PR, ou schema sem migração | `/mudar-schema` |
| `HTTP 403` em `gh pr …` na nuvem | o `gh pr` não funciona lá | normal: o Claude usa as ferramentas do GitHub (e o merge fica para o computador) |
