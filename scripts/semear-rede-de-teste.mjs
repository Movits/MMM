// Popula a rede particular de UMA usuária com contatos fictícios, para dar o
// que cruzar ao Smart Match durante um teste.
//
// Isto NÃO é o seed de bots que foi removido do projeto. Aquele criava contas
// de usuária na plataforma, que apareciam nos números públicos e nas listas de
// todo mundo. Aqui nada disso acontece: os contatos entram na agenda privada de
// uma única pessoa, que é exatamente onde o Cruzamento Inteligente trabalha.
// Ninguém além da dona enxerga, e `--limpar` desfaz tudo.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/semear-rede-de-teste.mjs email@da.usuaria
//   DATABASE_URL='mysql://...' node scripts/semear-rede-de-teste.mjs email@da.usuaria --limpar
//
// Os dados são desenhados para exercitar os três tipos de cruzamento — tag exata
// (100), mesma categoria (60) e similaridade semântica (45) — e mais a regra da
// direção da etapa 11: duas pontas que querem exportar são concorrentes e nunca
// se encontram, enquanto "exportar" contra "importar" é o par de maior valor.

import mysql from "mysql2/promise";

const email = process.argv[2];
const limpar = process.argv.includes("--limpar");

if (!email || !process.env.DATABASE_URL) {
  console.error("Uso: DATABASE_URL='mysql://...' node scripts/semear-rede-de-teste.mjs email@da.usuaria [--limpar]");
  process.exit(1);
}

const slug = texto => texto.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Cada contato traz o que oferece e o que procura. Os pares foram montados de
// propósito: alguns casam pela mesma tag, outros só pela categoria, e outros
// só pelo sentido — para dar para ver os três tipos na tela.
const CONTATOS = [
  { nome: "Helena Vasconcelos", cargo: "Diretora de Expansão", empresa: "Cerrado Agro", cidade: "Goiânia",
    possui: [["Soja em grande volume", "Commodities"]],
    procura: [["Investimento em logística", "Investimento"]] },

  { nome: "Marina Tavares", cargo: "Sócia", empresa: "Tavares Participações", cidade: "São Paulo",
    possui: [["Investimento em logística", "Investimento"]],
    procura: [["Soja em grande volume", "Commodities"]] },

  { nome: "Beatriz Nakamura", cargo: "CEO", empresa: "Rota Fria", cidade: "Santos",
    possui: [["Armazenagem refrigerada", "Logística"]],
    procura: [["Compradores no exterior", "Comércio exterior"]] },

  { nome: "Carla Monteiro", cargo: "Trading Manager", empresa: "Monteiro Export", cidade: "Curitiba",
    possui: [["Compradores no exterior", "Comércio exterior"]],
    procura: [["Armazenagem refrigerada", "Logística"]] },

  { nome: "Débora Antunes", cargo: "Fundadora", empresa: "Clínica Vida Plena", cidade: "Belo Horizonte",
    possui: [["Rede de clínicas próprias", "Saúde"]],
    procura: [["Aporte para expansão", "Investimento"]] },

  { nome: "Renata Klein", cargo: "Investidora-anjo", empresa: "Klein Capital", cidade: "Porto Alegre",
    possui: [["Aporte para expansão", "Investimento"]],
    procura: [["Negócios em saúde", "Saúde"]] },

  { nome: "Patrícia Sales", cargo: "Head Jurídico", empresa: "Sales Advogadas", cidade: "Recife",
    possui: [["Assessoria em contratos internacionais", "Jurídico"]],
    procura: [["Indicação de clientes no agro", "Commodities"]] },

  { nome: "Luciana Ferraz", cargo: "Diretora Industrial", empresa: "Ferraz Alimentos", cidade: "Ribeirão Preto",
    possui: [["Linha de produção ociosa", "Indústria"]],
    procura: [["Marca para envase próprio", "Indústria"]] },

  { nome: "Sofia Andrade", cargo: "Sócia-fundadora", empresa: "Andrade Naturais", cidade: "Florianópolis",
    possui: [["Marca de alimentos naturais", "Indústria"]],
    procura: [["Fábrica com capacidade disponível", "Indústria"]] },

  { nome: "Vitória Camargo", cargo: "Diretora de Novos Negócios", empresa: "Camargo Energia", cidade: "Brasília",
    possui: [["Projetos de energia solar", "Energia"]],
    procura: [["Terrenos com outorga", "Energia"]] },

  // As três seguintes existem para demonstrar a regra da direção (etapa 11).
  // Serra e Andina querem as duas EXPORTAR vinho — são concorrentes, e o motor
  // nunca as apresenta uma à outra, ainda que os textos sejam idênticos. Serra e
  // Lisboa dizem coisas opostas, "exportar" contra "importar", e é justamente aí
  // que existe negócio: esse par sai em 100.
  //
  // Repare que a Andina escreveu "Exportar vinho" no campo do que PROCURA. Não é
  // erro de quem cadastrou: é assim que se fala — a necessidade sai redigida como
  // objetivo. É essa contradição entre o campo e a palavra que a regra resolve.
  { nome: "Helena Bertolucci", cargo: "Diretora Comercial", empresa: "Vinícola Serra Gaúcha", cidade: "Bento Gonçalves",
    possui: [["Exportar vinho", "Comércio exterior"]],
    procura: [["Armazenagem refrigerada", "Logística"]] },

  { nome: "Constanza Duarte", cargo: "Sócia", empresa: "Bodega Andina", cidade: "Porto Alegre",
    possui: [],
    procura: [["Exportar vinho", "Comércio exterior"]] },

  { nome: "Inês Salgueiro", cargo: "Diretora de Compras", empresa: "Importadora Lisboa", cidade: "Lisboa",
    possui: [["Rede de distribuição na Europa", "Comércio exterior"]],
    procura: [["Importar vinho", "Comércio exterior"]] },
];

const conexao = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [[usuaria]] = await conexao.query("SELECT id, openId, name FROM users WHERE email = ?", [email]);
  if (!usuaria) {
    console.error(`Nenhuma usuária com o e-mail ${email}.`);
    process.exit(1);
  }
  const dono = usuaria.openId;

  if (limpar) {
    const [r1] = await conexao.query("DELETE FROM ai_match_suggestions WHERE owner_id = ?", [dono]);
    const [r2] = await conexao.query("DELETE FROM contact_assets WHERE owner_id = ?", [dono]);
    const [r3] = await conexao.query("DELETE FROM contact_needs WHERE owner_id = ?", [dono]);
    const [r4] = await conexao.query("DELETE FROM private_contacts WHERE ownerId = ?", [dono]);
    console.log(`Limpo: ${r4.affectedRows} contatos, ${r2.affectedRows} ativos, ${r3.affectedRows} necessidades, ${r1.affectedRows} sugestões.`);
    process.exit(0);
  }

  const agora = Date.now();
  let contatos = 0, itens = 0;

  for (const pessoa of CONTATOS) {
    const [inserido] = await conexao.query(
      "INSERT INTO private_contacts (ownerId, fullName, jobTitle, company, country, city, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'BR', ?, ?, ?)",
      [dono, pessoa.nome, pessoa.cargo, pessoa.empresa, pessoa.cidade, agora, agora],
    );
    const contatoId = inserido.insertId;
    contatos++;

    for (const [rotulo, categoria] of pessoa.possui) {
      await conexao.query(
        "INSERT INTO contact_assets (owner_id, contact_id, tag_slug, tag_label, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [dono, contatoId, slug(rotulo), rotulo, categoria, agora, agora],
      );
      itens++;
    }
    for (const [rotulo, categoria] of pessoa.procura) {
      await conexao.query(
        "INSERT INTO contact_needs (owner_id, contact_id, tag_slug, tag_label, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [dono, contatoId, slug(rotulo), rotulo, categoria, agora, agora],
      );
      itens++;
    }
  }

  console.log(`Rede de teste criada para ${usuaria.name}: ${contatos} contatos e ${itens} itens.`);
  console.log('Abra "Matches Inteligentes" e clique em "Atualizar matches" para o cruzamento rodar.');
  console.log(`Para desfazer: node scripts/semear-rede-de-teste.mjs ${email} --limpar`);
} catch (erro) {
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
