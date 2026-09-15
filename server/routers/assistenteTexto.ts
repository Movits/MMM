import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  LIMITE_AUDIO_DITADO_BASE64,
  LIMITE_TEXTO_REVISAO,
  revisarTexto,
  tetoDeDitado,
  tetoDeRevisao,
  transcreverDitado,
} from "../assistente-de-texto";
import { ALLOWED_MEETING_AUDIO_TYPES } from "../meeting-service";

/**
 * Botões "Gravar áudio" e "Revisar texto" dos campos livres. Nenhum dos dois
 * grava nada: devolvem texto para a tela, que o põe no campo (ditado) ou o
 * oferece como sugestão (revisão). Quem salva é o formulário, quando a pessoa
 * confirma. Detalhes e limites em server/assistente-de-texto.ts.
 */
export const assistenteTextoRouter = router({
  revisar: protectedProcedure
    .input(z.object({ texto: z.string().max(LIMITE_TEXTO_REVISAO) }))
    .mutation(async ({ ctx, input }) => {
      if (input.texto.trim().length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Escreva algo antes de pedir a revisão." });
      }
      tetoDeRevisao.reservar(String(ctx.user.id));
      return revisarTexto(input.texto);
    }),

  transcrever: protectedProcedure
    .input(z.object({
      audioBase64: z.string().min(20).max(LIMITE_AUDIO_DITADO_BASE64),
      mimeType: z.enum(ALLOWED_MEETING_AUDIO_TYPES),
      idioma: z.string().min(2).max(12).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      tetoDeDitado.reservar(String(ctx.user.id));
      return transcreverDitado(input);
    }),
});
