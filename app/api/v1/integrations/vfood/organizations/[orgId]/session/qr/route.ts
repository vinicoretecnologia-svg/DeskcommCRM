/** GET /api/v1/integrations/vfood/organizations/[orgId]/session/qr — QR do canal da integração (sem cache, sem log). */
import type { NextRequest } from "next/server";

import { qrDaSessao } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }): Promise<Response> {
  return rotaDaOrganizacao(req, params, {}, ({ admin, org }) => qrDaSessao(admin, org));
}
