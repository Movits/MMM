# Especificação Técnica — Etapa 4
## Complementação Inteligente: Chat de Enriquecimento de Cadastro
### Módulo CRM Inteligente · MMM (Mulheres que Movem o Mundo)

> **Versão:** 1.0 · **Data:** Agosto 2026 · **Autor:** Manus AI para Projeto MMM
> **Stack:** Node.js / NestJS · PostgreSQL 15+ (RDS) · React Native (Expo SDK 51) · OpenAI GPT-4o
> **Escopo:** MVP até 2.000 usuárias · ~5 sessões de enriquecimento/contato · ~1,5M mensagens/ano
> **Dependências:** Etapa 1 (Base Particular de Contatos) · Etapa 2 (Perfil Estratégico) · Etapa 3 (Contextos)

---

## 1. Visão Geral e Decisões de Negócio

Este módulo adiciona um assistente de IA conversacional ao perfil de cada contato. Após o cadastro manual de um novo contato (Etapa 1), o sistema inicia automaticamente uma sessão de enriquecimento. A IA conduz uma conversa em linguagem natural, extrai entidades estruturadas das respostas e propõe preenchimento dos campos do contato, tags de ativos/necessidades (Etapa 2) e vínculos de contexto (Etapa 3), sempre com confirmação explícita da usuária.

| Dimensão | Decisão |
|---|---|
| **Gatilho** | Automático após cadastro manual + manual sob demanda ("Enriquecer cadastro") |
| **Perguntas** | Dinâmica com roteiro mínimo de 6 perguntas obrigatórias; IA decide ordem e follow-ups |
| **Mapeamento** | NER via IA + confirmação da usuária (confirmar / editar / ignorar) |
| **Memória** | Persistência completa; contexto da IA = últimas 10 interações da sessão |
| **LGPD** | Consentimento implícito com aviso transparente; base legal: legítimo interesse da usuária |
| **Término** | 6 perguntas respondidas OU usuária encerra OU timeout de 7 dias |
| **Modelo de IA** | GPT-4o (ver justificativa em §5.2) |

**Roteiro base de 6 perguntas obrigatórias:**

| # | Campo alvo | Pergunta base |
|---|---|---|
| 1 | `phone` / `whatsapp` | Qual é o telefone ou WhatsApp dela? |
| 2 | `company` | Em qual empresa ou instituição ela atua? |
| 3 | `contact_assets` | O que ela tem a oferecer? (produtos, serviços, recursos, expertise) |
| 4 | `contact_needs` | O que ela está procurando ou precisa? |
| 5 | `context` (Etapa 3) | Como e onde vocês se conheceram? |
| 6 | `relationship_type` | Como você descreveria o relacionamento? (pessoal, profissional, ambos) |

---

## 2. Modelo de Dados — Schema SQL (PostgreSQL 15+)

### 2.1 Schema Completo

```sql
-- ============================================================
-- EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENRICHMENT_SESSIONS — Uma sessão por contato por usuária
-- ============================================================
CREATE TABLE enrichment_sessions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL,    -- FK → users.id (RLS)
  contact_id      BIGINT      NOT NULL,    -- FK → private_contacts.id (Etapa 1)
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'completed', 'timeout', 'cancelled')),
  questions_answered  SMALLINT NOT NULL DEFAULT 0,  -- das 6 obrigatórias
  questions_skipped   SMALLINT NOT NULL DEFAULT 0,
  summary         TEXT,                    -- gerado pela IA ao concluir
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Apenas uma sessão ativa por contato por usuária
  CONSTRAINT uq_session_active UNIQUE (user_id, contact_id, status)
    DEFERRABLE INITIALLY DEFERRED
  -- Nota: a constraint UNIQUE com status funciona para 'active'.
  -- Para múltiplas sessões completed/timeout, usar partial unique index:
);

-- Partial unique index: apenas uma sessão 'active' por contato por usuária
CREATE UNIQUE INDEX idx_session_one_active
  ON enrichment_sessions (user_id, contact_id)
  WHERE status = 'active';

COMMENT ON TABLE enrichment_sessions IS
  'Cada sessão representa um ciclo de enriquecimento de um contato. '
  'Apenas uma sessão active por (user_id, contact_id) ao mesmo tempo. '
  'Sessões completed/timeout/cancelled podem coexistir (histórico).';

-- ============================================================
-- ENRICHMENT_MESSAGES — Cada turno da conversa
-- ============================================================
CREATE TABLE enrichment_messages (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID        NOT NULL REFERENCES enrichment_sessions(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  user_id         UUID        NOT NULL,    -- desnormalizado para RLS eficiente
  role            VARCHAR(10) NOT NULL
                  CHECK (role IN ('system', 'assistant', 'user')),
  content         TEXT        NOT NULL,
  -- metadata JSONB: dados estruturados extraídos pela IA nesta mensagem
  -- Exemplo: {"extracted": [{"field": "company", "value": "Farmacore", "confidence": 0.95}]}
  metadata        JSONB,
  token_count     INTEGER,                 -- tokens consumidos (para billing)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN enrichment_messages.metadata IS
  'Dados estruturados extraídos pela IA. Schema: '
  '{"extracted": [{"field": "company|phone|asset|need|context", '
  '"value": "string", "confidence": 0.0-1.0, "suggestion_id": "uuid"}], '
  '"question_key": "phone|company|assets|needs|context|relationship"}';

-- ============================================================
-- ENRICHMENT_SUGGESTIONS — Cada extração da IA aguardando confirmação
-- ============================================================
CREATE TABLE enrichment_suggestions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID        NOT NULL REFERENCES enrichment_sessions(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  message_id      UUID        NOT NULL REFERENCES enrichment_messages(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  user_id         UUID        NOT NULL,    -- desnormalizado para RLS
  contact_id      BIGINT      NOT NULL,
  -- Tipo de dado extraído
  field_type      VARCHAR(30) NOT NULL
                  CHECK (field_type IN (
                    'phone', 'whatsapp', 'email', 'company', 'job_title',
                    'city', 'country', 'linkedin_url', 'instagram_handle',
                    'asset_tag', 'need_tag', 'context_link', 'relationship_type', 'notes'
                  )),
  -- Valor sugerido pela IA (texto livre)
  suggested_value TEXT        NOT NULL,
  -- Valor final aplicado (pode diferir se usuária editou)
  applied_value   TEXT,
  -- Tag do dicionário (Etapa 2), se field_type = asset_tag ou need_tag
  tag_id          UUID,                    -- FK → tags_dictionary.id (Etapa 2)
  tag_is_new      BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE = proposta de nova tag
  -- Confiança da IA (0.0 a 1.0)
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.0
                  CHECK (confidence >= 0.0 AND confidence <= 1.0),
  -- Status do ciclo de vida da sugestão
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'edited', 'ignored', 'applied', 'undone')),
  -- Auditoria
  actioned_at     TIMESTAMPTZ,
  actioned_by     VARCHAR(20),             -- 'user' ou 'system' (timeout auto-apply)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE enrichment_suggestions IS
  'Cada linha é uma extração da IA aguardando ação da usuária. '
  'status=applied significa que o dado foi gravado no contato/tags. '
  'status=undone significa que a usuária desfez após aplicar.';

-- ============================================================
-- CAMPO ENRICHMENT_STATUS NA TABELA CONTACTS (Etapa 1)
-- ============================================================
-- ALTER TABLE private_contacts
--   ADD COLUMN enrichment_status VARCHAR(20) DEFAULT 'none'
--     CHECK (enrichment_status IN ('none', 'active', 'completed', 'paused'));
-- Nota: campo desnormalizado para exibir badge no card sem JOIN.
-- Atualizado por trigger ou pelo backend ao mudar status da sessão.

-- ============================================================
-- REFERÊNCIA: CONTACT_ASSETS e CONTACT_NEEDS (Etapa 2)
-- ============================================================
-- Alimentadas pela confirmação de sugestões com field_type = 'asset_tag' / 'need_tag':
-- INSERT INTO contact_assets (contact_id, tag_id, source, source_session_id)
--   VALUES ($contact_id, $tag_id, 'ai_enrichment', $session_id);
-- O campo source='ai_enrichment' permite filtrar o que veio da IA vs. manual.

-- ============================================================
-- ÍNDICES
-- ============================================================
-- Sessões por contato (para verificar se já existe sessão ativa)
CREATE INDEX idx_es_user_contact    ON enrichment_sessions (user_id, contact_id);
CREATE INDEX idx_es_status          ON enrichment_sessions (status, last_activity_at);
CREATE INDEX idx_es_user_created    ON enrichment_sessions (user_id, created_at DESC);

-- Mensagens por sessão (para montar contexto da IA)
CREATE INDEX idx_em_session_created ON enrichment_messages (session_id, created_at ASC);
CREATE INDEX idx_em_user_created    ON enrichment_messages (user_id, created_at DESC);

-- Sugestões por sessão e status (para listar pendentes)
CREATE INDEX idx_esg_session_status ON enrichment_suggestions (session_id, status);
CREATE INDEX idx_esg_contact_applied ON enrichment_suggestions (contact_id, status)
  WHERE status IN ('applied', 'undone');  -- para histórico de enriquecimento
CREATE INDEX idx_esg_user_created   ON enrichment_suggestions (user_id, created_at DESC);
```

### 2.2 Row-Level Security (RLS)

```sql
ALTER TABLE enrichment_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_es_owner ON enrichment_sessions
  USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY rls_em_owner ON enrichment_messages
  USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY rls_esg_owner ON enrichment_suggestions
  USING (user_id = current_setting('app.current_user_id')::UUID);
```

---

## 3. Estratégia de IA e Prompt Engineering

### 3.1 Modelo Recomendado

| Critério | GPT-4o (OpenAI) | Claude 3.5 Sonnet (Anthropic) |
|---|---|---|
| **Custo input** | $2,50 / 1M tokens | $3,00 / 1M tokens |
| **Custo output** | $10,00 / 1M tokens | $15,00 / 1M tokens |
| **Latência P50** | ~800ms | ~1.200ms |
| **NER em português** | Excelente — treinado com dados extensos em pt-BR | Muito bom — ligeiramente inferior em entidades regionais |
| **JSON estruturado** | `response_format: json_object` nativo | Requer instrução no prompt |
| **Fine-tuning** | Disponível (GPT-4o fine-tuning) | Não disponível publicamente |
| **Contexto máximo** | 128k tokens | 200k tokens |
| **Disponibilidade SLA** | 99,9% (Azure OpenAI) | 99,5% (Anthropic API) |

**Recomendação: GPT-4o via Azure OpenAI.** Justificativa: menor custo de output (crítico para sessões longas), latência mais baixa (fundamental para UX de chat), suporte nativo a JSON estruturado (elimina parsing frágil), SLA mais alto via Azure, e fine-tuning disponível para versão futura com dados do MMM.

### 3.2 System Prompt (Especificação)

```
PERSONA:
Você é a Assistente de Networking do MMM (Mulheres que Movem o Mundo).
Seu papel é ajudar a usuária a completar o cadastro de um contato estratégico
de forma conversacional, natural e eficiente.
Tom: consultivo, direto, respeitoso, sem ser robótico.
Idioma: sempre o mesmo idioma da usuária (detectar automaticamente).

OBJETIVO:
Coletar informações sobre o contato seguindo o roteiro base de 6 perguntas.
Extrair entidades estruturadas das respostas.
Sugerir tags do dicionário quando aplicável.

ROTEIRO BASE (perguntar na ordem que fizer mais sentido dado o contexto):
1. Telefone/WhatsApp
2. Empresa/Instituição
3. O que ela oferece (ativos: produtos, serviços, expertise, recursos)
4. O que ela procura (necessidades: investimento, parceiros, clientes, etc.)
5. Como e onde se conheceram
6. Tipo de relacionamento (pessoal / profissional / ambos)

REGRAS DE COMPORTAMENTO:
- Se um campo já está preenchido, confirme em vez de perguntar do zero.
  Ex: "Vejo que ela trabalha na Farmacore. Está correto?"
- Faça apenas UMA pergunta por turno.
- Se a resposta for vaga, faça um follow-up contextual.
  Ex: "Você mencionou indústria farmacêutica. Qual é a especialidade dela?"
- Se a usuária disser "não sei" ou "não tenho", marque como skipped e avance.
- Não repita perguntas já respondidas ou explicitamente ignoradas.
- Ao detectar uma entidade, inclua-a no campo extracted_entities do JSON.
- Se a confiança for < 0.7, pergunte de volta em vez de assumir.

FORMATO DE SAÍDA (JSON obrigatório):
{
  "next_question": "texto da próxima pergunta para a usuária",
  "question_key": "phone|company|assets|needs|context|relationship|followup|complete",
  "extracted_entities": [
    {
      "field_type": "company|phone|asset_tag|need_tag|context_link|relationship_type|...",
      "value": "valor extraído",
      "confidence": 0.0-1.0,
      "display_label": "texto amigável para mostrar na UI"
    }
  ],
  "suggested_tags": [
    {
      "name": "nome da tag",
      "category": "asset|need",
      "is_new": true|false,
      "existing_tag_id": "uuid ou null"
    }
  ],
  "session_complete": false,
  "completion_summary": null
}

Quando question_key = "complete", preencha completion_summary com um resumo
do que foi coletado nesta sessão.
```

### 3.3 Context Window — Montagem do Contexto por Turno

A cada mensagem da usuária, o backend monta o seguinte contexto para enviar à IA:

```json
{
  "system": "[System Prompt acima]",
  "messages": [
    {
      "role": "system",
      "content": "DADOS DO CONTATO JÁ PREENCHIDOS:\n- Nome: Ana Souza\n- Empresa: (vazio)\n- Cargo: CEO\n- País: Brasil\n\nPERGUNTAS DO ROTEIRO JÁ RESPONDIDAS: []\nPERGUNTAS PULADAS: []\nSESSÃO ID: uuid"
    },
    // Últimas 10 mensagens da sessão (role: assistant/user)
    { "role": "assistant", "content": "Olá! Vou te ajudar a completar o cadastro da Ana..." },
    { "role": "user",      "content": "Ela trabalha na Farmacore" },
    // ... até 10 mensagens
    { "role": "user", "content": "[mensagem atual da usuária]" }
  ]
}
```

**Estratégia de truncamento:** se o contato tiver muitos dados preenchidos, o campo `DADOS DO CONTATO` é resumido mantendo apenas os campos vazios e os 3 mais recentemente atualizados. O histórico de mensagens é sempre limitado às últimas 10 (não às últimas N tokens), garantindo previsibilidade de custo.

### 3.4 Estratégia de NER (Named Entity Recognition)

A IA realiza NER diretamente no LLM (sem modelo separado), extraindo entidades conforme o schema de `extracted_entities`. Exemplos de mapeamento:

| Resposta da usuária | Campo extraído | Valor | Confiança |
|---|---|---|---|
| "Ela trabalha na Farmacore, uma pharma de SP" | `company` = "Farmacore", `city` = "São Paulo", `asset_tag` = "indústria farmacêutica" | múltiplos | 0.95 |
| "Está procurando investidor série A" | `need_tag` = "investimento série A" | tag nova | 0.88 |
| "Conheci na CPHI em Madrid" | `context_link` = "CPHI", `city` = "Madrid" | múltiplos | 0.92 |
| "Não sei o telefone dela" | — | skipped: `phone` | 1.00 |
| "Ela tem uma mina no interior" | `asset_tag` = "mineração" (proposta) | tag nova | 0.71 |

**Tratamento de ambiguidade:** se `confidence < 0.7`, a IA inclui `next_question` pedindo esclarecimento em vez de incluir a entidade em `extracted_entities`. Exemplo: "Você mencionou 'mina' — seria uma mina de mineração ou outro tipo de ativo?"

---

## 4. Fluxo de Tela UX/UI — Wireframes Descritivos

Todos os wireframes são mobile-first, largura base 375px.

### Tela A — Perfil do Contato com Chat Ativo

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (56dp)                                                   │
│  ← [Voltar]        [Foto 40dp] Ana Souza        [···]           │
│  Abaixo do nome: badge "✨ Enriquecendo..." (amber, pulsante)   │
├─────────────────────────────────────────────────────────────────┤
│  DADOS DO CONTATO (metade superior, scroll)                     │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Cargo: CEO · Empresa: (a preencher)                    │     │
│  │ País: Brasil · Telefone: (a preencher)                 │     │
│  │ [Ver perfil completo →]                                │     │
│  └────────────────────────────────────────────────────────┘     │
│  Altura: ~200dp                                                  │
├─────────────────────────────────────────────────────────────────┤
│  DIVISOR COM LABEL: "✨ Chat de Enriquecimento"                 │
│  bg: #FFFFFF06 · text-xs · amber · padding 8dp                  │
├─────────────────────────────────────────────────────────────────┤
│  ÁREA DO CHAT (scroll, flex-1, min-height 200dp)                │
│                                                                  │
│  [Avatar MMM]  Olá! Vou te ajudar a completar o cadastro        │
│                da Ana. Qual é o telefone ou WhatsApp dela?      │
│                bg: #FFFFFF10 · border-radius: 0 12 12 12dp      │
│                max-width: 75%                                    │
│                                                                  │
│                              Não tenho o telefone dela.  [você] │
│                              bg: #F59E0B20 · border-radius: 12  │
│                              0 12 12dp · max-width: 75%         │
│                                                                  │
│  [Avatar MMM]  Tudo bem! Em qual empresa ela atua?              │
│                                                                  │
│                              Ela trabalha na Farmacore.  [você] │
│                                                                  │
│  [CARD DE SUGESTÃO — ver Tela B]                                │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  INPUT FIXO (bottom, 56dp)                                      │
│  [___ Responda aqui... ___________________] [→ Enviar]          │
│  bg: #0A1628 · border-top: 1px #FFFFFF12                        │
│  Input: bg: #FFFFFF08 · border-radius: 24dp · padding: 12 16dp  │
│  Botão enviar: 40×40dp · bg: #F59E0B · ícone: →                 │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Área do chat: accessibilityRole="log" accessibilityLiveRegion="polite"
- Input: accessibilityLabel="Campo de resposta para o assistente de IA"
- Botão enviar: accessibilityLabel="Enviar resposta"
- Badge: accessibilityLabel="Enriquecimento de cadastro em andamento"
```

### Tela B — Bubble da IA com Card de Sugestão

```
┌─────────────────────────────────────────────────────────────────┐
│  BUBBLE DA IA                                                    │
│  [Avatar]  Entendi que ela trabalha na Farmacore.               │
│            Está correto?                                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  CARD DE CONFIRMAÇÃO                                      │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  🏢 Empresa                                          │ │   │
│  │  │  Farmacore                                           │ │   │
│  │  │  Confiança: ████████░░ 95%                           │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  │  [✓ Confirmar]  [✎ Editar]  [✗ Ignorar]                  │   │
│  │  Botões: 48dp altura · gap: 8dp · border-radius: 12dp    │   │
│  │  Confirmar: bg=#22C55E20 · border=#22C55E40 · text=#22C55E│  │
│  │  Editar:    bg=#3B82F620 · border=#3B82F640 · text=#3B82F6│  │
│  │  Ignorar:   bg=#FFFFFF08 · border=#FFFFFF20 · text=#FFFFFF40│ │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  CARD DE TAG (quando field_type = asset_tag / need_tag):        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  🏷️ Ativo sugerido                                       │   │
│  │  Indústria Farmacêutica                                   │   │
│  │  [✓ Adicionar como ativo]  [✗ Ignorar]                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Card: accessibilityRole="alert"                               │
│  - Anunciado: "Sugestão da IA: empresa Farmacore.                │
│    Botões: confirmar, editar, ignorar."                          │
└─────────────────────────────────────────────────────────────────┘

Estado "Editando":
- Ao tocar "Editar", o valor vira um Input editável pré-preenchido com o valor sugerido.
- Botão "Salvar edição" substitui os 3 botões.
- Ao salvar, o status da sugestão muda para 'edited' e o valor aplicado é o editado.
```

### Tela C — Estado de Processamento ("Pensando")

```
┌─────────────────────────────────────────────────────────────────┐
│  BUBBLE "PENSANDO"                                              │
│  [Avatar]  ● ● ●  (3 pontinhos animados, 600ms por ciclo)      │
│            bg: #FFFFFF10 · border-radius: 0 12 12 12dp          │
│                                                                  │
│  TIMEOUT VISUAL (após 8 segundos):                              │
│  [Avatar]  Isso está demorando mais que o esperado.             │
│            Verifique sua conexão.                               │
│            [Tentar novamente]  [Cancelar]                       │
│                                                                  │
│  Input: desabilitado durante processamento                      │
│  Botão enviar: spinner substituindo ícone →                     │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Bubble pensando: accessibilityLabel="Assistente está pensando"│
│  - accessibilityLiveRegion="polite"                              │
└─────────────────────────────────────────────────────────────────┘
```

### Tela D — Resumo de Conclusão

```
┌─────────────────────────────────────────────────────────────────┐
│  CARD DE CONCLUSÃO (aparece no chat como última mensagem)       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ✨ Cadastro enriquecido!                                 │   │
│  │  ──────────────────────────────────────────────────────  │   │
│  │  Adicionamos nesta sessão:                                │   │
│  │  ✓ Empresa: Farmacore                                     │   │
│  │  ✓ 2 ativos: Indústria Farmacêutica, Distribuição         │   │
│  │  ✓ 1 necessidade: Investidores                            │   │
│  │  ✓ Contexto: CPHI 2024                                    │   │
│  │  ─ Telefone: não informado                                │   │
│  │                                                           │   │
│  │  [Ver perfil completo]  [Fechar chat]                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  TIMEOUT (sessão expirou por 7 dias):                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ⏱ Sessão encerrada por inatividade.                     │   │
│  │  Você pode continuar o enriquecimento a qualquer momento. │   │
│  │  [Iniciar nova sessão]                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Tela E — Histórico de Enriquecimento (Aba no Perfil)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER DA ABA                                                   │
│  "Histórico de Enriquecimento"                                  │
├─────────────────────────────────────────────────────────────────┤
│  LISTA CRONOLÓGICA (mais recente primeiro)                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  🏢 Empresa preenchida                    10/08 14:32  │     │
│  │  IA sugeriu → você confirmou                           │     │
│  │  Farmacore                                   [🗑 Desfazer]│  │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  🏷️ Ativo adicionado                      10/08 14:33  │     │
│  │  IA sugeriu → você editou → aplicado                   │     │
│  │  Indústria Farmacêutica → Farma & Biotech  [🗑 Desfazer]│  │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  📞 Telefone                              10/08 14:30  │     │
│  │  IA perguntou → você ignorou                           │     │
│  │  (não preenchido)                                      │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ESTADO VAZIO:                                                   │
│  [Ícone ✨ centralizado]                                         │
│  "Nenhum enriquecimento via IA ainda."                          │
│  "Toque em 'Enriquecer cadastro' no perfil para começar."       │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Cada item: accessibilityLabel="[Campo] [status]: [valor]. [data]"│
│  - Botão desfazer: accessibilityLabel="Desfazer: remover [campo] [valor]"│
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Especificação de API REST (OpenAPI 3.0)

```yaml
openapi: "3.0.3"
info:
  title: MMM CRM — Enrichment API (Etapa 4)
  version: "1.0.0"
  description: |
    Endpoints para o Chat de Enriquecimento de Cadastro com IA.
    Autenticação: Bearer JWT. RBAC: roles `user` e `admin`.
    Rate limit: 20 mensagens/sessão, 50 sessões/dia/usuária.
    Todos os responses incluem X-Request-ID.

servers:
  - url: https://api.mmmos.com/api/v1

components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }

  schemas:
    ErrorResponse:
      type: object
      required: [error_code, message]
      properties:
        error_code: { type: string }
        message:    { type: string }
        details:    { type: object }

    Suggestion:
      type: object
      properties:
        id:              { type: string, format: uuid }
        field_type:      { type: string }
        suggested_value: { type: string }
        confidence:      { type: number, minimum: 0, maximum: 1 }
        display_label:   { type: string }
        status:          { type: string, enum: [pending, confirmed, edited, ignored, applied, undone] }
        tag_is_new:      { type: boolean }
        tag_id:          { type: string, format: uuid, nullable: true }

    EnrichmentSession:
      type: object
      properties:
        id:                 { type: string, format: uuid }
        contact_id:         { type: integer }
        status:             { type: string }
        questions_answered: { type: integer }
        questions_skipped:  { type: integer }
        created_at:         { type: string, format: date-time }

security:
  - BearerAuth: []

paths:

  # ─── POST /private-network/contacts/{contact_id}/enrichment-sessions ────────
  /private-network/contacts/{contact_id}/enrichment-sessions:
    post:
      summary: Iniciar sessão de enriquecimento
      operationId: startEnrichmentSession
      tags: [Enrichment]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "201":
          description: Sessão criada. first_question é a primeira pergunta da IA.
          content:
            application/json:
              schema:
                type: object
                properties:
                  session_id:     { type: string, format: uuid }
                  status:         { type: string, example: "active" }
                  first_question: { type: string, example: "Qual é o telefone ou WhatsApp dela?" }
                  first_message_id: { type: string, format: uuid }
              example:
                session_id: "sess-uuid"
                status: "active"
                first_question: "Olá! Vou te ajudar a completar o cadastro da Ana. Qual é o telefone ou WhatsApp dela?"
                first_message_id: "msg-uuid"
        "401": { description: Unauthorized }
        "403":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTACT_NOT_OWNED", message: "Este contato não pertence à sua conta.", details: {} }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example:
                error_code: "SESSION_ALREADY_ACTIVE"
                message: "Já existe uma sessão ativa para este contato."
                details: { existing_session_id: "sess-uuid", status: "active" }
        "429":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "DAILY_SESSION_LIMIT", message: "Limite de 50 sessões por dia atingido.", details: { retry_after_seconds: 3600 } }

  # ─── POST /enrichment-sessions/{session_id}/messages ────────────────────────
  /enrichment-sessions/{session_id}/messages:
    post:
      summary: Enviar mensagem da usuária e receber resposta da IA
      operationId: sendEnrichmentMessage
      description: |
        Fluxo de processamento:
        1. Salva mensagem da usuária (role=user)
        2. Monta contexto (dados do contato + últimas 10 mensagens)
        3. Chama GPT-4o via Azure OpenAI
        4. Parseia JSON de resposta
        5. Salva mensagem da IA (role=assistant) + cria enrichment_suggestions
        6. Retorna ai_response + suggestions
        Timeout máximo: 10 segundos (fallback se exceder)
      tags: [Enrichment]
      parameters:
        - name: session_id
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
              required: [content]
              properties:
                content:          { type: string, maxLength: 2000 }
                client_timestamp: { type: string, format: date-time }
            example:
              content: "Ela trabalha na Farmacore, uma empresa farmacêutica de São Paulo."
              client_timestamp: "2026-08-10T14:32:00Z"
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  message_id:    { type: string, format: uuid }
                  ai_response:   { type: string }
                  question_key:  { type: string }
                  suggestions:
                    type: array
                    items: { $ref: '#/components/schemas/Suggestion' }
                  session_complete: { type: boolean }
                  completion_summary: { type: string, nullable: true }
              example:
                message_id: "msg-uuid"
                ai_response: "Entendi! Ela trabalha na Farmacore em São Paulo. Isso está correto?"
                question_key: "company"
                suggestions:
                  - id: "sug-uuid-1"
                    field_type: "company"
                    suggested_value: "Farmacore"
                    confidence: 0.97
                    display_label: "Empresa: Farmacore"
                    status: "pending"
                    tag_is_new: false
                  - id: "sug-uuid-2"
                    field_type: "city"
                    suggested_value: "São Paulo"
                    confidence: 0.91
                    display_label: "Cidade: São Paulo"
                    status: "pending"
                    tag_is_new: false
                session_complete: false
                completion_summary: null
        "400":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "MESSAGE_TOO_LONG", message: "Mensagem excede 2000 caracteres.", details: {} }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SESSION_NOT_FOUND", message: "Sessão não encontrada.", details: {} }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SESSION_NOT_ACTIVE", message: "Esta sessão não está ativa.", details: { current_status: "completed" } }
        "422":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "AI_TIMEOUT", message: "A IA não respondeu a tempo. Tente novamente.", details: { timeout_ms: 10000 } }
        "429":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SESSION_MESSAGE_LIMIT", message: "Limite de 20 mensagens por sessão atingido.", details: {} }

  # ─── POST /enrichment-sessions/{session_id}/suggestions/{id}/confirm ────────
  /enrichment-sessions/{session_id}/suggestions/{suggestion_id}/confirm:
    post:
      summary: Confirmar ou confirmar com edição uma sugestão da IA
      operationId: confirmSuggestion
      tags: [Enrichment]
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: suggestion_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                edited_value: { type: string, nullable: true, description: "Preenchido se usuária editou o valor antes de confirmar" }
      responses:
        "200":
          description: Sugestão aplicada. O campo do contato foi atualizado.
          content:
            application/json:
              schema:
                type: object
                properties:
                  suggestion_id: { type: string, format: uuid }
                  status:        { type: string, example: "applied" }
                  applied_value: { type: string }
              example:
                suggestion_id: "sug-uuid"
                status: "applied"
                applied_value: "Farmacore"
        "400": { description: Validation error }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SUGGESTION_NOT_FOUND", message: "Sugestão não encontrada.", details: {} }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SUGGESTION_ALREADY_ACTIONED", message: "Esta sugestão já foi confirmada ou ignorada.", details: { current_status: "applied" } }
        "422": { description: Unprocessable }
        "429": { description: Rate limit }

  # ─── POST /enrichment-sessions/{session_id}/suggestions/{id}/ignore ─────────
  /enrichment-sessions/{session_id}/suggestions/{suggestion_id}/ignore:
    post:
      summary: Ignorar sugestão da IA
      operationId: ignoreSuggestion
      tags: [Enrichment]
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: suggestion_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  suggestion_id: { type: string, format: uuid }
                  status:        { type: string, example: "ignored" }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Suggestion not found }
        "409": { description: Already actioned }
        "429": { description: Rate limit }

  # ─── POST /enrichment-sessions/{session_id}/complete ────────────────────────
  /enrichment-sessions/{session_id}/complete:
    post:
      summary: Finalizar sessão manualmente
      operationId: completeEnrichmentSession
      tags: [Enrichment]
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  session_id:  { type: string, format: uuid }
                  status:      { type: string, example: "completed" }
                  summary:     { type: string }
                  applied_count: { type: integer }
              example:
                session_id: "sess-uuid"
                status: "completed"
                summary: "Adicionamos: Empresa (Farmacore), 2 ativos, 1 necessidade."
                applied_count: 4
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Session not found }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SESSION_NOT_ACTIVE", message: "Sessão já está encerrada.", details: {} }
        "429": { description: Rate limit }

  # ─── GET /private-network/contacts/{contact_id}/enrichment-history ──────────
  /private-network/contacts/{contact_id}/enrichment-history:
    get:
      summary: Histórico de sugestões aplicadas para um contato
      operationId: getEnrichmentHistory
      tags: [Enrichment]
      parameters:
        - name: contact_id
          in: path
          required: true
          schema: { type: integer }
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        suggestion_id:  { type: string, format: uuid }
                        field_type:     { type: string }
                        suggested_value:{ type: string }
                        applied_value:  { type: string }
                        status:         { type: string }
                        actioned_at:    { type: string, format: date-time }
                        session_id:     { type: string, format: uuid }
                  next_cursor: { type: string, nullable: true }
              example:
                data:
                  - suggestion_id: "sug-uuid"
                    field_type: "company"
                    suggested_value: "Farmacore"
                    applied_value: "Farmacore"
                    status: "applied"
                    actioned_at: "2026-08-10T14:32:00Z"
                    session_id: "sess-uuid"
                next_cursor: null
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Contact not found }
        "429": { description: Rate limit }

  # ─── DELETE /enrichment-sessions/{session_id} ────────────────────────────────
  /enrichment-sessions/{session_id}:
    delete:
      summary: Cancelar sessão de enriquecimento
      operationId: cancelEnrichmentSession
      tags: [Enrichment]
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string, format: uuid }
        - name: X-Request-ID
          in: header
          required: true
          schema: { type: string, format: uuid }
      responses:
        "204": { description: Sessão cancelada }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
        "404": { description: Session not found }
        "409":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
              example: { error_code: "SESSION_ALREADY_ENDED", message: "Sessão já está encerrada.", details: {} }
        "429": { description: Rate limit }
```

---

## 6. Estratégia de Performance e Custos

### 6.1 Estimativa de Tokens por Sessão

| Componente | Tokens (estimativa) |
|---|---|
| System prompt | ~500 tokens (input, fixo por turno) |
| Contexto do contato | ~200 tokens (input, varia) |
| Histórico de 10 mensagens | ~800 tokens (input, cresce por turno) |
| Mensagem da usuária | ~50 tokens (input, média) |
| **Total input por turno** | **~1.550 tokens** |
| Resposta da IA (JSON) | ~300 tokens (output) |
| **Total por turno** | **~1.850 tokens** |
| **Turnos por sessão (média 8)** | **~14.800 tokens/sessão** |

### 6.2 Estimativa de Custo Mensal (2.000 usuárias ativas)

| Métrica | Valor |
|---|---|
| Sessões/mês (2.000 usuárias × 5 sessões) | 10.000 sessões |
| Tokens input/mês (10.000 × 12.400) | 124M tokens |
| Tokens output/mês (10.000 × 2.400) | 24M tokens |
| Custo input (GPT-4o: $2,50/1M) | $310/mês |
| Custo output (GPT-4o: $10,00/1M) | $240/mês |
| **Custo total estimado** | **~$550/mês** |
| Custo por sessão | ~$0,055 |
| Custo por usuária/mês | ~$0,28 |

### 6.3 Rate Limiting

| Limite | Valor | Justificativa |
|---|---|---|
| Mensagens por sessão | 20 | Roteiro tem 6 perguntas; 20 permite follow-ups sem abuso |
| Sessões por dia por usuária | 50 | Evita uso automatizado; usuária normal cria ~5/dia |
| Requisições à IA por minuto (global) | 100 | Dentro do tier padrão Azure OpenAI |
| Timeout de resposta da IA | 10s | P95 esperado: ~2s; 10s cobre picos |

### 6.4 Estratégia de Fallback

```
Cenário 1 — Timeout da IA (> 10s):
  → Retornar 422 com error_code: "AI_TIMEOUT"
  → Frontend exibe: "Isso está demorando. Verifique sua conexão."
  → Botão "Tentar novamente" resubmete a mesma mensagem
  → Máximo 2 retries automáticos com backoff exponencial (2s, 4s)

Cenário 2 — Erro 500 do provedor OpenAI:
  → Retry automático 1x após 2 segundos
  → Se falhar novamente: retornar mensagem de fallback genérica:
    "Não consegui processar sua resposta agora. Tente novamente em instantes."
  → Sessão permanece ativa; usuária pode continuar depois

Cenário 3 — Rate limit do provedor (429):
  → Fila de espera com posição estimada
  → Frontend exibe: "Muitas solicitações simultâneas. Sua resposta será processada em breve."
  → Retry automático após Retry-After header

Cenário 4 — JSON inválido na resposta da IA:
  → Logar o erro com o conteúdo bruto
  → Retornar mensagem de fallback: "Não entendi bem. Pode reformular?"
  → NÃO criar enrichment_suggestions para esta mensagem
```

---

## 7. Critérios de Aceite (Definition of Done)

| # | Critério | Como verificar |
|---|---|---|
| 1 | Sessão inicia em ≤ 2s após cadastro de contato | Teste de integração: medir tempo entre INSERT em contacts e criação da sessão |
| 2 | IA responde em ≤ 3s (P95) em 4G | Teste de carga com k6: 100 usuárias simultâneas |
| 3 | Confirmar sugestão em ≤ 2 toques | Teste de usabilidade: toque na sugestão + botão confirmar |
| 4 | Sessão não duplicada para o mesmo contato | Teste: POST duas vezes → segundo retorna 409 |
| 5 | Dado confirmado aparece no perfil sem refresh | Teste E2E: confirmar empresa → abrir perfil → verificar campo |
| 6 | Histórico mostra todas as alterações com timestamp | Teste: GET /enrichment-history → verificar todos os applied |
| 7 | Falha da IA → feedback em ≤ 5s | Teste: mockar timeout da IA → verificar mensagem de erro |
| 8 | Nenhum dado enviado à IA sem user_id no log | Auditoria: verificar tabela audit_logs para cada chamada à IA |
| 9 | Desfazer sugestão não apaga mensagem do chat | Teste: desfazer → verificar enrichment_messages intacto |
| 10 | Isolamento por user_id: 2 usuárias, mesmo contato | Teste: criar contato com mesmo nome em 2 contas → verificar isolamento |

### 7.1 Casos de Teste Detalhados

```
Happy path — fluxo completo:
1. Cadastrar contato "Ana Souza" com apenas nome
2. Sessão inicia automaticamente → badge "Enriquecendo..." aparece
3. IA pergunta telefone → usuária responde "não sei" → skipped
4. IA pergunta empresa → "Ela trabalha na Farmacore"
5. Card de sugestão aparece: "Empresa: Farmacore" → confirmar
6. Campo empresa preenchido no perfil imediatamente
7. IA pergunta ativos → "ela tem distribuição farmacêutica"
8. Tag sugerida: "Distribuição Farmacêutica" (nova) → confirmar
9. Continuar até 6 perguntas → resumo aparece → sessão completed

Edge case — resposta "não sei":
1. IA pergunta telefone → "não tenho esse dado"
2. IA marca como skipped, avança para empresa
3. No final: "Você deixou de informar o telefone. Deseja incluir agora?"

Edge case — tag duplicada:
1. Usuária responde "ela trabalha com farmácia"
2. IA sugere tag "Indústria Farmacêutica" (já existe no dicionário)
3. Sistema vincula a tag existente, não cria duplicata

Edge case — timeout de 7 dias:
1. Sessão ativa por 7 dias sem interação
2. Job agendado muda status para 'timeout'
3. Badge some do perfil do contato
4. Usuária pode iniciar nova sessão

Edge case — falha da OpenAI:
1. Mockar timeout de 10s na chamada à IA
2. Backend retorna 422 com AI_TIMEOUT
3. Frontend exibe mensagem de erro em ≤ 5s
4. Botão "Tentar novamente" reaparece

Edge case — isolamento multi-tenant:
1. Usuária A cria contato "João" → sessão ativa
2. Usuária B cria contato "João" (diferente) → sessão ativa separada
3. Verificar que as sessões são completamente isoladas
```

---

## 8. Decisões Pendentes

| # | Questão | Impacto | Prazo sugerido |
|---|---|---|---|
| 1 | **Job de timeout:** o cron que muda sessões para `timeout` após 7 dias deve rodar a cada hora ou diariamente? Diário é suficiente para o MVP e mais barato. | Baixo | Antes do sprint 1 |
| 2 | **Auto-apply de sugestões com confiança > 0.95:** para campos simples (telefone, empresa), sugestões com confiança muito alta poderiam ser aplicadas automaticamente sem confirmação, reduzindo fricção. Risco: erros silenciosos. Confirmar se o produto aceita esse trade-off. | Alto — impacta UX e confiança | Antes do sprint 1 |
| 3 | **Limite de sessões por contato:** atualmente não há limite de sessões históricas por contato. Sugestão: manter apenas as 5 últimas sessões completed/timeout por contato para controle de storage. | Baixo | Backlog |
| 4 | **Idioma da IA:** o system prompt instrui a IA a detectar o idioma da usuária automaticamente. Se o MMM suporta 10 idiomas, a qualidade do NER pode variar em idiomas menos comuns (árabe, hindi, japonês). Confirmar se o MVP é apenas pt-BR ou multilíngue desde o início. | Médio — afeta qualidade do NER | Antes do sprint 1 |
| 5 | **Notificação push:** quando uma sessão entra em `paused` (30 min sem resposta), enviar push "Continue enriquecendo o cadastro de Ana"? Requer integração com FCM/APNs. | Médio — aumenta retenção | Sprint 3+ |

---

*Documento gerado por Manus AI · Projeto MMM — Mulheres que Movem o Mundo · Etapa 4 de N*
