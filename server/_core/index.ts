import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { spawnSync } from "child_process";
import { createServer } from "http";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { cleanupExpiredSessions, createAuditLog } from "../security";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ============================================================
// RATE LIMITERS
// ============================================================

// Rate limiter global: 200 req/min por IP (proteção geral)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em breve." },
  skip: (req) => {
    // Não limitar assets estáticos e HMR do Vite em dev
    const url = req.url || "";
    return url.startsWith("/@") || url.startsWith("/node_modules") || url.endsWith(".hot-update.js");
  },
});

// Rate limiter para API tRPC: 100 req/min por IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Limite de API excedido. Tente novamente em breve." },
});

// ============================================================
// MIDDLEWARE DE SEGURANÇA ADICIONAL
// ============================================================

// Remove headers que revelam tecnologia usada
function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Powered-By");
  // Impede que a página seja carregada em iframes (proteção adicional ao helmet)
  res.setHeader("X-Frame-Options", "DENY");
  // Força HTTPS por 1 ano (HSTS)
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  // Impede MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Controla informações de referrer
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // O microfone é necessário exclusivamente para a gravação privada de reuniões.
  // "self" impede concessão a iframes ou a origens externas; câmera e demais APIs seguem bloqueadas.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  next();
}

// Middleware anti-scan: bloqueia user-agents de scanners conhecidos
function antiScanMiddleware(req: Request, res: Response, next: NextFunction) {
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const blockedAgents = [
    "sqlmap", "nikto", "nessus", "openvas", "masscan", "zgrab",
    "nmap", "metasploit", "burpsuite", "dirbuster", "gobuster",
    "wfuzz", "hydra", "medusa", "acunetix", "appscan", "w3af",
  ];
  if (blockedAgents.some(agent => ua.includes(agent))) {
    res.status(403).json({ error: "Acesso negado." });
    return;
  }
  next();
}

async function startServer() {
  // Migrações no boot, ANTES de aceitar tráfego — só em produção. O deploy do
  // Render publica o código na hora, mas ninguém no time roda migração na mão:
  // a 0003 ficou dias pendente na produção, e a 0004 sem este passo derrubaria
  // toda a leitura de contatos (o drizzle nomeia as colunas nos selects).
  // Processo filho de propósito: migrar.mjs tem modo CLI idempotente com
  // código de saída honesto, e bundlá-lo no dist dispararia o guard de
  // "rodado direto" dele. Falhar aqui mata a subida: o Render mantém a versão
  // antiga no ar e o erro fica no log do deploy — servidor de pé com schema
  // errado é pior do que não subir. A instância é única; se duas correrem, o
  // PK de _migracoes faz a segunda falhar em vez de aplicar duas vezes. O
  // fluxo local de desenvolvimento não muda: pnpm db:migrate continua manual.
  if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) {
    const migracao = spawnSync(process.execPath, ["scripts/migrar.mjs"], {
      stdio: "inherit",
      env: process.env,
    });
    if (migracao.status !== 0) {
      console.error("[Boot] Migrações pendentes não aplicadas; abortando a subida.");
      process.exit(1);
    }
  }

  const app = express();
  const server = createServer(app);

  // Confiar no proxy reverso (necessário para rate limiting por IP real)
  app.set("trust proxy", 1);

  // V-05: Headers de segurança HTTP via Helmet (CSP rigoroso)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Em produção, remover 'unsafe-inline' e 'unsafe-eval' e usar nonces
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "wss:", "https:"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"], // Proteção adicional contra clickjacking
          objectSrc: ["'none'"],
          baseUri: ["'self'"], // Proteção contra base tag injection
          formAction: ["'self'"], // Formulários só podem enviar para o próprio domínio
          upgradeInsecureRequests: [],
        },
        useDefaults: false,
      },
      crossOriginEmbedderPolicy: false, // Necessário para Vite HMR
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      xssFilter: true,
      hidePoweredBy: true,
    })
  );

  // Gzip nas respostas. O Render não comprime no proxy: sem isto, os ~900 KB
  // de JS+CSS viajavam crus para cada visitante.
  app.use(compression());

  // Headers de segurança adicionais
  app.use(securityHeadersMiddleware);

  // Anti-scan middleware
  app.use(antiScanMiddleware);

  // Rate limiting global
  app.use(globalLimiter);

  // A gravação de reunião usa Base64 (até 10 MB de áudio, ~14 MB no JSON).
  // O limite ampliado é aplicado somente ao procedimento privado de reunião.
  app.use("/api/trpc/meetings.submitRecording", express.json({ limit: "15mb" }));

  // Mesmo caso para os anexos de contexto (fotos/PDF de até 10 MB em Base64):
  // sem este recorte, o limite global de 5 MB devolveria 413 para qualquer
  // arquivo acima de ~3,7 MB — antes de o tRPC sequer validar.
  app.use("/api/trpc/contexts.uploadMedia", express.json({ limit: "15mb" }));

  // V-09: Limite reduzido para 5MB no restante da aplicação.
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));

  registerStorageProxy(app);

  // ============================================================
  // JOB PERIÓDICO: Limpeza de sessões expiradas
  // Endpoint: POST /api/scheduled/cleanup-sessions
  // Exige sessão de cron: JWT assinado com o JWT_SECRET, openId "cron_..."
  // e claim taskUid (ver sdk.authenticateRequest). Nenhum agendador externo
  // está configurado hoje; o endpoint fica pronto para quando houver.
  // ============================================================
  app.post("/api/scheduled/cleanup-sessions", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        return res.status(403).json({ error: "cron-only endpoint" });
      }

      const cleaned = await cleanupExpiredSessions();

      await createAuditLog({
        userId: null,
        action: "CRON_CLEANUP_SESSIONS",
        resource: "sessions",
        status: "success",
        riskLevel: "low",
        details: {
          cleanedCount: cleaned,
          taskUid: user.taskUid,
          triggeredAt: new Date().toISOString(),
        },
      }).catch(() => {});

      return res.json({ ok: true, cleaned, timestamp: new Date().toISOString() });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        error,
        context: { url: req.url },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Rate limiting específico para API tRPC
  app.use("/api/trpc", apiLimiter);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");

  // Em produção a porta é imposta pela plataforma (Railway, Render, Fly) e o
  // roteador só entrega tráfego nela. Cair para outra porta faria o container
  // subir "com sucesso" e não responder nada, então aqui falhar é melhor.
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
