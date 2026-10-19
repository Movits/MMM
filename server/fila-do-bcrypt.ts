import { TRPCError } from "@trpc/server";

// ============================================================
// FILA DO BCRYPT
// ============================================================
// O bcrypt (bcryptjs, custo 12) é JavaScript puro e roda na mesma thread que
// atende todo o site. Numa instância de 0,5 CPU, uma rajada de cadastros e
// logins simultâneos — um único HTTP em lote do tRPC carrega centenas deles —
// ocupa a CPU e deixa todas as telas lentas. Medido numa máquina de
// desenvolvimento: ~210 ms por comparação, e 20 simultâneas travaram o laço de
// eventos por 2 s.
//
// Os tetos por rede (routers/auth.ts) limitam QUANTOS bcrypt uma rede dispara
// em 15 min, não QUANTOS AO MESMO TEMPO. Esta fila limita o segundo: poucas
// vagas simultâneas e uma espera curta; com a espera cheia, a pessoa recebe
// TOO_MANY_REQUESTS com a mensagem e tenta de novo em segundos, e o resto do
// site segue respondendo. Estado em memória: a instância é única.

export function criarFila(simultaneos: number, maximoNaEspera: number, mensagem: string) {
  let ocupadas = 0;
  const espera: Array<() => void> = [];

  return {
    async executar<T>(tarefa: () => Promise<T>): Promise<T> {
      if (ocupadas < simultaneos) {
        ocupadas += 1;
      } else {
        if (espera.length >= maximoNaEspera) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: mensagem });
        }
        // A vaga é passada direto por quem termina (ver `finally`): `ocupadas`
        // não muda, então ninguém que chega no meio fura a espera.
        await new Promise<void>(resolve => espera.push(resolve));
      }
      try {
        return await tarefa();
      } finally {
        const proxima = espera.shift();
        if (proxima) proxima();
        else ocupadas -= 1;
      }
    },
    /** Só para os testes e para o diagnóstico. */
    estado() {
      return { ocupadas, naEspera: espera.length };
    },
  };
}

/** 4 bcrypt ao mesmo tempo e até 50 esperando: ~1 minuto de fila no pior caso. */
export const BCRYPT_SIMULTANEOS = 4;
export const BCRYPT_MAXIMO_NA_ESPERA = 50;
export const MENSAGEM_FILA_DO_BCRYPT =
  "Muitas entradas e cadastros ao mesmo tempo. Aguarde alguns segundos e tente de novo.";

export const filaDoBcrypt = criarFila(BCRYPT_SIMULTANEOS, BCRYPT_MAXIMO_NA_ESPERA, MENSAGEM_FILA_DO_BCRYPT);
