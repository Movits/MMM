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

## Subir no Railway

O repositório já tem `Dockerfile`, então o Railway não precisa adivinhar nada.

1. **Criar a conta** em railway.app e conectar o GitHub. Pede cartão, mesmo no
   plano Hobby.
2. **New Project → Deploy from GitHub repo → `Movits/MMM`.** Ele detecta o
   `Dockerfile` sozinho.
3. **Add MySQL** no mesmo projeto. O Railway cria a variável `DATABASE_URL` e
   já a injeta no serviço do app.
4. **Preencher as variáveis** da tabela abaixo em Variables.
5. **Rodar as migrações uma vez**, da sua máquina, apontando para o banco do
   Railway:
   ```bash
   DATABASE_URL="<a URL do MySQL do Railway>" pnpm db:push
   ```
   Isso não recria tudo: 11 tabelas do banco original não têm definição no
   Drizzle, entre elas o módulo SIVC inteiro. Está registrado na D6 e continua
   em aberto.
6. **Generate Domain** em Settings → Networking. Sai um endereço
   `*.up.railway.app`. Esse é o link da Glenda.
7. **Voltar em Variables** e apontar `FRONTEND_URL` para esse domínio, senão os
   links dos e-mails transacionais saem quebrados.

## Variáveis de ambiente

### Sem estas o servidor não inicia

| Variável | De onde vem |
|---|---|
| `DATABASE_URL` | criada pelo Railway ao adicionar o MySQL |
| `JWT_SECRET` | você gera: `openssl rand -base64 48` |
| `VAULT_ENCRYPTION_KEY` | você gera: `openssl rand -base64 48` |

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
