/**
 * Espera e pausa EFETIVAS de um turno: o que o painel da empresa, o campo do
 * agente e o padrão da instalação decidem juntos.
 *
 * Ordem de quem manda (do mais forte para o mais fraco):
 *   1. o painel da EMPRESA (Configurações › Atendimento), se alguém mexeu na
 *      chave — ligada vale o tempo dela, desligada vale "sem espera/sem pausa";
 *   2. o campo da versão publicada do AGENTE;
 *   3. o padrão da INSTALAÇÃO (`INBOUND_DEBOUNCE_MS`) para a espera, e "sem
 *      pausa" para a pausa.
 *
 * Chave nunca mexida chega aqui como `null` e cai para o degrau de baixo: quem
 * só atualiza o produto não muda de comportamento nenhum.
 */
import type { AtendimentoAutomatico } from '@/lib/organizacao/atendimento-automatico';
import { esperaDaEmpresaMs, pausaDaEmpresaMs } from '@/lib/organizacao/atendimento-automatico';

import { debounceEfetivo } from './debounce';
import { intervaloEfetivo } from './intervalo-entre-respostas';

export interface ConfigParaAjustes {
  inboundDebounceMs: number | null;
  replyMinIntervalMs: number | null;
  atendimentoDaEmpresa?: AtendimentoAutomatico;
}

export interface AjustesEfetivos {
  debounceMs: number;
  intervaloEntreRespostasMs: number;
}

export function ajustesEfetivos(
  config: ConfigParaAjustes | null | undefined,
  padraoInstalacaoMs: number,
): AjustesEfetivos {
  const empresa = config?.atendimentoDaEmpresa;
  const esperaDaEmpresa = empresa ? esperaDaEmpresaMs(empresa) : null;
  const pausaDaEmpresa = empresa ? pausaDaEmpresaMs(empresa) : null;
  return {
    debounceMs: debounceEfetivo(esperaDaEmpresa ?? config?.inboundDebounceMs ?? null, padraoInstalacaoMs),
    intervaloEntreRespostasMs: intervaloEfetivo(pausaDaEmpresa ?? config?.replyMinIntervalMs ?? null),
  };
}
