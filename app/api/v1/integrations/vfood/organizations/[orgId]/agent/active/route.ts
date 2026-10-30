/** PUT /api/v1/integrations/vfood/organizations/[orgId]/agent/active — ativa ou pausa SÓ o agente da integração. */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { definirAgenteAtivo } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

const schema = z.object({ active: z.boolean() }).strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }): Promise<Response> {
  return rotaDaOrganizacao(req, params, { schema }, ({ admin, org, body, ctx }) => definirAgenteAtivo(admin, org, body.active, ctx.requestId));
}
