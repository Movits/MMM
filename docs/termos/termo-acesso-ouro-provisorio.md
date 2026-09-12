# Autorização de Acesso ao Acervo Ouro (versão provisória)

**Versão provisória.** Este texto descreve exatamente o que o sistema faz hoje e
será substituído pela redação jurídica final. Enquanto ele não existia, o acervo
Ouro era liberado por omissão: qualquer contato que você marcasse como
compartilhado aparecia para as membras Ouro sem que você tivesse autorizado nada.

Publicar com:

```bash
node scripts/publicar-documento.mjs termo_acesso_ouro docs/termos/termo-acesso-ouro-provisorio.md --confirmo-producao
```

---

## O que você está autorizando

Você autoriza que **membras de nível Ouro** vejam os contatos da sua base que
**você marcar** como "Autorizadas (Ouro)". Nenhum outro contato seu entra nisso:
o padrão de todo contato é privado.

## O que elas veem

Apenas estes campos, e nada além:

- nome do contato;
- empresa e cargo;
- segmento (as tags do perfil);
- cidade e país;
- o que esse contato possui e o que procura;
- **o seu nome**, como quem compartilhou.

## O que elas nunca veem

Telefone, WhatsApp, e-mail, redes sociais, foto, cartão de visita e as suas
anotações. Esses campos não são lidos pela consulta do acervo, não é uma questão
de estarem escondidos na tela.

## Registro e revogação

Cada leitura do acervo fica registrada na trilha de auditoria. Você pode:

- voltar um contato para privado a qualquer momento — ele sai do acervo na
  leitura seguinte;
- revogar esta autorização por inteiro — a sua base inteira sai do acervo na
  requisição seguinte.

As duas coisas são reavaliadas a cada consulta, não existe cópia em cache.

## Vigência e alterações

Este texto é provisório e está em revisão jurídica. Quando a versão final for
publicada, você será avisada e precisará aceitá-la novamente. A data, o endereço
de rede e o texto exato desta autorização ficam registrados.

---

## O que ainda falta (para a versão 2, com o jurídico)

1. A base legal do tratamento desses dados, já que o contato é um terceiro que
   não tem conta na plataforma e não assinou nada.
2. Por quanto tempo a trilha de auditoria das leituras é mantida.
3. O que acontece com o que uma membra Ouro já viu depois de você revogar.
4. O nome jurídico que entra no termo: o texto do Smart Match usa
   "WMW — Women Moving the World" e o aplicativo usa MMM.
