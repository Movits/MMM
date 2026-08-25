# MMM (Mulheres que Movem o Mundo)

CRM inteligente de networking: cada usuária mantém sua base privada de
relacionamentos estratégicos, e a IA cruza **o que cada contato possui** com **o que
cada contato procura** para gerar oportunidades de negócio.

## Estado do repositório

Vazio de código, por enquanto. O projeto foi construído dentro do Manus e ainda não
saiu de lá. Recuperar essa cópia é a tarefa mais urgente do time.

O que já existe aqui é o desenho do sistema, escrito para não depender da
plataforma onde o código nasceu.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura/](./docs/arquitetura/) | Visão geral, camadas e princípios |
| [docs/arquitetura/modelo-de-dados.md](./docs/arquitetura/modelo-de-dados.md) | Entidades e DDL |
| [docs/arquitetura/fluxos.md](./docs/arquitetura/fluxos.md) | Assistente de Reuniões e Smart Match |
| [docs/arquitetura/privacidade.md](./docs/arquitetura/privacidade.md) | Os três níveis de acesso |
| [docs/arquitetura/decisoes-em-aberto.md](./docs/arquitetura/decisoes-em-aberto.md) | O que trava implementação |

O histórico de versões da documentação está no [CHANGELOG](./CHANGELOG.md).

## Gestão do projeto

O escopo (as 13 seções), quem está com cada item, status e prazos ficam no Notion,
não aqui. Este repositório é para código e desenho técnico.

## Antes de commitar

Nunca suba `.env`, chave de API, senha de banco ou dado pessoal de usuário ou
contato. O `.gitignore` cobre os casos comuns; confira o diff antes de cada commit.
