# Vitrine pública

Página estática de apresentação do MMM, publicada no GitHub Pages.

Não é a aplicação. O Pages entrega apenas arquivos prontos ao navegador — não roda
servidor nem banco — e login, matches por IA, cofre e upload dependem dos dois. Esta
página existe para o projeto ter um endereço público enquanto a hospedagem de verdade
não é definida (ver **D6** em `docs/arquitetura/decisoes-em-aberto.md`).

## Ligar o Pages — precisa de acesso de administrador

Só uma vez, e são dois cliques:

1. **Settings** → **Pages**
2. Em **Build and deployment** → **Source**, escolher **GitHub Actions**

Pronto. O fluxo em `.github/workflows/pages.yml` publica sozinho a cada mudança em
`vitrine/`, e o site fica em **https://movits.github.io/MMM/**.

Para publicar sem esperar uma alteração: aba **Actions** → *Publicar vitrine no
GitHub Pages* → **Run workflow**.

## Editar

`index.html` é um arquivo só, com o CSS embutido e sem etapa de build — dá para abrir
direto no navegador para conferir. A ilustração `hero-women.svg` é a mesma da home da
aplicação.

Quando a hospedagem estiver de pé, trocar a nota do fim da página por um botão
"Entrar na plataforma" apontando para o endereço real.
