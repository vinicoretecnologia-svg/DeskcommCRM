/** POST /api/v1/integrations/vfood/organizations/[orgId]/session/disconnect — desconecta só o número da integração; o vínculo fica. */
import type { NextRequest } from "next/server";

import { desconectarSessao } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }): Promise<Response> {
  return rotaDaOrganizacao(req, params, {}, ({ admin, org, ctx }) => desconectarSessao(admin, org, ctx.requestId));
}
