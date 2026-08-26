# Especificação Técnica — Etapa 2
## Perfil Estratégico do Contato: Ativos (Oferta) e Necessidades (Demanda)
### Módulo CRM Inteligente · MMM (Mulheres que Movem o Mundo)

> **Versão:** 1.0 · **Data:** Agosto 2026 · **Autor:** Manus AI para Projeto MMM
> **Stack:** Node.js / NestJS · PostgreSQL 15+ (RDS) · React Native (Expo SDK 51)
> **Escopo:** MVP até 2.000 usuárias · ~300k contatos · 10k tags em 12 meses

---

## 1. Contexto e Decisões de Negócio

Este documento especifica a **Etapa 2** do módulo CRM Inteligente, que adiciona ao perfil de cada contato estratégico dois eixos semânticos: o que o contato **possui** (ativos/oferta) e o que o contato **procura** (necessidades/demanda). Cada eixo é representado por tags extraídas de um dicionário global curado, vinculadas de forma privada por usuária.

As decisões de negócio já consolidadas que orientam esta especificação são as seguintes:

| Dimensão | Decisão |
|---|---|
| **Escopo de Tags** | Dicionário global compartilhado; vínculo tag-contato privado por `user_id` |
| **Curadoria** | Híbrida: `unverified` → `verified` após 3 usuárias distintas; admin pode rejeitar/mesclar |
| **Deduplicação** | `pg_trgm` + Levenshtein: ≥ 0.92 → merge automático; 0.75–0.92 → fila de revisão; < 0.75 → tag distinta |
| **Privacidade** | Privado absoluto por padrão; campo `visibility` (`private`/`network`/`public`) preparado para Etapa 8 |
| **Match** | Schema preparado (`ai_match_suggestions`), não implementado nesta etapa |

---

## 2. Modelo de Dados — Schema SQL (PostgreSQL 15+)

### 2.1 Decisão de i18n: JSONB inline vs. tabela separada

Optou-se por **JSONB inline** (`labels JSONB`) na tabela `tags_dictionary`. A justificativa é pragmática: no MVP com 3 idiomas (pt, es, en) e até 10k tags, o overhead de um JOIN adicional em toda busca de auto-completar supera o custo de armazenar o JSONB inline. A estrutura `{"pt": "Fundo de Investimento", "es": "Fondo de Inversión", "en": "Investment Fund"}` é indexável via `GIN` e permite consultas eficientes por idioma. A migração para tabela separada (`tag_translations`) é não-destrutiva quando necessário: basta criar a tabela, migrar os dados e remover a coluna `labels`.

### 2.2 Schema Completo

```sql
-- ============================================================
-- EXTENSÕES NECESSÁRIAS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- CREATE EXTENSION IF NOT EXISTS "vector"; -- ativar quando pgvector for necessário (ver §5.4)

-- ============================================================
-- TAG_CATEGORIES — Categorias fixas do sistema
-- ============================================================
CREATE TABLE tag_categories (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(80) NOT NULL UNIQUE,
  slug        VARCHAR(80) NOT NULL UNIQUE,  -- ex: "financeiro", "tecnologia"
  color_token VARCHAR(30) NOT NULL,          -- ex: "#F59E0B" — token de design
  icon_name   VARCHAR(50),                   -- nome do ícone no design system
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tag_categories IS
  'Categorias fixas do sistema. Apenas admins podem criar/alterar. '
  'Exemplos: Financeiro, Industrial, Tecnologia, Agronegócio, Energia, Saúde, Logística, Governo/Regulatório.';

-- Seed das categorias iniciais (referência — executar via migration seed)
-- INSERT INTO tag_categories (name, slug, color_token, sort_order) VALUES
--   ('Financeiro',          'financeiro',    '#F59E0B', 1),
--   ('Tecnologia',          'tecnologia',    '#3B82F6', 2),
--   ('Agronegócio',         'agronegocio',   '#22C55E', 3),
--   ('Industrial',          'industrial',    '#6B7280', 4),
--   ('Energia',             'energia',       '#EF4444', 5),
--   ('Saúde',               'saude',         '#EC4899', 6),
--   ('Logística',           'logistica',     '#8B5CF6', 7),
--   ('Governo/Regulatório', 'governo',       '#0EA5E9', 8);

-- ============================================================
-- TAGS_DICTIONARY — Dicionário global de tags
-- ============================================================
CREATE TABLE tags_dictionary (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     UUID        NOT NULL REFERENCES tag_categories(id)
                              ON DELETE RESTRICT ON UPDATE CASCADE,
  name            VARCHAR(120) NOT NULL,
  slug            VARCHAR(120) NOT NULL UNIQUE,  -- normalizado: lowercase, sem acentos
  labels          JSONB       NOT NULL DEFAULT '{}',
  -- ex: {"pt": "Fundo de Investimento", "es": "Fondo de Inversión", "en": "Investment Fund"}
  status          VARCHAR(20) NOT NULL DEFAULT 'unverified'
                              CHECK (status IN ('unverified', 'verified', 'rejected', 'merged')),
  created_by      UUID        NOT NULL,           -- FK → users.id (quem criou)
  usage_count     INT         NOT NULL DEFAULT 0, -- atualizado via trigger
  distinct_users  INT         NOT NULL DEFAULT 0, -- usuárias distintas que usam a tag
  -- Preparação para pgvector (Etapa 7):
  -- embedding     VECTOR(1536),                  -- descomentado quando pgvector for ativado
  merged_into_id  UUID        REFERENCES tags_dictionary(id)
                              ON DELETE SET NULL ON UPDATE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN tags_dictionary.slug IS
  'Versão normalizada do nome: lowercase, sem acentos, hífens no lugar de espaços. '
  'Usado para deduplicação e busca.';
COMMENT ON COLUMN tags_dictionary.distinct_users IS
  'Número de user_id distintos que vincularam esta tag a pelo menos um contato. '
  'Quando atinge 3, trigger promove status para verified.';

-- ============================================================
-- TAG_ALIASES — Histórico de merges e sinônimos
-- ============================================================
CREATE TABLE tag_aliases (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias_tag_id    UUID        NOT NULL REFERENCES tags_dictionary(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  canonical_tag_id UUID       NOT NULL REFERENCES tags_dictionary(id)
                              ON DELETE RESTRICT ON UPDATE CASCADE,
  merge_type      VARCHAR(20) NOT NULL DEFAULT 'manual'
                              CHECK (merge_type IN ('automatic', 'manual', 'admin')),
  merged_by       UUID,       -- FK → users.id (NULL se automático)
  similarity_score NUMERIC(5,4), -- score que disparou o merge (se automático)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tag_aliases IS
  'Registra merges: alias_tag_id foi mesclada em canonical_tag_id. '
  'A tag alias permanece no dicionário com status=merged para manter histórico.';

-- ============================================================
-- TAG_USAGE_LOG — Auditoria de criação e uso
-- ============================================================
CREATE TABLE tag_usage_log (
  id          BIGSERIAL   PRIMARY KEY,
  tag_id      UUID        NOT NULL REFERENCES tags_dictionary(id)
                          ON DELETE CASCADE ON UPDATE CASCADE,
  user_id     UUID        NOT NULL,  -- FK → users.id
  action      VARCHAR(20) NOT NULL
              CHECK (action IN ('created', 'used', 'removed', 'merged', 'rejected')),
  context     JSONB,                 -- dados adicionais (ex: contact_id, similarity_score)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tag_usage_log IS
  'Append-only. Nunca fazer UPDATE ou DELETE nesta tabela. '
  'Fonte de verdade para auditoria e cálculo de distinct_users.';

-- ============================================================
-- CONTACT_ASSETS — Vínculo contato-tag do tipo "possui" (oferta)
-- ============================================================
CREATE TABLE contact_assets (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id  BIGINT      NOT NULL,  -- FK → private_contacts.id (tabela da Etapa 1)
  user_id     UUID        NOT NULL,  -- FK → users.id (multi-tenant RLS)
  tag_id      UUID        NOT NULL REFERENCES tags_dictionary(id)
                          ON DELETE RESTRICT ON UPDATE CASCADE,
  notes       VARCHAR(500),          -- nota textual opcional
  visibility  VARCHAR(10) NOT NULL DEFAULT 'private'
              CHECK (visibility IN ('private', 'network', 'public')),
  deleted_at  TIMESTAMPTZ,           -- soft delete (ver §5.3)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unicidade: mesmo contato não pode ter a mesma tag como ativo duas vezes
  CONSTRAINT uq_contact_asset UNIQUE (contact_id, user_id, tag_id)
  -- Nota: a constraint de conflito asset vs. need é validada no backend (§4.2)
  -- pois envolve duas tabelas distintas
);

-- ============================================================
-- CONTACT_NEEDS — Vínculo contato-tag do tipo "procura" (demanda)
-- ============================================================
CREATE TABLE contact_needs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id  BIGINT      NOT NULL,
  user_id     UUID        NOT NULL,
  tag_id      UUID        NOT NULL REFERENCES tags_dictionary(id)
                          ON DELETE RESTRICT ON UPDATE CASCADE,
  notes       VARCHAR(500),
  visibility  VARCHAR(10) NOT NULL DEFAULT 'private'
              CHECK (visibility IN ('private', 'network', 'public')),
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_contact_need UNIQUE (contact_id, user_id, tag_id)
);

-- ============================================================
-- AI_MATCH_SUGGESTIONS — Schema preparado para Etapa 7
-- ============================================================
CREATE TABLE ai_match_suggestions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id    UUID        NOT NULL,  -- user_id que "procura"
  target_id       UUID        NOT NULL,  -- user_id cujo contato "possui"
  asset_tag_id    UUID        NOT NULL REFERENCES tags_dictionary(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  need_tag_id     UUID        NOT NULL REFERENCES tags_dictionary(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  match_score     NUMERIC(5,4),          -- 0.0000 a 1.0000
  match_reason    JSONB,                 -- {"category_match": true, "tag_exact": false, ...}
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_match_suggestions IS
  'Tabela criada nesta etapa mas populada apenas na Etapa 7. '
  'Não criar endpoints de escrita nesta etapa — apenas garantir que o schema existe.';
```

### 2.3 Triggers Obrigatórios

```sql
-- ─── Trigger 1: Atualizar distinct_users e promover tag para verified ─────────
CREATE OR REPLACE FUNCTION fn_update_tag_distinct_users()
RETURNS TRIGGER AS $$
DECLARE
  v_distinct INT;
BEGIN
  -- Contar user_ids distintos que usam esta tag (assets + needs, excluindo soft-deleted)
  SELECT COUNT(DISTINCT user_id) INTO v_distinct
  FROM (
    SELECT user_id FROM contact_assets WHERE tag_id = NEW.tag_id AND deleted_at IS NULL
    UNION
    SELECT user_id FROM contact_needs  WHERE tag_id = NEW.tag_id AND deleted_at IS NULL
  ) sub;

  UPDATE tags_dictionary
  SET
    distinct_users = v_distinct,
    usage_count    = usage_count + 1,
    status         = CASE
                       WHEN status = 'unverified' AND v_distinct >= 3 THEN 'verified'
                       ELSE status
                     END,
    updated_at     = NOW()
  WHERE id = NEW.tag_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_update_tag_stats
  AFTER INSERT ON contact_assets
  FOR EACH ROW EXECUTE FUNCTION fn_update_tag_distinct_users();

CREATE TRIGGER trg_need_update_tag_stats
  AFTER INSERT ON contact_needs
  FOR EACH ROW EXECUTE FUNCTION fn_update_tag_distinct_users();

-- ─── Trigger 2: Atualizar updated_at automaticamente ─────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar em todas as tabelas com updated_at
CREATE TRIGGER trg_tag_categories_updated_at
  BEFORE UPDATE ON tag_categories FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_tags_dictionary_updated_at
  BEFORE UPDATE ON tags_dictionary FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_contact_assets_updated_at
  BEFORE UPDATE ON contact_assets FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_contact_needs_updated_at
  BEFORE UPDATE ON contact_needs FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
```

### 2.4 Row-Level Security (RLS)

```sql
-- Habilitar RLS nas tabelas multi-tenant
ALTER TABLE contact_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_needs  ENABLE ROW LEVEL SECURITY;

-- Política: usuária vê apenas seus próprios registros
CREATE POLICY rls_contact_assets_owner ON contact_assets
  USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY rls_contact_needs_owner ON contact_needs
  USING (user_id = current_setting('app.current_user_id')::UUID);

-- Nota de implementação: o NestJS deve executar
-- SET LOCAL app.current_user_id = '<uuid>' em cada transação autenticada.
-- tag_categories e tags_dictionary são públicas (leitura) — sem RLS.
-- tag_usage_log é append-only; leitura restrita a admins via RBAC no backend.
```

---

## 3. Fluxo de Tela UX/UI — Wireframes Descritivos

Todos os wireframes são mobile-first, largura base 375px, altura base 812px (iPhone SE / padrão Expo).

### Tela A — Adicionar Tag (Oferta ou Demanda)

```
┌─────────────────────────────────────────────────────────────────┐
│  NAVEGAÇÃO                                                       │
│  ← [Voltar]          "Adicionar Ativo"          [?] Ajuda       │
│  Altura: 56dp · bg: #0A1628 · border-bottom: 1px #FFFFFF1A      │
├─────────────────────────────────────────────────────────────────┤
│  CAMPO DE BUSCA                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🔍  Buscar ou criar tag...                    [✕]       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Altura: 48dp · border-radius: 12dp · bg: #FFFFFF0D             │
│  Placeholder: "Ex: Fundo de Investimento, Agritech..."          │
│  Foco automático ao abrir a tela (autofocus)                    │
├─────────────────────────────────────────────────────────────────┤
│  FILTRO POR CATEGORIA (scroll horizontal, chips)                │
│  [Todas] [Financeiro] [Tecnologia] [Agronegócio] [Industrial]   │
│  [Energia] [Saúde] [Logística] [Governo]                        │
│  Altura: 40dp · chip selecionado: bg=color_token, text=branco   │
│  chip não selecionado: bg=#FFFFFF0D, text=#FFFFFF60             │
│  Área de toque: 48dp mínimo (padding vertical 4dp)              │
├─────────────────────────────────────────────────────────────────┤
│  ESTADO: BUSCANDO (spinner inline, não bloqueia tela)           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⟳  Buscando...                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ESTADO: RESULTADO (lista de tags)                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ● Fundo de Investimento          [Financeiro ✓]        │    │
│  │    Usada por 47 pessoas                                  │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  ● Fundo Imobiliário              [Financeiro]          │    │
│  │    Usada por 12 pessoas                                  │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  ● Fundos de Venture Capital      [Financeiro]          │    │
│  │    Usada por 8 pessoas                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Cada item: altura 64dp · padding 16dp · border-bottom 1px      │
│  Ícone colorido (color_token da categoria) · 12dp de raio       │
│  Subtexto "Usada por N pessoas" · text-sm · #FFFFFF50           │
│  Tag verified: ícone ✓ ao lado do nome da categoria             │
│  Tag unverified: sem ícone (sem sinalização negativa ao usuário) │
│  Área de toque: linha inteira (TouchableOpacity)                 │
│                                                                  │
│  ESTADO: VAZIO (nenhum resultado)                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Nenhuma tag encontrada para "xyz"                       │    │
│  │                                                          │    │
│  │  [+ Criar tag "xyz" em Financeiro]                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Botão "Criar tag": bg=#F59E0B · text=#0A1628 · bold            │
│  Ao tocar: abre sub-modal de seleção de categoria (§ abaixo)    │
│                                                                  │
│  ESTADO: CRIANDO TAG NOVA (sub-modal bottom sheet)              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ─────────── (drag handle 40×4dp)                        │    │
│  │  Criar nova tag                                          │    │
│  │  Nome: [xyz_______________________________]              │    │
│  │  Categoria: (obrigatório)                                │    │
│  │  [Financeiro] [Tecnologia] [Agronegócio]                 │    │
│  │  [Industrial] [Energia]    [Saúde]                       │    │
│  │  [Logística]  [Governo]                                  │    │
│  │                                                          │    │
│  │  ⚠ Esta tag ficará disponível imediatamente para você.  │    │
│  │    Será verificada após 3 usuárias a utilizarem.         │    │
│  │                                                          │    │
│  │              [Cancelar]    [Criar e adicionar]           │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Bottom sheet: altura 380dp · bg=#0D1B2E · border-radius 24dp   │
│  Backdrop: rgba(0,0,0,0.6) · toque fora fecha                   │
│                                                                  │
│  ESTADO: ERRO DE BUSCA                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⚠ Não foi possível buscar tags.                         │    │
│  │    Verifique sua conexão.                                 │    │
│  │                          [Tentar novamente]              │    │
│  └─────────────────────────────────────────────────────────┘    │
│  bg=#FFFFFF08 · border: 1px #EF444440 · border-radius 12dp      │
│  Botão retry: outline · border=#F59E0B · text=#F59E0B           │
├─────────────────────────────────────────────────────────────────┤
│  TECLADO VIRTUAL (320dp de altura estimada no iOS)              │
│  A lista de resultados deve ser scrollable acima do teclado.    │
│  Usar KeyboardAvoidingView com behavior="padding" no iOS.       │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Campo de busca: accessibilityLabel="Buscar tags" accessibilityHint="Digite para filtrar"
- Chips de categoria: accessibilityRole="button" accessibilityState={{selected}}
- Itens da lista: accessibilityRole="button" accessibilityLabel="[Nome da tag], categoria [Categoria], usada por [N] pessoas"
- Botão criar: accessibilityLabel="Criar nova tag [nome]"
- Estado de erro: accessibilityLiveRegion="polite"
```

### Tela B — Cartão de Perfil do Contato (Visão Estratégica)

```
┌─────────────────────────────────────────────────────────────────┐
│  CABEÇALHO DO CONTATO (existente — Etapa 1)                     │
│  [Foto 72dp] Nome · Cargo · Empresa · Localização · Tags        │
│  Altura: ~140dp                                                  │
├─────────────────────────────────────────────────────────────────┤
│  SEÇÃO "O QUE POSSUI" (Ativos)                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Título: "💼 O que possui"  · text-xs · #FFFFFF50 · uppercase   │
│  Subtítulo: "Recursos, ativos e ofertas estratégicas"           │
│                                                                  │
│  ESTADO: PREENCHIDO (chips em wrap layout)                      │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [● Fundo de Investimento] [● Agritech] [● M&A]         │     │
│  │ [● Due Diligence]         [● Equity]                    │     │
│  └────────────────────────────────────────────────────────┘     │
│  Chip: padding 8×12dp · border-radius 20dp                      │
│  bg: color_token da categoria com 15% opacidade                 │
│  border: 1px color_token com 40% opacidade                      │
│  text: color_token · font-medium · 13sp                         │
│  ● ícone: 8dp · cor = color_token da categoria                  │
│                                                                  │
│  Se nota textual presente: toque no chip abre tooltip/popover   │
│  com a nota (max 2 linhas visíveis, scroll interno se maior)    │
│                                                                  │
│  Se > 6 chips: mostrar 5 + botão "[+N mais]" que expande inline │
│  (sem navegação — accordion na própria tela)                    │
│                                                                  │
│  ESTADO: VAZIO                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Nenhum ativo cadastrado ainda.                         │     │
│  │  [+ Adicionar o que este contato possui]                │     │
│  └────────────────────────────────────────────────────────┘     │
│  bg=#FFFFFF05 · border: 1px dashed #FFFFFF20 · border-radius 12 │
│  Botão: text-link · color=#F59E0B                               │
├─────────────────────────────────────────────────────────────────┤
│  SEÇÃO "O QUE PROCURA" (Necessidades)                           │
│  ─────────────────────────────────────────────────────────────  │
│  Título: "🔍 O que procura" · mesma estrutura visual            │
│  Diferenciação visual: chips com ícone 🔍 no lugar de ●         │
│  bg: branco 8% opacidade · border: 1px branco 20% opacidade    │
│  text: branco 80% · (neutro, sem cor de categoria)              │
│  Justificativa: distingue claramente oferta (colorida) de       │
│  demanda (neutra), evitando confusão semântica.                 │
│                                                                  │
│  Mesma lógica de expansão e estado vazio.                       │
├─────────────────────────────────────────────────────────────────┤
│  BOTÃO FLUTUANTE (FAB)                                          │
│  Posição: bottom-right · margin 24dp · z-index elevado          │
│  Tamanho: 56×56dp · border-radius 28dp                          │
│  bg: #F59E0B · shadow: 0 4px 16px rgba(245,158,11,0.4)         │
│  Ícone: + (24dp, branco)                                        │
│  accessibilityLabel="Adicionar ativo ou necessidade"            │
│                                                                  │
│  Ao tocar: bottom sheet com duas opções:                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  O que este contato possui?  [→ Adicionar Ativo]        │     │
│  │  O que este contato procura? [→ Adicionar Necessidade]  │     │
│  └────────────────────────────────────────────────────────┘     │
│  Cada opção: altura 64dp · ícone 24dp · texto descritivo        │
└─────────────────────────────────────────────────────────────────┘

Comportamento de scroll:
- A tela inteira é um ScrollView vertical.
- Seções de ativos e necessidades expandem inline (sem scroll interno).
- O FAB permanece fixo (position absolute) sobre o scroll.
- Em telas com muitos chips (>20 total), o scroll é fluido sem paginação.
```

### Tela C — Estados Especiais

```
ESTADO: CONTATO SEM TAGS (vazio total)
┌─────────────────────────────────────────────────────────────────┐
│  [Ilustração: rede de conexões vazia — SVG inline, 120×120dp]   │
│                                                                  │
│  "Perfil estratégico em branco"                                 │
│  text-lg · font-bold · text-center · #FFFFFF                    │
│                                                                  │
│  "Adicione o que este contato possui e o que procura para       │
│   identificar oportunidades de conexão."                        │
│  text-sm · text-center · #FFFFFF60 · max-width 280dp            │
│                                                                  │
│  [+ Começar a mapear]                                           │
│  bg=#F59E0B · text=#0A1628 · bold · border-radius 12dp          │
│  padding: 14×24dp · min-width 200dp                             │
└─────────────────────────────────────────────────────────────────┘

ESTADO: ERRO DE BUSCA (sem conexão / timeout)
┌─────────────────────────────────────────────────────────────────┐
│  [Ícone: wifi-off, 40×40dp, #EF4444]                            │
│  "Sem conexão"                                                  │
│  "Não foi possível carregar as tags."                           │
│  [Tentar novamente]  ← outline button, border=#F59E0B          │
│                                                                  │
│  Comportamento: após 3 tentativas automáticas (exponential      │
│  backoff: 1s, 2s, 4s), exibir este estado manual.              │
└─────────────────────────────────────────────────────────────────┘

ESTADO: TAG DUPLICADA (409 Conflict)
┌─────────────────────────────────────────────────────────────────┐
│  Toast / Snackbar (bottom, 48dp acima do FAB):                  │
│  bg=#1E293B · border-left: 4px #F59E0B                          │
│  "Esta tag já está em 'O que possui' deste contato."            │
│  Duração: 4 segundos · auto-dismiss                             │
│  accessibilityLiveRegion="assertive"                            │
└─────────────────────────────────────────────────────────────────┘

ESTADO: CONFLITO ASSET vs. NEED (422 Unprocessable)
┌─────────────────────────────────────────────────────────────────┐
│  Toast / Snackbar:                                              │
│  bg=#1E293B · border-left: 4px #EF4444                          │
│  "Este contato já tem 'Fundo de Investimento' como necessidade. │
│   Uma tag não pode ser ativo e necessidade ao mesmo tempo."     │
│  Duração: 5 segundos · auto-dismiss                             │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade geral:
- Contraste mínimo 4.5:1 em todos os textos sobre fundos escuros.
- Área de toque mínima 48×48dp em todos os elementos interativos.
- Chips com notas: accessibilityHint="Toque para ver observação"
- FAB: accessibilityRole="button" accessibilityLabel="Adicionar ativo ou necessidade"
- Estados de erro: accessibilityLiveRegion="assertive" para leitores de tela.
```

---

## 4. Especificação de API REST (OpenAPI 3.0)

```yaml
openapi: "3.0.3"
info:
  title: MMM CRM — Strategic Profile API
  version: "1.0.0"
  description: |
    Endpoints para gerenciamento de ativos (oferta) e necessidades (demanda)
    no perfil estratégico de contatos privados.
    Autenticação: Bearer JWT. RBAC: roles `user` e `admin`.
    Rate limit padrão: 30 req/min por usuária (header X-RateLimit-*).

servers:
  - url: https://api.mmmos.com/api/v1

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    ErrorResponse:
      type: object
      required: [error_code, message]
      properties:
        error_code:  { type: string, example: "TAG_ALREADY_EXISTS_AS_ASSET" }
        message:     { type: string, example: "Esta tag já é um ativo deste contato." }
        details:     { type: object, additionalProperties: true }

    TagCategory:
      type: object
      properties:
        id:          { type: string, format: uuid }
        name:        { type: string, example: "Financeiro" }
        slug:        { type: string, example: "financeiro" }
        color_token: { type: string, example: "#F59E0B" }

    Tag:
      type: object
      properties:
        id:          { type: string, format: uuid }
        name:        { type: string, example: "Fundo de Investimento" }
        slug:        { type: string, example: "fundo-de-investimento" }
        category:    { $ref: '#/components/schemas/TagCategory' }
        status:      { type: string, enum: [verified, unverified] }
        usage_count: { type: integer, example: 47 }
        labels:
          type: object
          properties:
            pt: { type: string }
            en: { type: string }
            es: { type: string }

    ContactAsset:
      type: object
      properties:
        id:         { type: string, format: uuid }
        contact_id: { type: integer }
        tag:        { $ref: '#/components/schemas/Tag' }
        notes:      { type: string, maxLength: 500, nullable: true }
        visibility: { type: string, enum: [private, network, public], default: private }
        created_at: { type: string, format: date-time }

    StrategicProfile:
      type: object
      properties:
        contact_id: { type: integer }
        assets:
          type: array
          items: { $ref: '#/components/schemas/ContactAsset' }
        needs:
          type: array
          items: { $ref: '#/components/schemas/ContactAsset' }
        last_updated: { type: string, format: date-time }

security:
  - BearerAuth: []

paths:

  # ──────────────────────────────────────────────────────────────────────────
  # GET /strategic-tags — Auto-completar de tags
  # ──────────────────────────────────────────────────────────────────────────
  /strategic-tags:
    get:
      summary: Buscar tags no dicionário global (auto-completar)
      operationId: searchStrategicTags
      tags: [Tags]
      parameters:
        - name: q
          in: query
          description: Termo de busca fuzzy (trigram similarity)
          schema: { type: string, minLength: 1, maxLength: 80 }
        - name: category_id
          in: query
          description: Filtrar por categoria (UUID)
          schema: { type: string, format: uuid }
        - name: limit
          in: query
          description: Máximo de resultados (padrão 10, máximo 20)
          schema: { type: integer, default: 10, maximum: 20 }
        - name: cursor
          in: query
          description: Cursor para paginação (opaque string retornada pelo servidor)
          schema: { type: string }
      responses:
        "200":
          description: Lista de tags ordenada por relevância
          headers:
            X-Request-ID: { schema: { type: string } }
            X-RateLimit-Remaining: { schema: { type: integer } }
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/Tag' }
                  next_cursor: { type: string, nullable: true }
              example:
                data:
                  - id: "a1b2c3d4-..."
                    name: "Fundo de Investimento"
                    slug: "fundo-de-investimento"
                    category:
                      id: "cat-uuid"
                      name: "Financeiro"
                      slug: "financeiro"
                      color_token: "#F59E0B"
                    status: "verified"
                    usage_count: 47
                    labels: { pt: "Fundo de Investimento", en: "Investment Fund", es: "Fondo de Inversión" }
                next_cursor: null
        "400":
          description: Parâmetros inválidos
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "INVALID_QUERY", message: "O parâmetro 'q' deve ter entre 1 e 80 caracteres.", details: {} }
        "401":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "UNAUTHORIZED", message: "Token JWT ausente ou expirado.", details: {} }
        "429":
          description: Rate limit excedido
          headers:
            Retry-After: { schema: { type: integer } }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "RATE_LIMIT_EXCEEDED", message: "Limite de 30 requisições/minuto atingido.", details: { retry_after_seconds: 12 } }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /private-network/contacts/{contact_id}/assets — Adicionar ativo
  # ──────────────────────────────────────────────────────────────────────────
  /private-network/contacts/{contact_id}/assets:
    post:
      summary: Adicionar ativo (oferta) ao perfil estratégico do contato
      operationId: addContactAsset
      tags: [Strategic Profile]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
          description: Idempotency key gerado pelo cliente
        - name: If-Match
          in: header
          required: true
          schema: { type: string }
          description: ETag do contato para concorrência otimista (obtido via GET do contato)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                tag_id:
                  type: string
                  format: uuid
                  description: UUID da tag existente. Mutuamente exclusivo com new_tag_name.
                new_tag_name:
                  type: string
                  maxLength: 120
                  description: Nome da nova tag a criar. Obrigatório se tag_id ausente.
                category_id:
                  type: string
                  format: uuid
                  description: Obrigatório se new_tag_name fornecido.
                notes:
                  type: string
                  maxLength: 500
                  nullable: true
            examples:
              tag_existente:
                value: { tag_id: "a1b2c3d4-...", notes: "Foco em agritech, ticket médio R$ 5M" }
              nova_tag:
                value: { new_tag_name: "Agritech B2B", category_id: "cat-agronegocio-uuid", notes: null }
      responses:
        "201":
          description: Ativo adicionado com sucesso
          headers:
            X-Request-ID: { schema: { type: string } }
            ETag: { schema: { type: string } }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ContactAsset' }
              example:
                id: "asset-uuid"
                contact_id: 42
                tag:
                  id: "a1b2c3d4"
                  name: "Fundo de Investimento"
                  category: { name: "Financeiro", color_token: "#F59E0B" }
                  status: "verified"
                  usage_count: 48
                notes: "Foco em agritech, ticket médio R$ 5M"
                visibility: "private"
                created_at: "2026-08-06T23:00:00Z"
        "400":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "MISSING_CATEGORY_ID", message: "category_id é obrigatório ao criar nova tag.", details: {} }
        "401":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "UNAUTHORIZED", message: "Token JWT ausente ou expirado.", details: {} }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FORBIDDEN", message: "Este contato não pertence à sua conta.", details: {} }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} }
        "409":
          description: Tag já existe como ativo deste contato
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "TAG_ALREADY_EXISTS_AS_ASSET", message: "Esta tag já é um ativo deste contato.", details: { existing_asset_id: "asset-uuid" } }
        "412":
          description: ETag não corresponde (conflito de concorrência)
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "PRECONDITION_FAILED", message: "O contato foi modificado por outra operação. Recarregue e tente novamente.", details: {} }
        "422":
          description: Tag já existe como necessidade do mesmo contato
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "TAG_CONFLICT_ASSET_NEED", message: "Esta tag já está em 'O que procura' deste contato. Uma tag não pode ser ativo e necessidade simultaneamente.", details: { existing_need_id: "need-uuid" } }
        "429":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "RATE_LIMIT_EXCEEDED", message: "Limite de requisições atingido.", details: { retry_after_seconds: 8 } }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /private-network/contacts/{contact_id}/needs — Adicionar necessidade
  # ──────────────────────────────────────────────────────────────────────────
  /private-network/contacts/{contact_id}/needs:
    post:
      summary: Adicionar necessidade (demanda) ao perfil estratégico do contato
      operationId: addContactNeed
      tags: [Strategic Profile]
      description: |
        Contrato idêntico ao POST /assets, com as seguintes diferenças:
        - Valida que a tag NÃO existe como asset do mesmo contato (retorna 422 se existir).
        - Valida que a tag NÃO existe como need do mesmo contato (retorna 409 se existir).
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
        - name: If-Match
          in: header
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                tag_id:       { type: string, format: uuid }
                new_tag_name: { type: string, maxLength: 120 }
                category_id:  { type: string, format: uuid }
                notes:        { type: string, maxLength: 500, nullable: true }
      responses:
        "201":
          description: Necessidade adicionada com sucesso
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ContactAsset' }
        "400": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/400' }
        "401": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/401' }
        "403": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/403' }
        "404": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/404' }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "TAG_ALREADY_EXISTS_AS_NEED", message: "Esta tag já é uma necessidade deste contato.", details: { existing_need_id: "need-uuid" } }
        "412": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/412' }
        "422":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "TAG_CONFLICT_NEED_ASSET", message: "Esta tag já está em 'O que possui' deste contato.", details: { existing_asset_id: "asset-uuid" } }
        "429": { $ref: '#/paths/~1private-network~1contacts~1{contact_id}~1assets/post/responses/429' }

  # ──────────────────────────────────────────────────────────────────────────
  # DELETE /assets/{id} e /needs/{id} — Remover ativo ou necessidade
  # ──────────────────────────────────────────────────────────────────────────
  /private-network/contacts/{contact_id}/assets/{contact_asset_id}:
    delete:
      summary: Remover ativo do perfil estratégico
      operationId: deleteContactAsset
      description: |
        **Decisão: Hard delete com auditoria em tag_usage_log.**
        Justificativa: ativos e necessidades são dados operacionais de curto prazo.
        Soft delete adicionaria complexidade em todas as queries (WHERE deleted_at IS NULL)
        sem benefício real — o histórico de uso é mantido no tag_usage_log (append-only).
        Se auditoria de "quem removeu o quê" for necessária no futuro, tag_usage_log
        já registra a ação 'removed'.
      tags: [Strategic Profile]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: contact_asset_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204":
          description: Ativo removido com sucesso
          headers:
            X-Request-ID: { schema: { type: string } }
        "401":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "UNAUTHORIZED", message: "Token JWT ausente ou expirado.", details: {} }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FORBIDDEN", message: "Apenas o dono do contato ou um admin pode remover este ativo.", details: {} }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "ASSET_NOT_FOUND", message: "Ativo não encontrado.", details: {} }
        "429":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "RATE_LIMIT_EXCEEDED", message: "Limite de requisições atingido.", details: {} }

  /private-network/contacts/{contact_id}/needs/{contact_need_id}:
    delete:
      summary: Remover necessidade do perfil estratégico
      operationId: deleteContactNeed
      description: Contrato idêntico ao DELETE /assets/{id}.
      tags: [Strategic Profile]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: contact_need_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204":
          description: Necessidade removida com sucesso
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Not Found }
        "429": { description: Rate limit }

  # ──────────────────────────────────────────────────────────────────────────
  # GET /strategic-profile — Perfil completo em uma requisição
  # ──────────────────────────────────────────────────────────────────────────
  /private-network/contacts/{contact_id}/strategic-profile:
    get:
      summary: Obter perfil estratégico completo do contato (assets + needs)
      operationId: getStrategicProfile
      tags: [Strategic Profile]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Perfil estratégico completo
          headers:
            X-Request-ID: { schema: { type: string } }
            ETag: { schema: { type: string }, description: "Hash do estado atual do perfil para If-Match" }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StrategicProfile' }
              example:
                contact_id: 42
                assets:
                  - id: "asset-1"
                    tag: { name: "Fundo de Investimento", category: { name: "Financeiro", color_token: "#F59E0B" }, status: "verified" }
                    notes: "Foco em agritech, ticket médio R$ 5M"
                    visibility: "private"
                    created_at: "2026-08-01T10:00:00Z"
                needs:
                  - id: "need-1"
                    tag: { name: "Distribuição Logística", category: { name: "Logística", color_token: "#8B5CF6" }, status: "verified" }
                    notes: null
                    visibility: "private"
                    created_at: "2026-08-02T14:30:00Z"
                last_updated: "2026-08-02T14:30:00Z"
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} }
        "429": { description: Rate limit }
```

---

## 5. Estratégia de Indexação e Busca

### 5.1 Índices por Tabela

| Tabela | Nome do Índice | Tipo | Colunas | Justificativa |
|---|---|---|---|---|
| `tag_categories` | `idx_tag_categories_slug` | B-tree | `slug` | Lookup por slug em seeds e validações |
| `tags_dictionary` | `idx_tags_dict_category` | B-tree | `category_id` | Filtro por categoria no auto-completar |
| `tags_dictionary` | `idx_tags_dict_status` | B-tree | `status` | Filtro `WHERE status IN ('verified','unverified')` |
| `tags_dictionary` | `idx_tags_dict_name_trgm` | GIN (pg_trgm) | `name gin_trgm_ops` | Busca fuzzy por nome — **crítico para <200ms** |
| `tags_dictionary` | `idx_tags_dict_slug` | B-tree | `slug` | Deduplicação e lookup exato |
| `tags_dictionary` | `idx_tags_dict_usage` | B-tree | `usage_count DESC` | Ordenação por popularidade |
| `tags_dictionary` | `idx_tags_dict_labels` | GIN | `labels` | Busca por idioma: `labels @> '{"en":"..."}'` |
| `contact_assets` | `idx_ca_user_contact` | B-tree | `(user_id, contact_id)` | RLS + lookup por contato — **query principal** |
| `contact_assets` | `idx_ca_tag` | B-tree | `tag_id` | JOIN com tags_dictionary |
| `contact_assets` | `idx_ca_user_tag` | B-tree | `(user_id, tag_id)` | Verificação de duplicidade antes do INSERT |
| `contact_needs` | `idx_cn_user_contact` | B-tree | `(user_id, contact_id)` | Mesmo padrão dos assets |
| `contact_needs` | `idx_cn_tag` | B-tree | `tag_id` | JOIN com tags_dictionary |
| `contact_needs` | `idx_cn_user_tag` | B-tree | `(user_id, tag_id)` | Verificação de conflito asset vs. need |
| `tag_usage_log` | `idx_tul_tag_user` | B-tree | `(tag_id, user_id)` | Cálculo de distinct_users no trigger |
| `tag_usage_log` | `idx_tul_created_at` | B-tree | `created_at DESC` | Queries de auditoria por período |
| `ai_match_suggestions` | `idx_ams_requester` | B-tree | `requester_id` | Lookup futuro por usuária |
| `ai_match_suggestions` | `idx_ams_score` | B-tree | `match_score DESC` | Ordenação por relevância |

### 5.2 Abordagem de Busca Fuzzy

A escolha é **GIN com `pg_trgm`** (não GiST). A justificativa técnica é direta: índices GIN são mais lentos para construir e atualizar, mas significativamente mais rápidos para consultas de leitura — exatamente o perfil de carga do auto-completar (muitas leituras, poucas escritas no dicionário). GiST seria preferível apenas se o dicionário tivesse atualizações em alta frequência (>100 inserções/segundo), o que não é o caso no MVP.

A query de auto-completar combina dois critérios para garantir ordenação por relevância:

```sql
SELECT
  td.id, td.name, td.slug, td.status, td.usage_count,
  tc.name AS category_name, tc.color_token,
  similarity(td.name, $1) AS sim_score
FROM tags_dictionary td
JOIN tag_categories tc ON tc.id = td.category_id
WHERE
  td.status IN ('verified', 'unverified')
  AND td.merged_into_id IS NULL
  AND (
    td.name ILIKE $1 || '%'                    -- prefixo exato (mais rápido)
    OR similarity(td.name, $1) > 0.3           -- fuzzy fallback
  )
  AND ($2::UUID IS NULL OR td.category_id = $2) -- filtro de categoria opcional
ORDER BY
  -- Prioridade 1: tags da própria usuária (JOIN com contact_assets/needs)
  EXISTS (
    SELECT 1 FROM contact_assets ca
    WHERE ca.tag_id = td.id AND ca.user_id = $3
  ) DESC,
  -- Prioridade 2: popularidade global
  td.usage_count DESC,
  -- Prioridade 3: similaridade textual
  sim_score DESC
LIMIT $4; -- máximo 10 (padrão) ou 20 (máximo)
```

**Garantia de <200ms:** Com o índice GIN em `name` e o índice B-tree em `(category_id, status)`, o plano de execução esperado é `Bitmap Index Scan` no GIN seguido de `Index Scan` no B-tree, com `Nested Loop` para o JOIN com `tag_categories`. Para 10k tags, o custo estimado é < 5ms de I/O. O overhead de rede (API Gateway → RDS) é o fator dominante, não o banco.

### 5.3 Critério para Ativar pgvector

O campo `embedding VECTOR(1536)` deve ser descomentado e a extensão `pgvector` ativada quando **qualquer uma** das seguintes condições for verdadeira:

- O dicionário ultrapassar **50.000 tags** (busca trigram começa a degradar acima desse volume)
- A Etapa 7 (Match Semântico) for iniciada
- A taxa de "nenhum resultado" no auto-completar ultrapassar **15%** das buscas (indicador de que a busca literal está falhando)

---

## 6. Critérios de Aceite (Definition of Done)

Os critérios abaixo são testáveis de forma objetiva e devem ser verificados antes do merge em `main`:

| # | Critério | Como verificar |
|---|---|---|
| 1 | Usuária adiciona tag existente via auto-completar em ≤ 3 toques | Teste de usabilidade: busca → seleciona → confirma |
| 2 | Busca de tags retorna em < 200ms para 10k tags | `EXPLAIN ANALYZE` na query de auto-completar com dataset de 10k tags |
| 3 | Tag duplicada (mesmo contato, mesmo tipo) retorna 409 com `error_code: TAG_ALREADY_EXISTS_AS_ASSET` | Teste de integração: POST asset duas vezes com mesma tag |
| 4 | Adicionar mesma tag como asset e need retorna 422 com `error_code: TAG_CONFLICT_ASSET_NEED` | Teste de integração: POST asset, depois POST need com mesma tag |
| 5 | Usuária offline vê estado de erro com botão de retry | Teste E2E: desligar rede, abrir tela de adicionar tag |
| 6 | Admin mescla duas tags via endpoint em ≤ 2 passos | Teste de integração: POST /admin/tags/merge com `source_id` e `target_id` |
| 7 | Schema suporta i18n sem migração destrutiva | Verificar que `labels JSONB` aceita novos idiomas sem ALTER TABLE |
| 8 | Todos os endpoints retornam `X-Request-ID` no response | Teste de contrato: verificar header em todas as respostas |

### 6.1 Casos de Teste Detalhados

**Happy path — criação e promoção de tag:**

```
1. Usuária A cria tag "Agritech B2B" (categoria: Agronegócio)
   → tag criada com status=unverified, distinct_users=1
2. Usuária B adiciona "Agritech B2B" a um de seus contatos
   → distinct_users=2, status permanece unverified
3. Usuária C adiciona "Agritech B2B"
   → trigger dispara, distinct_users=3, status=verified
4. Todas as usuárias veem a tag com ícone ✓ no auto-completar
```

**Edge case — deduplicação automática:**

```
1. Usuária D tenta criar tag "Agri-tech B2B" (similaridade > 0.92 com "Agritech B2B")
2. Sistema detecta via pg_trgm: similarity = 0.94
3. Merge automático: "Agri-tech B2B" → alias de "Agritech B2B"
4. Registro em tag_aliases com merge_type=automatic, similarity_score=0.94
5. Usuária D recebe resposta 201 com a tag canônica "Agritech B2B"
   (não com a tag que tentou criar)
```

**Edge case — conflito asset vs. need:**

```
1. Usuária adiciona "Fundo de Investimento" como asset do Contato X
2. Tenta adicionar "Fundo de Investimento" como need do mesmo Contato X
3. Backend valida: SELECT EXISTS (SELECT 1 FROM contact_assets WHERE contact_id=X AND tag_id=Y AND user_id=Z)
4. Retorna 422 com error_code=TAG_CONFLICT_NEED_ASSET
5. Frontend exibe toast com mensagem clara
6. Usuária remove o asset → agora pode adicionar como need sem conflito
```

**Edge case — concorrência otimista:**

```
1. Cliente A e Cliente B carregam o perfil do Contato X (ETag: "abc123")
2. Cliente A adiciona asset com If-Match: "abc123" → sucesso, novo ETag: "def456"
3. Cliente B tenta adicionar need com If-Match: "abc123" → 412 Precondition Failed
4. Cliente B recarrega o perfil (novo ETag: "def456") e tenta novamente → sucesso
```

---

## 7. Decisões Pendentes

As seguintes questões ainda requerem validação do time de produto/negócio antes do início do desenvolvimento:

| # | Questão | Impacto | Prazo sugerido |
|---|---|---|---|
| 1 | **Visibilidade de tags unverified no auto-completar:** tags criadas por outras usuárias mas ainda não verificadas devem aparecer para todas? Atualmente a spec retorna `verified` e `unverified` (exceto `rejected`/`merged`). Se o produto quiser ocultar tags de outras usuárias até verificação, a query precisa de ajuste. | Médio — afeta UX do auto-completar | Antes do sprint 1 |
| 2 | **Limite de tags por contato:** existe um máximo de ativos ou necessidades por contato? Sem limite, um contato poderia ter centenas de tags, impactando performance do cartão de perfil. Sugestão: 50 por tipo (assets e needs separadamente). | Baixo no MVP, alto em escala | Antes do sprint 1 |
| 3 | **Endpoint de merge para admin:** o endpoint `POST /admin/tags/merge` não foi especificado neste documento (fora do escopo da Etapa 2). Confirmar se deve ser incluído nesta etapa ou na Etapa 3 (Painel Administrativo). | Baixo para MVP | Antes do sprint 2 |
| 4 | **Idioma padrão do dicionário:** quando `labels` não contém o idioma do usuário, qual fallback usar? Sugestão: `pt` → `en` → `name` (campo principal). Confirmar se esta ordem está correta. | Baixo | Antes do sprint 1 |
| 5 | **Soft delete vs. hard delete para contact_assets/needs:** a spec escolheu hard delete com auditoria em `tag_usage_log`. Se o produto precisar de "histórico de ativos removidos" visível para a usuária (ex: "você já teve este ativo"), o schema precisará de soft delete. Confirmar requisito. | Médio — impacta schema | Antes do sprint 1 |

---

*Documento gerado por Manus AI · Projeto MMM — Mulheres que Movem o Mundo · Etapa 2 de N*
