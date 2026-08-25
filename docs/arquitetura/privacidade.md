# Privacidade e níveis de acesso — MMM

Cobre as etapas 8, 10 e 11 do escopo, e o ajuste A13.

## A regra que organiza tudo

> A tela nunca é a última linha de defesa.

Se o servidor devolve um dado e o front-end apenas não o desenha, o dado **está
exposto**. Qualquer pessoa vê abrindo as ferramentas do navegador, e não é preciso
saber programar para isso. Toda regra de privacidade descrita aqui precisa existir
no banco e na consulta, não no componente de tela.

---

## Os três níveis

O escopo da Glenda (etapas 8 e 10) define:

| Nível | Quem vê | O que vê |
|---|---|---|
| **Privado** | só o dono | tudo |
| **Ouro** | dono + Usuários Ouro autorizados | tudo que o dono liberou, incluindo dados pessoais |
| **Público no ecossistema** | todos os membros do MMM | **só as oportunidades — nunca os dados pessoais do contato** |

O padrão de um contato novo é **privado**. Nada vira público por omissão.

### O nível público é uma consulta diferente

Esta é a parte mais fácil de errar. A Glenda foi explícita:

> nesta hipótese não pode aparecer os dados pessoais do contato, só as oportunidades.

Não basta filtrar linhas — é preciso **não selecionar as colunas**:

```sql
-- Projeção pública: as colunas pessoais nem são lidas.
CREATE VIEW oportunidade_publica AS
SELECT
  c.id            AS contato_ref,   -- referência opaca, não identifica
  c.pais,
  c.cidade,
  ti.nome         AS oferta,
  ca.direcao
FROM contato c
JOIN contato_atributo ca ON ca.contato_id = c.id
JOIN taxonomia_item   ti ON ti.id = ca.item_id
WHERE c.nivel_visibilidade = 'publico';
-- nome, empresa, cargo, telefone, whatsapp, email, linkedin, instagram,
-- foto e cartão de visita NÃO aparecem aqui, e é esse o ponto.
```

---

## Autorização Ouro

O escopo diz que o membro só pode usar a plataforma se autorizar o acesso do Usuário
Ouro aos seus dados. Isso é uma autorização explícita, revogável, com data:

```sql
CREATE TABLE autorizacao_ouro (
  usuario_id    uuid PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  concedida_em  timestamptz NOT NULL DEFAULT now(),
  revogada_em   timestamptz
);
```

E o compartilhamento pontual com pessoas específicas ("compartilhadas apenas com
pessoas autorizadas", etapa 8):

```sql
CREATE TABLE compartilhamento (
  contato_id     uuid NOT NULL REFERENCES contato(id) ON DELETE CASCADE,
  usuario_id     uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  concedido_em   timestamptz NOT NULL DEFAULT now(),
  revogado_em    timestamptz,
  PRIMARY KEY (contato_id, usuario_id)
);
```

> **Revogar é preencher uma data, nunca apagar a linha.** Se a autorização for
> deletada, some a prova de que ela existiu no período em que os dados foram usados —
> que é exatamente a informação que interessa numa auditoria.

---

## Regras de linha no banco

Em Postgres, `ROW LEVEL SECURITY`. A ideia: mesmo que a aplicação tenha um bug e
esqueça um `WHERE`, o banco não devolve o que não pode.

```sql
ALTER TABLE contato ENABLE ROW LEVEL SECURITY;

-- O dono vê os seus.
CREATE POLICY contato_dono ON contato
  FOR ALL
  USING (dono_usuario_id = current_usuario_id());

-- Usuário Ouro vê os contatos marcados 'ouro' de quem autorizou o acesso Ouro.
CREATE POLICY contato_ouro ON contato
  FOR SELECT
  USING (
    nivel_visibilidade = 'ouro'
    AND EXISTS (
      SELECT 1 FROM usuario_papel up
      WHERE up.usuario_id = current_usuario_id()
        AND up.papel = 'ouro'
        AND up.revogado_em IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM autorizacao_ouro ao
      WHERE ao.usuario_id = contato.dono_usuario_id
        AND ao.revogada_em IS NULL
    )
  );

-- Compartilhamento pontual.
CREATE POLICY contato_compartilhado ON contato
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM compartilhamento cp
      WHERE cp.contato_id = contato.id
        AND cp.usuario_id = current_usuario_id()
        AND cp.revogado_em IS NULL
    )
  );
```

O nível **público não ganha política em `contato`** — de propósito. Ele é servido
pela view `oportunidade_publica`, que não expõe as colunas pessoais. Dar acesso
público direto à tabela `contato` seria contrariar a regra da Glenda.

---

## Consentimento do Smart Match (etapa 11)

O cruzamento só pode considerar quem autorizou. Na prática, a consulta de Match do
[modelo-de-dados.md](./modelo-de-dados.md) ganha esta condição nos dois lados:

```sql
AND EXISTS (
  SELECT 1
  FROM consentimento cs
  JOIN documento_versao dv ON dv.id = cs.documento_versao_id
  WHERE cs.usuario_id = <dono do contato>
    AND dv.tipo = 'termo_smart_match'
    AND cs.revogado_em IS NULL
)
```

Recusar o Smart Match **não pode** impedir o uso do resto do app. Desliga o
cruzamento, e só.

Revogar precisa ter efeito imediato: como a condição é avaliada na consulta, e não
num campo copiado para outro lugar, preencher `revogado_em` já basta — o contato sai
do cruzamento na consulta seguinte, sem precisar de nenhum processo de limpeza.

---

## O ajuste A13, e o que ele não resolve

A nota do Gabriel pede bloqueio de e-mail e telefone para impedir acordos fechados
fora da plataforma. Tecnicamente:

```sql
-- Dados de contato da outra parte só saem depois do aceite do acordo.
CREATE POLICY oportunidade_dados_completos ON contato
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM oportunidade_parte op
      WHERE op.usuario_id = current_usuario_id()
        AND op.aceito_em IS NOT NULL
    )
  );
```

Mas vale ser honesto sobre o alcance disso: **nenhum bloqueio técnico impede duas
pessoas determinadas de trocarem contato por fora.** Elas se encontram no LinkedIn,
num evento, por um conhecido em comum.

O que o bloqueio faz de útil é outra coisa: torna o caminho oficial o mais fácil, e
gera o **registro** que sustenta a cláusula de non-circumvention da etapa 13. Por
isso a decisão técnica (D3) e a redação jurídica precisam ser tomadas na mesma
conversa — separadas, cada uma resolve metade do problema.

---

## Checklist antes de qualquer publicação

- [ ] Contato novo nasce privado
- [ ] Duas contas de teste: A não vê nada de B em nenhuma tela
- [ ] A busca em linguagem natural (etapas 6 e 9) respeita as mesmas regras
- [ ] O Match não cruza dado de quem não consentiu
- [ ] No nível público, nenhuma resposta do servidor contém nome, telefone, e-mail,
      WhatsApp, LinkedIn, Instagram, foto ou cartão de visita de contato
- [ ] Revogar autorização tira o acesso na consulta seguinte
- [ ] Áudio de reunião e cartões de visita ficam em storage cifrado, com URL
      temporária — não em link público permanente
