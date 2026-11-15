/**
 * /api/v1/channels/social/direta — a CONEXÃO DIRETA das redes sociais
 * (Instagram Direct e Messenger da Página, sem intermediário).
 *
 *   GET  — se a instalação permite a conexão e quais contas desta organização
 *          estão ligadas. Nunca devolve token nem segredo.
 *   POST — `{ action: "health", channel_id }` confere a conta na plataforma;
 *          `{ action: "remove", channel_id }` tira a conta do atendimento
 *          (arquiva: as conversas ficam).
 *
 * Conectar não é POST daqui: é navegação (`./entrar` → plataforma → `./retorno`),
 * porque o consentimento é uma tela da plataforma.
 *
 * Piso de papel `admin`, como o resto de Conexões › Redes sociais. A organização
 * vem da sessão (cookie), nunca do corpo; a sessão de canal é lida filtrando
 * `organization_id`, e um `channel_id` de outra organização responde 404.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { requireRole } from "@/lib/auth/require-role";
import { mfaEmDivida } from "@/lib/auth/server";
import { socialDiretaAdapter } from "@/lib/channels/social/direta/adapter";
import { appDaPortaDireta, portaDiretaDisponivel } from "@/lib/channels/social/direta/app";
import { contaDaSessaoDireta, contasDiretas, removerContaDireta } from "@/lib/channels/social/direta/conexao";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpo = z.discriminatedUnion("action", [
  z.object({ action: z.literal("health"), channel_id: z.uuid() }).strict(),
  z.object({ action: z.literal("remove"), channel_id: z.uuid() }).strict(),
]);

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "social_connections" });
  if (!auth.ok) return auth.response;
  try {
    const app = await appDaPortaDireta();
    const contas = await contasDiretas(createAdminClient(), auth.org.orgId);
    return ok({ disponivel: portaDiretaDisponivel(app), contas }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler as contas conectadas.", 500, { requestId });
  }
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const support = await requireSupportWrite();
  if (support) return support;
  const auth = await requireRole("admin", { requestId, resource: "social_connections" });
  if (!auth.ok) return auth.response;
  if (await mfaEmDivida()) {
    return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  }
  const lido = corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_error", "Confira os dados da conexão.", 400, { requestId });
  const limite = await checkRateLimit(`social-direta:${auth.org.orgId}`, 20, 60);
  if (!limite.allowed) {
    return fail("rate_limited", "Aguarde um minuto antes de tentar novamente.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }
  const db = createAdminClient();
  const body = lido.data;
  try {
    const conta = await contaDaSessaoDireta(db, auth.org.orgId, body.channel_id);
    if (!conta) return fail("not_found", "Conta não encontrada nesta organização.", 404, { requestId });

    if (body.action === "health") {
      const saude = await socialDiretaAdapter.checkHealth!({ organizationId: auth.org.orgId, sessionRef: conta });
      return ok({ status: saude.status === "WORKING" ? "healthy" : "attention", detail: saude.detail }, { requestId });
    }

    const r = await removerContaDireta(db, auth.org.orgId, body.channel_id);
    void audit({
      action: "channel.social_disconnected",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "social_connections",
      resourceId: body.channel_id,
      requestId,
      metadata: { operation: "remove", porta: "direta", ...r },
    });
    return ok(r, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível concluir a operação. Tente novamente.", 500, { requestId });
  }
}
