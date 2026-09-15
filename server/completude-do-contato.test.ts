import { describe, expect, it } from "vitest";
import { CAMPOS_DA_COMPLETUDE, camposFaltantes, contatoCompleto } from "../shared/completude-do-contato";

/**
 * Meu Network Inteligente — a régua de completude (pedido do Nicolas,
 * 13/09/2026, itens 6 a 10). É a mesma função no painel (servidor) e no
 * alerta do contato (tela): o que se trava aqui vale para os dois.
 */

const completo = {
  fullName: "Maria Silva",
  phone: "+55 11 99999-0000",
  whatsapp: null,
  email: "maria@empresa.com",
  totalTenho: 1,
  totalPreciso: 2,
};

describe("completude do contato — Quem Sou, O Que Tenho, O Que Preciso", () => {
  it("nome, telefone, e-mail, ao menos 1 tenho e 1 preciso: completo, nada faltando", () => {
    expect(camposFaltantes(completo)).toEqual([]);
    expect(contatoCompleto(completo)).toBe(true);
  });

  it("o exemplo do pedido: telefone faltando e O Que Preciso vazio geram o alerta, mesmo com e-mail", () => {
    const contato = { ...completo, phone: null, totalPreciso: 0 };
    expect(camposFaltantes(contato)).toEqual(["telefone", "preciso"]);
    expect(contatoCompleto(contato)).toBe(false);
  });

  it("WhatsApp conta como telefone", () => {
    expect(camposFaltantes({ ...completo, phone: null, whatsapp: "+55 21 98888-0000" })).toEqual([]);
  });

  it("espaço em branco não é dado", () => {
    expect(camposFaltantes({ ...completo, fullName: "   ", phone: " ", whatsapp: "\t", email: "  " }))
      .toEqual(["nome", "telefone", "email"]);
  });

  it("contato só com nome: faltam os outros quatro, sempre na ordem de CAMPOS_DA_COMPLETUDE", () => {
    const faltando = camposFaltantes({ fullName: "Farmabras Distribuidora Ltda.", totalTenho: 0, totalPreciso: 0 });
    expect(faltando).toEqual(["telefone", "email", "tenho", "preciso"]);
    expect(CAMPOS_DA_COMPLETUDE).toEqual(["nome", "telefone", "email", "tenho", "preciso"]);
  });

  it("só diz o que falta: não altera nem completa o contato recebido", () => {
    const contato = Object.freeze({ ...completo, email: null, totalTenho: 0 });
    expect(camposFaltantes(contato)).toEqual(["email", "tenho"]);
    expect(contato).toEqual({ ...completo, email: null, totalTenho: 0 });
  });
});
