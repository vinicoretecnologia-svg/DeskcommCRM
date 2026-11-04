/**
 * DELETE /api/v1/voice/sessions — desconecta a chamada de voz desta organização.
 *
 * A metade que faltava do par. Havia `POST .../sessions/pair` e nada do outro
 * lado: `logoutSession`/`deleteSession` existiam no cliente e nenhuma rota os
 * chamava. Sem esta rota, quem pareasse um segundo aparelho no número da
 * empresa não tinha caminho de volta pela tela.
 *
 * ═══ POR QUE ADMIN, E POR QUE NÃO EXIGE A FEATURE LIGADA ═══
 *
 * `admin` porque parear é `admin` — e porque desconectar o canal de voz da
 * empresa não é ação de quem atende.
 *
 * Mas esta rota NÃO checa `org_voice_calls.enabled`. É deliberado: exigir a
 * feature ligada para conseguir desligá-la é a armadilha clássica de quem põe o
 * gate no lugar errado — bastaria a flag cair por qualquer motivo para o
 * aparelho ficar vinculado sem caminho de volta. A porta de saída nunca depende
 * do interruptor.
 *
 * O ato em si vive em `lib/voice/desparear.ts`, compartilhado com o PUT de
 * `/api/v1/voice/opt-in` — desligar a feature pela tela precisa desconectar de
 * verdade, e não podem ser dois códigos que divergem.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { despareaVoz } from "@/lib/voice/desparear";
import { getWacallsClient, wacallsFriendlyError } from "@/lib/wacalls/client";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  const requestId = randomUUID();

  // `?id=<linha de voz>` desconecta SÓ aquele número (migration 9105). Sem o
  // parâmetro, desconecta todos — é o que "desligar a voz" precisa. O id é
  // re-validado: `despareaVoz` só alcança linhas de voz DESTA organização.
  const idDaLinha = new URL(req.url).searchParams.get("id");
  if (idDaLinha !== null && !/^[0-9a-f-]{36}$/i.test(idDaLinha)) {
    return fail("invalid_request", "Identificador de número inválido.", 400, { requestId });
  }

  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const wacalls = getWacallsClient();
  if (!wacalls) {
    // 503, e não "arquiva assim mesmo": sem o serviço não há como derrubar o
    // vínculo, e marcar a linha como desconectada aqui diria à tela que o
    // aparelho saiu quando ele continua lá.
    return fail(
      "voice_indisponivel_na_instalacao",
      t(
        "A chamada de voz não está disponível neste servidor — sem ela o aparelho não pode ser desconectado.",
      ),
      503,
      { requestId },
    );
  }

  const supabase = await createClient();
  try {
    const resultado = await despareaVoz(supabase, wacalls, org.orgId, idDaLinha);

    if (resultado.desapareado) {
      void audit({
        action: "voice.session_unpaired",
        actorUserId: user.id,
        organizationId: org.orgId,
        resourceType: "channel_session",
        resourceId: resultado.channelSessionId,
        requestId,
        metadata: { origem: "rota", ...(idDaLinha ? { linha_de_voz: idDaLinha } : {}) },
      });
    }

    return ok(resultado, { requestId });
  } catch (err) {
    logger.error("wacalls: desparear falhou", {
      request_id: requestId,
      organization_id: org.orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("wacalls_error", wacallsFriendlyError(err), 502, { requestId });
  }
}
