# Colocar o MMM no ar

## Por que não dá para usar o GitHub Pages

O GitHub Pages serve **arquivos estáticos**. Ele entrega HTML, CSS, JavaScript
e imagens, e não executa nada do lado do servidor.

O MMM não é um site estático. É um processo Node único que faz as duas coisas
ao mesmo tempo:

| O que | Onde |
|---|---|
| Front-end compilado | `dist/public`, servido pelo Express |
| API tRPC | `/api/trpc`, no mesmo processo (`server/_core/index.ts:216`) |

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
   servidor respeita em produção (`server/_core/index.ts:230`).

5. **Variáveis**, na tabela da próxima seção. A `DATABASE_URL` é a mesma do
   passo 2.

6. Depois do primeiro deploy, copiar o endereço `*.onrender.com` e voltar em
   *Environment* para apontar `FRONTEND_URL` para ele.

**O custo do plano gratuito:** o serviço dorme depois de um tempo sem acesso, e
a primeira visita seguinte demora de 30 a 60 segundos. Vale avisar quem for
testar, senão parece que está fora do ar.

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

A recusa é proposital, em `server/_core/env.ts:20`. A versão do Manus caía para
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

`PORT` o Railway injeta sozinho. Não defina na mão.

## O que continua quebrado depois do deploy

**Upload de arquivo.** `server/storage.ts` falava com o Forge do Manus, que saiu
do ar. Isso derruba quatro caminhos: gravação de reunião, documentos do deal
room, documentos do SIVC e geração de imagem. Precisa ser reescrito para S3 ou
Cloudflare R2. O `@aws-sdk/client-s3` já está instalado e sem uso.

Enquanto isso não for feito, esses fluxos falham com mensagem própria em vez de
erro obscuro, o que é o comportamento correto mas continua sendo falha.

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

Depois de publicado, abrir o domínio, criar uma conta e fazer login. Se o login
funciona, o banco, o JWT e a API estão de pé.
