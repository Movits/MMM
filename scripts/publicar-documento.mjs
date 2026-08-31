// Publica uma versão de documento e a torna vigente.
//
// O texto do termo vive no banco, não no código: quando o jurídico entregar a
// redação final, ela entra como uma versão nova por aqui, sem deploy. A versão
// anterior continua no banco, porque é ela que dá sentido aos consentimentos
// já registrados — "fulana aceitou" sem versão não diz o que ela aceitou.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/publicar-documento.mjs termo_smart_match caminho/do/texto.md
//
// Sem o caminho do arquivo, publica o texto provisório embutido abaixo.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const TIPOS = ["termo_smart_match", "acordo_intermediacao", "contrato_comissao", "termo_gravacao"];

// Provisório, para a mecânica poder ser construída e testada antes do texto
// jurídico existir. Descreve o que o sistema realmente faz hoje.
const TEXTO_PROVISORIO = `# Autorização para Cruzamento Inteligente (Smart Match)

**Versão provisória.** Este texto descreve o funcionamento do recurso e será
substituído pela redação jurídica final.

## O que você está autorizando

O Cruzamento Inteligente compara o que cada contato da **sua** base particular
tem a oferecer com o que os outros contatos dessa mesma base procuram, e sugere
a você as conexões que fazem sentido.

## O que não acontece

- Sua base de contatos não é compartilhada com outras usuárias.
- Nenhum contato seu é apresentado a ninguém sem que você decida apresentar.
- O cruzamento não envia mensagem a ninguém: ele mostra a sugestão a você.

## Enquanto a autorização estiver ativa

O sistema guarda, para cada sugestão, quais informações levaram àquele
resultado, para que você possa entender o motivo da indicação.

## Se você recusar ou revogar

O Cruzamento Inteligente é desligado e nenhuma sugestão nova é gerada. **Todo o
restante da plataforma continua funcionando normalmente** — cadastro, rede de
contatos, oportunidades, reuniões e mensagens não dependem desta autorização.

A revogação vale a partir do momento em que é feita.

## Registro

Ficam registrados a data da autorização, a versão deste documento e o endereço
de origem do acesso, como prova de que a autorização foi concedida por você.
`;

const tipo = process.argv[2];
const caminho = process.argv[3];

if (!TIPOS.includes(tipo)) {
  console.error(`Tipo inválido. Use um destes: ${TIPOS.join(", ")}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

const texto = caminho ? await readFile(caminho, "utf8") : TEXTO_PROVISORIO;
const conexao = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [[maior]] = await conexao.query(
    "SELECT COALESCE(MAX(version), 0) AS maior FROM document_versions WHERE type = ?",
    [tipo],
  );
  const versao = Number(maior.maior) + 1;

  // Tirar a anterior de vigência antes de inserir a nova: o índice único sobre
  // a coluna gerada recusaria duas vigentes do mesmo tipo.
  await conexao.beginTransaction();
  await conexao.query("UPDATE document_versions SET isCurrent = FALSE WHERE type = ? AND isCurrent = TRUE", [tipo]);
  await conexao.query(
    "INSERT INTO document_versions (id, type, version, text, isCurrent) VALUES (?, ?, ?, ?, TRUE)",
    [randomUUID(), tipo, versao, texto],
  );
  await conexao.commit();

  console.log(`Publicada a versão ${versao} de ${tipo}, agora vigente.`);
  if (!caminho) {
    console.log("Texto provisório — substituir pela redação jurídica quando estiver pronta.");
  }
} catch (erro) {
  await conexao.rollback().catch(() => {});
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
