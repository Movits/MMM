# Histórico da documentação

## v1.1 (25/08/2026)

Revisão geral após painel de revisão (estilo, relevância e técnica).

Estilo, em todos os documentos: texto mais seco, sem travessões, sem citações de
mensagens do time, sem repetição de argumento entre arquivos.

Correções técnicas no modelo:

- `privacidade.md`: política `oportunidade_dados_completos` reescrita; a versão
  anterior liberava a tabela inteira de contatos com um único aceite. Definidas as
  roles de conexão (`mmm_owner`, `mmm_app`, `mmm_match`), a função
  `current_usuario_id()` e o mecanismo que sustenta a view pública. Publicada a
  consulta de Match integrada com consentimento e visibilidade. Declarada a
  cobertura de RLS do MVP. `autorizacao_ouro` e `compartilhamento` com id
  surrogate, preservando histórico de revogações.
- `modelo-de-dados.md`: `cnpj_coerente` corrigida (terceiro setor tem CNPJ);
  `natureza` obrigatória; estados `extraindo` e `em_revisao` no CHECK de
  `reuniao.status`; índice único em `contato_atributo` contra atributos duplicados;
  uma versão vigente por tipo de documento; FK de `origem_id` para
  `reuniao_extracao`; cadeia contato → atributo → match com `RESTRICT` e nota de
  anonimização (LGPD); CHECK em `modalidades`; sinônimo de taxonomia único global;
  `usuario_papel` com id surrogate; seção de índices mínimos; requisito Postgres 13+.
- `fluxos.md`: estados do diagrama alinhados ao CHECK do modelo.
- `decisoes-em-aberto.md`: três decisões de produto do modelo de acesso
  acrescentadas (escopo da autorização Ouro, cumulatividade dos níveis, validade do
  consentimento entre versões do termo).

## v1.0 (25/08/2026)

Primeira versão: visão geral e camadas, modelo de dados, fluxos, privacidade e
decisões em aberto, escritos a partir das 13 seções de escopo de 06/08/2026 e das
notas da reunião de 05/08/2026.
