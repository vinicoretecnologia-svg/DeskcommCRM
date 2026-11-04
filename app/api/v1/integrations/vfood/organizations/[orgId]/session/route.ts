/**
 * POST /api/v1/integrations/vfood/organizations/[orgId]/session — cria ou recupera o canal WhatsApp da integração.
 * GET — status da sessão (fonte real: WAHA).
 */
import type { NextRequest } from "next/server";

import { garantirSessao, lerSessao } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  return rotaDaOrganizacao(req, params, {}, ({ admin, org, ctx }) => garantirSessao(admin, org, ctx.tenantId));
}

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  return rotaDaOrganizacao(req, params, {}, ({ admin, org }) => lerSessao(admin, org));
}
