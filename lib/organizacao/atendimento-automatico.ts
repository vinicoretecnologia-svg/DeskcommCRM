/**
 * "Atendimento automático" — as chaves simples da empresa para o jeito que a IA
 * responde: esperar antes de responder, pausar entre uma resposta e a próxima e
 * entender áudios e fotos.
 *
 * Mora em `organizations.settings.atendimento_ia`, sem tabela e sem migration,
 * no mesmo desenho de `bloqueio-de-chamadas.ts`: ESTE arquivo é o único que
 * conhece o caminho dentro do jsonb. Tela, ação, worker e motor passam por aqui.
 *
 * ⚠️ AUSENTE É "COMO ERA ANTES". Cada chave só passa a mandar depois que alguém
 * a mexe na tela:
 *   - espera/pausa nunca configuradas → `null`: vale o valor do agente e, na
 *     falta dele, o padrão da instalação. Quem só atualiza não muda de
 *     comportamento nenhum.
 *   - leitura de mídia nunca configurada → LIGADA (é como sempre foi).
 *
 * Quando a empresa mexe numa chave, o painel dela vence o campo do agente: o
 * cliente que desliga "Esperar antes de responder" espera que TODA IA dele pare
 * de esperar, não só as que não têm o campo preenchido.
 *
 * O resolvedor NUNCA lança: valor malformado cai em "não configurado". A leitura
 * roda no caminho quente do turno, e um throw ali derrubaria a resposta de todo
 * cliente da empresa.
 */

/** Teto da espera antes de responder (igual ao do agente, `TETO_DEBOUNCE_MS`). */
export const ESPERA_MAX_S = 60;
/** Teto da pausa entre respostas (igual ao do agente: 10 min). */
export const PAUSA_MAX_S = 600;
/** Valor sugerido quando a chave é ligada pela primeira vez. */
export const ESPERA_SUGERIDA_S = 8;
export const PAUSA_SUGERIDA_S = 10;

export interface ChaveComTempo {
  ligada: boolean;
  segundos: number;
}

export interface AtendimentoAutomatico {
  /** `null` = nunca configurada: vale o agente / o padrão da instalação. */
  espera: ChaveComTempo | null;
  /** `null` = nunca configurada: vale o agente (sem pausa por padrão). */
  pausa: ChaveComTempo | null;
  /** Entender áudios e fotos. Ligada por padrão. */
  midia: boolean;
}

export interface AtendimentoAutomaticoPatch {
  espera?: ChaveComTempo;
  pausa?: ChaveComTempo;
  midia?: boolean;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function inteiroNaFaixa(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(Math.max(Math.round(v), 0), max);
}

function chaveComTempo(bruto: Record<string, unknown>, nome: string, max: number): ChaveComTempo | null {
  const ligada = bruto[`${nome}_ligada`];
  if (typeof ligada !== "boolean") return null;
  const segundos = inteiroNaFaixa(bruto[`${nome}_segundos`], max);
  return { ligada, segundos: segundos ?? 0 };
}

/** Lê as chaves a partir de `organizations.settings` (ou de qualquer lixo). */
export function lerAtendimentoAutomatico(settings: unknown): AtendimentoAutomatico {
  const bruto = objeto(objeto(settings).atendimento_ia);
  return {
    espera: chaveComTempo(bruto, "espera", ESPERA_MAX_S),
    pausa: chaveComTempo(bruto, "pausa", PAUSA_MAX_S),
    // Só o booleano `false` desliga: ausente ou malformado é "como sempre foi".
    midia: bruto.midia_ligada !== false,
  };
}

/** `settings` com as chaves mescladas e limitadas, preservando tudo que não é nosso. */
export function comAtendimentoAutomatico(
  settings: unknown,
  patch: AtendimentoAutomaticoPatch,
): Record<string, unknown> {
  const base = objeto(settings);
  const atual = objeto(base.atendimento_ia);
  const novo: Record<string, unknown> = { ...atual };
  if (patch.espera) {
    novo.espera_ligada = patch.espera.ligada;
    novo.espera_segundos = inteiroNaFaixa(patch.espera.segundos, ESPERA_MAX_S) ?? 0;
  }
  if (patch.pausa) {
    novo.pausa_ligada = patch.pausa.ligada;
    novo.pausa_segundos = inteiroNaFaixa(patch.pausa.segundos, PAUSA_MAX_S) ?? 0;
  }
  if (typeof patch.midia === "boolean") novo.midia_ligada = patch.midia;
  return { ...base, atendimento_ia: novo };
}

/**
 * A espera da empresa em ms, para o motor: `null` quando nunca configurada (vale
 * o agente); `0` quando a empresa desligou (responde na hora); o valor quando ligada.
 */
export function esperaDaEmpresaMs(a: AtendimentoAutomatico): number | null {
  if (a.espera === null) return null;
  return a.espera.ligada ? a.espera.segundos * 1000 : 0;
}

/** Idem para a pausa entre respostas (desligada = sem pausa). */
export function pausaDaEmpresaMs(a: AtendimentoAutomatico): number | null {
  if (a.pausa === null) return null;
  return a.pausa.ligada ? a.pausa.segundos * 1000 : 0;
}
