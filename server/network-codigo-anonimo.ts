import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { privateContacts } from "../drizzle/schema";
import { exigirDb } from "./db";

/**
 * O ID ANÔNIMO de cada contato da rede particular — Meu Network Inteligente,
 * spec da Glenda de 14/09, item 13: "Cada contato do network particular deve
 * receber automaticamente um ID ÚNICO. Exemplo: NW-7F29A4".
 *
 * Aleatório e GUARDADO na linha (private_contacts.codigo_anonimo, índice
 * único), nunca calculado:
 * - derivar do id sequencial deixaria o ID reversível (os ids são poucos e
 *   contíguos: bastaria testar 1, 2, 3...), e o ID existe justamente para o
 *   cruzamento global não revelar quem é a pessoa;
 * - derivar do segredo do servidor (como a referência da vitrine) trocaria
 *   todos os IDs no dia em que o segredo girar, e o registro de conexões
 *   (item 16) guarda esses IDs como prova de que a conexão existiu.
 *
 * Seis dígitos hexadecimais, como no exemplo: 16,7 milhões de combinações. A
 * colisão é rara mas possível, e quem grava tenta de novo com outro código
 * (o índice único é quem arbitra, não uma leitura prévia).
 */

export const PREFIXO_DO_CODIGO = "NW-";
export const FORMATO_DO_CODIGO = /^NW-[0-9A-F]{6}$/;
const TENTATIVAS = 6;

export function gerarCodigoAnonimo(): string {
  return `${PREFIXO_DO_CODIGO}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/** ER_DUP_ENTRY (errno 1062) em qualquer ponto da cadeia de `cause` do drizzle. */
export function ehColisaoDeChave(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let salto = 0; atual && salto < 10; salto += 1) {
    const { code, errno } = atual as { code?: unknown; errno?: unknown };
    if (code === "ER_DUP_ENTRY" || errno === 1062) return true;
    atual = (atual as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Executa `gravar` com um código novo a cada colisão do índice único. Outro
 * erro (banco fora, coluna ausente) sobe na hora: não é caso de tentar de novo.
 */
export async function comCodigoAnonimo<T>(gravar: (codigo: string) => Promise<T>): Promise<T> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
    try {
      return await gravar(gerarCodigoAnonimo());
    } catch (erro) {
      if (!ehColisaoDeChave(erro)) throw erro;
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

/**
 * Preenche o ID anônimo dos contatos DESTA dona que ainda não têm (contatos
 * criados antes da coluna existir). Cada UPDATE leva `codigo_anonimo IS NULL`
 * no WHERE: duas leituras simultâneas do painel não trocam o código que a
 * outra acabou de gravar — o código de um contato, uma vez dado, não muda.
 * Devolve quantos contatos ganharam código nesta chamada.
 */
export async function garantirCodigosAnonimos(ownerId: string): Promise<number> {
  const db = await exigirDb();
  const semCodigo = await db
    .select({ id: privateContacts.id })
    .from(privateContacts)
    .where(and(eq(privateContacts.ownerId, ownerId), isNull(privateContacts.codigoAnonimo)))
    .limit(500);
  let preenchidos = 0;
  for (const contato of semCodigo) {
    await comCodigoAnonimo(async codigo => {
      const [resultado] = await db
        .update(privateContacts)
        .set({ codigoAnonimo: codigo })
        .where(and(
          eq(privateContacts.id, contato.id),
          eq(privateContacts.ownerId, ownerId),
          isNull(privateContacts.codigoAnonimo),
        ));
      if ((resultado as { affectedRows?: number } | undefined)?.affectedRows) preenchidos += 1;
    });
  }
  return preenchidos;
}
