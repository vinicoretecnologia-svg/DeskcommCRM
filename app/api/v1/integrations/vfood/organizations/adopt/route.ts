/**
 * POST /api/v1/integrations/vfood/organizations/adopt — regularização ADMINISTRATIVA e explícita: vincula a um
 * restaurante do VFood uma organização que já existia (criada à mão) e que ainda não pertence a nenhuma integração.
 *
 * Só carimba a organização. Não move, não desconecta e não assume canais, agentes ou servidores MCP que ela já tenha:
 * esses continuam independentes, e a integração cria os seus próprios.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { adotarOrganizacao } from "@/lib/integrations/vfood/recursos";
import { rotaSemOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().uuid() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  return rotaSemOrganizacao(req, { schema }, async ({ ctx, body }) => {
    const r = await adotarOrganizacao(ctx.tenantId, body.organizationId, ctx.requestId);
    return { data: { organizationId: r.organizationId }, status: r.replay ? 200 : 201 };
  });
}
