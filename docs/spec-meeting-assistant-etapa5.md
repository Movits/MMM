# Especificação Técnica Completa — Etapa 5

## Assistente de Reuniões: Gravação, Transcrição e Extração Inteligente

**Produto:** MMM — Mulheres que Movem o Mundo  
**Módulo:** CRM Inteligente / Base Particular de Relacionamentos  
**Versão:** 1.0 — proposta para MVP  
**Autoria:** Manus AI  
**Status:** pronto para planejamento e desenvolvimento; não é uma implementação executável.

> **Escopo desta etapa.** Este documento define o módulo de reuniões privadas do CRM: gravação consentida, upload de áudio, transcrição assíncrona, extração de entidades e revisão de sugestões de contato. Por instrução de produto, ele não cria controllers, migrations executáveis, jobs nem processamento de áudio no projeto atual.

### Matriz de cobertura da solicitação

| Requisito do briefing | Seção final |
|---|---|
| Schema para reuniões, gravações, transcrições, extrações e sugestões | [Seção 4](#4-modelo-de-dados-postgresql-15) |
| Pipeline Whisper → Claude → sugestão de contatos | [Seção 3](#3-arquitetura-lógica-e-pipeline-assíncrono) |
| Storage S3 e remoção de áudio em 30 dias | [Seção 5](#5-storage-s3-e-retenção) |
| Consentimento LGPD, isolamento e RLS | [Seção 9](#9-segurança-lgpd-e-privacidade) |
| UX de gravação, processamento, sugestões e transcrição | [Seção 7](#7-uxui-mobile-first) |
| Contratos REST/OpenAPI | [Seção 8](#8-api-rest--openapi-30-resumida) |
| Custos, observabilidade e critérios de aceite | [Seções 10–12](#10-resiliência-observabilidade-e-operação) |

## 1. Objetivo e resultado de negócio

O Assistente de Reuniões reduz a perda de inteligência relacional após encontros, chamadas e eventos. A usuária grava uma reunião somente depois de declarar que obteve consentimento dos participantes. Quando a gravação é encerrada, o sistema a envia para armazenamento privado, transcreve o conteúdo e propõe contatos, ativos, necessidades e oportunidades. A usuária continua sendo a única pessoa que pode visualizar, corrigir, aceitar ou descartar esses resultados.

O módulo se integra às etapas anteriores sem alterar a propriedade dos dados: um contato confirmado pertence à Base Particular de Contatos; suas tags são registradas nos ativos e necessidades; e a reunião pode ser vinculada a um Contexto existente. O processamento deve ocorrer fora do ciclo de requisição da interface para que a usuária não permaneça aguardando o áudio ser transcrito.

| Área | Decisão para o MVP |
|---|---|
| Gravação móvel | AAC/M4A, mínimo 16 kHz, mono ou estéreo, via Expo/React Native |
| Transcrição | OpenAI Whisper API, assíncrona, com `language=pt` quando conhecido |
| Extração semântica | Claude 3.5 Sonnet, JSON estruturado e validação por schema |
| Armazenamento | S3 privado, prefixo por usuária/reunião, remoção automática do áudio após 30 dias |
| Dados permanentes | Transcrição, extrações, sugestões e auditoria, enquanto não houver exclusão ou anonimização válida |
| Privacidade | Isolamento por `user_id`, RBAC, RLS PostgreSQL e URLs pré-assinadas de curta duração |
| Confirmação humana | Toda sugestão que cria, altera ou vincula contato exige ação explícita da usuária |

### 1.1 Premissas de plataforma

A referência solicitada adota **NestJS, PostgreSQL 15+, React Native/Expo SDK 51 e AWS S3**. O projeto MMM hoje possui implementação web diferente; portanto, esta especificação é o contrato de arquitetura para a futura entrega móvel e deve ser adaptada ao runtime existente apenas quando a implementação for aprovada. Não é permitido reutilizar endpoints públicos ou armazenamento local para gravações.

### 1.2 Critérios de sucesso do MVP

| Indicador | Meta operacional |
|---|---:|
| Criação de reunião após consentimento | 100% das reuniões possuem `consent_given_at` e versão do aviso |
| Isolamento de dados | 0 leituras ou escritas cross-tenant nos testes de RLS |
| Processamento | status final (`completed` ou `failed`) em até 10 minutos para áudio de até 60 minutos, exceto indisponibilidade externa |
| Qualidade de revisão | 100% das sugestões de contato permanecem `pending` até decisão humana |
| Retenção de áudio | objetos originais vencidos após 30 dias, com reconciliação diária |
| Observabilidade | 100% dos jobs com `correlation_id`, tentativa, duração e causa de falha registradas |

---

## 2. Jornada funcional e fluxos de estado

### 2.1 Fluxo principal

```text
Usuária abre “Registrar reunião”
  → informa título opcional e contexto opcional
  → lê aviso LGPD e marca consentimento obrigatório
  → [Iniciar gravação]
  → POST /meetings cria meeting(status=recording)
  → aplicativo grava AAC/M4A localmente
  → [Pausar] ⇄ [Retomar]
  → [Finalizar]
  → meeting(status=uploading) + URL pré-assinada S3
  → cliente envia arquivo diretamente ao S3
  → POST /recordings/complete confirma checksum/tamanho
  → meeting(status=queued)
  → worker: valida arquivo → transcreve Whisper → persiste texto
  → worker: Claude extrai entidades → persiste extrações
  → worker: agrupa pessoas → cria sugestões pendentes
  → meeting(status=completed)
  → notificação/badge: “Reunião processada: N contatos sugeridos”
  → usuária revisa cada card: confirmar | editar | ignorar | já existe
```

### 2.2 Máquina de estados

| Entidade | Estados permitidos | Transições |
|---|---|---|
| `meetings.status` | `draft`, `recording`, `paused`, `uploading`, `queued`, `transcribing`, `extracting`, `completed`, `failed`, `cancelled`, `deleted` | A API aceita somente transições adjacentes; worker não pode retornar um item `completed` a `recording`. |
| `meeting_recordings.status` | `pending_upload`, `uploaded`, `verified`, `expired`, `deleted`, `failed` | A confirmação do upload exige `uploaded`; a limpeza de lifecycle marca `expired`/`deleted`. |
| `meeting_extractions.status` | `pending_review`, `accepted`, `rejected`, `superseded` | A decisão da sugestão propaga a decisão às extrações agrupadas. |
| `meeting_contact_suggestions.status` | `pending`, `confirmed`, `edited`, `ignored`, `linked`, `failed` | Estados terminais não podem voltar a `pending` sem duplicar uma nova sugestão. |

### 2.3 Regras de negócio não negociáveis

1. O botão **Iniciar gravação** permanece indisponível sem o checkbox de consentimento.
2. A transcrição não cria contatos automaticamente. O máximo que pode acontecer é criar **sugestões pendentes**.
3. A ação **Já existe** exige que a usuária escolha um contato da própria Base Particular. Busca por telefone tem precedência sobre busca por nome; o resultado nunca é visível para outras usuárias.
4. A ação **Editar** abre um formulário pré-preenchido, preserva o original em auditoria e exige salvar explicitamente.
5. O áudio original é removido pelo lifecycle do S3 depois de 30 dias. A transcrição não é removida por esse lifecycle, mas deve ser apagada quando a usuária excluir a reunião ou requisitar exclusão aplicável.
6. O próprio participante gravador é responsável por obter consentimento. O sistema registra a declaração, data, versão do aviso e identificador da sessão, sem tentar inferir consentimento por IA.

---

## 3. Arquitetura lógica e pipeline assíncrono

```text
┌─────────────────────┐       ┌───────────────────┐       ┌─────────────────┐
│ React Native / Expo │──────▶│ API NestJS        │──────▶│ PostgreSQL 15+  │
│ grava e envia AAC   │       │ JWT + RBAC + RLS  │       │ metadados/RLS   │
└─────────┬───────────┘       └─────────┬─────────┘       └─────────────────┘
          │ URL pré-assinada             │ publica job
          ▼                              ▼
┌─────────────────────┐       ┌───────────────────┐
│ S3 privado          │◀──────│ Fila + workers    │
│ mmm/meetings/...    │       │ idempotentes      │
└─────────┬───────────┘       └──────┬──────┬─────┘
          │ URL curta                  │      │
          ▼                            ▼      ▼
   ┌──────────────┐             ┌────────┐ ┌──────────────┐
   │ Whisper API  │             │ Claude │ │ Resend/push  │
   │ transcrição  │             │ NER    │ │ aviso pronto │
   └──────────────┘             └────────┘ └──────────────┘
```

### 3.1 Componentes e responsabilidades

| Componente | Responsabilidade | Não deve fazer |
|---|---|---|
| Aplicativo móvel | Capturar áudio, mostrar consentimento/timer, enviar arquivo, consultar status e revisar sugestões | Enviar áudio ao Whisper diretamente ou guardar credenciais de IA/S3 |
| API NestJS | Autorizar usuário, criar reunião, emitir URL pré-assinada, validar callbacks e expor recursos REST | Processar áudio longo no thread HTTP |
| Fila de jobs | Orquestrar as etapas e retries com `idempotency_key` | Reexecutar ação que já chegou ao estado terminal |
| Worker de transcrição | Ler áudio autorizado, chamar Whisper, salvar transcrição e métricas | Criar contatos ou expor conteúdo em logs |
| Worker de extração | Converter texto em JSON validado, persistir entidades e agrupar sugestões | Aceitar JSON inválido ou vincular contato sem revisão |
| S3 | Armazenar original criptografado e aplicar expiração | Expor bucket ou objeto publicamente |
| Notificação | Avisar somente a dona da reunião que o processamento terminou | Incluir transcrição, telefone ou conteúdo confidencial no texto da notificação |

### 3.2 Contrato interno do job

```json
{
  "job_type": "meeting.process",
  "job_id": "a0a4c4bd-ae4e-4e0c-932e-dcf3f9d2d4ff",
  "idempotency_key": "meeting:8b1c:recording:3:sha256:2f1c",
  "meeting_id": "8b1c3b16-318f-4bb2-8ea8-cd3cdc594a2f",
  "user_id": "a42a4a58-2821-4c68-95b8-b680f0d8a57b",
  "recording_id": "b40f1cb4-81fd-4183-b914-5fa81171e7e6",
  "attempt": 1,
  "correlation_id": "req_01HRQ4D9D1PDG0B8R9GQ10TM98",
  "enqueued_at": "2026-08-11T16:30:00Z"
}
```

### 3.3 Pipeline detalhado

1. A API cria `meetings` com `status=recording`, contexto opcional e evidência de consentimento.
2. Ao finalizar a captura, o aplicativo solicita uma URL pré-assinada `PUT`, válida por no máximo 15 minutos e limitada ao `content-type` AAC/M4A, tamanho esperado e chave específica.
3. O app envia o arquivo diretamente ao S3 e chama `POST /recordings/{id}/complete` com tamanho, SHA-256 e duração medida localmente.
4. A API confere metadados; em seguida, muda o estado para `queued` e publica job idempotente.
5. O worker torna a gravação `verified`, gera URL de leitura com duração curta, chama Whisper e persiste apenas o resultado retornado. O preço publicado para Whisper é US$ 0,006/minuto. [1]
6. O worker envia a transcrição, contexto da reunião e schema JSON para Claude 3.5 Sonnet. O modelo deve emitir apenas entidades suportadas e evidências textuais. A referência original do modelo informa janela de 200 mil tokens e US$ 3/MTok de entrada + US$ 15/MTok de saída. [2]
7. As entidades passam por validação Zod/JSON Schema, deduplicação e normalização de telefone/e-mail. Dados sem evidência ou confiança mínima ficam `pending_review`, nunca são descartados silenciosamente.
8. Um agrupador junta entidades por provável pessoa e gera `meeting_contact_suggestions`.
9. O sistema encerra em `completed` e cria uma notificação genérica para a dona. Em falha recuperável, agenda retry exponencial; em falha definitiva, marca `failed`, mantém diagnóstico seguro e apresenta botão de nova tentativa.

---

## 4. Modelo de dados PostgreSQL 15+

> **Referência de schema, não migration executável.** Identificadores são UUIDs. A aplicação define `SET LOCAL app.current_user_id = '<uuid>'` no início de cada transação autenticada; a conexão de serviço administrativo não deve possuir `BYPASSRLS`.

```sql
CREATE TYPE meeting_status AS ENUM (
  'draft','recording','paused','uploading','queued','transcribing',
  'extracting','completed','failed','cancelled','deleted'
);

CREATE TYPE recording_status AS ENUM (
  'pending_upload','uploaded','verified','expired','deleted','failed'
);

CREATE TYPE extraction_entity_type AS ENUM (
  'person_name','company','phone','email','role','asset_tag','need_tag',
  'opportunity','product','sector','city','country'
);

CREATE TYPE extraction_status AS ENUM (
  'pending_review','accepted','rejected','superseded'
);

CREATE TYPE suggestion_status AS ENUM (
  'pending','confirmed','edited','ignored','linked','failed'
);

CREATE TABLE meetings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_id UUID NULL REFERENCES contexts(id) ON DELETE SET NULL,
  title VARCHAR(180) NULL,
  status meeting_status NOT NULL DEFAULT 'draft',
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  consent_given_at TIMESTAMPTZ NULL,
  consent_notice_version VARCHAR(32) NULL,
  started_at TIMESTAMPTZ NULL,
  ended_at TIMESTAMPTZ NULL,
  duration_seconds INTEGER NULL CHECK (duration_seconds >= 0),
  processing_error_code VARCHAR(80) NULL,
  processing_error_at TIMESTAMPTZ NULL,
  anonymized_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((consent_confirmed = FALSE) OR consent_given_at IS NOT NULL)
);

CREATE TABLE meeting_recordings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  status recording_status NOT NULL DEFAULT 'pending_upload',
  content_type VARCHAR(80) NOT NULL DEFAULT 'audio/mp4',
  format VARCHAR(16) NOT NULL DEFAULT 'm4a',
  file_size_bytes BIGINT NULL CHECK (file_size_bytes >= 0),
  sha256 CHAR(64) NULL,
  sample_rate_hz INTEGER NULL CHECK (sample_rate_hz >= 16000),
  channels SMALLINT NULL CHECK (channels IN (1,2)),
  recorded_duration_seconds INTEGER NULL CHECK (recorded_duration_seconds >= 0),
  uploaded_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_transcriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES meeting_recordings(id) ON DELETE RESTRICT,
  full_text TEXT NOT NULL,
  language VARCHAR(12) NOT NULL DEFAULT 'pt-BR',
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  processing_time_ms INTEGER NULL CHECK (processing_time_ms >= 0),
  model_name VARCHAR(80) NOT NULL,
  source_version VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_extractions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  transcription_id UUID NOT NULL REFERENCES meeting_transcriptions(id) ON DELETE CASCADE,
  entity_type extraction_entity_type NOT NULL,
  entity_value TEXT NOT NULL,
  normalized_value TEXT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_text TEXT NOT NULL,
  start_time_ms INTEGER NULL CHECK (start_time_ms >= 0),
  end_time_ms INTEGER NULL CHECK (end_time_ms >= start_time_ms),
  speaker_label VARCHAR(64) NULL,
  status extraction_status NOT NULL DEFAULT 'pending_review',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_contact_suggestions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  contact_id UUID NULL REFERENCES private_contacts(id) ON DELETE SET NULL,
  suggested_name VARCHAR(180) NULL,
  suggested_company VARCHAR(180) NULL,
  suggested_role VARCHAR(180) NULL,
  suggested_phone VARCHAR(50) NULL,
  suggested_email VARCHAR(254) NULL,
  suggested_city VARCHAR(120) NULL,
  suggested_country VARCHAR(2) NULL,
  extracted_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted_needs JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunity_notes TEXT NULL,
  source_extraction_ids UUID[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status suggestion_status NOT NULL DEFAULT 'pending',
  resolution_note TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'confirmed' OR contact_id IS NOT NULL),
  CHECK (status <> 'linked' OR contact_id IS NOT NULL)
);
```

### 4.1 Índices e justificativas

```sql
CREATE INDEX meetings_user_status_started_idx
  ON meetings (user_id, status, started_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX meetings_user_context_idx
  ON meetings (user_id, context_id)
  WHERE context_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX meeting_recordings_meeting_idx ON meeting_recordings (meeting_id);
CREATE INDEX meeting_recordings_expiry_idx
  ON meeting_recordings (expires_at)
  WHERE deleted_at IS NULL;

CREATE INDEX meeting_transcriptions_meeting_idx ON meeting_transcriptions (meeting_id);
CREATE INDEX meeting_extractions_meeting_type_idx
  ON meeting_extractions (meeting_id, entity_type, confidence DESC);
CREATE INDEX meeting_extractions_user_status_idx
  ON meeting_extractions (user_id, status);
CREATE INDEX meeting_extractions_normalized_value_idx
  ON meeting_extractions (normalized_value)
  WHERE normalized_value IS NOT NULL;

CREATE INDEX meeting_suggestions_meeting_status_idx
  ON meeting_contact_suggestions (meeting_id, status, confidence DESC);
CREATE INDEX meeting_suggestions_user_pending_idx
  ON meeting_contact_suggestions (user_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX meeting_suggestions_phone_idx
  ON meeting_contact_suggestions (user_id, suggested_phone)
  WHERE suggested_phone IS NOT NULL;
```

O índice principal de `meetings` atende a listagem habitual: minhas reuniões, filtradas por status, da mais recente para a mais antiga. Índices de entidade evitam varredura completa ao abrir transcrição destacada ou ao revisar apenas telefones/empresas. O índice de expiração permite reconciliar objetos que o S3 já removeu.

### 4.2 RLS e tenancy

O PostgreSQL aplica RLS por tabela; com RLS habilitada e nenhuma policy compatível, o comportamento é **default deny**. [4] A API deve abrir transação e definir o usuário autenticado antes de qualquer leitura ou escrita.

```sql
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_contact_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY meetings_tenant_policy ON meetings
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY recordings_tenant_policy ON meeting_recordings
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY transcriptions_tenant_policy ON meeting_transcriptions
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY extractions_tenant_policy ON meeting_extractions
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY suggestions_tenant_policy ON meeting_contact_suggestions
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

### 4.3 Auditoria e consistência

Uma trigger comum atualiza `updated_at`; um log de auditoria imutável registra ações sensíveis: início, consentimento, finalização, emissão de URL, conclusão, decisão de sugestão, exclusão e anonimização. Cada worker usa `idempotency_key` exclusiva; a combinação `(meeting_id, recording_id, job_type)` deve ter índice único na tabela de jobs da infraestrutura.

---

## 5. Storage S3 e retenção

O bucket não pode ser público. A regra de lifecycle do S3 deve expirar objetos no prefixo `private/meetings/` após 30 dias; ações de expiração fazem o S3 excluir objetos vencidos automaticamente. [3]

```text
s3://mmm-private/
└── private/
    └── meetings/
        └── {user_id}/
            └── {meeting_id}/
                └── recordings/
                    └── {recording_id}.m4a
```

| Controle | Especificação |
|---|---|
| Criptografia em repouso | SSE-KMS com chave dedicada do ambiente; rotação gerenciada e permissões mínimas |
| Trânsito | TLS 1.2+; presigned `PUT` e `GET` somente HTTPS |
| URL de upload | 15 min; chave já definida; `Content-Type`, checksum SHA-256 e limite de tamanho no policy/validação |
| URL de leitura worker | 10 min; emitida sob demanda, não persistida nem enviada ao cliente |
| Cliente móvel | nunca recebe credenciais AWS; recebe apenas URL pré-assinada da própria gravação |
| Lifecycle | expirar em 30 dias; job diário concilia `deleted_at` com objeto ausente |
| Exclusão antecipada | revoga links futuros, deleta objeto e marca `meeting_recordings.deleted_at` |

Exemplo conceitual de regra de lifecycle:

```json
{
  "id": "expire-private-meeting-audio-after-30-days",
  "filter": { "prefix": "private/meetings/" },
  "expiration": { "days": 30 },
  "status": "Enabled"
}
```

---

## 6. Extração de entidades e agrupamento

### 6.1 Prompt e contrato da IA

O worker fornece somente a transcrição necessária, contexto opcional da reunião e uma instrução para não inventar dados. Ele não envia histórico integral da Base Particular nem dados de outras usuárias. Cada saída é validada por schema e armazenada com `evidence_text`, que permite à usuária verificar de onde a sugestão veio.

```json
{
  "language": "pt-BR",
  "entities": [
    {
      "entity_type": "person_name",
      "entity_value": "João Silva",
      "normalized_value": "joao silva",
      "confidence": 0.93,
      "evidence_text": "João Silva, diretor da Farmacore",
      "start_time_ms": 82000,
      "end_time_ms": 86000,
      "speaker_label": "SPEAKER_01",
      "metadata": { "possible_person_key": "p_1" }
    },
    {
      "entity_type": "company",
      "entity_value": "Farmacore",
      "normalized_value": "farmacore",
      "confidence": 0.89,
      "evidence_text": "diretor da Farmacore",
      "metadata": { "possible_person_key": "p_1" }
    }
  ],
  "suggested_contacts": [
    {
      "person_key": "p_1",
      "name": "João Silva",
      "company": "Farmacore",
      "role": "Diretor",
      "phone": null,
      "email": null,
      "assets": ["acesso a fábrica"],
      "needs": ["investidores"],
      "opportunity_notes": "Possível parceria industrial.",
      "source_entity_indexes": [0, 1],
      "confidence": 0.86
    }
  ]
}
```

### 6.2 Regras de normalização e confiança

| Tipo | Normalização | Regra de criação de sugestão |
|---|---|---|
| Pessoa | caixa baixa, espaços normalizados, sem remover nome original | nome + pelo menos uma evidência relacionada, confiança ≥ 0,60 |
| Telefone | E.164 quando DDI/DDD forem determináveis; original permanece na evidência | nunca sobrescrever contato existente automaticamente |
| E-mail | lowercase, validação sintática, sem validação de entrega | confiança ≥ 0,85 para exibir como dado principal |
| Empresa/cargo | valor original + forma normalizada | pode compor card sem criar contato isolado |
| Ativo/necessidade | mapear para `tags_dictionary`; sem correspondência cria item “não verificado” | confirmação humana obrigatória |
| Oportunidade | texto livre e evidência | não cria oportunidade pública; apenas nota privada no card |

O agrupador deve priorizar telefone normalizado, e-mail normalizado e depois nome + empresa. Ambiguidade gera dois cards ou solicita decisão à usuária; nunca funde pessoas automaticamente por semelhança textual isolada.

### 6.3 Aplicação da decisão da usuária

| Ação | Efeito transacional |
|---|---|
| Confirmar | Cria `private_contacts`, associa tags de ativos/necessidades, vincula o contato ao `context_id` da reunião quando existente, marca card `confirmed` |
| Editar | Abre formulário com origem/evidência; ao salvar, cria ou atualiza apenas os campos escolhidos e marca card `edited` |
| Ignorar | Marca `ignored`; preserva auditoria e não mostra novamente naquele encontro |
| Já existe | Busca somente na rede da usuária; vincula `contact_id` e marca `linked` |

Todas as ações acima devem ser uma transação: se criação de contato, vínculo de tags ou vínculo de contexto falhar, nenhum estado parcial pode permanecer.

---

## 7. UX/UI mobile-first

### Tela A — Registrar reunião

**Cabeçalho:** “Registrar reunião” e ação de voltar.  
**Campos:** título opcional (até 180 caracteres), seletor de contexto opcional, aviso de privacidade e checkbox de consentimento.  
**CTA primário:** “Iniciar gravação”, com cor MMM `#D4A017`, habilitado somente quando `consent_confirmed=true`.

> “Confirmo que obtive consentimento dos participantes para gravar esta reunião.”

> “Este áudio será processado por IA para extrair informações de contato e oportunidades. Apenas você tem acesso à gravação e à transcrição.”

Estados: campo de contexto vazio; consentimento não marcado; erro de permissão de microfone; sem espaço local; link para política de privacidade.

### Tela B — Gravação em andamento

**Topo:** título editável e badge “Gravando”.  
**Centro:** timer `HH:MM:SS`, waveform/amplitude com alternativa textual acessível “áudio sendo capturado”.  
**Ações:** Pausar/Retomar e Finalizar. Finalizar requer confirmação simples apenas se ainda estiver gravando.  
**Tratamento de interrupção:** se o app não suportar background no aparelho, a interface pausa e informa “A gravação foi pausada para preservar sua privacidade; retome ao voltar ao app.” Chamada telefônica pausa automaticamente.

### Tela C — Upload e processamento

Mostra três etapas com status: “Enviando áudio”, “Transcrevendo” e “Organizando sugestões”. A usuária pode sair da tela; o cartão aparece depois em “Minhas reuniões” com badge de processamento. Erros mostram “Tentar novamente” sem expor detalhes de provedores.

### Tela D — Detalhe da reunião concluída

Resumo com título, data, duração, contexto, contagem de sugestões pendentes e navegação em abas: **Sugestões**, **Transcrição** e **Detalhes**. Exibir aviso de retenção: “O áudio estará disponível até DD/MM/AAAA”.

### Tela E — Revisar sugestões de contato

Lista vertical, acessível e previsível; o padrão Tinder pode ser opcional, não obrigatório. Cada card contém identidade sugerida, empresa, cargo, telefone/e-mail, chips de ativos/necessidades, confiança qualitativa e trecho de evidência expansível.

| Ação do card | Comportamento |
|---|---|
| Confirmar | cria o contato e apresenta toast “Contato adicionado à sua rede” |
| Editar | abre formulário pré-preenchido com campos modificáveis |
| Ignorar | marca a sugestão como ignorada e avança para o card seguinte |
| Já existe | abre busca somente na Base Particular da usuária e vincula o resultado escolhido |

### Tela F — Transcrição

Texto corrido com busca local, contador de resultados e destaques: pessoa em azul, empresa em verde, telefone/e-mail em laranja, ativo em dourado e necessidade em roxo. Toque em destaque abre bottom sheet com evidência, confiança e vínculo com o card. O MVP não inclui exportação, mas reserva ação “Exportar” como indisponível e sem falsa promessa.

### Acessibilidade e localização

Todos os controles possuem rótulos acessíveis; waveform não é a única forma de indicar gravação; contraste mínimo AA; mensagens de erro são anunciadas por leitor de tela. As chaves de texto devem entrar nos 10 locales existentes do MMM antes do lançamento. A linguagem da transcrição pode ser detectada, mas a interface respeita o idioma escolhido pela usuária.

---

## 8. API REST — OpenAPI 3.0 resumida

```yaml
openapi: 3.0.3
info:
  title: MMM Meeting Assistant API
  version: 1.0.0
servers:
  - url: https://api.mmm.example/api/v1
paths:
  /meetings:
    post:
      summary: Cria uma reunião e registra consentimento
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [consentConfirmed, consentNoticeVersion]
              properties:
                title: { type: string, maxLength: 180 }
                contextId: { type: string, format: uuid, nullable: true }
                consentConfirmed: { type: boolean, enum: [true] }
                consentNoticeVersion: { type: string, example: "2026-08" }
      responses:
        '201': { description: Reunião criada em recording }
        '400': { description: Consentimento ou payload inválido }
        '401': { description: JWT ausente ou inválido }
        '429': { description: Limite de criação atingido }
    get:
      summary: Lista as reuniões da usuária autenticada
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: status, in: query, schema: { type: string } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        '200': { description: Lista paginada e privada }
  /meetings/{meetingId}:
    get:
      summary: Detalha uma reunião privada
      security: [{ bearerAuth: [] }]
      responses:
        '200': { description: Reunião encontrada }
        '404': { description: Não encontrada para o tenant }
    patch:
      summary: Atualiza título ou contexto antes/depois do processamento
      security: [{ bearerAuth: [] }]
      responses:
        '200': { description: Atualizada }
    delete:
      summary: Solicita exclusão da reunião, áudio e dados derivados
      security: [{ bearerAuth: [] }]
      responses:
        '202': { description: Exclusão assíncrona iniciada }
  /meetings/{meetingId}/recordings/presign:
    post:
      summary: Emite URL pré-assinada de upload para o áudio da própria reunião
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [contentType, fileSizeBytes, format]
              properties:
                contentType: { type: string, example: audio/mp4 }
                fileSizeBytes: { type: integer, maximum: 104857600 }
                format: { type: string, enum: [m4a, aac] }
      responses:
        '201': { description: recordingId, storage key e URL temporária }
        '413': { description: Arquivo maior que o limite }
        '415': { description: Formato não aceito }
  /meetings/{meetingId}/recordings/{recordingId}/complete:
    post:
      summary: Confirma upload, valida metadados e agenda processamento
      security: [{ bearerAuth: [] }]
      responses:
        '202': { description: Processamento enfileirado }
        '409': { description: Upload já confirmado ou estado inválido }
  /meetings/{meetingId}/transcription:
    get:
      summary: Retorna transcrição e entidades destacáveis
      security: [{ bearerAuth: [] }]
      responses:
        '200': { description: Transcrição privada }
        '409': { description: Processamento ainda não concluído }
  /meetings/{meetingId}/suggestions:
    get:
      summary: Lista sugestões de contato pendentes ou resolvidas
      security: [{ bearerAuth: [] }]
      responses:
        '200': { description: Sugestões privadas }
  /meeting-contact-suggestions/{suggestionId}/resolve:
    post:
      summary: Confirma, edita, ignora ou vincula uma sugestão a contato existente
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [action]
              properties:
                action: { type: string, enum: [confirm, edit, ignore, link_existing] }
                contactId: { type: string, format: uuid, nullable: true }
                contactPayload: { type: object, nullable: true }
      responses:
        '200': { description: Decisão persistida em transação }
        '409': { description: Sugestão já resolvida ou conflito concorrente }
        '422': { description: Dados de contato inválidos }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

### 8.1 Padrão de erro

```json
{
  "error": {
    "code": "MEETING_NOT_READY",
    "message": "A reunião ainda está sendo processada.",
    "correlationId": "req_01HRQ4D9D1PDG0B8R9GQ10TM98",
    "retryAfterSeconds": 15
  }
}
```

Mensagens ao cliente não incluem bucket, URL pré-assinada, conteúdo de transcrição, resposta bruta de modelo ou identificação de outro tenant.

---

## 9. Segurança, LGPD e privacidade

A LGPD regula o tratamento de dados pessoais inclusive em meios digitais. [5] Nesta funcionalidade, uma gravação pode conter dados de contato, voz, informação profissional e conteúdo estratégico. Portanto, o produto deve tratar o consentimento de gravação como controle explícito de UX e manter trilha de evidência; a validação jurídica da base legal e do aviso final permanece responsabilidade do time jurídico/DPO.

| Camada | Controle obrigatório |
|---|---|
| Autenticação | JWT de curta duração; refresh seguro; endpoint verifica `sub` antes de carregar qualquer recurso |
| Autorização | `user` gerencia somente suas reuniões; `admin` acessa metadados operacionais por fluxo auditado, não conteúdo por padrão |
| Banco | RLS por `user_id`, `FORCE ROW LEVEL SECURITY` para papéis de aplicação quando aplicável, e testes negativos cross-tenant |
| Arquivos | bucket privado, SSE-KMS, URLs pré-assinadas curtas e chave do objeto derivada do `user_id` + `meeting_id` |
| Provedores | segredo apenas no worker; nenhuma credencial OpenAI, Anthropic, S3 ou Resend no aplicativo móvel |
| Logs | redigir texto, telefone, e-mail e URL; guardar somente IDs, durações, status e `correlation_id` |
| Consentimento | checkbox obrigatório, data/hora, versão do aviso, identidade da usuária e auditoria imutável |
| Retenção | áudio: 30 dias; texto/extratos: até exclusão/anonimização; execução diária de reconciliação |
| Exclusão | enfileirar remoção S3 e cascata lógica dos derivados; provar conclusão por auditoria |
| Abuso | limites por usuária/dia, tamanho máximo, mime allowlist, checksum e antivirus opcional antes do worker |

**Anonimização futura:** `anonymized_at` em `meetings` sinaliza que identificadores diretos foram removidos ou irreversivelmente transformados. A implementação futura deve definir se transcrição é apagada ou pseudonimizada, com validação jurídica antes de prometer anonimização.

---

## 10. Resiliência, observabilidade e operação

### 10.1 Retentativas e falhas

| Falha | Tratamento | Retry |
|---|---|---|
| Upload interrompido | manter `pending_upload`, permitir nova URL ao mesmo `recording_id` se checksum não foi confirmado | cliente, até expirar URL |
| S3 indisponível | marcar operação como recuperável e exibir ação de tentar novamente | exponencial: 1, 5, 15 min |
| Whisper 429/5xx | não perde gravação; mantém job em `queued` | 3 tentativas com backoff e jitter |
| Whisper devolve arquivo inválido | `failed` com código seguro `TRANSCRIPTION_INVALID_RESPONSE` | manual após revisão |
| Claude JSON inválido | validar, solicitar reparo estruturado uma vez; se falhar, persistir transcrição e marcar extração como falha | 1 reparo + 2 retries |
| Duplicação de job | bloquear por `idempotency_key` e retornar último estado | não duplicar transcrição/sugestões |
| Consentimento ausente | API responde 400; não cria URL nem arquivo | sem retry |

### 10.2 Métricas e alertas

| Métrica | Dimensão | Alerta inicial |
|---|---|---|
| `meeting_upload_success_ratio` | app version, OS | abaixo de 95% por 30 min |
| `meeting_transcription_latency_ms` | duração do áudio, idioma | p95 acima de 8 min |
| `meeting_extraction_failure_ratio` | modelo, versão do prompt | acima de 3% por 1 h |
| `meeting_suggestion_resolution_ratio` | ação, categoria | monitoramento de qualidade semanal |
| `meeting_audio_lifecycle_overdue_count` | ambiente | maior que 0 por 24 h |
| `meeting_cross_tenant_denied_count` | endpoint | pico anormal: investigar segurança |

O dashboard operacional não exibe texto transcrito. O trace correlaciona request, job, recording e meeting apenas por IDs.

---

## 11. Estimativa de custos e capacidade

O custo publicado para Whisper é US$ 0,006/minuto. [1] Para manter aderência à decisão de produto, a estimativa abaixo usa a referência original de Claude 3.5 Sonnet: US$ 3/MTok de entrada e US$ 15/MTok de saída. [2] Valores de S3, transferência, push e Resend devem ser cotados na conta/região contratada, portanto não são fixados aqui.

| Hipótese por reunião | Cálculo | Custo estimado |
|---|---:|---:|
| Áudio de 30 min | 30 × US$ 0,006 | US$ 0,18 de transcrição |
| Extração típica | 10 mil tokens input + 2 mil output | US$ 0,06 de NER |
| Processamento típico | Whisper + NER | **US$ 0,24**, antes de S3/egress/notificação |
| 1.000 reuniões de 30 min/mês | 1.000 × US$ 0,24 | **US$ 240/mês**, antes de S3/egress/notificação |

Fórmula operacional: `custo_mensal = minutos_de_audio × 0,006 + (tokens_input / 1.000.000 × 3) + (tokens_output / 1.000.000 × 15) + custo_s3 + custo_notificacoes`. Antes de produção, o time deve atualizar a tabela com a lista de preços vigente, já que preços e disponibilidade de modelos podem mudar.

---

## 12. Critérios de aceite e plano de testes

| ID | Critério testável |
|---|---|
| AC-01 | Sem checkbox de consentimento, `POST /meetings` retorna 400 e não há meeting/recording criado. |
| AC-02 | Reunião criada contém `consent_given_at`, versão de aviso e `user_id`. |
| AC-03 | URL pré-assinada de uma usuária não permite upload/leitura em `meeting_id` de outra. |
| AC-04 | Áudio M4A de 30 minutos chega a `completed` com transcrição persistida e sem bloquear a requisição HTTP. |
| AC-05 | Um job duplicado não cria segunda transcrição nem sugestões duplicadas. |
| AC-06 | Extração inválida de IA não cria contato e deixa diagnóstico seguro para retry. |
| AC-07 | Card confirmado cria contato, tags e vínculo de contexto em uma única transação. |
| AC-08 | Card ignorado fica `ignored`, permanece auditável e não volta à fila pendente. |
| AC-09 | Card “já existe” busca apenas contatos da mesma `user_id`. |
| AC-10 | Teste de RLS prova que usuário A não consulta, cria, atualiza ou remove dados de usuário B. |
| AC-11 | Lifecycle/reconciliação marca áudio de mais de 30 dias como removido, sem apagar transcrição. |
| AC-12 | Log de notificação não contém trecho de transcrição, telefone, e-mail nem nome sugerido. |
| AC-13 | Falha do Whisper executa retries com backoff; depois do limite apresenta estado recuperável. |
| AC-14 | Interface anuncia estado de gravação e processamento para leitor de tela e opera com foco por teclado onde aplicável. |

### Casos de teste prioritários

1. **Happy path:** consentimento → gravação de 5 min → upload → transcrição → duas sugestões → confirmar uma e ignorar outra.
2. **Contato existente:** entidade com telefone igual ao da Base Particular; usuária usa “Já existe” e vínculo é criado sem duplicar contato.
3. **Resiliência:** desativar temporariamente Whisper; verificar estado `queued`, retries e ação manual de nova tentativa.
4. **Privacidade:** usuário B chama detalhe, URL e transcrição de reunião do usuário A; todos retornam 404 ou conjunto vazio sem diferença observável.
5. **Retenção:** objeto simulado vencido; worker de reconciliação remove acesso ao áudio e preserva transcrição/metadados.

---

## 13. Backlog de implementação recomendado

| Ordem | Entrega | Dependência |
|---:|---|---|
| 1 | Modelagem PostgreSQL, RLS, auditoria e bucket/policy S3 | decisão de ambientes e KMS |
| 2 | API de reunião, consentimento e presigned upload | JWT/RBAC e storage |
| 3 | Interface Expo de gravação, pausa, upload e status | permissões nativas iOS/Android |
| 4 | Fila, worker Whisper e persistência de transcrição | observabilidade e credenciais OpenAI |
| 5 | Worker Claude, schema de extração e agrupamento | credenciais Anthropic e dicionário de tags |
| 6 | Revisão de sugestões e transações com contatos/tags/contextos | etapas 1, 2 e 3 do CRM |
| 7 | Lifecycle, exclusão, reconciliação, alertas e testes de carga | infraestrutura S3 e DPO |

## 14. Decisões ainda necessárias antes do desenvolvimento

1. Confirmar se a retenção de texto é realmente permanente ou se haverá prazo por região/contrato.
2. Definir limite máximo de duração e tamanho por gravação no MVP; esta proposta usa 100 MB no contrato de upload apenas como limite inicial sujeito à revisão.
3. Escolher tecnologia de fila compatível com infraestrutura: SQS, BullMQ/Redis ou equivalente. O contrato exige semântica idempotente, não fornecedor específico.
4. Validar capacidade de gravação em segundo plano do Expo para o conjunto mínimo de iOS/Android suportado.
5. Validar juridicamente o texto de consentimento, política de privacidade, procedimento de exclusão e uso de provedores internacionais.
6. Confirmar a disponibilidade comercial do Claude 3.5 Sonnet no ambiente pretendido; caso esteja descontinuado, preservar o contrato JSON e substituir por modelo Sonnet compatível após nova estimativa.

---

## Referências

[1]: https://developers.openai.com/api/docs/pricing "OpenAI API Pricing — modelos de transcrição"
[2]: https://www.anthropic.com/news/claude-3-5-sonnet "Anthropic — anúncio e preço do Claude 3.5 Sonnet"
[3]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html "AWS S3 — gerenciamento de lifecycle de objetos"
[4]: https://www.postgresql.org/docs/current/ddl-rowsecurity.html "PostgreSQL — Row Security Policies"
[5]: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm "Lei nº 13.709/2018 — LGPD"
