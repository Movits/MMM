# Arquitetura

> Documento de arquitetura, escrito em 25/08/2026 a partir das 13 seções de escopo
> enviadas pela Glenda em 06/08/2026 e das notas da reunião de 05/08/2026.

## Para que serve este documento

O código do MMM foi construído inteiramente dentro do Manus e, até 25/08/2026, nunca
saiu de lá. Este documento existe para que o desenho do sistema não dependa disso:

- **Se o código voltar**, ele é o checklist para revisar o que existe.
- **Se não voltar**, ele é a planta para reconstruir.

Não escolhe stack: o modelo de dados vale para qualquer coisa em cima de Postgres, e
os fluxos valem para qualquer linguagem.

## Índice

| Documento | Conteúdo |
|---|---|
| [modelo-de-dados.md](./modelo-de-dados.md) | As entidades, o DDL e as notas de modelagem |
| [fluxos.md](./fluxos.md) | Assistente de Reuniões, Smart Match e o funil do corretor |
| [privacidade.md](./privacidade.md) | Os três níveis de acesso como regra de banco, não de tela |
| [decisoes-em-aberto.md](./decisoes-em-aberto.md) | O que trava implementação e precisa de decisão |

---

## Os três princípios

### 1. Privacidade é estrutura, não tela

O escopo define três níveis de acesso (privado, Usuário Ouro, público no
ecossistema) e é explícito sobre o terceiro:

> Público no ecossistema MMM: informações disponíveis para todos os membros da
> plataforma; nesta hipótese não pode aparecer os dados pessoais do contato, só as
> oportunidades.

Se o servidor devolve o dado e a tela apenas não o exibe, o dado está exposto. Cada
nível precisa ser uma regra no banco e uma consulta própria. O desenho completo está
em [privacidade.md](./privacidade.md).

### 2. O Match só funciona sobre lista controlada

O exemplo do escopo: contato A possui mina de terras raras, contato B procura
fornecedor de terras raras. Isso só casa automaticamente se as duas pontas apontarem
para o mesmo item de uma lista compartilhada.

Com texto livre, `terras raras`, `terra rara` e `rare earth` são três coisas
diferentes e o cruzamento não encontra nada. Por isso existe a tabela
`taxonomia_item` e por isso `contato_atributo` referencia ela.

O texto livre continua existindo (ajuste A5), mas fica num campo separado, fora do
cruzamento, e alimenta a revisão periódica da lista.

### 2b. Parecença de palavra não é negócio — direção oposta é

"Exportar vinho" e "importar vinho" são quase o mesmo texto. Qualquer critério que
meça semelhança entre as duas põe esse par no topo — e o par oposto, que é onde
existe negócio, no mesmo balaio de duas exportadoras, que são concorrentes e nunca
devem ser apresentadas uma à outra.

**A direção nunca sai da semelhança do texto.** Ela vem do campo — `contato_atributo`
possui contra procura — e, quando a pessoa escreve um verbo, dela. Os dois podem se
contradizer: quem digita "procuro exportar vinho" está oferecendo, ainda que o texto
esteja no campo de procura, porque é assim que se fala. Nesse conflito a palavra
manda, e a regra tem duas metades que só funcionam juntas:

| ponta A | ponta B | resultado |
|---|---|---|
| possui *exportar* vinho | procura *exportar* vinho | **barrado** — concorrentes |
| possui *exportar* vinho | procura *importar* vinho | **100** — mesmo objeto, direções opostas |
| possui vinho | procura *importar* vinho | 100 — uma ponta neutra, comportamento de sempre |

A implementação está em [`shared/direcao-do-termo.ts`](../../shared/direcao-do-termo.ts)
e entra em `scoreMatch` **antes de qualquer outro critério**: nenhum outro pode
reapresentar quem foi barrado. As restrições da lista de verbos (só verbo, só na
cabeça do termo, só quando inequívoco) estão documentadas no próprio arquivo, e
existem porque a versão frouxa quebra matches legítimos que já funcionam.

É também o motivo de o critério semântico continuar desligado
(`server/match-service.ts`): ele decide justamente por parecença, que é o que
confunde "exportar" com "importar".

### 2c. Serviço só casa com necessidade declarada

Quem registra "Advocacia tributária" em *o que tenho* casava com meia rede: quase
toda empresa "poderia precisar" de um tributarista, e o motor tratava essa
necessidade presumida como se fosse declarada. A regra (pedido de 12/09/2026):
antes de qualquer cruzamento, cada item de *o que tenho* é classificado
(`shared/tipo-da-oferta.ts`) em serviço, produto, ativo, oportunidade,
investimento/capital, conexão/network, tecnologia, imóvel/infraestrutura ou outros —
e o item do tipo **serviço** só casa com uma necessidade que alguém DECLAROU em
*o que preciso*. A necessidade não precisa usar as mesmas palavras (equivalência
semântica é permitida), mas precisa existir.

| oferta | outro lado | resultado |
|---|---|---|
| serviços jurídicos tributários | procura "assessoria tributária para revisão da carga fiscal da empresa" | **match em todos** (desde 14/09): assessoria numa área da profissão é atendida por ela (`AREAS_DAS_PROFISSOES`); 100 no motor privado |
| serviços jurídicos tributários | indústria farmacêutica que procura "distribuidor para expansão na África" | **sem match** em todos — toda indústria tem impostos, mas ninguém declarou precisar; na IA, citar o distribuidor ou "indústria farmacêutica" é barrado |
| consultoria em internacionalização | empresa com operações internacionais que procura "investidor para ampliação da fábrica" | **sem match** em todos — operar fora não é procurar consultoria; na IA, citar a descrição da empresa ou o investidor é barrado |
| consultoria em internacionalização | procura "apoio para estruturar a entrada da minha empresa no Paraguai" | **match em todos** (desde 14/09): a necessidade declara o assunto (vocabulário curado); 60 no motor privado |
| advocacia tributária | procura "revisar nossos tributos e identificar créditos fiscais" | **match em todos** (desde 14/09), pelo assunto; 60 no motor privado |
| consultoria para registro de medicamentos | procura "suporte para obter autorização regulatória para comercializar nosso medicamento" | **match em todos** (desde 14/09), pelo assunto; 60 no motor privado |
| consultoria jurídica | procura "consultoria em marketing" | **sem match** em todos — a palavra é a mesma, o serviço não; na IA, a frase citada precisa pedir um serviço que o perfil oferece |

Não contam como necessidade: setor ou atividade econômica, porte, localização, cargo,
problemas típicos do segmento, obrigações legais, serviços "que seriam úteis",
necessidades prováveis. Essas informações só podem subir a nota de um match que já
passou pelo portão; nunca criá-lo. A restrição vale para serviço e só para serviço:
produtos, ativos, investimento, conexões etc. continuam casando como antes.

Onde ela mora: no motor privado (`scoreMatch`), a categoria em comum deixa de valer
para serviço — sobra tag, objeto e núcleo, que são exatamente "alguém nomeou o
serviço"; no motor de perfis (`server/matching.ts`), o par sustentado só por serviço
sem demanda expressa dá zero, não é gravado, e a leitura da lista esconde a linha
gravada antes da regra (sem apagá-la: a dispensa da dona sobrevive); nos dois prompts
por LLM de `routers/matching.ts`, o modelo classifica o item, cita o trecho literal do
título, das tags ou da descrição da oportunidade que declara a necessidade e
`server/portao-da-demanda-expressa.ts` confere a citação nesse texto (no máximo uma
palavra ausente) antes de exibir — e usa o classificador como piso: perfil que só tem
serviço e nada em "preciso" exige citação seja qual for o tipo que o modelo escreveu.
Prompt é pedido, a conferência é a garantia.

Dois cuidados vieram da revisão da regra em produção (13/09 e 14/09/2026: a #124 e a
correção por cima dela), e três revisões adversariais levaram à forma ESTRITA. A
categoria digitada continua decidindo o tipo quando o texto não decide — decisão do time
em 14/09; a categoria ser texto livre virou cartão próprio. **A mesma coisa escrita de
outro jeito é a mesma necessidade:** família (o lema: advocacia, consultoria, assessoria,
tradução...) e especialidade (lemas curados: tributário = tributarista = fiscal = tax =
ICMS) iguais dão 100 no motor privado e satisfazem o de perfis — também entre consultoria e
assessoria e no apoio que nomeia a profissão ("Assessoria jurídica tributária" diante de
"Advocacia tributária"), e quando os dois lados nomeiam a família e nada mais
("Contabilidade" e "Serviços contábeis" diante de "Contador"); a necessidade que nomeia só a
família ("Advogado" diante de "Advocacia tributária") vale 60. **Palavra igual não é serviço
igual, e na dúvida não casa:** o motor só afirma equivalência do que entende. Palavra
fora das listas precisa aparecer igual dos dois lados, e a oferta não pode ter palavra
desconhecida a mais: "Consultoria em segurança do trabalho" não atende "Consultoria
trabalhista", "Consultoria em seguros empresariais" não atende "Consultoria
empresarial". Na IA, o portão só barra a citação que nomeia um serviço entendido e
claramente diferente do que o perfil oferece ("consultoria em marketing" para
"Consultoria jurídica"); o que o texto não entende fica com o modelo
(`citacaoAmarradaAoPerfil`).

**Equivalência semântica sem IA nos motores determinísticos (14/09/2026, spec da Glenda).**
Duas pontes, ambas curadas e com teste negativo por entrada
(`server/demanda-expressa-exemplos-da-spec.test.ts`):
- *assessoria ou consultoria sobre área da profissão* (`AREAS_DAS_PROFISSOES` em
  `shared/tipo-da-oferta.ts`): "Assessoria tributária" é atendida pela advocacia e pela
  contabilidade que cobrem a área; áreas ambíguas (empresarial, imobiliária, ambiental, civil,
  financeira) ficam de fora, e quem nomeia outra profissão ("Contador tributário") segue sem casar;
- *assunto do serviço* (`necessidadeDeclaraOAssuntoDoServico`): tributário, internacionalização
  (internacionalizar, exportar, entrada ou expansão com destino em outro país — o Brasil e os
  estados não contam) e regulatório sanitário (agência sanitária, ou ato regulatório junto de
  medicamento, cosmético, saneante...). A necessidade tem de pedir ajuda ou uma ação (apoio,
  suporte, revisar, recuperar, obter, estruturar, entrar...), não pode nomear outro serviço, e o
  serviço oferecido tem de nomear o mesmo assunto numa família que o presta. "Exportar café",
  "Distribuidor para expansão na África", "Créditos tributários" e "Empresa brasileira com
  operações internacionais" não passam. Depois da ação, o resto do pedido também não pode pedir a
  contraparte ou o capital, lidos pela palavra que os rege ("ENTRADA DE investidor internacional",
  "OBTER capital para registro de medicamentos", "expandir VIA distribuidores"), nem registrar marca
  ou patente ("Registrar marca de cosméticos no INPI"); a contraparte como público do serviço
  ("planejamento tributário PARA investidores") e o crédito do fisco ("créditos DE ICMS") seguem
  passando. No portão da IA, a mesma leitura barra a citação antes do atalho do assunto. Vale 60 no motor privado, com o selo de significados
  parecidos; é base expressa no de perfis.

Na IA, o portão passou a barrar também a citação que pede CONTRAPARTE (distribuidor, comprador,
fornecedor, investidor; capital, produto, imóvel), a que só DESCREVE quem escreveu ("Indústria
farmacêutica") e a que pede um assunto do vocabulário que nenhum serviço do perfil presta. Não se
usa IA para confirmar equivalência nos motores determinísticos: o custo seria uma chamada por par
em cada recálculo, e a camada de IA que já existe (os prompts com citação conferida) é exatamente
"a IA confirma citando o trecho declarado, o código confere".

"O que você busca?" (12 opções desde 14/09, `shared/o-que-busca.ts`): nenhuma opção libera
serviço sozinha; "Serviço Especializado" é genérica e não é necessidade de serviço específico; o
texto de "Outra necessidade" é necessidade declarada e vale como *o que preciso* nos três motores.

Três lacunas medidas depois da #127 foram fechadas em 14/09/2026, com uma decisão de
produto junto:
- **Logística é serviço** (decisão do Nicolas, 14/09): logística, transporte, frete e
  armazenagem passam pelo portão, inclusive a opção fixa "Logística" de *o que tenho*,
  que segue atendendo quem declarou "Distribuidores" ou "Fornecedores". O bem físico
  continua sendo o bem: "Galpão logístico" e "Armazém" são imóvel, "Frota" é ativo,
  "Armazenamento" (dado, energia) é ativo. Consequência na rede de teste: "Armazenagem
  refrigerada" deixa de casar pela categoria com quem procura "Galpão alfandegado".
- **O classificador passa a ler** saúde (médico, clínica, fisioterapia, psicologia,
  enfermagem, odontologia, nutricionista, veterinária), "Tributarista", "Planejamento
  tributário", "Recuperação de créditos tributários", perícia, BPO, "Desenvolvimento de
  software", branding, "Social media", "Comércio exterior" e "Projeto arquitetônico" — que
  caíam em "outros" e casavam em 60 pela categoria digitada. Os adjetivos ("Equipamento
  médico", "Material odontológico") não arrastam produto para serviço. Os que não têm
  palavra de serviço (planejamento, desenvolvimento, projeto técnico, comércio exterior)
  são reconhecidos para serem barrados, mas não ganham família: casam só por slug, objeto
  ou núcleo.
- **No motor de perfis, a especialidade e a área de atuação contam como oferta** quando
  *o que tenho* está vazio — a mesma leitura que o portão da IA já fazia. A tela de
  cadastro não tem opção de serviço em *o que tenho*, então a advogada põe o serviço na
  especialidade, e o par passava pelas seis dimensões ("Advocacia tributária" na
  especialidade × farmacêutica que procura distribuidores dava 57 e era gravado).
- **Na IA, oportunidade que oferece serviço exige declaração que possa ser ele**, não só
  "alguma declaração" (`perfilDeclarouPrecisarDoServico`): contraparte comercial
  (distribuidores, compradores, fornecedores, investidores, parceiros), capital, produto,
  imóvel e outro serviço nomeado barram; o que o texto não entende fica com o modelo.

Limites aceitos e decisões pendentes (revisão adversarial de 13/09/2026):
- a categoria é texto livre e decide o tipo quando o texto não decide: "Cafeteira
  industrial" [Consultoria] vira serviço e cai no portão (decisão do time em 14/09; a
  causa raiz virou cartão próprio);
- a especialidade escrita de outro jeito só é lida em pt, en e es; nos outros 7 idiomas
  as listas reconhecem a família do serviço (#124), e a especialidade só casa escrita
  igual;
- "Consultoria jurídica" oferecida não atende a necessidade "Advogado" nos motores
  determinísticos ("Legal advisory" × "Lawyer" deixou de dar 100); na IA, fica com o
  modelo. O inverso, "Assessoria jurídica" pedida diante de "Advocacia" oferecida, atende
  com a nota da família;
- advocacia empresarial, societária e de contratos são áreas distintas para a regra
  ("Advocacia corporativa" é societária; fora da advocacia, corporativo é empresarial) —
  decisão pendente do time;
- em chinês e japonês só a família é lida: a oferta atende a necessidade genérica escrita
  em outro idioma ("律师" × "Advogado"), e nenhuma especialidade;
- na oferta, o público que leva a 100 diante da necessidade que só nomeia o serviço é o
  destinatário (pequenas empresas, MEI, PMEs, startups, pessoa física: `DESTINATARIOS_COMUNS`);
  setor, finalidade e grupo depois de "para" ("para restaurantes", "para exportação", "para
  fundadoras") ficam em 60, como a mesma especialidade escrita com "em" — lista de destinatários
  a confirmar com o Roberto (revisão de 15/09 na #127);
- "avocat" só é o advogado com qualificador jurídico ("Avocat fiscaliste", "Avocat d'affaires",
  "Cabinet d'avocats"); sem ele é o abacate, e a categoria decide ("Avocats Hass export
  international" [Fruits] casa pela categoria). "Conseil" e "conseiller" de órgão ("Conseil
  d'administration", "Conseiller municipal") não são a consultoria;
- boutique, casa, ateliê, studio, instituto e hub são a casa de quem presta só com o genitivo e o
  substantivo de serviço logo depois ("Boutique de advocacia tributária" × "Advogado tributarista"
  = 100, "Casa de consultoria" [Consultoria] × "Consultoria" = 100); "Boutique de joias de design"
  e "Casa de câmbio" seguem casando pela categoria, e "Hub" não decide a classificação pelo texto
  ("Hub logístico" e "Hub de logística" em [Imóveis] são o galpão). Cabeça fora dessa lista com o serviço
  depois do genitivo ("Escola de design" [Design]) segue sem leitura do serviço e é barrada diante
  do próprio profissional: ler qualquer cabeça faria "Peças de manutenção" procurada casar com
  "Manutenção de peças". A cabeça neutra colada depois do serviço também é quem presta ("Tax law
  firm" × "Tax lawyer" = 100);
- o adjetivo de serviço depois de cabeça desconhecida é lido ("Gestão contábil" [Contabilidade] ×
  "Contador" = 60), salvo quando a cabeça é o conceito que ele qualifica: "Pessoa jurídica",
  "Estrutura jurídica" e "Documento contábil" oferecidos com categoria de serviço são barrados;
- "estratégica" ao lado de especialidade reconhecida sai da oferta ("Advocacia tributária
  estratégica" × "Advogado tributarista" = 100); sozinha é o assunto, e "Consultoria tributária
  estratégica" × "Consultoria estratégica" = 0;
- o complemento da cabeça neutra é lido como a classificação o lê ("Empresa de gestão contábil"
  é contabilidade, e vale a nota da família diante de "Contador"); "Perícia contábil" é a
  família perícia, e não atende "Contador";
- casa, house, sala, loja, store, flat, vaga e cobertura não são imóvel na OFERTA (#124, 9615971 e
  d7fac93): "Vaga de emprego", "Casa de câmbio" e "Consulting house" com categoria de serviço
  caem no portão, como na main. Faltar palavra em imóvel só mantém o que havia; sobrar palavra
  tira o item do portão. No PEDIDO a conta é a oposta, e o portão da IA tem leitura própria da
  cabeça (`necessidadePedeImovel`): casa, loja e flat pedidos, sala comercial e vaga de garagem
  são imóvel e não sustentam serviço ("loja de rua no centro" citada, a demanda "Sala comercial
  de 40 m²"); "Casa de consultoria", "Casa de software", "Loja virtual", "Sala de reunião" e
  "Vaga de emprego" não;
- nos idiomas novos as listas leem a forma usual do profissional (femininos alemães em -in,
  "Kanzlei", "juriste", "traductrice", acusativo e genitivo russos, o artigo árabe colado,
  "مستشار", "लेखा"), mas a regra segue estrita: palavra de pedido que as listas não leem
  ("Steuerberaterin GESUCHT", "लेखाकार चाहिए") é especialidade desconhecida, e o par é barrado. A
  exceção da #127 para o que as listas não leem (`regraNaoLeOPar`, e6ddfa4), a leitura do chinês e
  do japonês pelo fim do termo (9e027bf, e6ddfa4, 0d6643d) e o selo "Mesmo serviço" (9e866b9) não
  foram portados para a #135 — decisão pendente do Roberto e do Nicolas (15/09): "税务咨询" ×
  "Consultoria tributária" e "Steuerberatung" × "Steuerberaterin gesucht" dão 0 aqui e 100 na #127,
  e o 100 pelo mesmo serviço aparece como "Tag exata";
- no motor privado, "Consultoria" digitada não é atendida por advocacia nem por
  contabilidade; no de perfis, a opção fixa "Consultoria" é atendida pela família da
  cabeça (advocacia, contabilidade, auditoria, mentoria, coaching);
- a regra estrita troca match falso por falso negativo: o mesmo serviço escrito com
  palavra que as listas não conhecem e só um lado usa ("Consultoria em exportação" ×
  "Consultoria em comércio exterior", "Contador para projeto aprovado na Lei Rouanet")
  não casa nos motores determinísticos, como antes da correção;
- na IA, citação de finalidade sem especialidade reconhecida ("Buscamos consultoria para
  aumentar vendas no Instagram"), especialidade que as listas não leem ("advogado de
  LGPD"), negação ("já temos consultoria jurídica") e autodescrição ("somos um escritório
  de advocacia") ficam com o modelo; só o assunto desconhecido de consultoria ou
  assessoria ("consultoria em e-commerce") barra diante de especialidade reconhecida, e a
  descrição estruturada com dois-pontos ("Precisamos de consultoria: marketing digital")
  ainda escapa.

### 3. Nada que a IA extrair entra sozinho

A etapa 3 manda a IA ler o áudio de uma reunião e sugerir contatos. Toda informação
extraída carrega a origem (o trecho da transcrição, a posição e a confiança), e nada
vira contato sem o usuário confirmar.

Modelos de linguagem geram texto plausível, inclusive dados que ninguém falou. A
origem permite conferir; a confirmação impede que o erro vire cadastro.

---

## Camadas

```
┌───────────────────────────────────────────────────────────┐
│  INTERFACE                                                │
│  App da usuária (celular)      │   Painel do corretor     │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│  APLICAÇÃO                                                │
│  Cadastro · Rede · Reuniões · Busca · Oportunidades       │
│  Toda regra de permissão é verificada AQUI e no banco.    │
└───────────────────────────────────────────────────────────┘
                            │
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Extração    │  Busca em    │  Motor de    │  Funil de    │
│  de reunião  │  linguagem   │  Match       │  oportuni-   │
│  (etapa 3)   │  natural     │  (etapa 7)   │  dades       │
│              │  (etapas 6,9)│              │  (etapa 12)  │
└──────────────┴──────────────┴──────────────┴──────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│  DADOS                                                    │
│  Postgres com regras de linha por usuário                 │
│  Storage cifrado (fotos, cartões, áudios)                 │
│  Taxonomia compartilhada · Log de auditoria append-only   │
└───────────────────────────────────────────────────────────┘
```

## Onde cada etapa encosta no modelo

| Etapa | Onde vive |
|---|---|
| 1. Base Particular de Contatos | `contato` |
| 2. Perfil Estratégico | `contato_atributo` + `taxonomia_item` |
| 3. Assistente de Reuniões | `reuniao`, `reuniao_transcricao`, `reuniao_extracao` |
| 4. Complementação Inteligente | campos vazios de `contato` + `contato_atributo` |
| 5. Organização por Contexto | `contexto`, `contexto_contato`, `contexto_arquivo` |
| 6. Memória Inteligente | consulta sobre `contato` + `contexto` + `contato_atributo` |
| 7. Match Inteligente | `match` sobre `contato_atributo` |
| 8. Privado + Coletivo | `contato.nivel_visibilidade` |
| 9. Pesquisa Inteligente | mesma base da etapa 6 |
| 10. Níveis de Acesso (Ouro) | `autorizacao_ouro`, `compartilhamento`, regras de linha |
| 11. Autorização Smart Match | `documento_versao`, `consentimento` |
| 12. Corretor de Negócios | `oportunidade`, `oportunidade_evento` |
| 13. Acordo de Intermediação | `documento_versao`, `oportunidade_parte` |

E os ajustes da reunião de 05/08:

| Ajuste | Onde vive |
|---|---|
| A1–A3 (áreas, mín. 1 máx. 5) | `perfil_membro_area` + `taxonomia_item` |
| A4 (gênero) | `perfil_membro.genero` |
| A5 (setor com texto livre) | `perfil_membro.setor_texto_livre` |
| A6–A7 (natureza, porte, CNPJ) | `perfil_membro` |
| A8 (presencial) | `perfil_membro.modalidades` |
| A9 (replicar bloco na página do que busca) | `contato_atributo.direcao` |
| A11 (contrato de comissão) | `documento_versao` + `consentimento` |
| A12 (destaque de produto) | sem entidade definida; o desenho depende da decisão D4 |
| A13 (bloquear contato direto) | `oportunidade_parte` + auditoria |
| A14 (dinheiro pela plataforma) | fora deste documento; ver decisoes-em-aberto.md |
