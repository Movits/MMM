// Publica uma versão de documento e a torna vigente.
//
// O texto do termo vive no banco, não no código: quando o jurídico entregar a
// redação final, ela entra como uma versão nova por aqui, sem deploy. A versão
// anterior continua no banco, porque é ela que dá sentido aos consentimentos
// já registrados — "fulana aceitou" sem versão não diz o que ela aceitou.
//
// PUBLICAR UMA VERSÃO NOVA DESLIGA O RECURSO PARA QUEM JÁ TINHA AUTORIZADO.
// O consentimento vale para a versão que foi aceita, e só para ela; a versão
// nova ninguém aceitou ainda. Isso é correto — o texto mudou, o aceite anterior
// não cobre o texto novo — mas não pode ser surpresa. Por isso o script conta
// quantas pessoas serão afetadas e exige confirmação antes de mexer.
//
// Uso:
//   node scripts/publicar-documento.mjs <tipo> <arquivo.md>              publica o arquivo
//   node scripts/publicar-documento.mjs <tipo> <arquivo.md> --simular    só mostra o que faria
//   node scripts/publicar-documento.mjs <tipo> --texto-provisorio        publica o rascunho embutido
//   ... --sem-aviso                                                      não notifica as membras
//
// Contra banco que não seja local, exige também --confirmo-producao.
//
// Ao publicar, cada membra recebe uma notificação no sino avisando que há um
// texto para autorizar — sem isso, ninguém ficava sabendo e cada uma descobria
// só ao abrir a aba de matches. --sem-aviso desliga (ex.: ensaio em base local).

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

// Espelha o DOCUMENT_TYPES de server/routers/consent.ts (e o enum do banco).
const TIPOS = ["termo_smart_match", "acordo_intermediacao", "contrato_comissao", "termo_gravacao", "termo_acesso_ouro"];

// Provisório, para a mecânica poder ser construída e testada antes do texto
// jurídico existir. Descreve o que o sistema realmente faz hoje.
const TEXTO_PROVISORIO = `# Autorização para Cruzamento Inteligente (Smart Match)

**Versão provisória.** Este texto descreve o funcionamento do recurso e será
substituído pela redação jurídica final.

## O que você está autorizando

Esta autorização liga os dois cruzamentos do MMM:

1. **Na sua base particular:** o sistema compara o que cada contato da **sua**
   base tem a oferecer com o que os outros contatos dessa mesma base procuram,
   e sugere a você as conexões que fazem sentido.
2. **Entre os perfis das membras:** o **seu perfil** (setores, o que você
   oferece e procura, cidade e país) é comparado com os perfis de outras
   membras que também autorizaram, e as afinidades aparecem no painel — para
   você e para elas. Só participam do cruzamento membras com esta autorização
   ativa, dos dois lados.

## O que não acontece

- Sua base de contatos não é compartilhada com outras usuárias.
- Nenhum contato seu é apresentado a ninguém sem que você decida apresentar.
- No cruzamento de perfis, o que as outras membras veem são os campos do seu
  perfil — nunca seu e-mail, telefone ou os contatos da sua base.
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

const argumentos = process.argv.slice(2);
const opcoes = argumentos.filter(a => a.startsWith("--"));
const [tipo, caminho] = argumentos.filter(a => !a.startsWith("--"));

const simular = opcoes.includes("--simular");
const usarProvisorio = opcoes.includes("--texto-provisorio");
const confirmouProducao = opcoes.includes("--confirmo-producao");
const semAviso = opcoes.includes("--sem-aviso");

const morrer = mensagem => { console.error(mensagem); process.exit(1); };

if (!TIPOS.includes(tipo)) morrer(`Tipo inválido. Use um destes: ${TIPOS.join(", ")}`);
if (!process.env.DATABASE_URL) morrer("Defina DATABASE_URL.");

// O rascunho embutido não pode sair por omissão. Antes, esquecer o caminho do
// arquivo publicava texto provisório como se fosse o termo definitivo — e o
// comando de esquecer é mais curto que o de acertar.
if (!caminho && !usarProvisorio) {
  morrer(
    "Falta o arquivo com o texto.\n" +
    "  Para publicar um arquivo:   node scripts/publicar-documento.mjs " + tipo + " caminho/do/texto.md\n" +
    "  Para publicar o rascunho:   node scripts/publicar-documento.mjs " + tipo + " --texto-provisorio",
  );
}
if (caminho && usarProvisorio) morrer("Escolha um: o arquivo ou --texto-provisorio, não os dois.");

const url = new URL(process.env.DATABASE_URL);
const ehLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (!ehLocal && !confirmouProducao && !simular) {
  morrer(
    `O banco é ${url.hostname}, que não é local.\n` +
    "Publicar aqui desliga o cruzamento de quem já autorizou até que cada uma aceite o texto novo.\n" +
    "Rode com --simular para ver o efeito, ou acrescente --confirmo-producao para seguir.",
  );
}
if (!ehLocal && usarProvisorio && !simular) {
  morrer(`Recusado: --texto-provisorio contra ${url.hostname}. Rascunho não vira termo em produção.`);
}

const texto = caminho ? await readFile(caminho, "utf8") : TEXTO_PROVISORIO;
const conexao = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [[maior]] = await conexao.query(
    "SELECT COALESCE(MAX(version), 0) AS maior FROM document_versions WHERE type = ?",
    [tipo],
  );
  const versao = Number(maior.maior) + 1;

  const [[vigente]] = await conexao.query(
    "SELECT id, version FROM document_versions WHERE type = ? AND isCurrent = TRUE",
    [tipo],
  );

  // Quantas pessoas perdem o acesso ao recurso no instante em que isto rodar.
  const [[afetadas]] = vigente
    ? await conexao.query(
        "SELECT COUNT(*) AS n FROM consents WHERE documentVersionId = ? AND revokedAt IS NULL",
        [vigente.id],
      )
    : [[{ n: 0 }]];

  // Na PRIMEIRA publicação o número acima é zero — não há versão anterior para
  // ter aceites — e "impacto: 0" lia-se como "sem efeito". O efeito real é o
  // oposto: a base INTEIRA passa a precisar aceitar antes de usar o recurso.
  const [[base]] = await conexao.query("SELECT COUNT(*) AS n FROM users");

  console.log(`banco:    ${url.hostname}${ehLocal ? " (local)" : "  <- NÃO É LOCAL"}`);
  console.log(`tipo:     ${tipo}`);
  console.log(`origem:   ${caminho ?? "texto provisório embutido"}`);
  console.log(`tamanho:  ${texto.length} caracteres`);
  console.log(`vigente:  ${vigente ? `versão ${vigente.version}` : "nenhuma"}`);
  console.log(`nova:     versão ${versao}`);
  if (vigente) {
    console.log(`impacto:  ${afetadas.n} pessoa(s) com autorização ativa vão precisar aceitar de novo`);
  } else {
    console.log(`impacto:  primeira publicação — a base inteira (${base.n} usuária(s)) passa a precisar aceitar antes de usar o recurso`);
  }
  console.log(`aviso:    ${semAviso ? "DESLIGADO (--sem-aviso)" : `notificação no sino para ${base.n} usuária(s)`}`);

  if (simular) {
    console.log("\n--simular: nada foi gravado.");
    process.exit(0);
  }

  // Tirar a anterior de vigência antes de inserir a nova: o índice único sobre
  // a coluna gerada recusaria duas vigentes do mesmo tipo.
  await conexao.beginTransaction();
  await conexao.query("UPDATE document_versions SET isCurrent = FALSE WHERE type = ? AND isCurrent = TRUE", [tipo]);
  await conexao.query(
    "INSERT INTO document_versions (id, type, version, text, isCurrent) VALUES (?, ?, ?, ?, TRUE)",
    [randomUUID(), tipo, versao, texto],
  );

  // Aviso no sino, na MESMA transação: ou a publicação sai com o aviso, ou não
  // sai. Texto pronto em português, como todas as notificações da plataforma.
  if (!semAviso) {
    const ROTULOS = {
      termo_smart_match: "A autorização do Cruzamento Inteligente (Smart Match)",
      acordo_intermediacao: "O Acordo de Intermediação",
      contrato_comissao: "O Contrato de Comissão",
      termo_gravacao: "O Termo de Gravação de Reuniões",
      termo_acesso_ouro: "O Termo de Acesso Ouro",
    };
    await conexao.query(
      "INSERT INTO platform_notifications (userId, type, title, body, actionUrl, isRead) " +
      "SELECT id, 'system', ?, ?, ?, FALSE FROM users",
      [
        "📄 Novo texto para autorizar",
        `${ROTULOS[tipo]} está na versão ${versao}. ` +
        (vigente
          ? "O texto mudou, então a autorização anterior deixou de valer — leia e autorize de novo para continuar usando o recurso."
          : "Leia e autorize na próxima visita para usar o recurso."),
        "/dashboard",
      ],
    );
  }

  await conexao.commit();

  console.log(`\nPublicada a versão ${versao} de ${tipo}, agora vigente.`);
  if (!semAviso) {
    console.log(`Notificação enviada ao sino de ${base.n} usuária(s).`);
  }
  if (Number(afetadas.n) > 0) {
    console.log(`${afetadas.n} pessoa(s) verão a tela de autorização na próxima visita, com aviso de que o texto mudou.`);
  }
  if (usarProvisorio) {
    console.log("Texto provisório — substituir pela redação jurídica quando estiver pronta.");
  }
} catch (erro) {
  await conexao.rollback().catch(() => {});
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
