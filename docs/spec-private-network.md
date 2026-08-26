# Especificação Técnica — Base Particular de Contatos
## Módulo: Minha Rede de Relacionamentos · MMM (Mulheres que Movem o Mundo)

> **Versão:** 1.0 · **Data:** Agosto 2026 · **Autor:** Manus AI para Projeto MMM

---

## 1. Visão Geral

O módulo **"Base Particular de Contatos"** é um CRM pessoal embutido no ecossistema MMM. Cada usuária mantém uma agenda estratégica completamente isolada, onde registra contatos de alto valor — investidores, diplomatas, executivos, autoridades públicas, advogados, pesquisadores, fornecedores e compradores — independentemente de essas pessoas estarem cadastradas na plataforma.

O princípio central de design é **privacidade absoluta por padrão**: nenhuma outra usuária, administradora ou operador da plataforma pode acessar, listar ou inferir a existência de contatos de terceiros sem consentimento explícito da proprietária.

---

## 2. Modelo de Dados — Esquema do Banco de Dados

### 2.1 Tabela `private_contacts`

```sql
CREATE TABLE private_contacts (
  -- Identidade
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  owner_id      VARCHAR(128)      NOT NULL,          -- FK → users.open_id (proprietária do contato)

  -- Informações básicas
  full_name     VARCHAR(200)      NOT NULL,
  photo_url     VARCHAR(512)      NULL,              -- URL no storage S3 interno
  job_title     VARCHAR(200)      NULL,
  company       VARCHAR(200)      NULL,

  -- Localização
  country       VARCHAR(100)      NULL,
  state         VARCHAR(100)      NULL,
  city          VARCHAR(100)      NULL,

  -- Comunicação
  phone         VARCHAR(50)       NULL,              -- formato E.164 recomendado
  whatsapp      VARCHAR(50)       NULL,
  email         VARCHAR(254)      NULL,

  -- Presença digital
  linkedin_url  VARCHAR(512)      NULL,
  instagram     VARCHAR(100)      NULL,              -- @handle sem @

  -- Categorização
  profile_tags  JSON              NULL,              -- ex: ["Investidor","Diplomata"]

  -- Cartão de visita
  card_image_url VARCHAR(512)     NULL,              -- URL no storage S3 interno
  card_ocr_text  TEXT             NULL,              -- reservado para futuro OCR

  -- Notas
  notes         TEXT              NULL,

  -- Auditoria
  created_at    BIGINT            NOT NULL,          -- Unix ms UTC
  updated_at    BIGINT            NOT NULL,          -- Unix ms UTC

  PRIMARY KEY (id),

  -- Row-Level Security: toda query DEVE filtrar por owner_id
  INDEX idx_owner          (owner_id),
  INDEX idx_owner_name     (owner_id, full_name),
  INDEX idx_owner_company  (owner_id, company),
  INDEX idx_owner_country  (owner_id, country),
  INDEX idx_owner_updated  (owner_id, updated_at DESC)
);
```

### 2.2 Esquema Drizzle ORM (TypeScript)

```ts
// drizzle/schema.ts — adição ao schema existente
export const privateContacts = mysqlTable("private_contacts", {
  id:            bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  ownerId:       varchar("owner_id", { length: 128 }).notNull(),

  fullName:      varchar("full_name",  { length: 200 }).notNull(),
  photoUrl:      varchar("photo_url",  { length: 512 }),
  jobTitle:      varchar("job_title",  { length: 200 }),
  company:       varchar("company",    { length: 200 }),

  country:       varchar("country",    { length: 100 }),
  state:         varchar("state",      { length: 100 }),
  city:          varchar("city",       { length: 100 }),

  phone:         varchar("phone",      { length: 50 }),
  whatsapp:      varchar("whatsapp",   { length: 50 }),
  email:         varchar("email",      { length: 254 }),

  linkedinUrl:   varchar("linkedin_url",  { length: 512 }),
  instagram:     varchar("instagram",     { length: 100 }),

  profileTags:   json("profile_tags").$type<string[]>(),

  cardImageUrl:  varchar("card_image_url", { length: 512 }),
  cardOcrText:   text("card_ocr_text"),

  notes:         text("notes"),

  createdAt:     bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:     bigint("updated_at", { mode: "number" }).notNull(),
});
```

### 2.3 Recomendações de Índices

| Índice | Campos | Justificativa |
|---|---|---|
| `idx_owner` | `owner_id` | Filtro primário em toda operação — obrigatório |
| `idx_owner_name` | `owner_id, full_name` | Busca por nome dentro da rede da usuária |
| `idx_owner_company` | `owner_id, company` | Filtro por empresa/instituição |
| `idx_owner_country` | `owner_id, country` | Filtro por localização |
| `idx_owner_updated` | `owner_id, updated_at DESC` | Ordenação padrão (mais recentes primeiro) |

> **Nota sobre `profile_tags`:** o campo é `JSON` para máxima flexibilidade. Para buscas frequentes por tag, considere uma tabela auxiliar `private_contact_tags (contact_id, tag)` com índice composto `(owner_id via JOIN, tag)` em versões futuras.

---

## 3. Fluxo de Tela UX/UI

### 3.1 Tela Principal — Lista de Contatos (`/network`)

```
┌─────────────────────────────────────────────────────┐
│  ← Dashboard          Minha Rede          [+ Novo]  │
├─────────────────────────────────────────────────────┤
│  🔍 Buscar por nome, empresa ou cargo...            │
├──────────────────────────────────────────────────── │
│  Filtros: [Todos ▾]  [País ▾]  [Perfil ▾]          │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ 🖼  Ana Souza                          [···]  │  │
│  │     CEO · Fundo XYZ                           │  │
│  │     🇧🇷 São Paulo  ·  💼 Investidora          │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ 🖼  Carlos Mendes                      [···]  │  │
│  │     Embaixador · Ministério das Relações Ext. │  │
│  │     🇧🇷 Brasília  ·  🌐 Diplomata             │  │
│  └───────────────────────────────────────────────┘  │
│  ... (scroll infinito)                              │
└─────────────────────────────────────────────────────┘
```

**Comportamentos:**
- Busca full-text em tempo real (debounce 300ms) nos campos `full_name`, `company` e `job_title`.
- Filtro por `profile_tags` (multi-select chips) e por `country`.
- Card exibe foto (avatar com inicial se ausente), nome, cargo, empresa, país e primeira tag.
- Menu `[···]` oferece: **Ver**, **Editar**, **Excluir** (com confirmação).
- Botão `[+ Novo]` abre drawer lateral (desktop) ou bottom sheet (mobile).

### 3.2 Fluxo — Adicionar Novo Contato

```
Passo 1 — Informações Básicas
  ┌──────────────────────────────────────────────────┐
  │  📷 Foto do Contato                [Carregar]    │
  │  ─────────────────────────────────────────────   │
  │  Nome Completo *                                 │
  │  [_________________________________]             │
  │  Cargo                                           │
  │  [_________________________________]             │
  │  Empresa / Instituição                           │
  │  [_________________________________]             │
  │                              [Próximo →]         │
  └──────────────────────────────────────────────────┘

Passo 2 — Localização e Comunicação
  ┌──────────────────────────────────────────────────┐
  │  País          [Selecione ▾]                     │
  │  Estado        [_____________]                   │
  │  Cidade        [_____________]                   │
  │  ─────────────────────────────────────────────   │
  │  Telefone      [+55 (__)_____-____]              │
  │  WhatsApp      [+55 (__)_____-____]              │
  │  E-mail        [___________________@___.___]     │
  │                    [← Voltar]  [Próximo →]       │
  └──────────────────────────────────────────────────┘

Passo 3 — Presença Digital e Perfil
  ┌──────────────────────────────────────────────────┐
  │  LinkedIn URL  [linkedin.com/in/_______________] │
  │  Instagram     [@___________________________]    │
  │  ─────────────────────────────────────────────   │
  │  Perfil / Tags (selecione todos que se aplicam)  │
  │  [Investidor] [Diplomata] [Executivo] [Advogado] │
  │  [Autoridade] [Fornecedor] [Comprador] [Pesquis.]│
  │                    [← Voltar]  [Próximo →]       │
  └──────────────────────────────────────────────────┘

Passo 4 — Cartão de Visita e Notas
  ┌──────────────────────────────────────────────────┐
  │  📇 Cartão de Visita                             │
  │  ┌────────────────────────────────────────────┐  │
  │  │  Arraste ou clique para enviar imagem      │  │
  │  │  JPG, PNG ou PDF · máx. 5 MB              │  │
  │  └────────────────────────────────────────────┘  │
  │  ─────────────────────────────────────────────   │
  │  Notas / Observações                             │
  │  ┌────────────────────────────────────────────┐  │
  │  │  Como nos conhecemos, contexto, próximos   │  │
  │  │  passos...                                 │  │
  │  └────────────────────────────────────────────┘  │
  │                    [← Voltar]  [✓ Salvar]        │
  └──────────────────────────────────────────────────┘
```

### 3.3 Cartão de Perfil do Contato (visualização)

```
┌─────────────────────────────────────────────────────┐
│  ← Minha Rede                              [Editar] │
├─────────────────────────────────────────────────────┤
│                                                     │
│        ┌──────────┐                                 │
│        │   FOTO   │  Ana Souza                      │
│        │  128×128 │  CEO · Fundo XYZ                │
│        └──────────┘  🇧🇷 São Paulo, SP, Brasil      │
│                                                     │
│  Tags: [Investidora] [Executiva]                    │
├─────────────────────────────────────────────────────┤
│  📞 Comunicação                                     │
│     Telefone:   +55 11 9 9999-9999                  │
│     WhatsApp:   +55 11 9 9999-9999  [Abrir ↗]      │
│     E-mail:     ana@fundoxyz.com    [Copiar]        │
├─────────────────────────────────────────────────────┤
│  🌐 Presença Digital                                │
│     LinkedIn:   /in/anasouza       [Abrir ↗]       │
│     Instagram:  @anasouza          [Abrir ↗]       │
├─────────────────────────────────────────────────────┤
│  📇 Cartão de Visita                                │
│     ┌──────────────────────────────────────────┐   │
│     │  [imagem do cartão — clique para ampliar]│   │
│     └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  📝 Notas                                           │
│     Conhecemos na Cúpula de Investimentos SP 2026.  │
│     Interesse em co-investir em fintechs B2B.       │
│     Próximo passo: enviar deck até 15/ago.          │
├─────────────────────────────────────────────────────┤
│  Adicionado em 01/ago/2026 · Atualizado há 2 dias   │
└─────────────────────────────────────────────────────┘
```

---

## 4. Especificações de API (REST/tRPC)

O módulo é implementado via **tRPC** (padrão do projeto MMM), mas a especificação abaixo usa notação REST/OpenAPI para documentação e futura exposição pública.

### 4.1 `POST /api/v1/private-network/contacts` — Criar Contato

**Autenticação:** Bearer JWT (obrigatório) · **Autorização:** qualquer usuária autenticada

**Request Body:**
```json
{
  "fullName":    "Ana Souza",               // string, obrigatório, max 200
  "photoUrl":    "/manus-storage/...",      // string, opcional
  "jobTitle":    "CEO",                     // string, opcional, max 200
  "company":     "Fundo XYZ",              // string, opcional, max 200
  "country":     "Brasil",                  // string, opcional
  "state":       "SP",                      // string, opcional
  "city":        "São Paulo",               // string, opcional
  "phone":       "+5511999999999",          // string, opcional, E.164
  "whatsapp":    "+5511999999999",          // string, opcional, E.164
  "email":       "ana@fundoxyz.com",        // string, opcional, RFC 5321
  "linkedinUrl": "https://linkedin.com/in/anasouza",
  "instagram":   "anasouza",               // sem @
  "profileTags": ["Investidora","Executiva"],
  "notes":       "Conhecemos na Cúpula..."
}
```

**Response 201:**
```json
{ "id": 42, "createdAt": 1754000000000 }
```

**Erros:** `400 Bad Request` (validação), `401 Unauthorized`.

---

### 4.2 `GET /api/v1/private-network/contacts` — Listar Contatos

**Query Parameters:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `q` | string | Busca full-text em nome, empresa e cargo |
| `tag` | string | Filtro por tag (ex: `Investidora`) |
| `country` | string | Filtro por país |
| `page` | int | Página (padrão: 1) |
| `limit` | int | Itens por página (padrão: 20, máx: 100) |
| `sort` | string | `updated_desc` (padrão) · `name_asc` · `created_desc` |

**Response 200:**
```json
{
  "data": [
    {
      "id": 42,
      "fullName": "Ana Souza",
      "photoUrl": "/manus-storage/...",
      "jobTitle": "CEO",
      "company": "Fundo XYZ",
      "country": "Brasil",
      "city": "São Paulo",
      "profileTags": ["Investidora","Executiva"],
      "updatedAt": 1754000000000
    }
  ],
  "total": 87,
  "page": 1,
  "limit": 20
}
```

> O endpoint **nunca** retorna contatos de outras usuárias. O filtro `WHERE owner_id = :currentUser` é aplicado na camada de banco antes de qualquer outra condição.

---

### 4.3 `GET /api/v1/private-network/contacts/{id}` — Detalhar Contato

**Response 200:** objeto completo com todos os campos, incluindo `cardImageUrl`, `cardOcrText` e `notes`.

**Erros:** `404 Not Found` se o contato não existir **ou** não pertencer à usuária autenticada (resposta idêntica para evitar enumeração).

---

### 4.4 `PUT /api/v1/private-network/contacts/{id}` — Atualizar Contato

**Request Body:** mesmos campos do POST, todos opcionais (PATCH semântico).

**Validação de propriedade:** `WHERE id = :id AND owner_id = :currentUser` — retorna `404` se não encontrado ou não pertencer à usuária.

**Response 200:** objeto atualizado completo.

---

### 4.5 `POST /api/v1/private-network/contacts/{id}/card-image` — Upload do Cartão de Visita

**Content-Type:** `multipart/form-data`

**Campo:** `file` — imagem JPG, PNG ou PDF · máximo 5 MB

**Fluxo:**
1. Servidor valida propriedade do contato (`owner_id = currentUser`).
2. Arquivo é enviado ao S3 interno com chave `private-contacts/{ownerId}/{contactId}/card.{ext}`.
3. `card_image_url` é atualizado na tabela.
4. Campo `card_ocr_text` é reservado para pipeline de OCR assíncrono futuro.

**Response 200:**
```json
{ "cardImageUrl": "/manus-storage/private-contacts/..." }
```

**Erros:** `400` (tipo/tamanho inválido), `404` (contato não encontrado ou não pertence à usuária).

---

### 4.6 `DELETE /api/v1/private-network/contacts/{id}` — Excluir Contato

Exclui o registro e os arquivos S3 associados (foto e cartão de visita). Retorna `204 No Content`.

---

## 5. Arquitetura de Segurança e Privacidade

### 5.1 Princípios Fundamentais

O módulo adota **Privacy by Design** (ISO 31700) como princípio não-negociável. Os dados da rede de contatos de uma usuária são tratados como dados de nível de sigilo equivalente a agenda pessoal criptografada — nenhum acesso administrativo é permitido sem ordem judicial documentada.

### 5.2 Row-Level Security (RLS)

Toda query ao banco de dados que acessa `private_contacts` **obrigatoriamente** inclui a cláusula `WHERE owner_id = :currentUserId` na camada de aplicação (tRPC procedures). Não existe endpoint que liste contatos sem esse filtro.

```ts
// Exemplo de helper RLS — server/db.ts
export async function getContactById(db: DB, ownerId: string, contactId: number) {
  const [row] = await db
    .select()
    .from(privateContacts)
    .where(
      and(
        eq(privateContacts.id, contactId),
        eq(privateContacts.ownerId, ownerId)   // ← RLS obrigatório
      )
    )
    .limit(1);
  return row ?? null;
}
```

Se o contato não existir **ou** não pertencer à usuária, a função retorna `null` e o endpoint responde `404` — **nunca** `403`, para evitar enumeração de IDs.

### 5.3 Isolamento de Armazenamento (S3)

Os arquivos de foto e cartão de visita são armazenados com chaves prefixadas por `private-contacts/{ownerId}/`, garantindo que:

- URLs não são adivinháveis (chave inclui UUID gerado no servidor).
- Acesso às URLs requer autenticação via presigned URL com TTL de 1 hora.
- Nenhuma URL pública permanente é gerada para arquivos deste módulo.

### 5.4 Criptografia

| Camada | Mecanismo |
|---|---|
| Transporte | TLS 1.3 obrigatório em todos os endpoints |
| Banco de dados em repouso | Criptografia AES-256 gerenciada pelo provedor (TiDB/MySQL) |
| Campos sensíveis (telefone, e-mail) | Candidatos a criptografia em nível de coluna (AES-256-GCM) em versão futura |
| Arquivos S3 | SSE-S3 (Server-Side Encryption) com chave gerenciada pelo provedor |
| Sessão/JWT | `jose` com algoritmo ES256, TTL de 24h, rotação automática |

### 5.5 Auditoria e Logs

- Toda operação de criação, atualização e exclusão registra `updatedAt` (timestamp UTC).
- Logs de acesso ao módulo são retidos por 90 dias no servidor de aplicação.
- **Nenhum log de conteúdo** (valores dos campos) é armazenado — apenas metadados de operação (tipo de ação, timestamp, IP anonimizado).

### 5.6 Política de Acesso Administrativo

```
┌─────────────────────────────────────────────────────────┐
│  Nível de Acesso          │  Pode ver contatos?         │
├───────────────────────────┼─────────────────────────────┤
│  Própria usuária          │  ✅ Sim — acesso total      │
│  Outras usuárias          │  ❌ Não — isolamento total  │
│  Administradora MMM       │  ❌ Não — sem acesso        │
│  Suporte técnico          │  ❌ Não — sem acesso        │
│  Ordem judicial           │  ⚠️  Processo documentado   │
└───────────────────────────┴─────────────────────────────┘
```

A `adminProcedure` do sistema **não** inclui acesso a `private_contacts`. Qualquer tentativa de acesso por role `admin` retorna `403 Forbidden` com log de auditoria.

### 5.7 Validação de Entrada

Todos os campos são validados com **Zod** antes de chegar ao banco:

- `fullName`: string, 1–200 chars, sanitização XSS.
- `email`: validação RFC 5321 via `z.string().email()`.
- `phone` / `whatsapp`: regex E.164 `^\+[1-9]\d{1,14}$`.
- `linkedinUrl`: `z.string().url()` com allowlist de domínio `linkedin.com`.
- `instagram`: regex `^[a-zA-Z0-9._]{1,30}$` (sem @).
- `profileTags`: array de strings com allowlist de valores predefinidos.
- `notes`: string, máx. 5.000 chars, sanitização XSS.

---

## 6. Tags de Perfil Predefinidas

| Tag | Descrição |
|---|---|
| Empresário/a | Fundadores e proprietários de empresas |
| Investidor/a | Angels, VCs, family offices, fundos |
| Diplomata | Embaixadores, cônsules, adidos |
| Autoridade Pública | Governantes, parlamentares, secretários |
| Advogado/a | Jurídico, compliance, M&A |
| Pesquisador/a | Academia, think tanks, institutos |
| Fornecedor/a | Prestadores de serviço, parceiros operacionais |
| Comprador/a | Clientes estratégicos, distribuidores |
| Executivo/a | C-level, diretores, gerentes sênior |
| Outro | Perfil não categorizado |

---

## 7. Roadmap de Evolução

| Fase | Funcionalidade | Prioridade |
|---|---|---|
| v1.0 | CRUD completo + upload de cartão de visita | **Atual** |
| v1.1 | OCR automático do cartão de visita (extração de dados) | Alta |
| v1.2 | Exportação da rede em CSV/vCard | Média |
| v1.3 | Compartilhamento seletivo de contato com outra usuária MMM | Média |
| v2.0 | Enriquecimento automático via LinkedIn API | Baixa |
| v2.1 | Lembretes de follow-up com IA | Baixa |

---

*Documento gerado por Manus AI · Projeto MMM — Mulheres que Movem o Mundo*
