import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  BCRYPT_MAXIMO_NA_ESPERA,
  BCRYPT_SIMULTANEOS,
  criarFila,
  MENSAGEM_FILA_DO_BCRYPT,
} from "./fila-do-bcrypt";

/**
 * A fila do bcrypt: poucas vagas simultâneas, espera curta, e TOO_MANY_REQUESTS
 * com mensagem quando a espera enche. Um bcrypt de custo 12 ocupa a thread que
 * atende o site inteiro; uma rajada (um HTTP em lote do tRPC basta) deixava
 * todas as telas lentas numa instância de 0,5 CPU.
 */

/** Uma tarefa que só termina quando o teste manda. */
function tarefaControlada<T>(valor: T) {
  let terminar!: () => void;
  let falhar!: (erro: Error) => void;
  let comecou = false;
  const executar = () =>
    new Promise<T>((resolve, reject) => {
      comecou = true;
      terminar = () => resolve(valor);
      falhar = reject;
    });
  return {
    executar,
    terminar: () => terminar(),
    falhar: (erro: Error) => falhar(erro),
    comecou: () => comecou,
  };
}

const umaVolta = () => new Promise(resolve => setImmediate(resolve));

describe("fila do bcrypt", () => {
  it("os valores: 4 simultâneos e 50 na espera", () => {
    expect(BCRYPT_SIMULTANEOS).toBe(4);
    expect(BCRYPT_MAXIMO_NA_ESPERA).toBe(50);
  });

  it("roda no máximo N ao mesmo tempo; quem espera entra quando alguém termina, na ordem de chegada", async () => {
    const fila = criarFila(2, 10, "cheia");
    const tarefas = [1, 2, 3, 4].map(n => tarefaControlada(n));
    const resultados = tarefas.map(t => fila.executar(t.executar));
    await umaVolta();

    expect(tarefas.map(t => t.comecou())).toEqual([true, true, false, false]);
    expect(fila.estado()).toEqual({ ocupadas: 2, naEspera: 2 });

    tarefas[1].terminar();
    await umaVolta();
    expect(tarefas.map(t => t.comecou())).toEqual([true, true, true, false]);
    expect(fila.estado()).toEqual({ ocupadas: 2, naEspera: 1 });

    tarefas[0].terminar();
    tarefas[2].terminar();
    await umaVolta();
    tarefas[3].terminar();
    expect(await Promise.all(resultados)).toEqual([1, 2, 3, 4]);
    expect(fila.estado()).toEqual({ ocupadas: 0, naEspera: 0 });
  });

  it("com a espera cheia, recusa na hora com TOO_MANY_REQUESTS e a mensagem, sem rodar a tarefa", async () => {
    const fila = criarFila(1, 2, MENSAGEM_FILA_DO_BCRYPT);
    const tarefas = [1, 2, 3].map(n => tarefaControlada(n));
    const aceitas = tarefas.map(t => fila.executar(t.executar));
    await umaVolta();

    let rodou = false;
    const erro = await fila
      .executar(async () => {
        rodou = true;
      })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(TRPCError);
    expect((erro as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect((erro as TRPCError).message).toBe(MENSAGEM_FILA_DO_BCRYPT);
    expect(rodou).toBe(false);

    for (const t of tarefas) {
      t.terminar();
      await umaVolta();
    }
    expect(await Promise.all(aceitas)).toEqual([1, 2, 3]);
  });

  it("tarefa que falha devolve a vaga (sem isso, 4 erros travariam o login para sempre)", async () => {
    const fila = criarFila(1, 5, "cheia");
    const primeira = tarefaControlada(1);
    const segunda = tarefaControlada(2);
    const p1 = fila.executar(primeira.executar).catch((e: Error) => e.message);
    const p2 = fila.executar(segunda.executar);
    await umaVolta();

    primeira.falhar(new Error("bcrypt quebrou"));
    expect(await p1).toBe("bcrypt quebrou");
    await umaVolta();
    expect(segunda.comecou()).toBe(true);
    segunda.terminar();
    expect(await p2).toBe(2);
    expect(fila.estado()).toEqual({ ocupadas: 0, naEspera: 0 });

    // E a fila segue aceitando depois.
    await expect(fila.executar(async () => "de novo")).resolves.toBe("de novo");
  });
});
