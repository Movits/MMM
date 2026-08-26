# Especificação Técnica — Etapa 3
## Organização por Contexto: Onde e Como Conheceu
### Módulo CRM Inteligente · MMM (Mulheres que Movem o Mundo)

> **Versão:** 1.0 · **Data:** Agosto 2026 · **Autor:** Manus AI para Projeto MMM
> **Stack:** Node.js / NestJS · PostgreSQL 15+ (RDS) · AWS S3 + CloudFront · React Native (Expo SDK 51)
> **Escopo:** MVP até 2.000 usuárias · ~150 contatos/usuária · ~5k contextos · ~20k mídias em 12 meses

---

## 1. Contexto e Decisões de Negócio

Este módulo permite que cada usuária registre **onde e como conheceu** cada contato estratégico, organizando encontros em "contextos" — eventos, missões, jantares, reuniões e outros. O vínculo entre contato e contexto carrega metadados do encontro (data, cidade, país, notas, tipo de relacionamento), formando uma memória institucional privada e pesquisável.

| Dimensão | Decisão |
|---|---|
| **Tipos de Contexto** | Híbrido: catálogo fixo global (10 tipos) + contextos personalizados privados por usuária |
| **Vínculo Contato-Contexto** | N:N com metadados próprios por encontro (data, cidade, notas, relationship_type) |
| **Participantes** | Tipo A: contatos da Base Particular (Etapa 1) · Tipo B: texto livre (nome + cargo) |
| **Storage de Mídia** | AWS S3 (bucket privado) + metadados no PostgreSQL · Presigned URL para upload e visualização |
| **Privacidade** | Contextos e vínculos privados por `user_id` · campo `visibility` preparado para Etapa 8 |
| **Offline** | Mostrar erro claro com retry — fila local não implementada no MVP (ver §6 Decisões Pendentes) |

**Catálogo fixo de contextos pré-cadastrados (seed):**
`Congresso`, `Missão Empresarial`, `Evento Internacional`, `Jantar`, `Embaixada`, `Reunião Particular`, `Feira Internacional`, `CPHI`, `Evento do MMM`, `Associação Comercial`.

---

## 2. Modelo de Dados — Schema SQL (PostgreSQL 15+)

### 2.1 Schema Completo

```sql
-- ============================================================
-- EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- CONTEXT_TYPES — Catálogo de tipos de contexto (fixo)
-- ============================================================
CREATE TABLE context_types (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(80) NOT NULL UNIQUE,
  slug        VARCHAR(80) NOT NULL UNIQUE,
  icon_name   VARCHAR(50),                  -- nome do ícone no design system
  color_token VARCHAR(30),                  -- ex: "#3B82F6"
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE context_types IS
  'Catálogo fixo de tipos de contexto. Apenas admins podem alterar. '
  'Seed: Congresso, Missão Empresarial, Evento Internacional, Jantar, '
  'Embaixada, Reunião Particular, Feira Internacional, CPHI, Evento do MMM, Associação Comercial.';

-- Seed (referência — executar via migration seed):
-- INSERT INTO context_types (name, slug, icon_name, color_token, sort_order) VALUES
--   ('Congresso',              'congresso',              'building-2',    '#3B82F6', 1),
--   ('Missão Empresarial',     'missao-empresarial',     'briefcase',     '#F59E0B', 2),
--   ('Evento Internacional',   'evento-internacional',   'globe',         '#8B5CF6', 3),
--   ('Jantar',                 'jantar',                 'utensils',      '#EC4899', 4),
--   ('Embaixada',              'embaixada',              'landmark',      '#0EA5E9', 5),
--   ('Reunião Particular',     'reuniao-particular',     'users',         '#22C55E', 6),
--   ('Feira Internacional',    'feira-internacional',    'store',         '#EF4444', 7),
--   ('CPHI',                   'cphi',                   'flask-conical', '#6366F1', 8),
--   ('Evento do MMM',          'evento-mmm',             'star',          '#F59E0B', 9),
--   ('Associação Comercial',   'associacao-comercial',   'handshake',     '#14B8A6', 10);

-- ============================================================
-- CONTEXTS — Contextos fixos globais + personalizados por usuária
-- ============================================================
CREATE TABLE contexts (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID,                        -- NULL = contexto global fixo; NOT NULL = personalizado
  context_type_id UUID      REFERENCES context_types(id)
                            ON DELETE SET NULL ON UPDATE CASCADE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  event_date    DATE,
  city          VARCHAR(100),
  country       VARCHAR(100),
  notes         TEXT,
  is_custom     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- is_custom=FALSE: contexto do catálogo fixo (user_id=NULL)
  -- is_custom=TRUE:  contexto personalizado da usuária (user_id=NOT NULL)
  visibility    VARCHAR(10) NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private', 'network', 'public')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unicidade: contexto personalizado com mesmo nome e data para a mesma usuária
  CONSTRAINT uq_context_user_name_date UNIQUE NULLS NOT DISTINCT (user_id, name, event_date),

  -- Regra: contexto personalizado DEVE ter user_id
  CONSTRAINT chk_custom_has_user CHECK (
    (is_custom = FALSE AND user_id IS NULL) OR
    (is_custom = TRUE  AND user_id IS NOT NULL)
  )
);

COMMENT ON COLUMN contexts.user_id IS
  'NULL para contextos globais do catálogo. NOT NULL para contextos personalizados da usuária.';
COMMENT ON COLUMN contexts.visibility IS
  'Preparado para Etapa 8 (Inteligência Coletiva). Default private.';

-- ============================================================
-- CONTACT_CONTEXTS — Vínculo N:N contato-contexto COM metadados
-- ============================================================
CREATE TABLE contact_contexts (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL,    -- FK → users.id (multi-tenant RLS)
  contact_id        BIGINT      NOT NULL,    -- FK → private_contacts.id (Etapa 1)
  context_id        UUID        NOT NULL REFERENCES contexts(id)
                                ON DELETE CASCADE ON UPDATE CASCADE,
  event_date        DATE,
  city              VARCHAR(100),
  country           VARCHAR(100),
  notes             VARCHAR(1000),
  relationship_type VARCHAR(20) NOT NULL DEFAULT 'profissional'
                    CHECK (relationship_type IN ('pessoal', 'profissional', 'ambos')),
  visibility        VARCHAR(10) NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private', 'network', 'public')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unicidade: mesmo contato, mesmo contexto, mesma data = duplicata proibida
  -- Datas diferentes = reencontro permitido
  CONSTRAINT uq_contact_context_date UNIQUE NULLS NOT DISTINCT (user_id, contact_id, context_id, event_date),

  -- event_date não pode ser mais de 1 dia no futuro (tolerância de fuso)
  CONSTRAINT chk_event_date_not_future CHECK (
    event_date IS NULL OR event_date <= CURRENT_DATE + INTERVAL '1 day'
  )
);

COMMENT ON TABLE contact_contexts IS
  'Vínculo N:N entre contato e contexto. Cada linha representa um encontro específico. '
  'Mesmo contato pode aparecer N vezes no mesmo contexto se as datas forem diferentes (reencontro).';

-- ============================================================
-- CONTEXT_PARTICIPANTS — Participantes avulsos (texto livre)
-- ============================================================
CREATE TABLE context_participants (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL,
  context_id  UUID        NOT NULL REFERENCES contexts(id)
                          ON DELETE CASCADE ON UPDATE CASCADE,
  name        VARCHAR(200) NOT NULL,
  company     VARCHAR(200),
  role        VARCHAR(200),
  notes       VARCHAR(500),
  -- Referência futura: se convertido em contato da Base Particular
  converted_contact_id BIGINT,  -- FK → private_contacts.id (preenchido após conversão)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN context_participants.converted_contact_id IS
  'Preenchido quando o participante avulso é convertido em contato da Base Particular. '
  'Permite rastrear a origem do contato.';

-- ============================================================
-- CONTEXT_MEDIA — Metadados de fotos e documentos no S3
-- ============================================================
CREATE TABLE context_media (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL,
  context_id      UUID        NOT NULL REFERENCES contexts(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  storage_path    VARCHAR(512) NOT NULL,   -- path no bucket S3
  storage_bucket  VARCHAR(100) NOT NULL DEFAULT 'mmm-private',
  file_type       VARCHAR(50) NOT NULL
                  CHECK (file_type IN ('image/jpeg','image/png','image/heic','application/pdf')),
  file_size       BIGINT      NOT NULL,    -- bytes
  original_name   VARCHAR(255) NOT NULL,
  caption         VARCHAR(255),
  thumbnail_path  VARCHAR(512),            -- gerado assincronamente para imagens
  sort_order      SMALLINT    NOT NULL DEFAULT 0,
  uploaded_by     UUID        NOT NULL,    -- FK → users.id
  deleted_at      TIMESTAMPTZ,             -- soft delete (lifecycle S3)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Limite de 10MB validado no app; documentado aqui para referência
  -- CHECK (file_size <= 10485760) -- 10MB em bytes
  -- Nota: preferimos validar no app para mensagem de erro amigável antes do upload
  CONSTRAINT chk_file_size CHECK (file_size > 0 AND file_size <= 10485760)
);

COMMENT ON COLUMN context_media.deleted_at IS
  'Soft delete: ao definir deleted_at, o objeto S3 é movido para prefixo deleted/ '
  'via lifecycle policy. Expiração permanente após 30 dias.';
COMMENT ON COLUMN context_media.thumbnail_path IS
  'Gerado assincronamente por Lambda/worker após upload. NULL até processamento.';

-- ============================================================
-- REFERÊNCIA: PRIVATE_CONTACTS (Etapa 1 — campos relevantes para JOIN)
-- ============================================================
-- CREATE TABLE private_contacts (
--   id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
--   ownerId   VARCHAR(128) NOT NULL,  -- equivalente a user_id
--   fullName  VARCHAR(200) NOT NULL,
--   photoUrl  VARCHAR(512),
--   jobTitle  VARCHAR(200),
--   company   VARCHAR(200),
--   ...
-- );
-- Nota: esta tabela existe no schema da Etapa 1 (MySQL/TiDB no projeto MMM atual).
-- Em PostgreSQL puro, o tipo seria BIGSERIAL e ownerId seria UUID.
```

### 2.2 Row-Level Security (RLS)

```sql
-- Habilitar RLS nas tabelas multi-tenant
ALTER TABLE contexts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_contexts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_media      ENABLE ROW LEVEL SECURITY;

-- Política contexts: usuária vê seus próprios + os globais (user_id IS NULL)
CREATE POLICY rls_contexts_owner ON contexts
  USING (user_id IS NULL OR user_id = current_setting('app.current_user_id')::UUID);

-- Políticas das demais tabelas: apenas os próprios registros
CREATE POLICY rls_contact_contexts_owner ON contact_contexts
  USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY rls_context_participants_owner ON context_participants
  USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY rls_context_media_owner ON context_media
  USING (user_id = current_setting('app.current_user_id')::UUID);
```

### 2.3 Triggers

```sql
-- Trigger: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contexts_updated_at
  BEFORE UPDATE ON contexts FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_contact_contexts_updated_at
  BEFORE UPDATE ON contact_contexts FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_context_participants_updated_at
  BEFORE UPDATE ON context_participants FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_context_media_updated_at
  BEFORE UPDATE ON context_media FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
```

---

## 3. Fluxo de Tela UX/UI — Wireframes Descritivos

Todos os wireframes são mobile-first, largura base 375px.

### Tela A — Meus Contextos (Lista)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (56dp)                                                   │
│  ← [Voltar]        "Meus Contextos"        [🔍 Buscar]          │
│  bg: #0A1628 · border-bottom: 1px #FFFFFF1A                     │
├─────────────────────────────────────────────────────────────────┤
│  FILTROS HORIZONTAIS (scroll horizontal, 48dp altura)           │
│  [Todos ✓] [Eventos] [Missões] [Reuniões] [Jantares] [Outros]  │
│  Chip ativo: bg=color_token · text=branco · bold                │
│  Chip inativo: bg=#FFFFFF0D · text=#FFFFFF60                    │
│  Padding: 16dp horizontal · gap: 8dp                            │
├─────────────────────────────────────────────────────────────────┤
│  LISTA VERTICAL (scroll)                                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [Thumb  ] CPHI 2024                    [3 contatos]    │     │
│  │ [64×64dp] Feira Internacional                          │     │
│  │           📅 15 out 2024 · Madrid, Espanha             │     │
│  └────────────────────────────────────────────────────────┘     │
│  Card: altura 80dp · padding 16dp · border-radius 16dp          │
│  bg: #FFFFFF08 · border: 1px #FFFFFF12                          │
│  Thumbnail: 64×64dp · border-radius 12dp · object-fit: cover    │
│  Se sem thumbnail: ícone do tipo (24dp, color_token) em bg      │
│  Nome: font-semibold · 15sp · #FFFFFF                           │
│  Tipo: text-xs · color_token do tipo                            │
│  Data + Local: text-xs · #FFFFFF50 · ícone 📅 10dp              │
│  Badge contatos: pill · bg=#FFFFFF12 · text-xs · #FFFFFF60      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [Ícone  ] Roadshow Europa 2026         [1 contato]     │     │
│  │ [64×64dp] Missão Empresarial                           │     │
│  │           📅 Mar 2026 · Paris, França                  │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ... (scroll infinito / paginação cursor-based)                 │
├─────────────────────────────────────────────────────────────────┤
│  ESTADO VAZIO                                                   │
│  [Ilustração SVG: mapa com pin, 120×120dp, centralizado]        │
│  "Nenhum contexto ainda"                                        │
│  "Registre onde e como conheceu seus contatos estratégicos."    │
│  [+ Registrar primeiro encontro]                                │
│  bg=#F59E0B · text=#0A1628 · bold · border-radius 12dp          │
├─────────────────────────────────────────────────────────────────┤
│  FAB (botão flutuante)                                          │
│  Posição: bottom-right · margin 24dp                            │
│  Tamanho: 56×56dp · border-radius 28dp                          │
│  bg: #F59E0B · ícone: + (24dp, branco)                          │
│  accessibilityLabel="Adicionar novo contexto"                   │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Cards: accessibilityRole="button" accessibilityLabel="[Nome], [Tipo], [Data], [N] contatos"
- Thumbnail: accessibilityLabel="Foto do contexto [Nome]"
- Filtros: accessibilityRole="tab" accessibilityState={{selected}}
- FAB: accessibilityRole="button" accessibilityLabel="Adicionar novo contexto"
```

### Tela B — Detalhe do Contexto

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (56dp)                                                   │
│  ← [Voltar]     "CPHI 2024"     [···] Menu (Editar / Excluir)  │
├─────────────────────────────────────────────────────────────────┤
│  SEÇÃO INFO                                                     │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  [Badge tipo: Feira Internacional · color_token]        │     │
│  │  📅 15 de outubro de 2024                               │     │
│  │  📍 Madrid, Espanha                                     │     │
│  │  ─────────────────────────────────────────────────────  │     │
│  │  Notas: "Maior feira farmacêutica do mundo. Foco em     │     │
│  │  parcerias para distribuição na América Latina."        │     │
│  │  [Ver mais ↓] se > 3 linhas (accordion)                 │     │
│  └────────────────────────────────────────────────────────┘     │
│  bg: #FFFFFF06 · border-radius 16dp · padding 16dp              │
├─────────────────────────────────────────────────────────────────┤
│  SEÇÃO PARTICIPANTES                                            │
│  Título: "👥 Participantes (3)"                                 │
│                                                                  │
│  TIPO A — Contatos da Base Particular:                          │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [Foto 40dp] Ana Souza · CEO, Fundo XYZ                 │     │
│  │             Profissional · Madrid, 15 out 2024         │     │
│  │             [Ver perfil →]                              │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ [Foto 40dp] Carlos Mendes · Embaixador                 │     │
│  │             Profissional · Madrid, 15 out 2024         │     │
│  └────────────────────────────────────────────────────────┘     │
│  Cada item: 64dp · padding 12dp · border-bottom 1px #FFFFFF0A  │
│                                                                  │
│  TIPO B — Outros participantes (avulsos):                       │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [Inicial] João Silva · Diretor, PharmaCorp             │     │
│  │           [Adicionar à minha rede →]                   │     │
│  └────────────────────────────────────────────────────────┘     │
│  Inicial: círculo 40dp · bg=#FFFFFF12 · text=#FFFFFF70          │
│  "Adicionar à minha rede": text-link · color=#F59E0B            │
│                                                                  │
│  [+ Adicionar contato desta rede]  [+ Participante avulso]      │
│  Botões: outline · border=#FFFFFF20 · text=#FFFFFF60            │
├─────────────────────────────────────────────────────────────────┤
│  SEÇÃO MÍDIA                                                    │
│  Título: "📷 Fotos e Documentos (5)"                            │
│                                                                  │
│  GRID 3 COLUNAS (gap 4dp):                                      │
│  ┌──────┐ ┌──────┐ ┌──────┐                                     │
│  │ img1 │ │ img2 │ │ img3 │  Cada célula: (375-32-8)/3 ≈ 111dp  │
│  └──────┘ └──────┘ └──────┘  Altura = largura (1:1)             │
│  ┌──────┐ ┌──────┐ ┌──────┐  border-radius: 8dp                 │
│  │ img4 │ │ PDF  │ │  +   │  PDF: ícone centralizado            │
│  └──────┘ └──────┘ └──────┘  "+" = adicionar mídia              │
│                                                                  │
│  Toque em imagem: abre lightbox/galeria fullscreen              │
│  Toque em PDF: abre visualizador ou download                    │
│  Long press: menu contextual (Ver legenda / Excluir)            │
│                                                                  │
│  [+ Adicionar foto ou documento]                                │
│  Botão: outline · padding 12×16dp · ícone 📎                    │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Thumbnails: accessibilityLabel="Foto [N] do contexto [Nome]"
- PDFs: accessibilityLabel="Documento PDF: [original_name]"
- Botão excluir contexto: accessibilityLabel="Excluir contexto [Nome]" + confirmação modal
```

### Tela C — Adicionar / Editar Contexto

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  [✕ Cancelar]    "Novo Contexto"    [Salvar]                    │
│  "Salvar" desabilitado até nome preenchido                      │
├─────────────────────────────────────────────────────────────────┤
│  FORMULÁRIO (scroll vertical)                                   │
│                                                                  │
│  Nome *                                                         │
│  [________________________________] max 100 chars               │
│  Contador: "0/100" · text-xs · #FFFFFF30                        │
│                                                                  │
│  Tipo de Contexto                                               │
│  [Selecione ou busque... ▾]                                     │
│  Dropdown searchable com os 10 tipos fixos + "Outro"            │
│  Cada opção: ícone colorido + nome                              │
│                                                                  │
│  Data do Evento                                                 │
│  [📅 Selecionar data]                                           │
│  Date picker nativo (DateTimePicker Expo)                       │
│  Validação: data futura > hoje+1 → erro inline                  │
│  Mensagem de erro: "A data não pode ser futura."                │
│  text-xs · color=#EF4444 · abaixo do campo                     │
│                                                                  │
│  Cidade                                                         │
│  [_________________________________]                            │
│  Texto livre (auto-completar geográfico em versão futura)       │
│                                                                  │
│  País                                                           │
│  [Selecione o país ▾]                                           │
│  Lista de países (ISO 3166-1) ordenada por uso recente          │
│                                                                  │
│  Notas                                                          │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ Descreva o contexto, objetivos, impressões...        │        │
│  └─────────────────────────────────────────────────────┘        │
│  Altura: 100dp · resize: none                                   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Vincular contatos agora?                                       │
│  [○ Não, fazer depois]  [● Sim, vincular agora]                 │
│  Segmented control · 2 opções                                   │
│  Se "Sim": abre seção de busca de contatos abaixo               │
│                                                                  │
│  ESTADO DE ERRO — Nome vazio:                                   │
│  Campo com border: 1px #EF4444                                  │
│  "Nome do contexto é obrigatório." · text-xs · #EF4444          │
└─────────────────────────────────────────────────────────────────┘
```

### Tela D — Vincular Contato ao Contexto

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (modal bottom sheet ou tela empilhada)                  │
│  ─── (drag handle 40×4dp)                                       │
│  "Vincular Contato"                                             │
├─────────────────────────────────────────────────────────────────┤
│  BUSCA DE CONTATO                                               │
│  🔍 [Buscar na minha rede...]                                   │
│  Auto-completar: busca em private_contacts por fullName         │
│  Resultado:                                                     │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ [Foto] Ana Souza · CEO, Fundo XYZ · São Paulo          │     │
│  │ [Foto] Ana Lima  · Diretora, Tech Corp · Brasília      │     │
│  └────────────────────────────────────────────────────────┘     │
│  Toque no contato: seleciona e mostra campos adicionais         │
├─────────────────────────────────────────────────────────────────┤
│  CAMPOS DO VÍNCULO (aparecem após selecionar contato)           │
│                                                                  │
│  Contato selecionado: [Foto 32dp] Ana Souza [✕ remover]         │
│                                                                  │
│  Data do Encontro                                               │
│  [📅 Herdar do contexto (15 out 2024)]  ou  [Outra data]        │
│  Toggle: "Usar data do contexto" (default: ON)                  │
│                                                                  │
│  Cidade do Encontro                                             │
│  [Herdar: Madrid] ou [_____________]                            │
│                                                                  │
│  Tipo de Relacionamento                                         │
│  [Pessoal] [● Profissional] [Ambos]                             │
│  Segmented control · 3 opções                                   │
│                                                                  │
│  Notas sobre este encontro                                      │
│  [Observações específicas sobre Ana neste contexto...]          │
│                                                                  │
│              [Cancelar]    [Vincular]                           │
│  "Vincular": bg=#F59E0B · text=#0A1628 · bold                   │
├─────────────────────────────────────────────────────────────────┤
│  CONFIRMAÇÃO (toast, 3s):                                       │
│  "Ana Souza vinculada ao CPHI 2024 ✓"                           │
│  bg=#1E293B · border-left: 4px #22C55E                          │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Busca: accessibilityLabel="Buscar contato na minha rede"
- Contato selecionado: accessibilityLabel="[Nome] selecionado. Toque para remover."
- Botão vincular: accessibilityLabel="Vincular [Nome] ao contexto [Contexto]"
- Toast: accessibilityLiveRegion="assertive"
```

---

## 4. Especificação de API REST (OpenAPI 3.0)

```yaml
openapi: "3.0.3"
info:
  title: MMM CRM — Contexts API (Etapa 3)
  version: "1.0.0"
  description: |
    Endpoints para gerenciamento de contextos (onde e como conheceu),
    vínculos contato-contexto, participantes avulsos e mídias.
    Autenticação: Bearer JWT. RBAC: roles `user` e `admin`.
    Rate limit padrão: 60 req/min por usuária.
    Todos os responses incluem header X-Request-ID.

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
        error_code: { type: string }
        message:    { type: string }
        details:    { type: object, additionalProperties: true }

    ContextType:
      type: object
      properties:
        id:          { type: string, format: uuid }
        name:        { type: string, example: "Feira Internacional" }
        slug:        { type: string, example: "feira-internacional" }
        color_token: { type: string, example: "#EF4444" }
        icon_name:   { type: string, example: "store" }

    Context:
      type: object
      properties:
        id:              { type: string, format: uuid }
        name:            { type: string }
        context_type:    { $ref: '#/components/schemas/ContextType' }
        event_date:      { type: string, format: date, nullable: true }
        city:            { type: string, nullable: true }
        country:         { type: string, nullable: true }
        notes:           { type: string, nullable: true }
        is_custom:       { type: boolean }
        contact_count:   { type: integer }
        thumbnail_url:   { type: string, nullable: true }
        created_at:      { type: string, format: date-time }

    ContactContext:
      type: object
      properties:
        id:                { type: string, format: uuid }
        contact_id:        { type: integer }
        contact_name:      { type: string }
        contact_photo_url: { type: string, nullable: true }
        contact_job_title: { type: string, nullable: true }
        event_date:        { type: string, format: date, nullable: true }
        city:              { type: string, nullable: true }
        country:           { type: string, nullable: true }
        notes:             { type: string, nullable: true }
        relationship_type: { type: string, enum: [pessoal, profissional, ambos] }

    ContextParticipant:
      type: object
      properties:
        id:      { type: string, format: uuid }
        name:    { type: string }
        company: { type: string, nullable: true }
        role:    { type: string, nullable: true }
        notes:   { type: string, nullable: true }
        converted_contact_id: { type: integer, nullable: true }

    ContextMedia:
      type: object
      properties:
        id:            { type: string, format: uuid }
        file_type:     { type: string }
        original_name: { type: string }
        caption:       { type: string, nullable: true }
        file_size:     { type: integer }
        view_url:      { type: string, description: "Presigned URL S3 (1h TTL)" }
        thumbnail_url: { type: string, nullable: true }
        created_at:    { type: string, format: date-time }

security:
  - BearerAuth: []

paths:

  # ──────────────────────────────────────────────────────────────────────────
  # GET /contexts
  # ──────────────────────────────────────────────────────────────────────────
  /contexts:
    get:
      summary: Listar contextos da usuária (fixos + personalizados)
      operationId: listContexts
      tags: [Contexts]
      parameters:
        - name: type
          in: query
          schema: { type: string, description: "Slug do tipo (ex: feira-internacional)" }
        - name: year
          in: query
          schema: { type: integer, example: 2024 }
        - name: country
          in: query
          schema: { type: string, example: "Espanha" }
        - name: q
          in: query
          schema: { type: string, description: "Busca textual em nome e notas" }
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: cursor
          in: query
          schema: { type: string, description: "Cursor opaco para paginação" }
      responses:
        "200":
          description: Lista de contextos ordenada por data decrescente
          headers:
            X-Request-ID: { schema: { type: string } }
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/Context' }
                  next_cursor: { type: string, nullable: true }
              example:
                data:
                  - id: "ctx-uuid"
                    name: "CPHI 2024"
                    context_type: { name: "Feira Internacional", color_token: "#EF4444" }
                    event_date: "2024-10-15"
                    city: "Madrid"
                    country: "Espanha"
                    is_custom: false
                    contact_count: 3
                    thumbnail_url: "https://cdn.mmmos.com/presigned/..."
                next_cursor: null
        "401":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "UNAUTHORIZED", message: "Token JWT ausente ou expirado.", details: {} }
        "429":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "RATE_LIMIT_EXCEEDED", message: "Limite de 60 req/min atingido.", details: { retry_after_seconds: 15 } }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /contexts
  # ──────────────────────────────────────────────────────────────────────────
    post:
      summary: Criar novo contexto personalizado
      operationId: createContext
      tags: [Contexts]
      parameters:
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:            { type: string, maxLength: 100 }
                context_type_id: { type: string, format: uuid }
                event_date:      { type: string, format: date }
                city:            { type: string, maxLength: 100 }
                country:         { type: string, maxLength: 100 }
                notes:           { type: string }
            example:
              name: "Roadshow Europa 2026"
              context_type_id: "type-missao-uuid"
              event_date: "2026-03-10"
              city: "Paris"
              country: "França"
              notes: "Apresentações para fundos europeus de impacto."
      responses:
        "201":
          headers:
            X-Request-ID: { schema: { type: string } }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Context' }
        "400":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "INVALID_NAME", message: "O nome do contexto é obrigatório.", details: {} }
        "401": { description: Unauthorized }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTEXT_DUPLICATE", message: "Você já tem um contexto com este nome nesta data.", details: {} }
        "422":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FUTURE_DATE", message: "A data do evento não pode ser futura.", details: { max_allowed: "2026-08-07" } }
        "429": { description: Rate limit }

  # ──────────────────────────────────────────────────────────────────────────
  # GET /contexts/{context_id}
  # ──────────────────────────────────────────────────────────────────────────
  /contexts/{context_id}:
    get:
      summary: Detalhe do contexto com contatos, participantes e mídias
      operationId: getContext
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          headers:
            X-Request-ID: { schema: { type: string } }
            ETag: { schema: { type: string } }
          content:
            application/json:
              schema:
                allOf:
                  - { $ref: '#/components/schemas/Context' }
                  - type: object
                    properties:
                      contacts:
                        type: array
                        items: { $ref: '#/components/schemas/ContactContext' }
                      participants:
                        type: array
                        items: { $ref: '#/components/schemas/ContextParticipant' }
                      media:
                        type: array
                        items: { $ref: '#/components/schemas/ContextMedia' }
        "401": { description: Unauthorized }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FORBIDDEN", message: "Este contexto não pertence à sua conta.", details: {} }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTEXT_NOT_FOUND", message: "Contexto não encontrado.", details: {} }
        "429": { description: Rate limit }

    put:
      summary: Atualizar contexto personalizado
      operationId: updateContext
      tags: [Contexts]
      description: |
        Apenas o `user_id` dono do contexto ou `admin` pode atualizar.
        Contextos globais (is_custom=false) não podem ser editados por usuárias comuns.
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
        - name: If-Match
          in: header
          required: true
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:            { type: string, maxLength: 100 }
                context_type_id: { type: string, format: uuid }
                event_date:      { type: string, format: date }
                city:            { type: string }
                country:         { type: string }
                notes:           { type: string }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Context' }
        "400": { description: Validation error }
        "401": { description: Unauthorized }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CANNOT_EDIT_GLOBAL_CONTEXT", message: "Contextos globais não podem ser editados.", details: {} }
        "404": { description: Not found }
        "412": { description: ETag mismatch }
        "422": { description: Future date }
        "429": { description: Rate limit }

    delete:
      summary: Excluir contexto
      operationId: deleteContext
      description: |
        **Decisão: Soft delete no contexto + hard delete nos metadados de mídia + lifecycle S3.**
        Justificativa: o contexto é movido para `deleted_at` (soft delete) para permitir
        recuperação em até 30 dias. Os metadados de mídia no PostgreSQL são deletados
        imediatamente (hard delete). Os arquivos S3 são movidos para prefixo `deleted/`
        via lifecycle policy e expiram em 30 dias. Os vínculos contact_contexts e
        context_participants são deletados em cascata (ON DELETE CASCADE no schema).
        Os contatos da Base Particular NÃO são afetados.
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204": { description: Contexto excluído com sucesso }
        "401": { description: Unauthorized }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FORBIDDEN", message: "Apenas o dono do contexto ou admin pode excluí-lo.", details: {} }
        "404": { description: Not found }
        "429": { description: Rate limit }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /contexts/{context_id}/contacts — Vincular contato
  # ──────────────────────────────────────────────────────────────────────────
  /contexts/{context_id}/contacts:
    post:
      summary: Vincular contato da Base Particular ao contexto
      operationId: linkContactToContext
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [contact_id]
              properties:
                contact_id:        { type: integer }
                event_date:        { type: string, format: date, nullable: true }
                city:              { type: string, nullable: true }
                country:           { type: string, nullable: true }
                notes:             { type: string, maxLength: 1000, nullable: true }
                relationship_type: { type: string, enum: [pessoal, profissional, ambos], default: profissional }
            example:
              contact_id: 42
              event_date: "2024-10-15"
              city: "Madrid"
              country: "Espanha"
              relationship_type: "profissional"
              notes: "Apresentou interesse em parceria para América Latina."
      responses:
        "201":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ContactContext' }
        "400":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "INVALID_CONTACT_ID", message: "contact_id é obrigatório.", details: {} }
        "401": { description: Unauthorized }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTACT_NOT_OWNED", message: "Este contato não pertence à sua rede.", details: {} }
        "404": { description: Context or contact not found }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "LINK_DUPLICATE", message: "Este contato já está vinculado a este contexto nesta data.", details: { existing_link_id: "link-uuid" } }
        "422":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FUTURE_DATE", message: "A data do encontro não pode ser futura.", details: {} }
        "429": { description: Rate limit }

  /contexts/{context_id}/contacts/{contact_id}:
    delete:
      summary: Desvincular contato do contexto (não exclui o contato)
      operationId: unlinkContactFromContext
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204": { description: Vínculo removido. Contato permanece na Base Particular. }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "LINK_NOT_FOUND", message: "Vínculo não encontrado.", details: {} }
        "429": { description: Rate limit }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /contexts/{context_id}/participants — Participante avulso
  # ──────────────────────────────────────────────────────────────────────────
  /contexts/{context_id}/participants:
    post:
      summary: Adicionar participante avulso (texto livre)
      operationId: addContextParticipant
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:    { type: string, maxLength: 200 }
                company: { type: string, maxLength: 200, nullable: true }
                role:    { type: string, maxLength: 200, nullable: true }
                notes:   { type: string, maxLength: 500, nullable: true }
            example:
              name: "João Silva"
              company: "PharmaCorp"
              role: "Diretor de Parcerias"
              notes: "Demonstrou interesse em distribuição no Brasil."
      responses:
        "201":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ContextParticipant' }
        "400": { description: Validation error }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Context not found }
        "429": { description: Rate limit }

  # ──────────────────────────────────────────────────────────────────────────
  # POST /contexts/{context_id}/media — Upload de mídia
  # ──────────────────────────────────────────────────────────────────────────
  /contexts/{context_id}/media:
    post:
      summary: Fazer upload de foto ou documento para o contexto
      operationId: uploadContextMedia
      description: |
        **Abordagem escolhida: Presigned URL S3 em duas etapas.**
        1. Cliente chama este endpoint → servidor valida, gera presigned PUT URL (15min TTL) e retorna.
        2. Cliente faz PUT diretamente para o S3 usando a presigned URL.
        3. Cliente notifica o servidor via PATCH /media/{media_id}/confirm após upload concluído.
        
        Justificativa: elimina o tráfego de arquivo pelo servidor NestJS, reduzindo latência
        e custo de egress. O servidor valida tipo e tamanho via Content-Type e Content-Length
        headers na presigned URL (S3 conditions). Upload direto do app para S3 sem etapa 3
        seria mais simples, mas exigiria expor credenciais AWS no app mobile — inaceitável.
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [file_name, file_type, file_size]
              properties:
                file_name:  { type: string, maxLength: 255 }
                file_type:  { type: string, enum: [image/jpeg, image/png, image/heic, application/pdf] }
                file_size:  { type: integer, description: "Tamanho em bytes (máx 10MB = 10485760)" }
                caption:    { type: string, maxLength: 255, nullable: true }
            example:
              file_name: "foto-cphi-2024.jpg"
              file_type: "image/jpeg"
              file_size: 2048000
              caption: "Estande da empresa parceira"
      responses:
        "201":
          description: Presigned URL gerada. Cliente deve fazer PUT para upload_url.
          content:
            application/json:
              schema:
                type: object
                properties:
                  media_id:   { type: string, format: uuid }
                  upload_url: { type: string, description: "Presigned PUT URL S3 (15min TTL)" }
                  storage_path: { type: string }
              example:
                media_id: "media-uuid"
                upload_url: "https://mmm-private.s3.amazonaws.com/mmm/user-id/contexts/ctx-id/1722960000_foto.jpg?X-Amz-..."
                storage_path: "mmm/user-id/contexts/ctx-id/1722960000_foto-cphi-2024.jpg"
        "400":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "INVALID_FILE_TYPE", message: "Tipo de arquivo não permitido. Use JPEG, PNG, HEIC ou PDF.", details: {} }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Context not found }
        "413":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "FILE_TOO_LARGE", message: "O arquivo excede o limite de 10MB.", details: { max_bytes: 10485760, received_bytes: 12582912 } }
        "429": { description: Rate limit }

  /contexts/{context_id}/media/{media_id}:
    delete:
      summary: Excluir mídia do contexto
      operationId: deleteContextMedia
      description: |
        Hard delete no metadado PostgreSQL.
        O arquivo S3 é movido para prefixo `deleted/` via lifecycle policy
        e expira permanentemente após 30 dias.
      tags: [Contexts]
      parameters:
        - name: context_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: media_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204": { description: Mídia removida }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "MEDIA_NOT_FOUND", message: "Mídia não encontrada.", details: {} }
        "429": { description: Rate limit }
```

---

## 5. Estratégia de Storage e Mídia

### 5.1 Comparação de Abordagens de Upload

| Abordagem | Prós | Contras | Recomendação |
|---|---|---|---|
| **A. Upload via API (servidor como proxy)** | Controle total; validação server-side antes do S3 | Dobra o tráfego de rede; bottleneck no servidor; custo de egress | ❌ Não recomendado |
| **B. Presigned URL S3 (duas etapas)** | Upload direto app→S3; servidor não processa bytes; S3 valida tipo/tamanho via conditions | Requer etapa de confirmação; cliente precisa lidar com dois requests | ✅ **Recomendado** |
| **C. Upload direto com credenciais temporárias (STS)** | Máxima performance; sem etapa de confirmação | Complexidade de STS/IAM; risco de credenciais no app | ❌ Complexidade excessiva para MVP |

**Abordagem escolhida: B (Presigned URL S3 em duas etapas).**

### 5.2 Estrutura de Path no Bucket

```
Bucket: mmm-private (privado, sem acesso público)

Estrutura:
mmm/{user_id}/contexts/{context_id}/{timestamp}_{filename}

Exemplos:
mmm/usr-abc/contexts/ctx-xyz/1722960000_foto-cphi-2024.jpg
mmm/usr-abc/contexts/ctx-xyz/1722960100_contrato.pdf

Soft-deleted (lifecycle policy):
deleted/mmm/{user_id}/contexts/{context_id}/{timestamp}_{filename}

Thumbnails (gerados assincronamente):
mmm/{user_id}/contexts/{context_id}/thumbs/{timestamp}_{filename}
```

### 5.3 Política de Lifecycle S3

```json
{
  "Rules": [
    {
      "ID": "delete-soft-deleted-after-30-days",
      "Filter": { "Prefix": "deleted/" },
      "Status": "Enabled",
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Filter": { "Prefix": "mmm/" },
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

### 5.4 Segurança do Bucket

```
- Bucket: privado (Block Public Access = ON em todas as opções)
- Acesso de leitura: presigned GET URL com TTL de 1 hora
- Acesso de escrita: presigned PUT URL com TTL de 15 minutos
- Condições na presigned PUT URL:
    Content-Type: deve corresponder ao file_type declarado
    Content-Length: máximo 10485760 (10MB)
- CloudFront: distribuição privada com signed URLs para thumbnails
- CORS: permitir apenas origins da app mobile e domínio da API
- Encryption: SSE-S3 (AES-256) em todos os objetos
- Versioning: desabilitado no MVP (habilitar se auditoria de versões for necessária)
```

---

## 6. Estratégia de Indexação e Busca

### 6.1 Índices por Tabela

| Tabela | Nome do Índice | Tipo | Colunas | Justificativa |
|---|---|---|---|---|
| `contexts` | `idx_ctx_user_id` | B-tree | `user_id` | RLS + filtro principal |
| `contexts` | `idx_ctx_user_date` | B-tree | `(user_id, event_date DESC)` | Lista cronológica por usuária |
| `contexts` | `idx_ctx_user_country` | B-tree | `(user_id, country)` | Filtro por país |
| `contexts` | `idx_ctx_type` | B-tree | `context_type_id` | Filtro por tipo |
| `contexts` | `idx_ctx_name_trgm` | GIN (pg_trgm) | `name gin_trgm_ops` | Busca fuzzy por nome |
| `contexts` | `idx_ctx_notes_trgm` | GIN (pg_trgm) | `notes gin_trgm_ops` | Busca textual em notas |
| `contact_contexts` | `idx_cc_user_context` | B-tree | `(user_id, context_id)` | Listar contatos de um contexto |
| `contact_contexts` | `idx_cc_user_contact` | B-tree | `(user_id, contact_id)` | Listar contextos de um contato |
| `contact_contexts` | `idx_cc_uniq` | B-tree (UNIQUE) | `(user_id, contact_id, context_id, event_date)` | Prevenir duplicatas |
| `context_participants` | `idx_cp_context` | B-tree | `(user_id, context_id)` | Listar participantes de um contexto |
| `context_media` | `idx_cm_context` | B-tree | `(user_id, context_id, deleted_at)` | Galeria de mídias (excluindo soft-deleted) |
| `context_media` | `idx_cm_sort` | B-tree | `(context_id, sort_order, created_at)` | Ordenação da galeria |

### 6.2 Query Principal — Lista de Contextos com Contagem

```sql
-- Garantia de <300ms para 1.000 contextos por usuária
SELECT
  c.id, c.name, c.event_date, c.city, c.country, c.is_custom,
  ct.name AS type_name, ct.color_token,
  COUNT(DISTINCT cc.contact_id) AS contact_count,
  (
    SELECT cm.storage_path
    FROM context_media cm
    WHERE cm.context_id = c.id
      AND cm.user_id = $1
      AND cm.file_type LIKE 'image/%'
      AND cm.deleted_at IS NULL
    ORDER BY cm.created_at ASC
    LIMIT 1
  ) AS thumbnail_path
FROM contexts c
LEFT JOIN context_types ct ON ct.id = c.context_type_id
LEFT JOIN contact_contexts cc ON cc.context_id = c.id AND cc.user_id = $1
WHERE (c.user_id = $1 OR c.user_id IS NULL)
  AND ($2::VARCHAR IS NULL OR ct.slug = $2)           -- filtro tipo
  AND ($3::INT IS NULL OR EXTRACT(YEAR FROM c.event_date) = $3) -- filtro ano
  AND ($4::VARCHAR IS NULL OR c.country ILIKE $4)     -- filtro país
  AND ($5::VARCHAR IS NULL OR (
    c.name % $5 OR c.notes % $5                       -- busca fuzzy
  ))
GROUP BY c.id, ct.name, ct.color_token
ORDER BY c.event_date DESC NULLS LAST, c.created_at DESC
LIMIT $6
OFFSET $7;
```

---

## 7. Critérios de Aceite (Definition of Done)

| # | Critério | Como verificar |
|---|---|---|
| 1 | Usuária cria contexto personalizado em ≤ 4 campos | Teste de usabilidade: nome + tipo + data + cidade |
| 2 | Vincula contato existente em ≤ 3 toques após busca | Busca → seleciona → confirma |
| 3 | Upload de foto (5MB) completa em < 10s em 4G | Teste de carga com throttling de rede |
| 4 | Lista "Meus Contextos" carrega em < 300ms | `EXPLAIN ANALYZE` com 1.000 contextos |
| 5 | Contexto duplicado (mesmo nome + data) retorna 409 | Teste de integração: POST duas vezes |
| 6 | Participante avulso convertido em contato com 1 toque | Teste E2E: toque em "Adicionar à minha rede" |
| 7 | Exclusão de contexto não exclui contatos vinculados | Verificar que private_contacts permanece intacto |
| 8 | Todos os endpoints retornam `X-Request-ID` | Teste de contrato em todos os responses |

### 7.1 Casos de Teste Detalhados

```
Happy path — fluxo completo:
1. Usuária cria contexto "CPHI 2024" (tipo: Feira Internacional, data: 15/10/2024, Madrid)
2. Vincula contato "Ana Souza" com notes "Interesse em parceria"
3. Adiciona participante avulso "João Silva, PharmaCorp"
4. Faz upload de foto (2MB JPEG) → presigned URL → confirma
5. Visualiza cartão de perfil da Ana com badge "CPHI 2024" na seção de contextos

Edge case — duplicata de vínculo:
1. Vincula Ana ao CPHI 2024 com data 15/10/2024 → sucesso
2. Tenta vincular Ana ao CPHI 2024 com data 15/10/2024 novamente → 409
3. Vincula Ana ao CPHI 2024 com data 16/10/2024 (reencontro) → sucesso (datas diferentes)

Edge case — upload inválido:
1. Tenta upload de PDF com 12MB → 413 com mensagem clara
2. Tenta upload de .docx → 400 com error_code INVALID_FILE_TYPE

Edge case — exclusão de contexto:
1. Contexto "CPHI 2024" tem 3 contatos vinculados e 2 fotos
2. Usuária exclui o contexto
3. Vínculos contact_contexts deletados em cascata
4. Metadados context_media deletados (hard delete no PostgreSQL)
5. Arquivos S3 movidos para deleted/ → expiram em 30 dias
6. Contatos Ana, Carlos e Maria permanecem intactos na Base Particular

Edge case — offline:
1. Usuária sem conexão tenta criar contexto
2. App detecta ausência de rede (NetInfo API do Expo)
3. Exibe: "Sem conexão. Verifique sua internet e tente novamente."
4. Botão "Tentar novamente" resubmete após reconexão
```

---

## 8. Decisões Pendentes

| # | Questão | Impacto | Prazo sugerido |
|---|---|---|---|
| 1 | **Offline com fila local:** o MVP mostra erro com retry. Se o produto quiser suporte offline real (criar contexto sem rede, sincronizar depois), é necessário implementar fila local com AsyncStorage/SQLite + sync job. Confirmar se é requisito do MVP ou versão futura. | Alto — impacta arquitetura mobile | Antes do sprint 1 |
| 2 | **Geração de thumbnail:** a spec prevê thumbnail gerado assincronamente por Lambda/worker. Se não houver Lambda disponível na infra atual, a alternativa é gerar no servidor NestJS após confirmação do upload (síncrono, mais lento). Confirmar abordagem. | Médio — afeta UX da galeria | Antes do sprint 2 |
| 3 | **Limite de mídias por contexto:** sem limite definido no MVP. Sugestão: 50 arquivos por contexto. Confirmar. | Baixo no MVP | Antes do sprint 1 |
| 4 | **Auto-completar geográfico de cidades:** a spec usa texto livre no MVP. Se o produto quiser auto-completar (Google Places API ou similar), é uma evolução de sprint 3+. Confirmar prioridade. | Baixo — UX improvement | Backlog |
| 5 | **Contextos globais editáveis por admin:** a spec bloqueia edição de contextos globais por usuárias comuns. Confirmar se admins podem editar via painel (ex: corrigir nome do "CPHI" para "CPhI World Congress"). | Baixo | Antes do sprint 2 |

---

*Documento gerado por Manus AI · Projeto MMM — Mulheres que Movem o Mundo · Etapa 3 de N*
