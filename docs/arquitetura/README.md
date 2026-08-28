# Arquitetura

> Documento de arquitetura, escrito em 25/08/2026 a partir das 13 seções de escopo
> enviadas pela Glenda em 06/08/2026 e das notas da reunião de 05/08/2026.

## Para que serve este documento

O código do MMM foi construído inteiramente dentro do Manus e, até 25/08/2026, nunca
saiu de lá. Este documento existe para que o desenho do sistema não dependa disso:

- **Se o código voltar**, ele é o checklist para revisar o que existe.
- **Se não voltar**, ele é a planta para reconstruir.

Não escolhe stack: o modelo de dados vale para qualquer coisa em cima de Postgres, e
os fluxos valem para qualquer linguagem.

## Índice

| Documento | Conteúdo |
|---|---|
| [modelo-de-dados.md](./modelo-de-dados.md) | As entidades, o DDL e as notas de modelagem |
| [fluxos.md](./fluxos.md) | Assistente de Reuniões, Smart Match e o funil do corretor |
| [privacidade.md](./privacidade.md) | Os três níveis de acesso como regra de banco, não de tela |
| [decisoes-em-aberto.md](./decisoes-em-aberto.md) | O que trava implementação e precisa de decisão |

---

## Os três princípios

### 1. Privacidade é estrutura, não tela

O escopo define três níveis de acesso (privado, Usuário Ouro, público no
ecossistema) e é explícito sobre o terceiro:

> Público no ecossistema MMM: informações disponíveis para todos os membros da
> plataforma; nesta hipótese não pode aparecer os dados pessoais do contato, só as
> oportunidades.

Se o servidor devolve o dado e a tela apenas não o exibe, o dado está exposto. Cada
nível precisa ser uma regra no banco e uma consulta própria. O desenho completo está
em [privacidade.md](./privacidade.md).

### 2. O Match só funciona sobre lista controlada

O exemplo do escopo: contato A possui mina de terras raras, contato B procura
fornecedor de terras raras. Isso só casa automaticamente se as duas pontas apontarem
para o mesmo item de uma lista compartilhada.

Com texto livre, `terras raras`, `terra rara` e `rare earth` são três coisas
diferentes e o cruzamento não encontra nada. Por isso existe a tabela
`taxonomia_item` e por isso `contato_atributo` referencia ela.

O texto livre continua existindo (ajuste A5), mas fica num campo separado, fora do
cruzamento, e alimenta a revisão periódica da lista.

### 3. Nada que a IA extrair entra sozinho

A etapa 3 manda a IA ler o áudio de uma reunião e sugerir contatos. Toda informação
extraída carrega a origem (o trecho da transcrição, a posição e a confiança), e nada
vira contato sem o usuário confirmar.

Modelos de linguagem geram texto plausível, inclusive dados que ninguém falou. A
origem permite conferir; a confirmação impede que o erro vire cadastro.

---

## Camadas

```
┌───────────────────────────────────────────────────────────┐
│  INTERFACE                                                │
│  App da usuária (celular)      │   Painel do corretor     │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│  APLICAÇÃO                                                │
│  Cadastro · Rede · Reuniões · Busca · Oportunidades       │
│  Toda regra de permissão é verificada AQUI e no banco.    │
└───────────────────────────────────────────────────────────┘
                            │
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Extração    │  Busca em    │  Motor de    │  Funil de    │
│  de reunião  │  linguagem   │  Match       │  oportuni-   │
│  (etapa 3)   │  natural     │  (etapa 7)   │  dades       │
│              │  (etapas 6,9)│              │  (etapa 12)  │
└──────────────┴──────────────┴──────────────┴──────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│  DADOS                                                    │
│  Postgres com regras de linha por usuário                 │
│  Storage cifrado (fotos, cartões, áudios)                 │
│  Taxonomia compartilhada · Log de auditoria append-only   │
└───────────────────────────────────────────────────────────┘
```

## Onde cada etapa encosta no modelo

| Etapa | Onde vive |
|---|---|
| 1. Base Particular de Contatos | `contato` |
| 2. Perfil Estratégico | `contato_atributo` + `taxonomia_item` |
| 3. Assistente de Reuniões | `reuniao`, `reuniao_transcricao`, `reuniao_extracao` |
| 4. Complementação Inteligente | campos vazios de `contato` + `contato_atributo` |
| 5. Organização por Contexto | `contexto`, `contexto_contato`, `contexto_arquivo` |
| 6. Memória Inteligente | consulta sobre `contato` + `contexto` + `contato_atributo` |
| 7. Match Inteligente | `match` sobre `contato_atributo` |
| 8. Privado + Coletivo | `contato.nivel_visibilidade` |
| 9. Pesquisa Inteligente | mesma base da etapa 6 |
| 10. Níveis de Acesso (Ouro) | `autorizacao_ouro`, `compartilhamento`, regras de linha |
| 11. Autorização Smart Match | `documento_versao`, `consentimento` |
| 12. Corretor de Negócios | `oportunidade`, `oportunidade_evento` |
| 13. Acordo de Intermediação | `documento_versao`, `oportunidade_parte` |

E os ajustes da reunião de 05/08:

| Ajuste | Onde vive |
|---|---|
| A1–A3 (áreas, mín. 1 máx. 5) | `perfil_membro_area` + `taxonomia_item` |
| A4 (gênero) | `perfil_membro.genero` |
| A5 (setor com texto livre) | `perfil_membro.setor_texto_livre` |
| A6–A7 (natureza, porte, CNPJ) | `perfil_membro` |
| A8 (presencial) | `perfil_membro.modalidades` |
| A9 (replicar bloco na página do que busca) | `contato_atributo.direcao` |
| A11 (contrato de comissão) | `documento_versao` + `consentimento` |
| A12 (destaque de produto) | sem entidade definida; o desenho depende da decisão D4 |
| A13 (bloquear contato direto) | `oportunidade_parte` + auditoria |
| A14 (dinheiro pela plataforma) | fora deste documento; ver decisoes-em-aberto.md |
