import { describe, expect, it, vi, beforeEach } from "vitest";
import { encryptData, decryptData, hashData } from "./security";

// security.ts exige JWT_SECRET no ambiente — definido aqui para o teste não depender do .env
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

// Mock do banco de dados para testes
vi.mock("./db", async () => {
  const { BancoIndisponivel } = await import("./banco-indisponivel");
  return {
    getDb: vi.fn().mockResolvedValue(null),
    exigirDb: vi.fn().mockRejectedValue(new BancoIndisponivel()),
    upsertUser: vi.fn(),
    getUserByOpenId: vi.fn(),
  };
});

describe("Cofre Digital - Criptografia", () => {
  it("deve criptografar e descriptografar dados corretamente", () => {
    const original = "dados-sensiveis-usuario@email.com";
    const encrypted = encryptData(original);
    const decrypted = decryptData(encrypted);

    expect(encrypted).not.toBe(original);
    expect(decrypted).toBe(original);
  });

  it("deve gerar texto criptografado diferente a cada chamada (IV único)", () => {
    const original = "mesmo-dado";
    const enc1 = encryptData(original);
    const enc2 = encryptData(original);

    // Cada criptografia deve ser única por causa do IV aleatório
    expect(enc1).not.toBe(enc2);
    // Mas ambas devem descriptografar para o mesmo valor
    expect(decryptData(enc1)).toBe(original);
    expect(decryptData(enc2)).toBe(original);
  });

  it("deve criptografar strings longas corretamente", () => {
    const longData = "a".repeat(1000);
    const encrypted = encryptData(longData);
    const decrypted = decryptData(encrypted);
    expect(decrypted).toBe(longData);
  });

  it("deve criptografar caracteres especiais e unicode", () => {
    const specialData = "Usuária: João & Maria <test@mmm.com> 🔒 Ação Corporativa";
    const encrypted = encryptData(specialData);
    const decrypted = decryptData(encrypted);
    expect(decrypted).toBe(specialData);
  });

  it("deve lançar erro ao descriptografar dado inválido", () => {
    expect(() => decryptData("dado-invalido-nao-criptografado")).toThrow();
  });

  // V-08: Teste para chave de criptografia separada do JWT_SECRET
  it("deve usar chave de criptografia diferente do JWT_SECRET puro", () => {
    const jwtSecret = process.env.JWT_SECRET!;
    const vaultData = "dado-sensivel-cofre";
    const encrypted = encryptData(vaultData);

    // O dado criptografado não deve conter o JWT_SECRET
    expect(encrypted).not.toContain(jwtSecret);
    // Deve descriptografar corretamente
    expect(decryptData(encrypted)).toBe(vaultData);
  });
});

describe("Cofre Digital - Hash de Dados", () => {
  it("deve gerar hash consistente para o mesmo input", () => {
    const data = "password123";
    const hash1 = hashData(data);
    const hash2 = hashData(data);
    expect(hash1).toBe(hash2);
  });

  it("deve gerar hashes diferentes para inputs diferentes", () => {
    const hash1 = hashData("password123");
    const hash2 = hashData("password456");
    expect(hash1).not.toBe(hash2);
  });

  it("deve gerar hash de 64 caracteres (SHA-256 hex)", () => {
    const hash = hashData("test-data");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});

describe("Cofre Digital - Segurança de Sessão", () => {
  it("deve verificar que dados criptografados não contêm o texto original", () => {
    const sensitiveEmail = "usuario@empresa.com";
    const encrypted = encryptData(sensitiveEmail);
    expect(encrypted).not.toContain(sensitiveEmail);
    expect(encrypted).not.toContain("usuario");
    expect(encrypted).not.toContain("empresa");
  });

  it("deve verificar que o hash não é reversível", () => {
    const password = "senha-secreta-123";
    const hash = hashData(password);
    // O hash não deve conter a senha original
    expect(hash).not.toContain(password);
    // O hash deve ser hexadecimal puro
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});

describe("Cofre Digital - Proteção contra Adulteração (V-08)", () => {
  it("deve detectar adulteração nos dados criptografados (authTag GCM)", () => {
    const original = "dado-integro";
    const encrypted = encryptData(original);

    // Adulterar o dado criptografado
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);

    // Modificar o último byte do dado criptografado
    const tamperedData = parts[2].slice(0, -2) + "ff";
    const tampered = `${parts[0]}:${parts[1]}:${tamperedData}`;

    // Deve lançar erro ao detectar adulteração (GCM authTag falha)
    expect(() => decryptData(tampered)).toThrow();
  });

  it("deve detectar adulteração no authTag", () => {
    const original = "dado-integro";
    const encrypted = encryptData(original);

    const parts = encrypted.split(":");
    // Modificar o authTag
    const tamperedAuthTag = "00000000000000000000000000000000";
    const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

    expect(() => decryptData(tampered)).toThrow();
  });
});
