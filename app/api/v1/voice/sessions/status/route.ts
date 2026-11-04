/**
 * GET /api/v1/voice/sessions/status — estado do pareamento de chamada de voz
 * da organização ativa. Usado pelo discador (§5.1 da spec) pra decidir se
 * mostra o botão "Ligar".
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { listarSessoesDeVoz } from "@/lib/wacalls/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) return new Response(null, { status: 401 });
  const ativa = await orgAtivaDaApi(user, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) return new Response(null, { status: 403 });

  const supabase = await createClient();
  // Uma linha de voz por número de mensagem (migration 9105). Os campos de topo
  // seguem existindo para quem ainda lê o formato antigo, e dizem "alguma voz":
  // a linha antiga (sem vínculo) tem prioridade, senão a primeira pareada.
  const linhas = await listarSessoesDeVoz(supabase, activeOrg.orgId);
  const row =
    linhas.find((l) => l.voice_for_channel_session_id === null) ??
    linhas.find((l) => !!l.wacalls_paired_at) ??
    linhas[0] ??
    null;

  return ok(
    {
      configured: linhas.length > 0,
      channelSessionId: row?.id ?? null,
      status: row?.status ?? null,
      paired: linhas.some((l) => !!l.wacalls_paired_at),
      jid: row?.wacalls_jid ?? null,
      // Estado por número: é o que o botão "Chamar" e a tela de Conexões leem.
      // `numeroDeMensagem` null = voz da organização inteira (pareamento antigo).
      sessions: linhas.map((l) => ({
        id: l.id,
        numeroDeMensagem: l.voice_for_channel_session_id,
        status: l.status,
        paired: !!l.wacalls_paired_at,
        jid: l.wacalls_jid,
      })),
    },
    { requestId },
  );
}
