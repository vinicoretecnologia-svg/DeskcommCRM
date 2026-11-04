import { describe, expect, it } from "vitest";

import {
  comAtendimentoAutomatico,
  ESPERA_MAX_S,
  esperaDaEmpresaMs,
  lerAtendimentoAutomatico,
  PAUSA_MAX_S,
  pausaDaEmpresaMs,
} from "./atendimento-automatico";

describe("lerAtendimentoAutomatico — ausente é como era antes", () => {
  it("settings vazio, nulo ou lixo: nada configurado e mídia ligada", () => {
    for (const s of [undefined, null, {}, [], "x", 3, { atendimento_ia: "x" }, { atendimento_ia: [] }]) {
      expect(lerAtendimentoAutomatico(s)).toEqual({ espera: null, pausa: null, midia: true });
    }
  });

  it("só o booleano false desliga a mídia", () => {
    expect(lerAtendimentoAutomatico({ atendimento_ia: { midia_ligada: false } }).midia).toBe(false);
    expect(lerAtendimentoAutomatico({ atendimento_ia: { midia_ligada: "false" } }).midia).toBe(true);
    expect(lerAtendimentoAutomatico({ atendimento_ia: { midia_ligada: 0 } }).midia).toBe(true);
  });

  it("espera e pausa exigem o booleano; segundos fora da faixa são limitados", () => {
    const a = lerAtendimentoAutomatico({
      atendimento_ia: { espera_ligada: true, espera_segundos: 9999, pausa_ligada: "sim", pausa_segundos: 5 },
    });
    expect(a.espera).toEqual({ ligada: true, segundos: ESPERA_MAX_S });
    expect(a.pausa).toBeNull();
  });
});

describe("comAtendimentoAutomatico", () => {
  it("preserva o resto de settings e mescla só o que veio", () => {
    const base = { plan: "pro", calls: { block_incoming: true }, atendimento_ia: { midia_ligada: false } };
    const novo = comAtendimentoAutomatico(base, { espera: { ligada: true, segundos: 10 } });
    expect(novo).toEqual({
      plan: "pro",
      calls: { block_incoming: true },
      atendimento_ia: { midia_ligada: false, espera_ligada: true, espera_segundos: 10 },
    });
  });

  it("limita os segundos e arredonda", () => {
    const n = comAtendimentoAutomatico({}, { espera: { ligada: true, segundos: 999 }, pausa: { ligada: true, segundos: 12.6 } });
    expect(lerAtendimentoAutomatico(n)).toMatchObject({
      espera: { ligada: true, segundos: ESPERA_MAX_S },
      pausa: { ligada: true, segundos: 13 },
    });
    const m = comAtendimentoAutomatico({}, { pausa: { ligada: true, segundos: PAUSA_MAX_S + 1 } });
    expect(lerAtendimentoAutomatico(m).pausa?.segundos).toBe(PAUSA_MAX_S);
  });

  it("segundos negativos ou inválidos viram 0", () => {
    const n = comAtendimentoAutomatico({}, { espera: { ligada: true, segundos: -4 } });
    expect(lerAtendimentoAutomatico(n).espera).toEqual({ ligada: true, segundos: 0 });
    const m = comAtendimentoAutomatico({}, { espera: { ligada: true, segundos: Number.NaN } });
    expect(lerAtendimentoAutomatico(m).espera).toEqual({ ligada: true, segundos: 0 });
  });

  it("ligar a mídia de volta grava true", () => {
    const off = comAtendimentoAutomatico({}, { midia: false });
    expect(lerAtendimentoAutomatico(off).midia).toBe(false);
    expect(lerAtendimentoAutomatico(comAtendimentoAutomatico(off, { midia: true })).midia).toBe(true);
  });
});

describe("o que o motor recebe", () => {
  it("nunca configurada: null (vale o agente e o padrão da instalação)", () => {
    const a = lerAtendimentoAutomatico({});
    expect(esperaDaEmpresaMs(a)).toBeNull();
    expect(pausaDaEmpresaMs(a)).toBeNull();
  });

  it("desligada: 0, e vence o campo do agente", () => {
    const a = lerAtendimentoAutomatico({ atendimento_ia: { espera_ligada: false, espera_segundos: 30, pausa_ligada: false } });
    expect(esperaDaEmpresaMs(a)).toBe(0);
    expect(pausaDaEmpresaMs(a)).toBe(0);
  });

  it("ligada: segundos em ms", () => {
    const a = lerAtendimentoAutomatico({ atendimento_ia: { espera_ligada: true, espera_segundos: 10, pausa_ligada: true, pausa_segundos: 20 } });
    expect(esperaDaEmpresaMs(a)).toBe(10_000);
    expect(pausaDaEmpresaMs(a)).toBe(20_000);
  });
});
