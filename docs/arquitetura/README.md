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

### 2b. Parecença de palavra não é negócio — direção oposta é

"Exportar vinho" e "importar vinho" são quase o mesmo texto. Qualquer critério que
meça semelhança entre as duas põe esse par no topo — e o par oposto, que é onde
existe negócio, no mesmo balaio de duas exportadoras, que são concorrentes e nunca
devem ser apresentadas uma à outra.

**A direção nunca sai da semelhança do texto.** Ela vem do campo — `contato_atributo`
possui contra procura — e, quando a pessoa escreve um verbo, dela. Os dois podem se
contradizer: quem digita "procuro exportar vinho" está oferecendo, ainda que o texto
esteja no campo de procura, porque é assim que se fala. Nesse conflito a palavra
manda, e a regra tem duas metades que só funcionam juntas:

| ponta A | ponta B | resultado |
|---|---|---|
| possui *exportar* vinho | procura *exportar* vinho | **barrado** — concorrentes |
| possui *exportar* vinho | procura *importar* vinho | **100** — mesmo objeto, direções opostas |
| possui vinho | procura *importar* vinho | 100 — uma ponta neutra, comportamento de sempre |

A implementação está em [`shared/direcao-do-termo.ts`](../../shared/direcao-do-termo.ts)
e entra em `scoreMatch` **antes de qualquer outro critério**: nenhum outro pode
reapresentar quem foi barrado. As restrições da lista de verbos (só verbo, só na
cabeça do termo, só quando inequívoco) estão documentadas no próprio arquivo, e
existem porque a versão frouxa quebra matches legítimos que já funcionam.

É também o motivo de o critério semântico continuar desligado
(`server/match-service.ts`): ele decide justamente por parecença, que é o que
confunde "exportar" com "importar".

### 2c. Serviço só casa com necessidade declarada

Quem registra "Advocacia tributária" em *o que tenho* casava com meia rede: quase
toda empresa "poderia precisar" de um tributarista, e o motor tratava essa
necessidade presumida como se fosse declarada. A regra (pedido de 12/09/2026):
antes de qualquer cruzamento, cada item de *o que tenho* é classificado
(`shared/tipo-da-oferta.ts`) em serviço, produto, ativo, oportunidade,
investimento/capital, conexão/network, tecnologia, imóvel/infraestrutura ou outros —
e o item do tipo **serviço** só casa com uma necessidade que alguém DECLAROU em
*o que preciso*. A necessidade não precisa usar as mesmas palavras (equivalência
semântica é permitida), mas precisa existir.

| oferta | outro lado | resultado |
|---|---|---|
| serviços jurídicos tributários | procura "assessoria tributária para revisar a carga fiscal" | **match nos motores por IA** (`routers/matching.ts`), com a citação conferida; nos motores determinísticos (perfis e privado) só casa se a necessidade NOMEIA o serviço — mesmo slug/objeto/núcleo, a opção fixa "Consultoria" ou a necessidade genérica "Consultoria" diante de "Consultoria jurídica" |
| serviços jurídicos tributários | indústria farmacêutica que procura "distribuidor para a África" | **sem match** em todos — toda indústria tem impostos, mas ninguém declarou precisar |
| consultoria em internacionalização | empresa com operações internacionais que procura "investidor para a fábrica" | **sem match** em todos — operar fora não é procurar consultoria |

Não contam como necessidade: setor ou atividade econômica, porte, localização, cargo,
problemas típicos do segmento, obrigações legais, serviços "que seriam úteis",
necessidades prováveis. Essas informações só podem subir a nota de um match que já
passou pelo portão; nunca criá-lo. A restrição vale para serviço e só para serviço:
produtos, ativos, investimento, conexões etc. continuam casando como antes.

Onde ela mora: no motor privado (`scoreMatch`), a categoria em comum deixa de valer
para serviço — sobra tag, objeto e núcleo, que são exatamente "alguém nomeou o
serviço"; no motor de perfis (`server/matching.ts`), o par sustentado só por serviço
sem demanda expressa dá zero, não é gravado, e a leitura da lista esconde a linha
gravada antes da regra (sem apagá-la: a dispensa da dona sobrevive); nos dois prompts
por LLM de `routers/matching.ts`, o modelo classifica o item, cita o trecho literal do
título, das tags ou da descrição da oportunidade que declara a necessidade e
`server/portao-da-demanda-expressa.ts` confere a citação nesse texto (no máximo uma
palavra ausente) antes de exibir — e usa o classificador como piso: perfil que só tem
serviço e nada em "preciso" exige citação seja qual for o tipo que o modelo escreveu.
Prompt é pedido, a conferência é a garantia.

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
