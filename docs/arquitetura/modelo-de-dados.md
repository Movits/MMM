# Modelo de dados

> Este desenho assume Postgres, e o código recuperado do Manus roda em MySQL. Qual
> dos dois cede é a [D6](./decisoes-em-aberto.md), ainda em aberto. Até ela ser
> respondida, o DDL que está no ar é o de `drizzle/`, não o daqui.

Postgres 13 ou superior (o DDL usa `gen_random_uuid()`, nativo a partir do 13; em
versões anteriores, habilitar a extensão `pgcrypto`). DDL simplificado: as regras de
linha (RLS) estão em [privacidade.md](./privacidade.md); os índices mínimos e os
triggers ficam nas seções próprias no fim deste arquivo.

As tabelas estão agrupadas por assunto, para leitura. Na hora de criar de verdade,
a ordem é outra, porque uma tabela não pode referenciar outra que ainda não existe:

```
taxonomia_item → taxonomia_sinonimo → usuario → usuario_papel → documento_versao
→ perfil_membro → perfil_membro_area → contato
→ contexto → contexto_contato → contexto_arquivo
→ reuniao → reuniao_transcricao → reuniao_extracao
→ contato_atributo → consentimento → match
→ oportunidade → oportunidade_evento → oportunidade_parte
→ autorizacao_ouro → compartilhamento → auditoria
```

`contato_atributo` vem depois de `reuniao_extracao` porque referencia essa tabela.

## Visão geral das entidades

```mermaid
erDiagram
    usuario ||--o| perfil_membro : "tem"
    usuario ||--o{ contato : "é dono de"
    usuario ||--o{ contexto : "é dono de"
    usuario ||--o{ consentimento : "concede"
    contato ||--o{ contato_atributo : "possui / procura"
    contato }o--o{ contexto : "foi conhecido em"
    taxonomia_item ||--o{ contato_atributo : "classifica"
    contexto ||--o{ reuniao : "abriga"
    reuniao ||--o| reuniao_transcricao : "gera"
    reuniao ||--o{ reuniao_extracao : "gera"
    reuniao_extracao |o--o| contato : "vira"
    contato_atributo ||--o{ match : "casa com"
    match ||--o| oportunidade : "vira"
    oportunidade ||--o{ oportunidade_evento : "registra"
    oportunidade ||--o{ oportunidade_parte : "envolve"
    documento_versao ||--o{ consentimento : "é aceito em"
```

---

## Identidade e papéis

```sql
CREATE TABLE usuario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  email       text UNIQUE NOT NULL,
  telefone    text,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- Papéis são acumuláveis: alguém pode ser Ouro e Corretor ao mesmo tempo.
-- id surrogate em vez de PK (usuario_id, papel): revogar e conceder de novo
-- gera uma linha nova, preservando o histórico. O índice parcial impede duas
-- concessões ativas do mesmo papel.
CREATE TABLE usuario_papel (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  papel          text NOT NULL CHECK (papel IN ('membro','ouro','corretor','admin')),
  concedido_em   timestamptz NOT NULL DEFAULT now(),
  concedido_por  uuid REFERENCES usuario(id),
  revogado_em    timestamptz
);
CREATE UNIQUE INDEX usuario_papel_ativo
  ON usuario_papel (usuario_id, papel) WHERE revogado_em IS NULL;
```

## Perfil do membro

Ajustes A4 a A8. Separado de `usuario` porque são dados de negócio, não de
autenticação.

```sql
CREATE TABLE perfil_membro (
  usuario_id          uuid PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  natureza            text NOT NULL
                      CHECK (natureza IN ('PF','PJ','MEI','terceiro_setor')),       -- A6
  cnpj                text,                                                          -- A7
  porte               text CHECK (porte IN ('MEI','micro','pequena','media','grande')),
  genero              text CHECK (genero IN ('masculino','feminino','nao_informado')),-- A4
  setor_principal_id  uuid REFERENCES taxonomia_item(id),                            -- A5
  setor_texto_livre   text,                    -- A5: quando não está na lista
  modalidades         text[] NOT NULL DEFAULT '{}'
                      CHECK (modalidades <@ ARRAY['presencial','online']),           -- A8
  atualizado_em       timestamptz NOT NULL DEFAULT now(),

  -- CNPJ obrigatório para toda pessoa jurídica (PJ, MEI e terceiro setor:
  -- associações e fundações também têm CNPJ); proibido para PF.
  CONSTRAINT cnpj_coerente CHECK (
    (natureza IN ('PJ','MEI','terceiro_setor') AND cnpj IS NOT NULL)
    OR (natureza = 'PF' AND cnpj IS NULL)
  )
);

-- A1, A2, A3: mínimo 1, máximo 5 áreas. O máximo é validado por trigger.
-- O mínimo não tem como ser garantido por trigger simples (o perfil nasce com
-- zero áreas antes do primeiro INSERT aqui): usar constraint trigger deferida
-- ou validar na aplicação no fluxo de cadastro.
CREATE TABLE perfil_membro_area (
  usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  area_id     uuid NOT NULL REFERENCES taxonomia_item(id),
  PRIMARY KEY (usuario_id, area_id)
);
```

---

## Taxonomia

```sql
CREATE TABLE taxonomia_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL CHECK (tipo IN ('area','setor','ativo','necessidade')),
  pai_id      uuid REFERENCES taxonomia_item(id),
  nome        text NOT NULL,
  slug        text NOT NULL,          -- normalizado, sem acento: 'terras-raras'
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, slug)
);

-- Faz 'terras raras', 'terra rara' e 'rare earth' caírem no mesmo item.
-- UNIQUE global no termo: um mesmo sinônimo não pode apontar para dois itens,
-- senão a resolução fica ambígua.
CREATE TABLE taxonomia_sinonimo (
  item_id  uuid NOT NULL REFERENCES taxonomia_item(id) ON DELETE CASCADE,
  termo    text NOT NULL UNIQUE,
  PRIMARY KEY (item_id, termo)
);
```

> **Nota de modelagem.** `ativo` em vez de `DELETE`: desativar um item da lista não
> pode apagar o atributo de ninguém. Contatos antigos continuam apontando para o item
> desativado, ele só deixa de aparecer em cadastros novos.

---

## Contatos e atributos estratégicos

```sql
CREATE TABLE contato (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_usuario_id      uuid NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  -- Quando o contato também é membro do MMM, aponta para ele.
  -- O perfil da própria usuária é um contato cujo dono e vinculado são ela mesma.
  usuario_vinculado_id uuid REFERENCES usuario(id),

  nome           text NOT NULL,
  empresa        text,
  cargo          text,
  pais           text,
  cidade         text,
  telefone       text,
  whatsapp       text,
  email          text,
  linkedin       text,
  instagram      text,
  observacoes    text,
  foto_url       text,
  cartao_url     text,          -- cartão de visita

  nivel_visibilidade text NOT NULL DEFAULT 'privado'
    CHECK (nivel_visibilidade IN ('privado','ouro','publico')),

  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- Etapa 2 e ajuste A9: as duas pontas na MESMA tabela, distinguidas por direcao.
-- Torna a consulta de Match simétrica e atende o A9 sem tabela adicional.
CREATE TABLE contato_atributo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id     uuid NOT NULL REFERENCES contato(id) ON DELETE RESTRICT,
  direcao        text NOT NULL CHECK (direcao IN ('possui','procura')),

  item_id        uuid REFERENCES taxonomia_item(id),
  texto_livre    text,          -- fora do cruzamento; alimenta revisão da lista

  origem         text NOT NULL DEFAULT 'manual'
                 CHECK (origem IN ('manual','reuniao','ia')),
  origem_id      uuid REFERENCES reuniao_extracao(id),  -- quando origem <> manual
  confianca      numeric CHECK (confianca BETWEEN 0 AND 1),
  criado_em      timestamptz NOT NULL DEFAULT now(),

  -- Um atributo precisa ser da lista OU texto livre. Nunca vazio.
  CONSTRAINT tem_conteudo CHECK (item_id IS NOT NULL OR texto_livre IS NOT NULL)
);

-- Sem isto, duas linhas idênticas geram matches duplicados.
CREATE UNIQUE INDEX contato_atributo_unico
  ON contato_atributo (contato_id, direcao, item_id) WHERE item_id IS NOT NULL;
```

> **Por que `direcao` em vez de duas tabelas.** Com uma tabela só, o Match é um
> `JOIN` da tabela nela mesma: `a.direcao='possui' AND b.direcao='procura' AND
> a.item_id = b.item_id`. Com duas tabelas, o mesmo cruzamento vira consultas
> paralelas que precisam ficar em sincronia.

> **Por que `ON DELETE RESTRICT` nesta cadeia.** `contato`, `contato_atributo` e
> `match` carregam a trilha que sustenta oportunidades e auditoria. Exclusão em
> cascata apagaria esse histórico (e falharia no meio quando encontrasse uma
> oportunidade). Exclusão de conta (LGPD) é uma rotina própria: anonimizar os dados
> pessoais e desativar o usuário, nunca `DELETE` físico da cadeia.

---

## Contexto (etapa 5)

```sql
CREATE TABLE contexto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  tipo             text NOT NULL,   -- congresso, missao, embaixada, evento_mmm...
  nome             text NOT NULL,
  data             date,
  cidade           text,            -- responde "quem conheci em Santiago?"
  pais             text,
  observacoes      text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contexto_contato (
  contexto_id  uuid NOT NULL REFERENCES contexto(id) ON DELETE CASCADE,
  contato_id   uuid NOT NULL REFERENCES contato(id)  ON DELETE CASCADE,
  PRIMARY KEY (contexto_id, contato_id)
);

CREATE TABLE contexto_arquivo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contexto_id  uuid NOT NULL REFERENCES contexto(id) ON DELETE CASCADE,
  url          text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('foto','documento')),
  criado_em    timestamptz NOT NULL DEFAULT now()
);
```

---

## Reuniões (etapa 3)

```sql
CREATE TABLE reuniao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  contexto_id      uuid REFERENCES contexto(id),
  titulo           text,
  iniciada_em      timestamptz NOT NULL DEFAULT now(),
  encerrada_em     timestamptz,
  audio_url        text,
  status           text NOT NULL DEFAULT 'gravando'
                   CHECK (status IN ('gravando','processando','transcrita',
                                     'extraindo','em_revisao','revisada','erro')),

  -- Gravar terceiros exige aviso. Registrar QUE o aviso foi dado e em qual versão.
  consentimento_documento_id uuid REFERENCES documento_versao(id),
  consentimento_em           timestamptz
);

CREATE TABLE reuniao_transcricao (
  reuniao_id  uuid PRIMARY KEY REFERENCES reuniao(id) ON DELETE CASCADE,
  texto       text NOT NULL,
  idioma      text NOT NULL DEFAULT 'pt-BR',
  provedor    text,
  confianca   numeric CHECK (confianca BETWEEN 0 AND 1),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reuniao_extracao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_id        uuid NOT NULL REFERENCES reuniao(id) ON DELETE CASCADE,
  tipo              text NOT NULL CHECK (tipo IN
                      ('pessoa','empresa','telefone','email','oportunidade','produto','setor')),
  valor             text NOT NULL,

  -- Rastreabilidade obrigatória: de onde na transcrição isso saiu.
  trecho_origem     text NOT NULL,
  offset_inicio     int,
  offset_fim        int,
  confianca         numeric NOT NULL CHECK (confianca BETWEEN 0 AND 1),

  status            text NOT NULL DEFAULT 'sugerido'
                    CHECK (status IN ('sugerido','aceito','rejeitado')),
  contato_gerado_id uuid REFERENCES contato(id),
  revisado_em       timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now()
);
```

> **`trecho_origem` é `NOT NULL` de propósito.** Se a IA não aponta de onde na
> transcrição a informação saiu, não sugere.

---

## Consentimento e documentos (etapas 11, 13 e ajuste A11)

```sql
CREATE TABLE documento_versao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         text NOT NULL CHECK (tipo IN
                 ('termo_smart_match','acordo_intermediacao','contrato_comissao','termo_gravacao')),
  versao       int  NOT NULL,
  texto        text NOT NULL,
  publicado_em timestamptz NOT NULL DEFAULT now(),
  vigente      boolean NOT NULL DEFAULT false,
  UNIQUE (tipo, versao)
);

-- No máximo uma versão vigente por tipo de documento.
CREATE UNIQUE INDEX documento_vigente_unico
  ON documento_versao (tipo) WHERE vigente;

CREATE TABLE consentimento (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id           uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  documento_versao_id  uuid NOT NULL REFERENCES documento_versao(id),
  concedido_em         timestamptz NOT NULL DEFAULT now(),
  revogado_em          timestamptz,          -- revogar NUNCA apaga a linha
  ip                   inet,
  user_agent           text
);
```

> Versionar o documento é o que transforma consentimento em prova: "fulano aceitou"
> sem versão não diz o que ele aceitou. Revogação é uma data preenchida, nunca um
> `DELETE`. Se o consentimento dado numa versão antiga do termo continua valendo
> quando sai uma versão nova é decisão em aberto (ver decisoes-em-aberto.md).
>
> Isso destrava o A11 e a etapa 13 antes de o texto jurídico ficar pronto: a
> mecânica se constrói agora, o texto entra como uma linha em `documento_versao`.

---

## Match e oportunidades (etapas 7, 12, 13)

```sql
CREATE TABLE match (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atributo_possui_id  uuid NOT NULL REFERENCES contato_atributo(id) ON DELETE RESTRICT,
  atributo_procura_id uuid NOT NULL REFERENCES contato_atributo(id) ON DELETE RESTRICT,
  item_id           uuid NOT NULL REFERENCES taxonomia_item(id),  -- o que casou
  score             numeric NOT NULL,
  status            text NOT NULL DEFAULT 'sugerido'
                    CHECK (status IN ('sugerido','descartado','virou_oportunidade')),
  gerado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atributo_possui_id, atributo_procura_id)
);
```

> **Integridade do match.** `CHECK` não faz subconsulta, então nada aqui garante que
> `atributo_possui_id` aponte para uma linha com `direcao='possui'` nem que os dois
> atributos e `item_id` casem entre si. Duas defesas, usar pelo menos uma: um
> trigger de validação no INSERT, ou `REVOKE INSERT` nesta tabela para a role da
> aplicação, deixando a escrita só para a role do motor de Match (ver
> privacidade.md).

```sql
CREATE TABLE oportunidade (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES match(id),
  corretor_usuario_id uuid REFERENCES usuario(id),
  status              text NOT NULL DEFAULT 'em_analise' CHECK (status IN (
                        'em_analise','primeiro_contato','reuniao_agendada',
                        'negociacao','proposta_apresentada','concluido','encerrado')),
  valor_estimado      numeric,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  encerrado_em        timestamptz
);

-- Cada mudança vira um evento. É daqui que saem os cinco indicadores da etapa 12.
CREATE TABLE oportunidade_evento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidade_id  uuid NOT NULL REFERENCES oportunidade(id) ON DELETE CASCADE,
  de_status        text,
  para_status      text NOT NULL,
  ator_usuario_id  uuid REFERENCES usuario(id),
  observacao       text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

-- Etapa 13: sem aceite, os dados completos não saem do servidor.
CREATE TABLE oportunidade_parte (
  oportunidade_id      uuid NOT NULL REFERENCES oportunidade(id) ON DELETE CASCADE,
  usuario_id           uuid NOT NULL REFERENCES usuario(id),
  documento_versao_id  uuid REFERENCES documento_versao(id),
  aceito_em            timestamptz,
  PRIMARY KEY (oportunidade_id, usuario_id)
);
```

> **Por que `oportunidade_evento` existe.** A etapa 12 pede tempo médio de
> negociação e taxa de conversão. Se `oportunidade.status` for só sobrescrito, a
> informação de quando mudou se perde e essas métricas ficam incalculáveis. Com
> eventos, os cinco indicadores saem de uma consulta.

## Auditoria

```sql
CREATE TABLE auditoria (
  id           bigserial PRIMARY KEY,
  ator_usuario_id uuid REFERENCES usuario(id),
  acao         text NOT NULL,       -- criou, alterou, visualizou, exportou
  entidade     text NOT NULL,
  entidade_id  uuid,
  diff         jsonb,
  ip           inet,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
```

Append-only por trigger: sem `UPDATE`, sem `DELETE`. É o registro que sustenta a
governança da etapa 13 e a evidência de contorno do ajuste A13.

## Índices mínimos

Além dos índices únicos já declarados acima:

```sql
CREATE INDEX ON contato_atributo (item_id, direcao);          -- consulta de Match
CREATE INDEX ON contato (dono_usuario_id);                    -- políticas RLS
CREATE INDEX ON compartilhamento (usuario_id);                -- políticas RLS
CREATE INDEX ON oportunidade_evento (oportunidade_id);        -- indicadores
CREATE INDEX ON auditoria (entidade, entidade_id);            -- consulta de trilha
```

---

## A consulta de Match

O motor da etapa 7:

```sql
SELECT
  cp.contato_id       AS contato_possui,
  cs.contato_id       AS contato_procura,
  ti.nome             AS casou_em
FROM contato_atributo cp
JOIN contato_atributo cs
  ON  cs.item_id  = cp.item_id      -- mesma lista controlada dos dois lados
  AND cs.direcao  = 'procura'
  AND cp.direcao  = 'possui'
  AND cs.contato_id <> cp.contato_id
JOIN taxonomia_item ti ON ti.id = cp.item_id
WHERE cp.item_id IS NOT NULL;       -- texto livre não entra no cruzamento
```

`ti.nome` já é a explicação do match ("casaram em: terras raras") que a etapa 7 pede
que seja exibida; sai da própria consulta.

Esta é a forma didática. A versão completa, com os filtros de permissão (etapa 10) e
de consentimento (etapa 11), está em
[privacidade.md](./privacidade.md#a-consulta-de-match-integrada); os filtros não são
opcionais, porque sem eles o Match cruza dado que o dono não liberou.
