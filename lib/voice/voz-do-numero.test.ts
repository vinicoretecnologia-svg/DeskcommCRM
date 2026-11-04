import { describe, expect, it } from "vitest";

import { vozDoNumero, type VozPareada } from "./voz-do-numero";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const voz = (numeroDeMensagem: string | null, paired = true): VozPareada => ({
  id: `v-${numeroDeMensagem ?? "org"}`,
  numeroDeMensagem,
  status: paired ? "WORKING" : "STARTING",
  paired,
  jid: null,
});

describe("vozDoNumero — o que o botão Chamar mostra", () => {
  it("o número com voz própria pareada pode ligar", () => {
    expect(vozDoNumero([voz(A), voz(B)], A)).toEqual({ serve: true, pareada: true });
  });

  it("o número SEM voz própria não usa a de outro número", () => {
    expect(vozDoNumero([voz(A)], B)).toEqual({ serve: false, pareada: false });
  });

  it("o pareamento antigo (sem vínculo) serve a qualquer número", () => {
    expect(vozDoNumero([voz(null)], B)).toEqual({ serve: true, pareada: true });
  });

  it("voz própria ainda não pareada (QR por ler) não deixa ligar", () => {
    expect(vozDoNumero([voz(A, false)], A)).toEqual({ serve: true, pareada: false });
  });

  it("a voz própria vence a antiga, mesmo quando a antiga está pareada", () => {
    expect(vozDoNumero([voz(null, true), voz(A, false)], A)).toEqual({ serve: true, pareada: false });
  });

  it("sem número e com uma só voz, ela serve", () => {
    expect(vozDoNumero([voz(A)], null)).toEqual({ serve: true, pareada: true });
  });

  it("sem lista (resposta antiga ou ainda carregando): não afirma nada", () => {
    expect(vozDoNumero(undefined, A)).toEqual({ serve: false, pareada: false });
  });
});
