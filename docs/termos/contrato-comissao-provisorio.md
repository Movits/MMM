# Termos de Uso e Acordo de Comissionamento (versão provisória)

Texto provisório para que o aceite no fim do cadastro tenha o que registrar. As
seções 1 a 3 repetem, em português, exatamente o que a tela mostra nos 10 idiomas
(`onboarding.terms.*`), e valem até a redação jurídica chegar.

**Versões publicadas em produção** (`document_versions`, tipo `contrato_comissao`):

- **v1:** punha o teto de 50% sobre o lucro declarado, texto anterior à resposta de 12/09.
- **v2, 14/09/2026 17:32:** o texto das seções 1 a 3 abaixo, publicado junto com o
  deploy da PR #107, com `--sem-aviso`. O aviso no sino levaria ao Dashboard, onde
  não há tela de aceite do contrato; hoje nenhum código exige este consentimento,
  e o aceite acontece só no fim do cadastro.

Para publicar uma versão nova, gere um arquivo **só com as seções 1 a 3** (sem
este cabeçalho nem as notas do fim, porque o script grava o arquivo inteiro) e rode,
com a `DATABASE_URL` de produção carregada:

```bash
node -r dotenv/config scripts/publicar-documento.mjs contrato_comissao caminho/do/texto.md --simular dotenv_config_path=.env.producao
node -r dotenv/config scripts/publicar-documento.mjs contrato_comissao caminho/do/texto.md --confirmo-producao --sem-aviso dotenv_config_path=.env.producao
```

Rodar contra o banco de produção só com autorização do Roberto.

---

## 1. Objeto

O MMM é uma plataforma de relacionamento entre membras. Ela apresenta pessoas
cujos interesses se complementam e registra os negócios que nascem dessas
apresentações. A plataforma não é parte do negócio: quem contrata são as membras
entre si.

## 2. Comissionamento

Negócio originado de uma apresentação feita pela plataforma gera comissão ao
MMM, nas seguintes condições:

- o percentual é definido caso a caso pela Diretoria Comercial;
- o limite é de 50% do valor dos honorários da intermediação do negócio;
- nesta versão o pagamento acontece fora da plataforma; o site apenas registra o
  negócio e a comissão devida.

## 3. Vigência e alterações

Este texto é provisório e está em revisão jurídica. Quando a versão final for
publicada, você será avisada e precisará aceitá-la novamente. A data e o texto
exato deste aceite ficam registrados.

---

## Respostas de 12/09/2026 que ainda não estão na tela

A Dra. Glenda respondeu por escrito e estas regras valem, mas ainda não entraram no
texto que a usuária aceita (entram numa próxima versão, depois da revisão jurídica):

- quem declara o valor é o **consultor de negócios**, não as partes;
- havendo duas indicadoras: se forem network de usuárias distintas, a comissão é
  rateada em partes iguais; se for uma usuária cadastrada e o network pessoal de
  outra, só a usuária cadastrada é remunerada;
- **é vedado o bypass**: ao ocorrer a conexão, as partes são contactadas pelo
  consultor de negócios e assinam contrato de intermediação e contra
  circunvenção;
- não há prazo de decadência: o negócio gera comissão a qualquer momento depois
  da apresentação. Atenção: o acordo de confidencialidade da Sala de Negociação
  ainda fala em vigência de 24 meses e espera o texto do jurídico.

## O que ainda falta (com o jurídico)

Das seis perguntas que estavam nesta lista, cinco foram respondidas em 12/09.
Sobraram duas:

1. **O critério do percentual.** Ela respondeu que quem define é a Diretoria
   Comercial, "por critérios que serão definidos em outra ocasião" — então existe
   o responsável, e não existe ainda a regra. Quando o registro do negócio fechado
   entrar (ajuste A11, PR #94, ainda em rascunho), o sistema vai gravar o
   percentual que alguém preencher e recusar acima de 50%; calcular sozinho, não
   vai conseguir.
2. **O nome jurídico que entra no contrato.** Perguntada qual nome entra nos
   contratos e qual aparece na tela, ela respondeu: "Houve alteração, vou lhe
   encaminhar a nova logo". Ou seja, nem "MMM — Mulheres que Movem o Mundo"
   (aplicativo) nem "WMW — Women Moving the World" (termo do Smart Match, redação
   da Cris) são definitivos, e a logo nova ainda não chegou.

E uma pergunta que a resposta dela abriu, e que é do jurídico, não do produto:
**o que são exatamente "os honorários da intermediação"** e como eles são
acordados com as partes, já que é sobre esse valor que os 50% incidem.
