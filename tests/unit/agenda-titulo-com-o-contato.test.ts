import { describe, expect, it } from "vitest";

import { tituloComOContato } from "@/app/api/v1/agenda/agendamentos/_handler";

describe("título do agendamento leva o nome de quem vem", () => {
  it("acrescenta o nome ao título do tipo", () => {
    expect(tituloComOContato("Avaliação física", "Tiago Vinicius")).toBe(
      "Avaliação física — Tiago Vinicius",
    );
  });

  it("não repete o nome quando o título já o traz, em qualquer caixa", () => {
    expect(tituloComOContato("Avaliação física - Tiago Vinicius", "Tiago Vinicius")).toBe(
      "Avaliação física - Tiago Vinicius",
    );
    expect(tituloComOContato("avaliação de TIAGO VINICIUS", "Tiago Vinicius")).toBe(
      "avaliação de TIAGO VINICIUS",
    );
  });

  it("sem nome (ou contato anonimizado, que chega como null) deixa o título como veio", () => {
    expect(tituloComOContato("Avaliação física", null)).toBe("Avaliação física");
    expect(tituloComOContato("Avaliação física", "   ")).toBe("Avaliação física");
  });

  it("cabe em 200 caracteres cortando o título, nunca o nome", () => {
    const t = tituloComOContato("x".repeat(200), "Tiago Vinicius");
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t.endsWith(" — Tiago Vinicius")).toBe(true);
  });
});
