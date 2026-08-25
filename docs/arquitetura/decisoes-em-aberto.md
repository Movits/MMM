# Decisões em aberto

Coisas que não são decisão técnica e que travam implementação. Cada uma tem um item
correspondente no quadro do projeto.

---

## D1: Percentual e regras da comissão

**Trava:** ajuste A11 (contrato de comissão no cadastro), etapa 13.
**Parado desde:** 12/08/2026.

Perguntas:

1. Qual o percentual da comissão do MMM?
2. Incide sobre o quê: valor do negócio fechado, valor recebido, outra base?
3. Percentual único, ou varia por tipo de negócio, porte ou valor?

Dá para andar sem a resposta: a tela de aceite, o versionamento do documento e o
registro do consentimento se constroem tratando o percentual como configuração. Só o
texto final depende da decisão.

---

## D2: Como o dinheiro passa pela plataforma

**Trava:** ajuste A14. É a decisão de maior impacto no prazo, e a única com
componente regulatório.

A nota da reunião de 05/08 diz:

> o dinheiro do negócio que foi fechado fica no site para depois ser repassado, já
> descontada a comissão

Guardar dinheiro de terceiros e repassar depois é atividade regulada no Brasil.
Fazer isso na mão, com o valor passando por uma conta do MMM, cria risco jurídico e
tributário.

| Caminho | Como funciona | Cabe até 10/09? |
|---|---|---|
| **Não tocar no dinheiro** | O MMM registra o negócio e cobra a comissão por fora. | Sim |
| **Split via gateway** | Pagar.me, Asaas, Stripe Connect e similares dividem o valor entre as partes e a comissão. A licença é do gateway, não do MMM. | Apertado |
| **Conta escrow própria** | O MMM recebe, guarda e repassa. Exige estrutura de instituição de pagamento. | Não |

**Recomendação técnica:** o primeiro caminho para 10/09, o segundo como alvo da
versão seguinte. O terceiro não deveria entrar em discussão sem parecer jurídico.

---

## D3: Até onde bloquear o contato direto

**Trava:** ajuste A13, e se conecta à cláusula de non-circumvention da etapa 13.

Perguntas:

1. Esconder e-mail e telefone até o acordo ser aceito, ou também filtrar contatos
   digitados dentro do chat?
2. Consequência de contornar: aviso, suspensão, cláusula contratual com penalidade?
3. Vale para todos os usuários ou só para oportunidades do Smart Match?

Ver a seção sobre o alcance real do bloqueio em
[privacidade.md](./privacidade.md#acesso-após-o-aceite-etapa-13-e-ajuste-a13).

---

## D4: Destaque de produto, pago ou gratuito?

**Trava:** ajuste A12. Decisão barata de tomar; muda o tamanho do item de um dia
para semanas.

| Se for | O item vira |
|---|---|
| Gratuito | Uma marcação e uma ordenação. Um dia de trabalho. |
| Pago | Meio de pagamento, cobrança, controle de validade do destaque. Semanas. |

---

## D5: O recorte do prazo de 10/09

Em 25/08 restam 16 dias, e estão em aberto:

- Etapas **12** e **13**, as duas maiores e nenhuma iniciada
- Ajustes **A11 a A14**, todos travados por decisão
- O código está inacessível fora do Manus
- Nada foi verificado por ninguém além de quem fez

Só o A14, do jeito que está escrito, consome mais do que os 16 dias restantes.

**Proposta de recorte:**

- **Em 10/09**: etapas 1 a 11 verificadas de verdade, ajustes A1 a A10 conferidos,
  etapas 12 e 13 na mecânica (aceite, corretor, status, auditoria), com o texto
  jurídico entrando como versão de documento depois.
- **Data própria**: A14, e A12 se for pago.
- **Esta semana**: D1, D2, D3 e D4 respondidos.

---

## Decisões de produto do modelo de acesso

Três definições que a revisão técnica do modelo levantou. São regras de produto, não
de código, e mudam políticas de acesso já desenhadas:

1. **A autorização Ouro é para o programa ou por pessoa?** Hoje o modelo registra
   "autorizo o acesso Ouro" como um todo: qualquer Usuária Ouro ativa vê os contatos
   nível ouro de quem autorizou. Se a intenção do escopo ("Usuários Ouro
   autorizados") é autorizar pessoa a pessoa, a tabela e a política mudam.
2. **Os níveis são cumulativos?** Um contato marcado `publico` aparece na vitrine de
   oportunidades sem dados pessoais. A Usuária Ouro autorizada também deveria ver os
   dados completos dele, como vê os de nível `ouro`? Se sim, a política inclui os
   dois níveis; se não, registrar que público é menos visível que ouro para quem tem
   acesso Ouro.
3. **Consentimento sobrevive à troca de versão do termo?** Quando sai uma versão
   nova do termo de Smart Match, o consentimento dado na versão antiga continua
   valendo, ou o cruzamento para até o usuário aceitar de novo?

---

## Stack: decisão adiada

Não faz sentido escolher antes de saber o que sobrou do código no Manus. Se o site
puder ser aproveitado, a escolha já está feita pelo que existe; se tudo precisar ser
refeito, ela é livre.

O que a stack escolhida precisa entregar:

- Os três níveis de privacidade aplicados no banco, não na tela
- Busca em linguagem natural sobre a base do próprio usuário
- Transcrição e extração de áudio
- Histórico auditável de oportunidades
- Funcionar no celular: o escopo pede app, não só site
