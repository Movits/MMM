/**
 * Liga e desliga, no Dashboard, as duas seções com os números da plataforma
 * inteira: "A rede hoje" (pessoas cadastradas, oportunidades ativas, conexões
 * realizadas e países representados, de `stats.platform`) e "Membros por
 * nível" (Bronze, Prata e Ouro, de `stats.membrosPorNivel`).
 *
 * DESLIGADO a pedido do Rosber Severo (grupo, 16/09/2026, na véspera do
 * lançamento): "isso aí fica suspenso, oculto, até a gente ter números muito
 * atraentes. O de baixo também". Nada foi apagado: com `false` as seções não
 * são desenhadas e as duas consultas nem saem do navegador. Para religar: trocar
 * para `true` E apagar o primeiro teste de
 * Dashboard.numeros-da-rede-escondidos.test.tsx, o que prende o valor `false`
 * (sem isso o CI barra). Os testes das duas seções ligadas
 * (Dashboard.indicadores-da-plataforma e Dashboard.membros-por-nivel) e os do
 * estado desligado fixam a constante por vi.mock e seguem valendo.
 *
 * Nenhuma outra tela mostra esses números: a Home pública deixou de exibi-los
 * em 14/09 (ver Home.hero.test.tsx). Os procedimentos continuam no servidor —
 * `stats.platform` é público —, então esconder aqui não torna o número secreto.
 *
 * Vive num módulo próprio, e não dentro do Dashboard, para o teste conseguir
 * trocar o valor com vi.mock.
 */
export const MOSTRAR_NUMEROS_DA_REDE = false;
