/**
 * Cadastro só para maiores de 18 anos.
 *
 * O Termo Geral de Uso publicado diz, na cláusula 3.4
 * (docs/termos/termo-geral-de-uso.md), por inteiro: "O USUÁRIO pessoa física
 * deve ser maior de 18 (dezoito) anos ou, quando aplicável, plenamente capaz nos
 * termos da legislação civil, sendo a PLATAFORMA destinada exclusivamente a
 * maiores de idade, ressalvada indicação expressa em sentido diverso." O sistema
 * dizia outra coisa: o campo de idade saiu da tela em 14/09 e o servidor
 * aceitava idade a partir de 16. O Roberto pediu, em 16/09: "Corrija o sistema
 * para 18 anos".
 *
 * O sistema aplica a primeira parte e só ela: 18 anos. A emancipada de 16 ou
 * 17 anos, que o "plenamente capaz nos termos da legislação civil" parece
 * admitir, não conclui o cadastro. Se o jurídico quiser cobri-la, muda o texto
 * da declaração e esta regra.
 *
 * A regra tem duas metades, as duas no servidor (server/maioridade.ts e
 * `profile.completeOnboarding`):
 *   1. idade, quando enviada, vale de IDADE_MINIMA para cima;
 *   2. concluir o cadastro exige a declaração explícita de maioridade — a caixa
 *      "Declaro que tenho 18 anos ou mais." da última etapa, ao lado do aceite
 *      do Termo. A tela não pede idade, então a declaração é o que existe.
 *
 * As mensagens moram aqui, e não só no servidor, porque a tela do cadastro
 * reconhece a recusa pela mensagem e mostra o texto traduzido
 * (`termoGeral.maioridadeRecusada`) no lugar dela.
 */
export const IDADE_MINIMA = 18;

/**
 * Recusa de `completeOnboarding` sem `declaraMaioridade: true`. A última frase
 * é para quem está com a tela antiga em cache durante o deploy: ela não tem a
 * caixa, e só recarregar a traz.
 */
export const MENSAGEM_MAIORIDADE_NAO_DECLARADA =
  "Para concluir o cadastro, declare que tem 18 anos ou mais: a plataforma é exclusiva para maiores de idade (cláusula 3.4 do Termo Geral de Uso). Se a caixa da declaração não aparece na última etapa, recarregue a página.";

export const MENSAGEM_IDADE_ABAIXO_DO_MINIMO =
  "A plataforma é exclusiva para maiores de 18 anos (cláusula 3.4 do Termo Geral de Uso).";
