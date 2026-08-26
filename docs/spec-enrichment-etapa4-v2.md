# Especificação Técnica — Etapa 4 (Revisão 2)
## Complementação Inteligente: Chat de Enriquecimento de Cadastro
### Módulo CRM Inteligente · MMM (Mulheres que Movem o Mundo)

> **Versão:** 2.0 · **Data:** Agosto 2026 · **Autor:** Manus AI para Projeto MMM
> **Stack:** Node.js / NestJS · PostgreSQL 15+ (RDS) · React Native (Expo SDK 51) · Claude 3.5 Sonnet
> **Escala:** MVP até 2.000 usuárias · ~5 sessões/contato · ~1,5M mensagens/ano
> **Dependências:** Etapa 1 (Base Particular) · Etapa 2 (Perfil Estratégico) · Etapa 3 (Contextos)
> **Diferenças da v1.0:** Modelo alterado para Claude 3.5 Sonnet · 6 telas (nova Tela C para Tags) · Triggers SQL · Concorrência otimista (ETag/If-Match) · Job de manutenção · Timeout progressivo (5s/10s/15s) · 12 critérios de aceite · 14 casos de teste

---

## 1. Decisões de Negócio Fechadas

| Dimensão | Decisão |
|---|---|
| **Gatilho** | Automático após cadastro manual + manual sob demanda ("Enriquecer cadastro") |
| **Perguntas** | Roteiro fixo de 6 com interpretação inteligente; IA decide ordem e follow-ups |
| **Mapeamento** | NER via Claude + confirmação da usuária (confirmar / editar / ignorar) |
| **Memória** | Persistência completa no PostgreSQL; contexto da IA = últimas 10 interações |
| **LGPD** | Consentimento implícito com aviso transparente; base legal: legítimo interesse |
| **Término** | 6 perguntas respondidas OU usuária encerra OU timeout de 7 dias |
| **Layout** | Bottom sheet arrastável: 45% inicial, 85% máximo |
| **Modelo de IA** | Claude 3.5 Sonnet (Anthropic API) — ver justificativa em §3.1 |

**Roteiro base de 6 perguntas obrigatórias:**

| # | Campo alvo | Pergunta base |
|---|---|---|
| 1 | `phone` / `whatsapp` | Qual é o telefone ou WhatsApp desta pessoa? |
| 2 | `company` | Em qual empresa ou instituição ela atua? |
| 3 | `contact_assets` | O que ela tem a oferecer? (produtos, serviços, recursos, expertise) |
| 4 | `contact_needs` | O que ela está procurando ou precisa? |
| 5 | `context` (Etapa 3) | Como e onde vocês se conheceram? |
| 6 | `relationship_type` | Como você descreveria o relacionamento? (pessoal, profissional, ambos) |

---

## 2. Modelo de Dados — Schema SQL (PostgreSQL 15+)

### 2.1 Extensões e Tipos

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE enrichment_status_enum AS ENUM ('none', 'active', 'paused', 'completed', 'timeout', 'cancelled');
CREATE TYPE enrichment_role_enum   AS ENUM ('system', 'assistant', 'user');
CREATE TYPE suggestion_status_enum AS ENUM ('pending', 'confirmed', 'edited', 'ignored', 'applied', 'undone');
CREATE TYPE field_type_enum AS ENUM (
  'phone', 'whatsapp', 'email', 'company', 'job_title',
  'city', 'country', 'linkedin_url', 'instagram_handle',
  'asset_tag', 'need_tag', 'context_link', 'relationship_type', 'notes'
);
```

### 2.2 Trigger Automático para `updated_at`

```sql
-- Função reutilizável para todos os triggers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2.3 Tabela `enrichment_sessions`

```sql
CREATE TABLE enrichment_sessions (
  id                  UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID                   NOT NULL,
  contact_id          BIGINT                 NOT NULL,
  status              enrichment_status_enum NOT NULL DEFAULT 'active',
  questions_answered  SMALLINT               NOT NULL DEFAULT 0
                      CHECK (questions_answered >= 0 AND questions_answered <= 6),
  questions_skipped   SMALLINT               NOT NULL DEFAULT 0
                      CHECK (questions_skipped >= 0 AND questions_skipped <= 6),
  -- ETag para concorrência otimista (incrementado a cada mudança de status)
  etag                INTEGER                NOT NULL DEFAULT 1,
  summary             TEXT,
  last_activity_at    TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_es_contact FOREIGN KEY (contact_id)
    REFERENCES contacts(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Apenas uma sessão 'active' por (user_id, contact_id)
CREATE UNIQUE INDEX idx_es_one_active
  ON enrichment_sessions (user_id, contact_id)
  WHERE status = 'active';

-- Índices de consulta
CREATE INDEX idx_es_user_contact    ON enrichment_sessions (user_id, contact_id);
CREATE INDEX idx_es_status_activity ON enrichment_sessions (status, last_activity_at);
CREATE INDEX idx_es_user_created    ON enrichment_sessions (user_id, created_at DESC);

-- Trigger updated_at
CREATE TRIGGER trg_es_updated_at
  BEFORE UPDATE ON enrichment_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN enrichment_sessions.etag IS
  'Versão incremental para concorrência otimista. '
  'O cliente envia If-Match: <etag>; o backend rejeita com 412 se não coincidir.';
```

### 2.4 Tabela `enrichment_messages`

```sql
CREATE TABLE enrichment_messages (
  id           UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id   UUID                 NOT NULL
               REFERENCES enrichment_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id      UUID                 NOT NULL,
  role         enrichment_role_enum NOT NULL,
  content      TEXT                 NOT NULL,
  -- JSONB: dados estruturados extraídos pela IA nesta mensagem
  -- Schema: {"extracted": [...], "question_key": "phone|company|..."}
  metadata     JSONB,
  token_count  INTEGER,
  created_at   TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_em_session_asc  ON enrichment_messages (session_id, created_at ASC);
CREATE INDEX idx_em_user_created ON enrichment_messages (user_id, created_at DESC);
CREATE INDEX idx_em_metadata_gin ON enrichment_messages USING GIN (metadata);

CREATE TRIGGER trg_em_updated_at
  BEFORE UPDATE ON enrichment_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN enrichment_messages.metadata IS
  'Schema: {"extracted": [{"field_type": "company", "value": "Farmacore", '
  '"confidence": 0.95, "display_label": "Empresa: Farmacore", "suggestion_id": "uuid"}], '
  '"question_key": "company"}';
```

### 2.5 Tabela `enrichment_suggestions`

```sql
CREATE TABLE enrichment_suggestions (
  id               UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id       UUID                   NOT NULL
                   REFERENCES enrichment_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  message_id       UUID                   NOT NULL
                   REFERENCES enrichment_messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id          UUID                   NOT NULL,
  contact_id       BIGINT                 NOT NULL
                   REFERENCES contacts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  field_type       field_type_enum        NOT NULL,
  suggested_value  TEXT                   NOT NULL,
  applied_value    TEXT,
  -- Referência ao dicionário de tags (Etapa 2), se field_type = asset_tag | need_tag
  tag_id           UUID,
  tag_is_new       BOOLEAN                NOT NULL DEFAULT FALSE,
  confidence       NUMERIC(4,3)           NOT NULL DEFAULT 0.000
                   CHECK (confidence >= 0.000 AND confidence <= 1.000),
  status           suggestion_status_enum NOT NULL DEFAULT 'pending',
  actioned_at      TIMESTAMPTZ,
  actioned_by      VARCHAR(20),
  -- Snapshot do valor antes de desfazer (para restaurar)
  undo_snapshot    JSONB,
  created_at       TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_esg_session_status   ON enrichment_suggestions (session_id, status);
CREATE INDEX idx_esg_contact_applied  ON enrichment_suggestions (contact_id, status)
  WHERE status IN ('applied', 'undone');
CREATE INDEX idx_esg_user_created     ON enrichment_suggestions (user_id, created_at DESC);

CREATE TRIGGER trg_esg_updated_at
  BEFORE UPDATE ON enrichment_suggestions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN enrichment_suggestions.undo_snapshot IS
  'Snapshot JSONB do estado anterior ao apply, para permitir desfazer. '
  'Exemplo: {"field": "company", "previous_value": null, "contact_id": 42}';
```

### 2.6 Referência: `contacts` (campo adicionado)

```sql
-- Campo desnormalizado para exibir badge sem JOIN
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS enrichment_status enrichment_status_enum DEFAULT 'none';

-- Trigger para sincronizar enrichment_status do contato com a sessão ativa
CREATE OR REPLACE FUNCTION sync_contact_enrichment_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE contacts
    SET enrichment_status = NEW.status
  WHERE id = NEW.contact_id
    AND user_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_enrichment_status
  AFTER INSERT OR UPDATE OF status ON enrichment_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_contact_enrichment_status();
```

### 2.7 Referência: Alimentando `contact_assets` e `contact_needs` (Etapa 2)

```sql
-- Quando uma sugestão de tag é confirmada (status → applied):
-- Para field_type = 'asset_tag':
INSERT INTO contact_assets (contact_id, tag_id, source, source_session_id, created_at)
  VALUES ($contact_id, $tag_id, 'ai_enrichment', $session_id, NOW())
  ON CONFLICT (contact_id, tag_id) DO NOTHING;

-- Para field_type = 'need_tag':
INSERT INTO contact_needs (contact_id, tag_id, source, source_session_id, created_at)
  VALUES ($contact_id, $tag_id, 'ai_enrichment', $session_id, NOW())
  ON CONFLICT (contact_id, tag_id) DO NOTHING;

-- O campo source='ai_enrichment' permite filtrar o que veio da IA vs. cadastro manual.
-- source_session_id permite rastrear qual sessão originou o vínculo (para desfazer).
```

### 2.8 Job de Manutenção — Timeout de Sessões (Executar Diariamente)

```sql
-- Executar via cron job (pg_cron ou job externo) uma vez por dia
-- Mover sessões inativas há 7 dias para status 'timeout'

WITH timed_out AS (
  UPDATE enrichment_sessions
  SET
    status           = 'timeout',
    updated_at       = NOW(),
    etag             = etag + 1
  WHERE
    status           = 'active'
    AND last_activity_at < NOW() - INTERVAL '7 days'
  RETURNING id, user_id, contact_id
)
-- O trigger trg_sync_enrichment_status cuida de atualizar contacts.enrichment_status
SELECT COUNT(*) AS sessions_timed_out FROM timed_out;

-- Também mover 'paused' para 'timeout' após 7 dias de inatividade
UPDATE enrichment_sessions
SET status = 'timeout', updated_at = NOW(), etag = etag + 1
WHERE status = 'paused'
  AND last_activity_at < NOW() - INTERVAL '7 days';
```

---

## 3. Estratégia de IA e Prompt Engineering

### 3.1 Modelo Recomendado e Justificativa

| Critério | Claude 3.5 Sonnet | GPT-4o | Gemini 1.5 Pro |
|---|---|---|---|
| **Custo input** | $3,00 / 1M tokens | $2,50 / 1M tokens | $1,25 / 1M tokens |
| **Custo output** | $15,00 / 1M tokens | $10,00 / 1M tokens | $5,00 / 1M tokens |
| **Latência P50** | ~1.200ms | ~800ms | ~1.500ms |
| **NER em português** | Excelente — superior em nuances semânticas e ambiguidades | Muito bom | Bom — inferior em contextos culturais brasileiros |
| **Qualidade de instrução** | Melhor seguimento de JSON estruturado e restrições complexas | Bom | Variável |
| **Fine-tuning** | Não disponível publicamente | Disponível | Disponível (Vertex AI) |
| **Política de dados** | Dados não usados para treino por padrão (API) | Dados não usados para treino (API) | Dados podem ser usados para melhorias (verificar ToS) |
| **Contexto máximo** | 200k tokens | 128k tokens | 1M tokens |
| **Custo/sessão estimado** | ~$0,068 | ~$0,055 | ~$0,028 |

**Recomendação: Claude 3.5 Sonnet.** Justificativa: apesar do custo ligeiramente superior ao GPT-4o, o Claude 3.5 Sonnet apresenta qualidade superior de NER em português brasileiro — especialmente em respostas ambíguas e entidades regionais (nomes de empresas, cidades, setores industriais). O seguimento de instruções complexas em JSON estruturado é mais consistente, reduzindo a taxa de falhas de parsing. A política de dados da Anthropic é mais clara para conformidade com LGPD. O custo adicional de ~$0,013/sessão representa menos de 1% do custo operacional do MVP.

### 3.2 System Prompt (Especificação Completa)

```
IDENTIDADE:
Você é a Assistente de Networking do MMM (Mulheres que Movem o Mundo).
Plataforma exclusiva para mulheres líderes, executivas e empreendedoras.

MISSÃO:
Ajudar a usuária a completar o cadastro de um contato estratégico de forma
conversacional, natural e eficiente. Você é discreta, profissional e respeitosa.

TOM E ESTILO:
- Consultivo e direto: vá ao ponto sem rodeios.
- Respeitoso: nunca pressione ou insista após uma negativa.
- Natural: evite linguagem robótica ou formulaica.
- Idioma: detecte automaticamente o idioma da usuária e responda no mesmo idioma.
  Padrão: português brasileiro.

ROTEIRO BASE (6 perguntas obrigatórias):
1. Telefone/WhatsApp
2. Empresa/Instituição
3. O que ela oferece (ativos: produtos, serviços, expertise, recursos)
4. O que ela procura (necessidades: investimento, parceiros, clientes, etc.)
5. Como e onde se conheceram
6. Tipo de relacionamento (pessoal / profissional / ambos)

REGRAS DE COMPORTAMENTO:
1. Faça apenas UMA pergunta por turno.
2. Se um campo já está preenchido no contato, confirme em vez de perguntar do zero.
   Exemplo: "Vejo que ela trabalha na Farmacore. Está correto?"
3. Se a usuária responder "não sei", "não tenho" ou equivalente:
   - Aceite imediatamente.
   - Marque a pergunta como skipped no JSON.
   - Avance para a próxima pergunta.
   - NÃO insista.
4. Se a resposta for vaga, faça UM follow-up contextual.
   Exemplo: "Você mencionou saúde — qual é a especialidade dela?"
5. Se a confiança na extração for < 0.70, pergunte de volta em vez de assumir.
6. Não repita perguntas já respondidas ou explicitamente ignoradas.
7. Ao detectar múltiplas entidades em uma resposta, extraia todas no JSON.
8. Para tags de ativos/necessidades: verifique se existe no dicionário antes de propor nova.

AVISO LGPD (exibir apenas na primeira mensagem da sessão):
"Utilizamos IA para ajudar a organizar seus contatos. Os dados são processados
de forma segura e não são usados para treinar modelos."

FORMATO DE SAÍDA (JSON obrigatório — NUNCA responda fora deste formato):
{
  "next_question": "texto da próxima pergunta para a usuária (string)",
  "question_key": "phone|company|assets|needs|context|relationship|followup|complete",
  "skipped_field": null,
  "extracted_entities": [
    {
      "field_type": "company|phone|whatsapp|email|job_title|city|country|asset_tag|need_tag|context_link|relationship_type",
      "value": "valor extraído (string)",
      "confidence": 0.0,
      "display_label": "label amigável para UI (ex: 'Empresa: Farmacore')"
    }
  ],
  "suggested_tags": [
    {
      "name": "nome da tag",
      "category": "asset|need",
      "is_new": true,
      "existing_tag_id": null
    }
  ],
  "session_complete": false,
  "completion_summary": null,
  "show_lgpd_notice": false
}

Quando question_key = "complete":
- session_complete = true
- completion_summary = resumo em 1-2 frases do que foi coletado
- next_question = mensagem de encerramento amigável
```

### 3.3 Context Window — Montagem por Turno

A cada mensagem da usuária, o backend monta o seguinte payload para o Claude:

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 1024,
  "system": "[System Prompt completo acima]",
  "messages": [
    {
      "role": "user",
      "content": "CONTEXTO DO CONTATO:\nNome: Ana Souza\nCargo: CEO\nEmpresa: (vazio)\nPaís: Brasil\nTelefone: (vazio)\n\nPERGUNTAS RESPONDIDAS: []\nPERGUNTAS PULADAS: []\nSESSÃO: sess-uuid\nÉ A PRIMEIRA MENSAGEM: true\n\nMensagem da usuária: [INICIAR SESSÃO]"
    },
    {
      "role": "assistant",
      "content": "{\"next_question\": \"Olá! ...\", ...}"
    },
    {
      "role": "user",
      "content": "Ela trabalha na Farmacore, uma empresa farmacêutica de São Paulo."
    }
  ]
}
```

**Estratégia de truncamento:** o contexto do contato inclui apenas campos vazios e os 3 mais recentemente atualizados. O histórico de mensagens é limitado às últimas 10 (5 pares pergunta/resposta), garantindo previsibilidade de custo independentemente do tamanho da conversa.

### 3.4 Estratégia de NER (Named Entity Recognition)

O Claude realiza NER diretamente, sem modelo separado. Exemplos de mapeamento:

| Resposta da usuária | Entidades extraídas | Confiança |
|---|---|---|
| "Ela trabalha na Farmacore, pharma de SP" | `company`="Farmacore", `city`="São Paulo", `asset_tag`="Indústria Farmacêutica" | 0.97, 0.91, 0.82 |
| "Está procurando investidor série A" | `need_tag`="Investimento Série A" (nova) | 0.88 |
| "Conheci na CPHI em Madrid" | `context_link`="CPHI", `city`="Madrid" | 0.94, 0.96 |
| "Não sei o telefone dela" | — (skipped: `phone`) | — |
| "Ela tem uma mina no interior" | `asset_tag`="Mineração" (proposta) | 0.71 |
| "Uma empresa de saúde" | — (confiança < 0.70 → follow-up) | 0.55 |

**Tratamento de ambiguidade:** se `confidence < 0.70`, o campo `next_question` contém a pergunta de esclarecimento e `extracted_entities` fica vazio para aquela entidade. Exemplo: "Você mencionou saúde — qual é o nome da empresa dela?"

---

## 4. Fluxo de Tela UX/UI — Wireframes Descritivos

Todos os wireframes são mobile-first, largura base 375px, tema escuro (#060e1a).

### Tela A — Perfil do Contato com Chat Ativo (Bottom Sheet)

```
┌─────────────────────────────────────────────────────────────────┐
│  STATUS BAR                                                      │
├─────────────────────────────────────────────────────────────────┤
│  HEADER (56dp)                                                   │
│  ← [Voltar]   [Foto 40dp] Ana Souza   [···]                     │
│               Badge: "✨ Enriquecendo..." (amber, pulsante 1s)  │
│               bg: #F59E0B15 · border: #F59E0B30 · text: #F59E0B │
│               border-radius: 999dp · padding: 2 8dp · text-xs   │
├─────────────────────────────────────────────────────────────────┤
│  PERFIL DO CONTATO (scroll, altura variável)                    │
│  Cargo · Empresa · País · Telefone · Links sociais              │
│  (conteúdo normal do perfil)                                    │
├─────────────────────────────────────────────────────────────────┤
│  BOTTOM SHEET (arrastável)                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DRAG HANDLE (barra cinza, 36×4dp, centralizada, 8dp top)│   │
│  │  HEADER DO CHAT                                          │   │
│  │  [✨] Chat de Enriquecimento  ·  [● ativo]  [✕ fechar]  │   │
│  │  bg: #0a1628 · border-bottom: 1px #FFFFFF12              │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  AVISO LGPD (apenas 1ª mensagem, dismissível)            │   │
│  │  "🔒 Utilizamos IA para organizar seus contatos.         │   │
│  │   Dados processados com segurança."  [✕]                 │   │
│  │  bg: #1e3a5f · border: #3b82f630 · text-xs               │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  ÁREA DE MENSAGENS (scroll, flex-1)                      │   │
│  │  Altura inicial: 45% da tela (≈ 300dp)                   │   │
│  │  Altura máxima: 85% da tela (arrastável)                 │   │
│  │                                                          │   │
│  │  [ver Telas B, C, D para conteúdo das mensagens]         │   │
│  │                                                          │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  INPUT FIXO (bottom, 56dp)                               │   │
│  │  [___ Responda aqui... _______________] [→ Enviar]       │   │
│  │  bg: #0A1628 · border-top: 1px #FFFFFF12                 │   │
│  │  Input: bg: #FFFFFF08 · border-radius: 24dp · h: 40dp    │   │
│  │  Botão: 40×40dp · bg: #F59E0B · ícone: → · border-r: 20dp│  │
│  │  Desabilitado durante processamento                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Acessibilidade:
- Bottom sheet: accessibilityRole="dialog" accessibilityLabel="Chat de enriquecimento"
- Drag handle: accessibilityLabel="Arraste para expandir ou recolher o chat"
- Badge: accessibilityLabel="Enriquecimento de cadastro em andamento"
- Input: accessibilityLabel="Campo de resposta para o assistente de IA"
- Botão enviar: accessibilityLabel="Enviar resposta"
```

### Tela B — Bubble da IA com Card de Sugestão (Campo Simples)

```
┌─────────────────────────────────────────────────────────────────┐
│  BUBBLE DA IA (esquerda)                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [Avatar 24dp]  Entendi que ela trabalha na Farmacore.   │  │
│  │                 Está correto?                             │  │
│  │  bg: #FFFFFF10 · border-radius: 0 12 12 12dp             │  │
│  │  max-width: 75% · padding: 10 14dp                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  CARD DE CONFIRMAÇÃO (abaixo do bubble, mesmo lado esquerdo)    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HEADER DO CARD                                           │  │
│  │  🏢 Empresa                    Confiança: ████████░░ 95% │  │
│  │  text-xs · text-amber-400      text-xs · text-white/30   │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  VALOR EXTRAÍDO                                           │  │
│  │  Farmacore                                                │  │
│  │  text-base · font-semibold · text-white                   │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  BOTÕES (3 em linha, gap: 8dp, cada um: flex-1, h: 40dp) │  │
│  │  [✓ Confirmar]  [✎ Editar]  [✗ Ignorar]                  │  │
│  │  Confirmar: bg=#22C55E20 · border=#22C55E40 · #22C55E    │  │
│  │  Editar:    bg=#3B82F620 · border=#3B82F640 · #3B82F6    │  │
│  │  Ignorar:   bg=#FFFFFF08 · border=#FFFFFF20 · #FFFFFF40  │  │
│  │  border-radius: 12dp · font-medium · text-xs             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ESTADO "EDITANDO" (ao tocar Editar):                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🏢 Empresa                                               │  │
│  │  [Farmacore________________________] ← Input editável     │  │
│  │  bg: #FFFFFF08 · border: #F59E0B50 · border-radius: 8dp  │  │
│  │  [Salvar edição] (full-width, bg: #F59E0B, text: #060e1a)│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Card: accessibilityRole="alert"                               │
│  - Anunciado: "Sugestão da IA: empresa Farmacore.                │
│    Três ações disponíveis: Confirmar, Editar, Ignorar."          │
│  - Área de toque mínima: 48×48dp em cada botão                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tela C — Card de Sugestão de Tag (Ativo / Necessidade)

```
┌─────────────────────────────────────────────────────────────────┐
│  BUBBLE DA IA                                                    │
│  [Avatar]  Parece que ela atua na indústria farmacêutica.       │
│            Posso adicionar isso como um ativo dela?             │
│                                                                  │
│  CARD DE TAG (abaixo do bubble)                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HEADER                                                   │  │
│  │  ✨ Ativo sugerido                                        │  │
│  │  text-xs · text-amber-400                                 │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  CHIP DA TAG                                              │  │
│  │  [🏷️ Indústria Farmacêutica]                              │  │
│  │  bg: #F59E0B20 · border: #F59E0B40 · text: #F59E0B       │  │
│  │  border-radius: 999dp · padding: 4 12dp · text-sm         │  │
│  │                                                           │  │
│  │  SE TAG NOVA (tag_is_new = true):                         │  │
│  │  Badge: "🆕 Será criada como não verificada"              │  │
│  │  bg: #FFFFFF08 · text-xs · text-white/40 · italic         │  │
│  │  Explicação: "Tags não verificadas ficam visíveis apenas  │  │
│  │  para você até serem aprovadas pelo time MMM."            │  │
│  │                                                           │  │
│  │  SE TAG EXISTENTE (tag_is_new = false):                   │  │
│  │  Badge: "✓ Tag verificada no dicionário MMM"              │  │
│  │  bg: #22C55E10 · text-xs · text-green-400                 │  │
│  │                                                           │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  BOTÕES                                                   │  │
│  │  [✓ Adicionar como ativo]  [🔍 Trocar tag]  [✗ Ignorar]  │  │
│  │  Adicionar: bg=#22C55E20 · border=#22C55E40 · #22C55E    │  │
│  │  Trocar:    bg=#8B5CF620 · border=#8B5CF640 · #8B5CF6    │  │
│  │  Ignorar:   bg=#FFFFFF08 · border=#FFFFFF20 · #FFFFFF40  │  │
│  │                                                           │  │
│  │  PAINEL "TROCAR TAG" (ao tocar Trocar tag):               │  │
│  │  [🔍 Buscar no dicionário MMM...]                         │  │
│  │  Lista de resultados (max 5 itens, scroll):               │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │ 🏷️ Farmacêutica e Biotecnologia  [Selecionar]   │   │  │
│  │  │ 🏷️ Saúde e Bem-estar            [Selecionar]   │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Anunciado: "Sugestão de ativo: Indústria Farmacêutica.        │
│    Tag nova, será criada como não verificada.                    │
│    Três ações: Adicionar como ativo, Trocar tag, Ignorar."       │
└─────────────────────────────────────────────────────────────────┘
```

### Tela D — Estado de Processamento (Timeout Progressivo)

```
┌─────────────────────────────────────────────────────────────────┐
│  ESTADO 1: Processando (0–5s)                                   │
│  [Avatar]  ● ● ●  (3 pontinhos, animação bounce, 600ms/ciclo)  │
│  Texto acessível: "Assistente está analisando sua resposta"     │
│  Input: desabilitado · Botão enviar: spinner                    │
│                                                                  │
│  ESTADO 2: Demora (5–10s)                                       │
│  [Avatar]  ● ● ●  (continua)                                    │
│  Abaixo do bubble: [Cancelar] (text-xs · text-white/40)         │
│  Botão Cancelar: envia sinal de abort ao backend                │
│                                                                  │
│  ESTADO 3: Aviso de lentidão (10–15s)                           │
│  [Avatar]  Isso está demorando mais que o esperado.             │
│            Verifique sua conexão.                               │
│  Botões: [Tentar novamente]  [Cancelar]                         │
│  Tentar novamente: resubmete a mesma mensagem (idempotente)     │
│                                                                  │
│  ESTADO 4: Erro (> 15s ou 503 do backend)                       │
│  [Avatar]  Não consegui processar agora. Tente em instantes.   │
│  Botão: [Tentar novamente] (bg: #F59E0B · text: #060e1a)        │
│  Input: reabilitado                                             │
│  Sessão permanece ativa — usuária pode continuar depois         │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Bubble pensando: accessibilityLiveRegion="polite"             │
│  - Anunciado: "Assistente está pensando"                         │
│  - Erro: accessibilityRole="alert"                               │
└─────────────────────────────────────────────────────────────────┘
```

### Tela E — Resumo de Conclusão

```
┌─────────────────────────────────────────────────────────────────┐
│  CARD DE CONCLUSÃO (aparece no chat como última mensagem)       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ✨ Cadastro enriquecido!                                 │  │
│  │  text-lg · font-bold · text-white                         │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  LISTA DO QUE FOI ADICIONADO                              │  │
│  │  ✓ Empresa: Farmacore                                     │  │
│  │  ✓ 2 ativos: Indústria Farmacêutica, Distribuição         │  │
│  │  ✓ 1 necessidade: Investidores                            │  │
│  │  ✓ Contexto: CPHI 2024                                    │  │
│  │  ─ Telefone: não informado                                │  │
│  │  text-sm · ✓ text-green-400 · ─ text-white/30            │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  BOTÕES (2 em linha)                                      │  │
│  │  [Ver perfil completo]  [Enriquecer outro contato]        │  │
│  │  Ver perfil: bg=#F59E0B · text=#060e1a · font-bold        │  │
│  │  Enriquecer outro: bg=#FFFFFF08 · border=#FFFFFF20        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  VERSÃO TIMEOUT (sessão expirou por 7 dias):                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ⏱ Sessão encerrada por inatividade (7 dias)             │  │
│  │  text-sm · text-white/50                                  │  │
│  │  "Você pode continuar o enriquecimento a qualquer momento."│  │
│  │  [Iniciar nova sessão] (bg: #F59E0B · text: #060e1a)      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Tela F — Histórico de Enriquecimento (Aba no Perfil)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER DA ABA                                                   │
│  "Histórico de Enriquecimento"  ·  [Filtrar ▾]                  │
├─────────────────────────────────────────────────────────────────┤
│  LISTA CRONOLÓGICA (mais recente primeiro)                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  🏢 Empresa preenchida                    10/08 14:32  │    │
│  │  IA sugeriu → você confirmou                           │    │
│  │  Farmacore                                             │    │
│  │  [🔄 Desfazer]                                         │    │
│  │  bg: #FFFFFF05 · border: #FFFFFF10 · border-radius: 12dp│   │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  🏷️ Ativo adicionado                      10/08 14:33  │    │
│  │  IA sugeriu → você editou → aplicado                   │    │
│  │  "Indústria Farmacêutica" → "Farma & Biotech"          │    │
│  │  [🔄 Desfazer]                                         │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ITEM DESFEITO (status = undone):                               │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  🏢 Empresa  (desfeito)                   10/08 14:35  │    │
│  │  ~~Farmacore~~  · text-white/30 · strikethrough        │    │
│  │  [↩ Restaurar]                                         │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ITEM IGNORADO:                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  📞 Telefone                              10/08 14:30  │    │
│  │  IA perguntou → você ignorou                           │    │
│  │  (não preenchido)  · text-white/30                     │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ESTADO VAZIO:                                                   │
│  [Ícone ✨ 48dp · centralizado · text-white/20]                 │
│  "Nenhum enriquecimento via IA ainda."                          │
│  "Toque em 'Enriquecer cadastro' no perfil para começar."       │
│  text-sm · text-white/40 · text-center                          │
│                                                                  │
│  Acessibilidade:                                                 │
│  - Cada item: accessibilityLabel="[Campo] [status]: [valor]. [data]"│
│  - Desfazer: accessibilityLabel="Desfazer: remover [campo] [valor]"│
│  - Restaurar: accessibilityLabel="Restaurar: [campo] [valor]"   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Especificação de API REST (OpenAPI 3.0)

```yaml
openapi: "3.0.3"
info:
  title: MMM CRM — Enrichment API v2 (Etapa 4)
  version: "2.0.0"
  description: |
    Chat de Enriquecimento de Cadastro com Claude 3.5 Sonnet.
    Autenticação: Bearer JWT. RBAC: roles `user` e `admin`.
    Rate limit: 20 mensagens/sessão, 50 sessões/dia/usuária.
    Concorrência otimista: If-Match com ETag da sessão.
    Todos os responses incluem X-Request-ID e ETag.

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
        error_code: { type: string, example: "SESSION_ALREADY_ACTIVE" }
        message:    { type: string, example: "Já existe uma sessão ativa para este contato." }
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

security:
  - BearerAuth: []

paths:

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
          description: Sessão criada com sucesso
          headers:
            X-Request-ID: { schema: { type: string } }
            ETag: { schema: { type: string }, description: "Versão da sessão para If-Match" }
          content:
            application/json:
              example:
                session_id: "sess-uuid"
                status: "active"
                etag: 1
                first_question: "Olá! Vou te ajudar a completar o cadastro da Ana. Qual é o telefone ou WhatsApp dela?"
                first_message_id: "msg-uuid"
                show_lgpd_notice: true
        "400": { description: "contact_id inválido" }
        "401": { description: "Token JWT ausente ou expirado" }
        "403":
          content:
            application/json:
              example: { error_code: "CONTACT_NOT_OWNED", message: "Este contato não pertence à sua conta.", details: {} }
        "404":
          content:
            application/json:
              example: { error_code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} }
        "409":
          content:
            application/json:
              example:
                error_code: "SESSION_ALREADY_ACTIVE"
                message: "Já existe uma sessão ativa para este contato."
                details: { existing_session_id: "sess-uuid", status: "active", etag: 3 }
        "422": { description: "Dados de entrada inválidos" }
        "429":
          content:
            application/json:
              example: { error_code: "DAILY_SESSION_LIMIT", message: "Limite de 50 sessões por dia atingido.", details: { retry_after_seconds: 3600 } }
        "503": { description: "Serviço de IA indisponível" }

  /enrichment-sessions/{session_id}/messages:
    post:
      summary: Enviar mensagem e receber resposta da IA
      operationId: sendEnrichmentMessage
      description: |
        Fluxo: salva msg usuária → monta contexto → chama Claude 3.5 Sonnet →
        parseia JSON → salva msg IA + cria suggestions → retorna.
        Timeout máximo: 15s. Retry automático 1x após 2s se Claude falhar.
        Concorrência otimista: If-Match deve conter o ETag atual da sessão.
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
        - name: If-Match
          in: header
          required: true
          schema: { type: string }
          description: "ETag da sessão (ex: '3'). Rejeita com 412 se não coincidir."
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content]
              properties:
                content:          { type: string, minLength: 1, maxLength: 2000 }
                client_timestamp: { type: string, format: date-time }
            example:
              content: "Ela trabalha na Farmacore, uma empresa farmacêutica de São Paulo."
              client_timestamp: "2026-08-10T14:32:00Z"
      responses:
        "200":
          headers:
            X-Request-ID: { schema: { type: string } }
            ETag: { schema: { type: string }, description: "Novo ETag da sessão após esta mensagem" }
          content:
            application/json:
              example:
                message_id: "msg-uuid"
                ai_response: "Entendi! Ela trabalha na Farmacore em São Paulo. Correto?"
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
                session_status: "active"
                pending_fields: ["phone", "assets", "needs", "context", "relationship"]
                session_complete: false
                completion_summary: null
                new_etag: 4
        "400":
          content:
            application/json:
              example: { error_code: "MESSAGE_TOO_LONG", message: "Mensagem excede 2000 caracteres.", details: {} }
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404":
          content:
            application/json:
              example: { error_code: "SESSION_NOT_FOUND", message: "Sessão não encontrada.", details: {} }
        "409":
          content:
            application/json:
              example: { error_code: "SESSION_NOT_ACTIVE", message: "Esta sessão não está ativa.", details: { current_status: "completed" } }
        "412":
          content:
            application/json:
              example: { error_code: "ETAG_MISMATCH", message: "Conflito de concorrência. Recarregue a sessão.", details: { current_etag: 5 } }
        "422":
          content:
            application/json:
              example: { error_code: "AI_TIMEOUT", message: "A IA não respondeu a tempo. Tente novamente.", details: { timeout_ms: 15000 } }
        "429":
          content:
            application/json:
              example: { error_code: "SESSION_MESSAGE_LIMIT", message: "Limite de 20 mensagens por sessão atingido.", details: {} }
        "503":
          content:
            application/json:
              example: { error_code: "AI_UNAVAILABLE", message: "Serviço de IA temporariamente indisponível. Tente em instantes.", details: { retry_after_seconds: 30 } }

  /enrichment-sessions/{session_id}/suggestions/{suggestion_id}/confirm:
    post:
      summary: Confirmar sugestão (com ou sem edição)
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
                edited_value: { type: string, nullable: true }
      responses:
        "200":
          content:
            application/json:
              example:
                suggestion_id: "sug-uuid"
                status: "applied"
                applied_value: "Farmacore"
                field_updated: "company"
        "400": { description: "Validation error" }
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404":
          content:
            application/json:
              example: { error_code: "SUGGESTION_NOT_FOUND", message: "Sugestão não encontrada.", details: {} }
        "409":
          content:
            application/json:
              example: { error_code: "SUGGESTION_ALREADY_ACTIONED", message: "Esta sugestão já foi confirmada ou ignorada.", details: { current_status: "applied" } }
        "422": { description: "Unprocessable" }
        "429": { description: "Rate limit" }
        "503": { description: "Database unavailable" }

  /enrichment-sessions/{session_id}/suggestions/{suggestion_id}/ignore:
    post:
      summary: Ignorar sugestão
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
              example: { suggestion_id: "sug-uuid", status: "ignored" }
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404": { description: "Suggestion not found" }
        "409": { description: "Already actioned" }
        "429": { description: "Rate limit" }
        "503": { description: "Database unavailable" }

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
              example:
                session_id: "sess-uuid"
                status: "completed"
                summary: "Adicionamos: Empresa (Farmacore), 2 ativos, 1 necessidade."
                applied_count: 4
                skipped_count: 1
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404": { description: "Session not found" }
        "409":
          content:
            application/json:
              example: { error_code: "SESSION_NOT_ACTIVE", message: "Sessão já está encerrada.", details: {} }
        "429": { description: "Rate limit" }
        "503": { description: "Database unavailable" }

  /private-network/contacts/{contact_id}/enrichment-history:
    get:
      summary: Histórico de sugestões aplicadas/ignoradas
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
          description: "Cursor para paginação (created_at do último item)"
      responses:
        "200":
          content:
            application/json:
              example:
                data:
                  - suggestion_id: "sug-uuid"
                    field_type: "company"
                    suggested_value: "Farmacore"
                    applied_value: "Farmacore"
                    status: "applied"
                    actioned_at: "2026-08-10T14:32:00Z"
                    session_id: "sess-uuid"
                    can_undo: true
                next_cursor: null
                total_applied: 4
                total_ignored: 1
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404": { description: "Contact not found" }
        "429": { description: "Rate limit" }

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
        "204": { description: "Sessão cancelada" }
        "401": { description: "Unauthorized" }
        "403": { description: "Forbidden" }
        "404": { description: "Session not found" }
        "409":
          content:
            application/json:
              example: { error_code: "SESSION_ALREADY_ENDED", message: "Sessão já está encerrada.", details: {} }
        "429": { description: "Rate limit" }
        "503": { description: "Database unavailable" }
```

---

## 6. Estratégia de Performance e Custos

### 6.1 Estimativa de Tokens por Sessão (Claude 3.5 Sonnet)

| Componente | Tokens input | Tokens output |
|---|---|---|
| System prompt (fixo por turno) | ~600 | — |
| Contexto do contato (variável) | ~200 | — |
| Histórico de 10 mensagens | ~800 | — |
| Mensagem da usuária (média) | ~50 | — |
| **Total input por turno** | **~1.650** | — |
| Resposta JSON da IA | — | ~350 |
| **Total por turno** | **~1.650** | **~350** |
| **8 turnos por sessão** | **~13.200** | **~2.800** |
| **Total por sessão** | **~16.000 tokens** | |

### 6.2 Projeção de Custo Mensal (2.000 usuárias ativas)

| Métrica | Cálculo | Valor |
|---|---|---|
| Sessões/mês | 2.000 usuárias × 5 sessões | 10.000 sessões |
| Tokens input/mês | 10.000 × 13.200 | 132M tokens |
| Tokens output/mês | 10.000 × 2.800 | 28M tokens |
| Custo input (Claude: $3,00/1M) | 132M × $0,003 | $396/mês |
| Custo output (Claude: $15,00/1M) | 28M × $0,015 | $420/mês |
| **Custo total estimado** | | **~$816/mês** |
| Custo por sessão | $816 / 10.000 | ~$0,082 |
| Custo por usuária/mês | $816 / 2.000 | ~$0,41 |

> **Nota:** O custo do Claude 3.5 Sonnet é ~48% maior que o GPT-4o ($550/mês). O delta de ~$266/mês é justificado pela qualidade superior de NER em português e conformidade LGPD mais clara.

### 6.3 Rate Limiting

| Limite | Valor | Justificativa |
|---|---|---|
| Mensagens por sessão | 20 | Roteiro tem 6 perguntas; 20 permite follow-ups sem abuso |
| Sessões por dia por usuária | 50 | Evita uso automatizado; usuária normal cria ~5/dia |
| Requisições ao Claude por minuto (global) | 60 | Dentro do tier padrão Anthropic |
| Timeout de resposta da IA | 15s | P95 esperado: ~1,5s; 15s cobre picos extremos |

### 6.4 Estratégia de Fallback

```
Cenário 1 — Timeout (> 15s):
  → Backend: retry automático 1x após 2s (backoff fixo)
  → Se falhar novamente: retornar 503 com AI_UNAVAILABLE
  → Frontend: exibe Tela D Estado 4 ("Não consegui processar agora")
  → Sessão permanece ativa; usuária pode continuar depois

Cenário 2 — Erro 500 do Claude:
  → Retry automático 1x após 2s
  → Se falhar: 503 para o app
  → Log do erro com X-Request-ID para diagnóstico

Cenário 3 — Rate limit do Claude (429):
  → Fila de espera no backend (max 30s)
  → Se não processar em 30s: 503 para o app

Cenário 4 — JSON inválido na resposta do Claude:
  → Logar conteúdo bruto com X-Request-ID
  → Retornar mensagem de fallback genérica:
    "Não entendi bem. Pode reformular sua resposta?"
  → NÃO criar enrichment_suggestions para esta mensagem
  → NÃO incrementar etag (mensagem não altera estado da sessão)
```

---

## 7. Critérios de Aceite (Definition of Done)

| # | Critério | Como verificar |
|---|---|---|
| 1 | Sessão inicia em ≤ 2s após cadastro manual | Teste de integração: medir tempo entre INSERT em contacts e criação da sessão |
| 2 | IA responde em ≤ 3s (P95) em 4G | Teste de carga com k6: 100 usuárias simultâneas |
| 3 | Confirmar sugestão em ≤ 2 toques | Teste de usabilidade: toque no card + botão confirmar |
| 4 | Sessão duplicada retorna 409 com session_id existente | Teste: POST duas vezes → segundo retorna 409 com existing_session_id |
| 5 | Dado confirmado aparece no perfil sem refresh | Teste E2E: confirmar empresa → abrir perfil → verificar campo |
| 6 | Tag existente é vinculada, não duplicada | Teste: confirmar tag existente → verificar ON CONFLICT DO NOTHING |
| 7 | Tag nova criada como `unverified` | Teste: confirmar tag nova → verificar tags_dictionary.verified = false |
| 8 | Desfazer aplicação não apaga mensagem do chat | Teste: desfazer → verificar enrichment_messages intacto |
| 9 | Timeout de 7 dias move sessão para `timeout` | Teste: executar job com data mockada → verificar status |
| 10 | Fallback de IA retorna erro claro em ≤ 5s | Teste: mockar timeout do Claude → verificar resposta em ≤ 5s |
| 11 | Todos os endpoints retornam X-Request-ID | Teste: verificar header em todas as respostas |
| 12 | If-Match incorreto retorna 412 | Teste: enviar ETag errado → verificar 412 com current_etag |

### 7.1 Casos de Teste Detalhados (14 casos)

```
1. Happy path completo:
   Cadastrar contato "Ana Souza" → sessão inicia → responder 6 perguntas
   → confirmar todas → sessão completed → resumo exibido.

2. Confirmação com alta confiança:
   Responder "Farmacore" → sugestão com confidence=0.97 → confirmar
   → campo company preenchido imediatamente.

3. Follow-up contextual:
   Responder "uma empresa de saúde" → Claude pede esclarecimento
   → "Qual é o nome da empresa?" → responder "MedTech Brasil"
   → sugestão company=MedTech Brasil.

4. Tag existente no dicionário:
   Responder "ela trabalha com farmácia" → Claude sugere tag existente
   "Indústria Farmacêutica" → confirmar → vínculo criado, não duplicado.

5. Tag nova:
   Responder "ela tem uma startup de agritech" → Claude propõe tag nova
   "Agritech" → confirmar → tag criada como unverified no dicionário.

6. Edição antes de confirmar:
   Sugestão "Farmacore" → tocar Editar → alterar para "Farmacore Ltda."
   → salvar → applied_value = "Farmacore Ltda.", status = "edited".

7. Ignorar sugestão:
   Sugestão de telefone → tocar Ignorar → status = "ignored"
   → IA não sugere novamente na mesma sessão.

8. "Não sei" como resposta:
   Perguntar telefone → responder "não tenho esse dado"
   → IA marca como skipped, avança para empresa
   → no final: "Você deixou de informar o telefone. Deseja incluir agora?"

9. Duplicidade de sessão (409):
   POST /enrichment-sessions duas vezes para o mesmo contato
   → segundo retorna 409 com existing_session_id.

10. IA offline (503):
    Mockar timeout de 15s no Claude → backend retenta 1x após 2s
    → retorna 503 → frontend exibe Tela D Estado 4 em ≤ 5s.

11. Rate limit de mensagens (429):
    Enviar 21ª mensagem → retorna 429 SESSION_MESSAGE_LIMIT.

12. Desfazer aplicação:
    Confirmar empresa → abrir histórico → tocar Desfazer
    → campo company volta ao valor anterior → status = "undone"
    → mensagem do chat permanece intacta.

13. Isolamento multi-tenant (403):
    Usuária A tenta acessar sessão da Usuária B
    → retorna 403 CONTACT_NOT_OWNED.

14. Concorrência otimista (412):
    Duas abas abertas com ETag=3 → primeira envia mensagem → ETag=4
    → segunda tenta enviar com If-Match: 3 → retorna 412 com current_etag=4.
```

---

## 8. Decisões Pendentes

| # | Questão | Impacto | Prazo sugerido |
|---|---|---|---|
| 1 | **Auto-apply com confiança > 0.95:** sugestões de campos simples (telefone, empresa) com confiança muito alta poderiam ser aplicadas sem confirmação, reduzindo fricção. Risco: erros silenciosos. Confirmar trade-off com produto. | Alto — impacta UX e confiança | Antes do sprint 1 |
| 2 | **Idioma multilíngue:** o system prompt detecta idioma automaticamente. A qualidade do NER em árabe, hindi e japonês pode ser inferior. Confirmar se o MVP é apenas pt-BR ou multilíngue desde o início. | Médio | Antes do sprint 1 |
| 3 | **Notificação push ao pausar:** quando sessão entra em `paused` (30 min sem resposta), enviar push "Continue enriquecendo o cadastro de Ana"? Requer FCM/APNs. | Médio — aumenta retenção | Sprint 3+ |
| 4 | **Limite de sessões históricas por contato:** manter apenas as 5 últimas sessões completed/timeout para controle de storage. | Baixo | Backlog |
| 5 | **ETag no frontend mobile:** React Native deve armazenar o ETag localmente (AsyncStorage) e enviá-lo em If-Match. Confirmar se o time mobile tem familiaridade com concorrência otimista. | Médio — risco de implementação | Antes do sprint 2 |

---

*Documento gerado por Manus AI · Projeto MMM — Mulheres que Movem o Mundo · Etapa 4 v2.0*
