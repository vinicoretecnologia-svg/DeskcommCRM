/** PUT /api/v1/integrations/vfood/organizations/[orgId]/mcp — cadastra/atualiza o servidor MCP do restaurante (chave cifrada). */
import type { NextRequest } from "next/server";

import { mcpSchema, registrarMcp } from "@/lib/integrations/vfood/recursos";
import { rotaDaOrganizacao } from "@/lib/integrations/vfood/rota";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }): Promise<Response> {
  return rotaDaOrganizacao(req, params, { schema: mcpSchema }, ({ admin, org, body, ctx }) => registrarMcp(admin, org, body, ctx.requestId));
}
