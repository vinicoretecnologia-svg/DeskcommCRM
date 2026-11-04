/**
 * Resolve a sessão WaCalls pareada de uma organização — helper compartilhado
 * pelas rotas `app/api/v1/voice/*`. Nunca aceita `channel_session_id`/
 * `wacalls_session_id` vindo do body: sempre relido do banco, escopado pela
 * org da sessão autenticada.
 *
 * ═══ UMA VOZ POR NÚMERO (migration 9105) ═══
 *
 * A voz era "uma por organização" e a busca usava `maybeSingle()`: empresa com
 * dois números só ligava por um. Agora cada aparelho de voz pode apontar, em
 * `voice_for_channel_session_id`, para o número de mensagem que ele atende, e a
 * escolha mora em `escolherSessaoDeVoz` — função pura, testável sem banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WacallsSessionRow {
  channelSessionId: string;
  wacallsSessionId: string;
  /** Número de mensagem que este aparelho atende; `null` = voz da organização inteira (pareamento antigo). */
  voiceForChannelSessionId: string | null;
}

export interface LinhaDeVoz {
  id: string;
  wacalls_session_id: string | null;
  voice_for_channel_session_id: string | null;
  status: string;
  wacalls_jid: string | null;
  wacalls_paired_at: string | null;
}

type LinhaMinima = Pick<LinhaDeVoz, "id" | "wacalls_session_id" | "voice_for_channel_session_id">;

/**
 * Qual das sessões de voz da organização serve a esta ligação.
 *
 * Com `numeroDeMensagem` (o canal da conversa em que o atendente clicou):
 *   1. o aparelho de voz vinculado a ESSE número;
 *   2. senão o legado, sem vínculo (a voz da organização inteira);
 *   3. senão nada. **Nunca** o aparelho de OUTRO número: ligar pelo número
 *      errado é pior do que não ligar — o cliente vê um número que nunca o
 *      atendeu.
 *
 * Sem `numeroDeMensagem` (chamada recebida, status geral): o legado, e, na falta
 * dele, a única sessão que existir. Havendo várias vinculadas e nenhuma legada,
 * a pergunta é ambígua e a resposta é `null`, não um palpite.
 */
export function escolherSessaoDeVoz(
  linhas: readonly LinhaMinima[],
  numeroDeMensagem?: string | null,
): WacallsSessionRow | null {
  const vivas = linhas.filter((l) => !!l.wacalls_session_id);
  const legado = vivas.find((l) => l.voice_for_channel_session_id === null) ?? null;

  let escolhida: LinhaMinima | null;
  if (numeroDeMensagem) {
    escolhida = vivas.find((l) => l.voice_for_channel_session_id === numeroDeMensagem) ?? legado;
  } else {
    escolhida = legado ?? (vivas.length === 1 ? vivas[0]! : null);
  }
  if (!escolhida?.wacalls_session_id) return null;
  return {
    channelSessionId: escolhida.id,
    wacallsSessionId: escolhida.wacalls_session_id,
    voiceForChannelSessionId: escolhida.voice_for_channel_session_id,
  };
}

/** Todas as linhas de voz vivas da organização — uma por número pareado. */
export async function listarSessoesDeVoz(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
): Promise<LinhaDeVoz[]> {
  const { data } = await supabase
    .from("channel_sessions")
    .select("id, wacalls_session_id, voice_for_channel_session_id, status, wacalls_jid, wacalls_paired_at")
    .eq("organization_id", organizationId)
    .eq("provider", "wacalls")
    .is("archived_at", null);
  return (data ?? []) as LinhaDeVoz[];
}

export async function resolveWacallsSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
  /** O número de mensagem da conversa. Vem do banco (a conversa lida), nunca do body cru. */
  numeroDeMensagem?: string | null,
): Promise<WacallsSessionRow | null> {
  const linhas = await listarSessoesDeVoz(supabase, organizationId);
  return escolherSessaoDeVoz(linhas, numeroDeMensagem);
}
