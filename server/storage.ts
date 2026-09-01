// Storage de arquivos sobre a API do S3 — que é um padrão de fato: AWS S3,
// Cloudflare R2, Backblaze B2 e MinIO falam todos o mesmo protocolo. A decisão
// de provedor (aberta na D6) não bloqueia este código: é só preencher as
// variáveis de ambiente.
//
//   STORAGE_BUCKET             nome do bucket (obrigatória)
//   STORAGE_ACCESS_KEY_ID      credencial (obrigatória)
//   STORAGE_SECRET_ACCESS_KEY  credencial (obrigatória)
//   STORAGE_ENDPOINT           só para R2/B2/MinIO (ex.: https://<conta>.r2.cloudflarestorage.com);
//                              vazia para a AWS
//   STORAGE_REGION             padrão: "auto" com endpoint próprio, "us-east-1" na AWS
//
// A versão anterior falava o protocolo do Forge/Manus, que saiu do ar — e a
// mensagem de erro dela mandava configurar BUILT_IN_FORGE_API_URL, a variável
// ERRADA, que ainda por cima é fallback do endpoint de LLM: seguir a mensagem
// não consertava o upload e apontava a IA para o host errado.
//
// As URLs devolvidas continuam no formato /manus-storage/{key}: é o caminho que
// está gravado no banco em todo documento existente, e a rota (storageProxy)
// agora exige sessão e posse antes de assinar o download.

import crypto from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageConfig = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
};

function getStorageConfig(): StorageConfig {
  const bucket = process.env.STORAGE_BUCKET ?? "";
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY ?? "";
  const endpoint = process.env.STORAGE_ENDPOINT ?? "";
  const region = process.env.STORAGE_REGION || (endpoint ? "auto" : "us-east-1");

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Storage não configurado: defina STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID e " +
        "STORAGE_SECRET_ACCESS_KEY (e STORAGE_ENDPOINT se não for AWS S3).",
    );
  }

  return { bucket, accessKeyId, secretAccessKey, endpoint, region };
}

let clientePorConfig: { chave: string; cliente: S3Client } | null = null;

function getClient(config: StorageConfig): S3Client {
  const chave = `${config.endpoint}|${config.region}|${config.bucket}|${config.accessKeyId}`;
  if (clientePorConfig?.chave === chave) return clientePorConfig.cliente;
  const cliente = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(config.endpoint
      ? {
          endpoint: config.endpoint,
          // Endpoints próprios (R2/B2/MinIO) esperam o bucket no caminho, não
          // no subdomínio.
          forcePathStyle: true,
        }
      : {}),
  });
  clientePorConfig = { chave, cliente };
  return cliente;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

// Sufixo aleatório para a chave nunca colidir com um upload anterior do mesmo
// nome — comportamento herdado da versão anterior, que os chamadores esperam.
function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const config = getStorageConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: typeof data === "string" ? Buffer.from(data) : data,
      ContentType: contentType,
    }),
  );

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

/**
 * URL assinada de leitura, válida por 5 minutos. Curta de propósito: a URL em
 * si dispensa autenticação, então quanto menos tempo viver, menor a janela para
 * um link colado num chat continuar funcionando.
 */
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const config = getStorageConfig();
  const key = normalizeKey(relKey);
  return getSignedUrl(
    getClient(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: 300 },
  );
}
