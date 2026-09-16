# Colocar o MMM no ar

## Por que não dá para usar o GitHub Pages

O GitHub Pages serve **arquivos estáticos**. Ele entrega HTML, CSS, JavaScript
e imagens, e não executa nada do lado do servidor.

O MMM não é um site estático. É um processo Node único que faz as duas coisas
ao mesmo tempo:

| O que | Onde |
|---|---|
| Front-end compilado | `dist/public`, servido pelo Express |
| API tRPC | `/api/trpc`, no mesmo processo (`server/_core/index.ts`) |

O cliente chama a API na mesma origem, em `client/src/main.tsx:49`:

```ts
httpBatchLink({ url: "/api/trpc" })
```

Publicado no Pages, esse endereço não existe. O resultado seria a tela inicial
carregando com os números zerados e o login falhando em toda tentativa, porque
não há servidor para responder. Pior que não ter link.

Além disso, três coisas nunca podem ir para o navegador e por isso exigem
servidor: a conexão com o MySQL, o `JWT_SECRET` que assina as sessões e a chave
do LLM. Publicá-las no bundle seria entregá-las a qualquer visitante.

**Onde funciona:** Railway, Render, Fly.io, Cloud Run ou um VPS. A decisão
[D6](./arquitetura/decisoes-em-aberto.md) recomenda Railway, porque sobe o
código como está, com MySQL gerenciado no mesmo lugar e sem hibernação.

---

## Subir de graça: Render + Aiven

Caminho escolhido em 29/08/2026 para a versão de teste, enquanto não há decisão
sobre hospedagem paga. Nenhum dos dois pede cartão.

O banco fica no **Aiven** porque o plano gratuito do Render oferece PostgreSQL, e
o MMM fala MySQL pelo driver `mysql2`.

1. **Banco.** aiven.io → *Create service* → **MySQL** → plano **Free**. Leva uns
   dois minutos para ficar de pé. Copie a *Service URI* do painel.

2. **Ajustar a URI.** O Aiven entrega algo terminando em `?ssl-mode=REQUIRED`,
   que é sintaxe do cliente de linha de comando. O `mysql2` ignora esse
   parâmetro e tenta conectar sem TLS, que o Aiven recusa, com um erro que não
   explica a causa. Troque o final por:
   ```
   ?ssl={"rejectUnauthorized":false}
   ```
   Isso criptografa a conexão mas não valida o certificado. Serve para o
   ambiente de teste. Para produção, use a CA que o Aiven disponibiliza.

3. **Criar as tabelas**, com a URI já ajustada:
   ```bash
   DATABASE_URL='mysql://...' node scripts/criar-banco.mjs
   ```

4. **Aplicação.** render.com → *New* → *Web Service* → conectar `Movits/MMM` →
   runtime **Docker**. Ele acha o `Dockerfile` sozinho e injeta a `PORT`, que o
   servidor respeita em produção (`server/_core/index.ts`).

5. **Variáveis**, na tabela da próxima seção. A `DATABASE_URL` é a mesma do
   passo 2.

6. Depois do primeiro deploy, copiar o endereço `*.onrender.com` e voltar em
   *Environment* para apontar `FRONTEND_URL` para ele.

**O custo do plano gratuito:** o serviço dorme depois de um tempo sem acesso, e
a primeira visita seguinte demora de 30 a 60 segundos. Vale avisar quem for
testar, senão parece que está fora do ar. Dormindo, o servidor também não roda a
varredura que apaga o áudio de reunião 24 h depois da transcrição ou da falha: por
isso a produção está no plano Starter, que não dorme.

## Subir no Railway

O repositório já tem `Dockerfile`, então o Railway não precisa adivinhar nada.

1. **Criar a conta** em railway.app e conectar o GitHub. Pede cartão, mesmo no
   plano Hobby.
2. **New Project → Deploy from GitHub repo → `Movits/MMM`.** Ele detecta o
   `Dockerfile` sozinho.
3. **Add MySQL** no mesmo projeto. O Railway cria a variável `DATABASE_URL` e
   já a injeta no serviço do app.
4. **Preencher as variáveis** da tabela abaixo em Variables.
5. **Criar as tabelas uma vez**, da sua máquina, apontando para o banco novo:
   ```bash
   DATABASE_URL="<a URL do MySQL>" node scripts/criar-banco.mjs
   ```
   O script aplica as migrações de `drizzle/` e anota o que rodou na tabela
   `_migracoes`. Dá para rodar de novo sem perigo: o que já foi aplicado não
   roda outra vez.

   **Banco que já existia antes do sistema de migração:** o `migrar.mjs` confere
   coluna a coluna antes de adotar. Se o banco estiver desviado, ele recusa e
   lista cada desvio; `node scripts/nivelar-banco.mjs --aplicar` gera os ALTERs
   a partir do próprio baseline (nunca apaga nada) e aí a adoção passa.

   **Para mudar o schema daqui em diante:** edite `drizzle/schema.ts`, rode
   `pnpm db:generate` (nasce a migração em `drizzle/`) e `pnpm db:migrate`
   (aplica). Nunca edite SQL de migração à mão — foi mantendo um SQL à mão que
   um banco novo passou a nascer sem as tabelas do consentimento. O CI cria um
   banco do zero e confere que schema e migrações concordam.

   **Em produção as migrações rodam sozinhas no boot.** O servidor (em
   `NODE_ENV=production`, com `DATABASE_URL` definida) executa
   `scripts/migrar.mjs` antes de aceitar tráfego: pendência é aplicada,
   falha aborta a subida — e a plataforma mantém a versão anterior no ar.
   Nasceu porque o deploy automático publicava código novo contra banco
   velho e ninguém rodava o comando manual: uma coluna nova no schema
   derrubaria todas as consultas da tabela até alguém migrar. O comando
   manual continua valendo para banco novo e para desenvolvimento.
6. **Generate Domain** em Settings → Networking. Sai um endereço
   `*.up.railway.app`. Esse é o link da Glenda.
7. **Voltar em Variables** e apontar `FRONTEND_URL` para esse domínio, senão os
   links dos e-mails transacionais saem quebrados.

## Variáveis de ambiente

### Sem estas o servidor não inicia

| Variável | De onde vem |
|---|---|
| `DATABASE_URL` | a URI do banco, com o `ssl` já ajustado |
| `JWT_SECRET` | você gera: `openssl rand -base64 48` |

`VAULT_ENCRYPTION_KEY` **não** impede o servidor de iniciar: sem ela,
`server/matching.ts:12` cai para o `JWT_SECRET`. Ainda assim, defina-a. Se o
cofre for cifrado com o `JWT_SECRET` e um dia esse segredo for rotacionado por
motivo de segurança, o conteúdo do cofre se torna ilegível.

A recusa é proposital, em `server/_core/env.ts`. A versão do Manus caía para
um valor padrão embutido no código, o que significa que qualquer pessoa com o
código conseguia assinar uma sessão válida.

### Sem estas o app sobe e falha em uso

| Variável | Para quê | Valor |
|---|---|---|
| `NODE_ENV` | modo produção | `production` |
| `FRONTEND_URL` | links de e-mail e redirects | o domínio do Railway |
| `LLM_API_URL` | matches, enriquecimento, transcrição | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `LLM_API_KEY` | a chave do endpoint acima | Google AI Studio |
| `RESEND_API_KEY` | e-mail de recuperação de senha | resend.com |
| `EMAIL_FROM` | remetente | `MMM <nao-responda@seudominio>` |
| `LLM_AUDIO_MODEL_RESERVA` | opcional: modelo reserva da transcrição (assume no 503/cota) | padrão `gemini-3.5-flash-lite`; sempre id concreto, nunca alias |

`PORT` o Railway injeta sozinho. Não defina na mão.

### Só para o exame de produção

`scripts/checar-producao.mjs` roda na sua máquina, não no Render, e por isso não
lê as variáveis do painel. Ele lê um arquivo `.env.producao` (ignorado pelo git,
como todo `.env.*`), separado do `.env` de trabalho, com uma variável obrigatória
e uma opcional:

| Variável | Para quê | Valor |
|---|---|---|
| `DATABASE_URL` | criar e apagar as contas QA, ler auditoria e migrações | a URI do Aiven, com o `ssl` já ajustado |
| `EXAME_BASE_URL` | opcional: o site examinado | padrão `https://mmm-gud5.onrender.com`; `http://localhost:3000` examina o `pnpm dev` |

`EXAME_BASE_URL` também pode vir do ambiente (`EXAME_BASE_URL=... node ...`), e aí
vence o valor do arquivo. `JWT_SECRET` não é necessário: o exame faz login pela
API com as contas que ele mesmo cria.

## O que continua quebrado depois do deploy

**Upload de arquivo — RESOLVIDO no código, falta configurar.**
`server/storage.ts` foi reescrito sobre a API do S3, que AWS S3, Cloudflare R2,
Backblaze B2 e MinIO falam igualmente: a decisão D6 escolhe o provedor, o
código não muda. Preencher no ambiente:

```
STORAGE_BUCKET=            nome do bucket
STORAGE_ACCESS_KEY_ID=     credencial
STORAGE_SECRET_ACCESS_KEY= credencial
STORAGE_ENDPOINT=          só fora da AWS (ex.: https://<conta>.r2.cloudflarestorage.com)
```

Sem as variáveis, os quatro caminhos que dependem de arquivo (gravação de
reunião, documentos do deal room, documentos do SIVC, geração de imagem) falham
com mensagem que nomeia as variáveis certas.

**A chave do B2 precisa das capacidades `listFiles` e `deleteFiles`.** O bucket
guarda versões (cartão F11): apagar um objeto sem dizer a versão só o esconde, e a
versão antiga continua guardada. Por isso o áudio de reunião (apagado 24 h depois da
transcrição ou da falha, ver `CLAUDE.md`) sai com todas as versões, na varredura, na
exclusão da reunião e na exclusão da conta: o servidor esconde o arquivo, lista as
versões da chave e apaga uma a uma. Sem essas duas capacidades o áudio pode até
deixar de ser servido (o apagamento simples vem antes), mas a versão fica no bucket,
a linha fica em `meeting_recordings` e o erro volta no log a cada passada, de 5 em 5
min; quando a chave for corrigida, a passada seguinte apaga. Nas exclusões é igual: a
reunião ou a conta sai, e a linha da gravação fica, sem reunião, para a varredura.
Repetir o erro não empilha marcadores de exclusão na chave: antes do apagamento
simples o servidor faz um HEAD e, se o arquivo já está escondido (404), não o esconde
de novo. O HEAD usa a mesma permissão de leitura com que o site já serve e reprocessa
o áudio. Se o HEAD estourar o prazo (bucket travado), o servidor desiste na hora, sem
gastar outro prazo no apagamento simples; se ele falhar por outro motivo (403, por
exemplo), o apagamento simples vai assim mesmo. Antes de falar com o bucket, o
servidor tira da chave o `/manus-storage/` que uma linha antiga ainda traga. Os
outros arquivos (fotos e cartões de contato, anexos de contexto, documentos da deal
room e do SIVC) seguem com o apagamento simples. Para eles continua recomendado
trocar a regra de lifecycle do bucket para "Keep only the last version" no painel
do B2 — a cargo do Roberto. A regra também serve de rede de segurança para o áudio:
o B2 apaga a versão que o apagamento simples escondeu, mesmo que a listagem falhe.

**No primeiro deploy com a regra das 24 h**, a poda do boot põe no passado o prazo
das gravações antigas (30 dias contados do envio) enquanto a instância velha ainda
atende. Se a velha abrir uma dessas reuniões nesse intervalo, ela só esconde o áudio
e apaga a linha. Por isso a poda devolve as chaves que venceu, e a passada expurga
pela chave as que já ficaram sem linha (as do boot antes mesmo da poda de dentro,
para uma queda do banco não perdê-las). As que ainda têm linha ficam com o
apagamento de sempre, que pula reunião em `processing`: se a velha aceitar, entre a
leitura e a escrita da poda, o reprocesso de uma reunião que falhou há mais de 24 h,
o áudio fica e a execução termina normalmente. Limite: numa base com mais de 4 mil
gravações vencidas, a passada do boot para no teto de 20 lotes de 200; se a velha
apagar a linha de uma gravação que ficou além do teto, a versão dela fica escondida
no bucket, como no legado abaixo.

**Pendência: áudio escondido antes deste deploy.** Até esta versão, o site apagava o
áudio de reunião com o apagamento simples (`storageDelete`) na exclusão da reunião,
na exclusão da conta e na leitura de uma gravação vencida, e em seguida apagava a
linha de `meeting_recordings`. Toda vez que isso aconteceu desde 01/09, quando o B2
entrou na produção, a versão com a voz das participantes ficou escondida no bucket e
sem linha no banco. A varredura não chega nelas: só trata chaves que têm linha ou que
a poda acabou de vencer, e não há script no repositório para isso. Saem de um de dois
jeitos, a cargo do Roberto ou do Gabriel: a regra de lifecycle "Keep only the last
version" (cartão F11, acima), que faz o B2 apagar as versões escondidas; ou a
limpeza, no painel do B2, dos arquivos escondidos do prefixo `meetings/`, com todas
as versões. Na limpeza à mão, só os escondidos: os visíveis são, em regra, áudio
ainda dentro do prazo, que a varredura apaga quando vencer. Registrado também na D8
de `docs/arquitetura/decisoes-em-aberto.md`.

A rota que serve os arquivos (`/manus-storage/*`) passou a exigir **sessão e
posse**: gravação só para a dona, SIVC só para a dona, deal room para as partes
(ou Ouro+, espelhando a política atual), e prefixo desconhecido é negado. Antes
ela redirecionava qualquer requisição anônima para a URL assinada.

**Gravação de reunião.** `server/routers/meetings.ts` recebe o áudio como base64
de até 15 MB em uma requisição e transcreve com LLM dentro dela. Um request pode
durar minutos. Confirmar o limite de tempo do host antes de contar essa etapa
como pronta.

## Verificar antes de mandar o link

```bash
pnpm install
pnpm check    # tipos
pnpm test     # Vitest
pnpm build    # gera dist/
```

Depois de publicado, rode `node scripts/checar-producao.mjs --env .env.producao`.
Ele cria e apaga as próprias contas QA, então não é preciso criar conta real para
conferir o login. A saída lista cada checagem e termina com o veredito e o código
de saída: 0 só sem falha (ALERTA conta como falha), exceção, limite de requisições
ou erro de limpeza.
