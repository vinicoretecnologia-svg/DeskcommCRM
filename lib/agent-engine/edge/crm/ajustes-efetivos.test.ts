import { describe, expect, it } from 'vitest';

import { lerAtendimentoAutomatico } from '@/lib/organizacao/atendimento-automatico';

import { ajustesEfetivos } from './ajustes-efetivos';

const PADRAO = 8_000;
const empresa = (atendimento_ia: Record<string, unknown>) => lerAtendimentoAutomatico({ atendimento_ia });

describe('ajustesEfetivos — quem manda na espera e na pausa', () => {
  it('sem agente e sem painel: padrão da instalação e sem pausa', () => {
    expect(ajustesEfetivos(null, PADRAO)).toEqual({ debounceMs: PADRAO, intervaloEntreRespostasMs: 0 });
    expect(ajustesEfetivos(undefined, PADRAO)).toEqual({ debounceMs: PADRAO, intervaloEntreRespostasMs: 0 });
  });

  it('painel nunca mexido: vale o campo do agente (regressão zero)', () => {
    const r = ajustesEfetivos(
      { inboundDebounceMs: 5_000, replyMinIntervalMs: 20_000, atendimentoDaEmpresa: empresa({}) },
      PADRAO,
    );
    expect(r).toEqual({ debounceMs: 5_000, intervaloEntreRespostasMs: 20_000 });
  });

  it('agente sem campo e painel nunca mexido: padrão da instalação', () => {
    const r = ajustesEfetivos(
      { inboundDebounceMs: null, replyMinIntervalMs: null, atendimentoDaEmpresa: empresa({}) },
      PADRAO,
    );
    expect(r).toEqual({ debounceMs: PADRAO, intervaloEntreRespostasMs: 0 });
  });

  it('painel ligado vence o campo do agente', () => {
    const r = ajustesEfetivos(
      {
        inboundDebounceMs: 5_000,
        replyMinIntervalMs: 20_000,
        atendimentoDaEmpresa: empresa({ espera_ligada: true, espera_segundos: 10, pausa_ligada: true, pausa_segundos: 30 }),
      },
      PADRAO,
    );
    expect(r).toEqual({ debounceMs: 10_000, intervaloEntreRespostasMs: 30_000 });
  });

  it('painel DESLIGADO vence o campo do agente: sem espera e sem pausa', () => {
    const r = ajustesEfetivos(
      {
        inboundDebounceMs: 5_000,
        replyMinIntervalMs: 20_000,
        atendimentoDaEmpresa: empresa({ espera_ligada: false, espera_segundos: 10, pausa_ligada: false, pausa_segundos: 30 }),
      },
      PADRAO,
    );
    expect(r).toEqual({ debounceMs: 0, intervaloEntreRespostasMs: 0 });
  });

  it('cada chave é independente: só a espera mexida, a pausa segue o agente', () => {
    const r = ajustesEfetivos(
      {
        inboundDebounceMs: null,
        replyMinIntervalMs: 15_000,
        atendimentoDaEmpresa: empresa({ espera_ligada: true, espera_segundos: 3 }),
      },
      PADRAO,
    );
    expect(r).toEqual({ debounceMs: 3_000, intervaloEntreRespostasMs: 15_000 });
  });

  it('nenhum valor passa do teto, nem o que vem do painel', () => {
    const r = ajustesEfetivos(
      { inboundDebounceMs: null, replyMinIntervalMs: null, atendimentoDaEmpresa: empresa({ espera_ligada: true, espera_segundos: 60, pausa_ligada: true, pausa_segundos: 600 }) },
      PADRAO,
    );
    expect(r.debounceMs).toBeLessThanOrEqual(60_000);
    expect(r.intervaloEntreRespostasMs).toBeLessThanOrEqual(600_000);
  });
});
