# Sistema de Recuperação de Senha por E-mail — MMM OS

**Stack:** Node.js · tRPC 11 · Drizzle ORM · MySQL (TiDB) · Resend API · bcrypt

---

## Visão Geral

O fluxo de recuperação de senha é dividido em duas etapas sequenciais e seguras. A primeira etapa gera um token criptograficamente seguro e envia o link por e-mail. A segunda etapa valida o token e aplica a nova senha. O token é de **uso único** e expira em **1 hora**.

---

## Etapa 1 — Solicitação de Reset (`/forgot-password`)

### Responsabilidades

Receber o e-mail do usuário, verificar se está cadastrado, gerar um token seguro, persistir no banco e enviar o e-mail com o link de reset via Resend.

### Código Backend (tRPC Procedure)

```typescript
// server/routers.ts
import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { users, passwordResetTokens } from "../drizzle/schema";
import { sendEmail, buildPasswordResetEmail } from "./_core/email";

forgotPassword: publicProcedure
  .input(z.object({
    email: z.string().email(),
    origin: z.string().url().optional(), // origem do frontend para construir a URL
  }))
  .mutation(async ({ input }) => {
    const db = await getDb();

    // 1. Buscar usuário pelo e-mail
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    // 2. Retornar sucesso mesmo se o e-mail não existir
    //    (evita enumeration attack — não revela se o e-mail está cadastrado)
    if (!user) return { success: true };

    // 3. Invalidar tokens anteriores não utilizados do mesmo usuário
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          sql`${passwordResetTokens.usedAt} IS NULL`
        )
      );

    // 4. Gerar token seguro: 48 bytes aleatórios = 96 caracteres hex
    const token = crypto.randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // 5. Persistir o token no banco
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token,
      expiresAt,
    });

    // 6. Construir a URL de reset
    const siteOrigin = input.origin || "https://mmmos-m2agtkvd.manus.space";
    const resetUrl = `${siteOrigin}/reset-password?token=${token}`;

    // 7. Enviar e-mail via Resend
    const { html, text } = buildPasswordResetEmail(user.name || "Membra", resetUrl);
    await sendEmail({
      to: user.email!,
      subject: "Redefina sua senha — MMM OS",
      html,
      text,
    });

    // Nunca retornar o token ou a URL na resposta (segurança)
    return { success: true };
  }),
```

### Schema da Tabela `password_reset_tokens`

```typescript
// drizzle/schema.ts
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id:        int("id").primaryKey().autoincrement(),
  userId:    int("user_id").notNull().references(() => users.id),
  token:     varchar("token", { length: 200 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),          // NULL = ainda válido
  createdAt: timestamp("created_at").defaultNow(),
});
```

### Helper de E-mail (`server/_core/email.ts`)

```typescript
import { Resend } from "resend";

const FROM_EMAIL = process.env.EMAIL_FROM || "MMM OS <noreply@mmmos-m2agtkvd.manus.space>";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Email] RESEND_API_KEY não configurada");
    return false;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      console.error("[Email] Erro ao enviar:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Email] Exceção:", err);
    return false;
  }
}

export function buildPasswordResetEmail(name: string, resetUrl: string) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8" /></head>
    <body style="background:#0a0f1a;color:#e5e5e5;font-family:sans-serif;padding:40px 20px;">
      <div style="max-width:520px;margin:0 auto;">
        <h1 style="color:#f59e0b;">MMM OS</h1>
        <h2>Redefinição de senha</h2>
        <p>Olá, <strong>${name}</strong>.</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
        <p>Este link é <strong>válido por 1 hora</strong> e pode ser usado apenas uma vez.</p>
        <a href="${resetUrl}"
           style="display:inline-block;padding:14px 32px;background:#f59e0b;
                  color:#000;font-weight:700;border-radius:8px;text-decoration:none;margin:20px 0;">
          Redefinir minha senha →
        </a>
        <p style="color:#6b7280;font-size:12px;">
          Se não solicitou esta redefinição, ignore este e-mail.
          Sua senha permanece a mesma.
        </p>
      </div>
    </body>
    </html>
  `;

  const text = `
Olá, ${name}.

Recebemos uma solicitação para redefinir a senha da sua conta no MMM OS.

Acesse o link abaixo para criar uma nova senha (válido por 1 hora):
${resetUrl}

Se não solicitou esta redefinição, ignore este e-mail.
  `.trim();

  return { html, text };
}
```

---

## Etapa 2 — Redefinição de Senha (`/reset-password`)

### Responsabilidades

Receber o token via query param e a nova senha, validar se o token é válido e não expirou, criptografar a nova senha com bcrypt e atualizar o banco, invalidar o token após o uso.

### Código Backend (tRPC Procedure)

```typescript
// server/routers.ts
import bcrypt from "bcryptjs";

resetPassword: publicProcedure
  .input(z.object({
    token: z.string().min(10),
    newPassword: z.string().min(8).max(128),
  }))
  .mutation(async ({ input }) => {
    const db = await getDb();

    // 1. Buscar o token no banco
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, input.token))
      .limit(1);

    // 2. Validar existência
    if (!record) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Token inválido ou já utilizado.",
      });
    }

    // 3. Validar expiração
    if (record.expiresAt < new Date()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Este link expirou. Solicite um novo.",
      });
    }

    // 4. Validar se já foi usado
    if (record.usedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Este link já foi utilizado. Solicite um novo.",
      });
    }

    // 5. Criptografar a nova senha com bcrypt (custo 12)
    const hashedPassword = await bcrypt.hash(input.newPassword, 12);

    // 6. Atualizar a senha do usuário
    await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, record.userId));

    // 7. Invalidar o token (marcar como usado)
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, record.id));

    return { success: true };
  }),
```

---

## Frontend — Página de Solicitação (`/forgot-password`)

```tsx
// client/src/pages/ForgotPassword.tsx (fluxo simplificado)
const forgotMutation = trpc.auth.forgotPassword.useMutation({
  onSuccess: () => setSent(true),
});

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  forgotMutation.mutate({ email, origin: window.location.origin });
  // ⚠️ Sempre passar window.location.origin para que o link de reset
  //    aponte para o domínio correto (dev vs. produção)
};
```

Após o envio, exibir apenas a mensagem **"Verifique seu e-mail"** — nunca mostrar o link na tela.

## Frontend — Página de Redefinição (`/reset-password?token=xxx`)

```tsx
// client/src/pages/ResetPassword.tsx (fluxo simplificado)
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) setToken(t);
}, []);

const resetMutation = trpc.auth.resetPassword.useMutation({
  onSuccess: () => {
    setSuccess(true);
    setTimeout(() => setLocation("/login"), 3000);
  },
});
```

---

## Boas Práticas de Segurança Implementadas

| Prática | Implementação |
|---|---|
| **Enumeration Attack** | Retorna `{ success: true }` mesmo quando o e-mail não existe |
| **Token seguro** | `crypto.randomBytes(48)` = 96 chars hex, impossível de adivinhar |
| **Expiração** | Token válido por apenas 1 hora |
| **Uso único** | `usedAt` é preenchido após o uso; verificado antes de aceitar |
| **Invalidação de tokens anteriores** | Ao solicitar novo reset, tokens anteriores são invalidados |
| **Hash bcrypt** | Custo 12 — resistente a ataques de força bruta |
| **Token nunca exposto** | Nunca retornado na resposta da API nem exibido na tela |
| **Origin dinâmica** | URL de reset usa `window.location.origin` (nunca hardcoded) |

---

## Variáveis de Ambiente Necessárias

| Variável | Descrição | Exemplo |
|---|---|---|
| `RESEND_API_KEY` | Chave de API do Resend | `re_xxxxxxxxxxxx` |
| `EMAIL_FROM` | Remetente do e-mail | `MMM OS <noreply@seudominio.com>` |

Obtenha a chave em [resend.com/api-keys](https://resend.com/api-keys). Para usar um domínio personalizado, verifique-o em **Resend → Domains** antes de configurar `EMAIL_FROM`.
