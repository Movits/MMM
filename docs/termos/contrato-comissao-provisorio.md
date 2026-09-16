# Termos de Uso e Acordo de Comissionamento (versão provisória)

<!-- NOTA INTERNA — não vai para o texto que a dona aceita.

     O script publica só o corpo do termo: este bloco de comentário, e tudo a
     partir da linha marcadora de notas internas lá embaixo, ficam de fora
     (recortarCorpoDoTermo, em scripts/publicar-documento.mjs).

     Texto provisório publicado para que o aceite no fim do cadastro tenha o que
     registrar. Ele repetia, em português, as cláusulas que a tela mostrava nos 10
     idiomas (onboarding.terms.*), e vale até a redação jurídica da Cris chegar.

     DESDE 14/09/2026 O CADASTRO NÃO MOSTRA NEM REGISTRA MAIS ESTE CONTRATO
     (Rosber, 21:34): a etapa "Termos e Condições" foi substituída pelo Termo Geral
     de Uso (termo_geral_de_uso, docs/termos/termo-geral-de-uso.md), que trata de
     intermediação e remuneração nas cláusulas 12 a 15. O tipo contrato_comissao
     e os aceites já gravados continuam no banco.

     Publicar com:
       node scripts/publicar-documento.mjs contrato_comissao docs/termos/contrato-comissao-provisorio.md --env .env.producao

     Quando a versão final sair, publique-a do mesmo jeito: a versão 2 vira a
     vigente, e todas as membras precisam aceitar de novo.
-->

## 1. Objeto

O MMM é uma plataforma de relacionamento entre membras. Ela apresenta pessoas
cujos interesses se complementam e registra os negócios que nascem dessas
apresentações. A plataforma não é parte do negócio: quem contrata são as membras
entre si.

## 2. Comissionamento

Negócio originado de uma apresentação feita pela plataforma gera comissão ao
MMM, nas seguintes condições:

- o percentual é definido caso a caso pela Diretoria Comercial;
- o limite é de 50% do valor dos **honorários da intermediação** do negócio;
- quem declara o valor é o **consultor de negócios**, não as partes;
- havendo duas indicadoras: se forem network de usuárias distintas, a comissão é
  rateada em partes iguais; se for uma usuária cadastrada e o network pessoal de
  outra, só a usuária cadastrada é remunerada;
- **é vedado o bypass**: ao ocorrer a conexão, as partes são contactadas pelo
  consultor de negócios e assinam contrato de intermediação e contra
  circunvenção;
- não há prazo de decadência — o negócio gera comissão a qualquer momento depois
  da apresentação;
- nesta versão o pagamento acontece fora da plataforma; o site apenas registra o
  negócio e a comissão devida.

## 3. Vigência e alterações

Este texto é provisório e está em revisão jurídica. Quando a versão final for
publicada, você será avisada e precisará aceitá-la novamente. A data e o texto
exato deste aceite ficam registrados.

<!-- NOTAS INTERNAS -->

---

## O que ainda falta (para a versão 2, com o jurídico)

Em 12/09/2026 a Dra. Glenda respondeu por escrito cinco das seis perguntas que
estavam nesta lista, e as respostas subiram para a seção 2. Sobraram duas:

1. **O critério do percentual.** Ela respondeu que quem define é a Diretoria
   Comercial, "por critérios que serão definidos em outra ocasião" — então existe
   o responsável, e não existe ainda a régra. Enquanto isso, o sistema grava o
   percentual que alguém preencher e recusa acima de 50%; calcular sozinho, não
   consegue.
2. **O nome jurídico que entra no contrato.** Perguntada qual nome entra nos
   contratos e qual aparece na tela, ela respondeu: "Houve alteração, vou lhe
   encaminhar a nova logo". Ou seja, nem "MMM — Mulheres que Movem o Mundo"
   (aplicativo) nem "WMW — Women Moving the World" (termo do Smart Match, redação
   da Cris) são definitivos, e a logo nova ainda não chegou.

E uma pergunta que a resposta dela abriu, e que é do jurídico, não do produto:
**o que são exatamente "os honorários da intermediação"** e como eles são
acordados com as partes, já que é sobre esse valor que os 50% incidem.
