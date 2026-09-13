import { protectedProcedure, router } from "../_core/trpc";
import { resumoDoNetworkInteligente } from "../network-inteligente";
import { hasValidConsent } from "./consent";

/**
 * Meu Network Inteligente — painel da rede particular (pedido do Nicolas,
 * 13/09/2026). Só leitura, só da própria dona.
 *
 * O termo do Smart Match é lido aqui e passado adiante: sem ele o resumo não
 * conta as sugestões entre contatos. Recusar o termo desliga o cruzamento, e o
 * painel não pode mostrar o que a tela de Conexões Inteligentes esconde. O
 * resto do painel (reuniões, contatos, completude) é dado da agenda e não
 * depende do termo, como a Minha Rede.
 */
export const networkInteligenteRouter = router({
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const termoSmartMatch = await hasValidConsent(ctx.user.id, "termo_smart_match");
    return resumoDoNetworkInteligente(ctx.user.openId, { termoSmartMatch });
  }),
});
