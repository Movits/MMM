<!-- Título da PR: "tipo: o que muda", em português (fix, feat, docs, test ou chore).
     Ex.: "fix: o cartão de conexão espremia o texto no celular".
     Estes comentários não aparecem na PR publicada. -->

## O que muda

<!-- Em poucas frases, o que passa a ser diferente para quem usa a plataforma ou para o time. -->

## Por quê

- Cartão do Notion (link):
- De onde veio a decisão (cartão do Notion, grupo do time ou pedido de quem; quem decidiu e quando, sem copiar o conteúdo do grupo):

## Como verifiquei

<!-- Marque só o que rodou de fato; linha que não se aplica, apague. -->

- [ ] `pnpm check` · `pnpm test` (N passaram, N pulados) · `pnpm build`
- [ ] Texto de tela: `node scripts/conferir-locales.mjs`
- [ ] Scripts ou hooks `.mjs`: `node --check <arquivo>`
- [ ] Schema: migração gerada por `pnpm db:generate` (rodado de novo, não cria arquivo) e aplicada em banco local
- [ ] Telas abertas com `pnpm dev`, cada uma com o nível da conta (bronze, prata, ouro, admin):
- [ ] Console do navegador sem erro nessas telas
- O que NÃO verifiquei e por quê (ex.: "telas não abertas: sessão na nuvem, sem MySQL"):

## Como validar (para quem revisa)

<!-- Passo a passo para outra pessoa conferir: o que abrir, com que nível de conta, o que deve acontecer. -->

> Quem fez não valida. Mesclar segue a regra do README (hoje: quem revisou e aprovou mescla).

## Riscos e o que fica de fora

- Muda comportamento do produto? (não / sim: o quê)
- Migração nova? Variável nova no Render (só o nome, nunca o valor)? Efeito em produção ao mesclar (todo merge na `main` vira deploy, salvo o que os Build Filters do Render ignoram)?
- O que fica de fora, e onde ficou anotado:
- [ ] Sem segredo ou dado pessoal no diff nem nesta descrição (o repositório é público) · sem `sql.raw` · nada rodado contra produção

## Conferência

<!-- O mesmo que foi para o carimbo (`node .claude/hooks/carimbo.mjs --status`). Nunca diga que leu o que não abriu. -->

- `origin/main` ao começar (sha):
- PRs vistas na área:
- Cartão lido no Notion (link, se não for o de "Por quê"):
- Grupo "Projetos IA": lido por mim em (DD/MM) ou informado por (quem) em (DD/MM): (resumo). Só o que toca esta PR, sem nome de usuária, telefone ou print:
