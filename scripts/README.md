# scripts/

Ferramentas de linha de comando do MMM. Rodam a partir da raiz do repositório,
com `node` (os `.mjs`) ou `npx tsx` (os `.ts`), e leem a conexão de
`DATABASE_URL` quando precisam de banco. O cabeçalho de cada arquivo tem o
detalhe de uso; esta página é só o mapa.

**Nunca rode script contra o banco de produção (Aiven) sem autorização
explícita do Roberto.** Os que mudam dado relatam sem `--aplicar` ou aceitam
`--simular`: use esse modo primeiro. `definir-senha-local.mjs` recusa banco
remoto e `publicar-documento.mjs` exige `--confirmo-producao`; os outros não
têm trava nenhuma. A única rotina prevista contra a produção é o exame
`checar-producao.mjs` depois de um deploy, e mesmo ela com autorização.

| Script | O que faz | Quando rodar |
| --- | --- | --- |
| `baseline.mjs` | Biblioteca, não comando: lê o baseline `0000_fundacao` de `drizzle/` e devolve tabelas, colunas e índices como dados. | Nunca direto; `migrar.mjs` e `nivelar-banco.mjs` importam dela. |
| `checar-producao.mjs` | Exame de saúde do site no ar: bateria de checagens reais contra aplicação e banco, cria e apaga os próprios dados de teste; `--com-ia` inclui FAQ, transcrição e Memória. Sai com 0 só se tudo passou. | Depois de todo deploy na `main`, antes de marcar a tarefa como concluída no Notion. Precisa do `.env` da produção (`DATABASE_URL` e `JWT_SECRET`). |
| `conferir-locales.mjs` | Confere que os 10 JSONs de `client/src/i18n/locales/` têm o mesmo conjunto de chaves; sai com 1 e lista o que falta ou sobra. | Sempre que tocar em texto de tela; o CI também roda. Não precisa de banco. |
| `corrigir-colunas-json.mjs` | Converte para `json` as colunas que o dump do Manus trouxe como `longtext`; sem `--aplicar` só relata. | Só em banco restaurado do dump antigo; banco criado por `criar-banco.mjs` já nasce certo. |
| `criar-banco.mjs` | Cria todas as tabelas num banco vazio aplicando as migrações de `drizzle/` (atalho para `migrar.mjs`). Seguro repetir. | Banco novo do zero: desenvolvimento, CI, primeira subida. |
| `definir-senha-local.mjs` | Grava a senha de uma conta com o mesmo bcrypt do registro; recusa qualquer host que não seja local. | Conta de teste inacessível em desenvolvimento, onde não há Resend para recuperar senha. |
| `demonstrar-etapa-11.ts` | Demonstração ao vivo da autorização do Cruzamento Inteligente: chama as mesmas funções do servidor e mostra o que respondem; `--exercitar` revoga e reaceita de verdade e devolve o estado ao final. | Para provar a etapa 11 a alguém, contra banco de desenvolvimento (`npx tsx`). |
| `migrar-rotulos-para-chaves.mjs` | Migra as listas de `user_profiles` do rótulo pt-BR para a chave canônica e recalcula o `profileCompleteness`; seguro repetir. | Uma vez, em banco com perfis gravados antes de 31/08/2026 (o front já grava chaves). |
| `migrar.mjs` | Aplica as migrações pendentes de `drizzle/` e anota em `_migracoes`: banco vazio recebe tudo, banco antigo em dia adota o baseline, banco desviado é recusado com a lista dos desvios. `--simular` só relata. | É o `pnpm db:migrate`; depois de `pnpm db:generate`. Em produção roda sozinho no boot. |
| `nivelar-banco.mjs` | Põe um banco da era anterior às migrações em dia com o baseline: cria tabela, coluna, índice e restrição que faltam e alarga enum; nunca apaga nada. Sem `--aplicar` só relata. | Quando `migrar.mjs` recusar o banco por desvio. O CI exige "Nada a nivelar" num banco recém-criado. |
| `publicar-documento.mjs` | Publica uma versão nova de documento (termo, acordo, contrato) e a torna vigente; conta quem perde o consentimento e pede confirmação. `--simular` só mostra; `--texto-provisorio` publica o rascunho embutido. | Quando o jurídico entregar redação nova. Fora do banco local exige `--confirmo-producao`. |
| `recuperar-enriquecimento.ts` | Reaplica ao contato as respostas do chat de enriquecimento (possui, procura, como se conheceram, tipo de relacionamento) que um defeito antigo confirmava e descartava; sem `--aplicar` só relata. | Uma vez, em banco com sugestões `applied` anteriores ao conserto (`npx tsx`). |
| `semear-rede-de-teste.mjs` | Cria contatos fictícios na rede particular de UMA usuária para dar o que cruzar ao Smart Match; `--limpar` desfaz. Ninguém além da dona enxerga. | Testar o cruzamento em desenvolvimento. |
