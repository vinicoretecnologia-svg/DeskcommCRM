/** POST /api/v1/integrations/vfood/organizations — cria ou recupera a organização do restaurante (idempotente). */
import type { NextRequest } from "next/server";

import { garantirOrganizacao, organizacaoSchema } from "@/lib/integrations/vfood/recursos";
import { rotaSemOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return rotaSemOrganizacao(req, { schema: organizacaoSchema }, async ({ ctx, body }) => {
    const r = await garantirOrganizacao(ctx.tenantId, body, ctx.requestId);
    return { data: { organizationId: r.organizationId }, status: r.replay ? 200 : 201 };
  });
}
