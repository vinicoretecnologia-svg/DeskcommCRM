/**
 * PUT /api/v1/integrations/vfood/organizations/[orgId]/agent — cria/atualiza o agente de delivery, sem ativá-lo.
 * GET  — estado do agente da integração (pronto, ativo, o que falta).
 */
import type { NextRequest } from "next/server";

import { agenteSchema, estadoDoAgente, garantirAgente } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ orgId: string }> };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  return rotaDaOrganizacao(req, params, { schema: agenteSchema }, ({ admin, org, body, ctx }) => garantirAgente(admin, org, ctx.tenantId, body, ctx.requestId));
}

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  return rotaDaOrganizacao(req, params, {}, ({ admin, org }) => estadoDoAgente(admin, org));
}
