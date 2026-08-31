# Autorização para o Cruzamento Inteligente

> **Pendente de revisão jurídica.** Este texto foi escrito a partir do
> comportamento real do sistema, conferido no código, para que a revisão do
> jurídico parta de uma descrição correta em vez de uma página em branco. Ele
> não substitui essa revisão. Enquanto ela não acontecer, o que está aqui é o
> melhor relato disponível do que o recurso faz — não uma peça jurídica pronta.

## O que é o Cruzamento Inteligente

Você mantém, dentro da plataforma, uma agenda particular de contatos, e registra
para cada um o que ele tem a oferecer e o que ele procura. O Cruzamento
Inteligente compara esses registros **entre os seus próprios contatos** e mostra
a você onde um tem o que o outro procura.

A comparação é feita de três formas: pelo termo cadastrado, pela categoria, e
pelo sentido do que foi escrito. Quando duas pontas querem a mesma coisa — duas
que exportam, por exemplo — elas não são apresentadas uma à outra: o sistema
entende que ali há concorrência, não negócio.

## O que você está autorizando

**Que o sistema leia e cruze os registros da sua agenda particular.** Sem esta
autorização o cruzamento não roda, nenhuma sugestão é gerada, e nenhuma das
telas do recurso funciona.

## Para onde os dados vão

Esta é a parte que mais importa saber antes de decidir.

Para comparar o sentido de termos que não são idênticos, o sistema envia a
**descrição do que cada contato possui e procura** para o serviço de
inteligência artificial do Google (Gemini), que devolve uma representação
numérica usada na comparação.

O que é enviado:

- o termo cadastrado (por exemplo, "armazenagem refrigerada");
- a descrição livre, quando você tiver escrito uma.

O que **não** é enviado: nome, empresa, cargo, telefone, e-mail, país ou
qualquer outro dado que identifique o contato. O Google recebe o assunto,
nunca de quem se trata.

Esse envio acontece durante o recálculo dos cruzamentos. Se o serviço estiver
indisponível, o cruzamento continua funcionando pelos outros dois critérios.

## O que não acontece

- Sua agenda **não** é compartilhada com outras usuárias da plataforma.
- Nenhum contato seu é apresentado a ninguém sem que você decida apresentar.
- O cruzamento **não** envia mensagem a nenhum contato: ele mostra a sugestão
  a você, e a iniciativa de aproximar as pessoas continua sendo sua.

## Avisos por e-mail

Quando o cruzamento encontrar uma conexão de alta compatibilidade na sua rede,
você recebe um e-mail avisando. O e-mail informa quantas conexões novas
existem e pede que você abra a plataforma; ele **não** contém nomes nem dados
dos contatos.

## O que fica registrado

Para cada sugestão, o sistema guarda quais informações levaram àquele
resultado, para que você possa entender por que aquela indicação apareceu.

Da sua autorização ficam registrados a data, a versão deste documento e o
endereço de origem do acesso — é o que permite demonstrar depois que a
autorização foi concedida por você, e a que texto ela se referia.

## Se você recusar

O Cruzamento Inteligente fica desligado. **Todo o restante da plataforma
continua funcionando normalmente**: cadastro, agenda de contatos,
oportunidades, reuniões e mensagens não dependem desta autorização.

## Se você revogar

Você pode revogar quando quiser, e vale a partir do momento em que é feita.
Revogando:

- nenhuma sugestão nova é gerada, e nenhum dado seu volta a ser enviado ao
  serviço de inteligência artificial;
- as sugestões geradas antes deixam de ser acessíveis;
- seus contatos e tudo que você registrou sobre eles permanecem intactos.

O registro da autorização **não** é apagado quando você revoga: a data da
revogação é acrescentada a ele. Isso existe para o seu lado — é o que permite
demonstrar em que período a autorização esteve valendo.

## Se este texto mudar

Uma versão nova deste documento não herda a autorização dada na versão
anterior. Quando o texto mudar, o cruzamento fica pausado e a plataforma
apresenta a versão nova para você ler e decidir de novo. Seus contatos e as
conexões que você já aceitou continuam onde estavam.
