/**
 * Autenticação das rotas privadas da integração VFood (`/api/v1/integrations/vfood/*`).
 *
 * A credencial é o `TENANT_PROVISIONING_SECRET` da instalação — a mesma de `POST /api/v1/tenants/provision`,
 * com o mesmo desligamento (sem segredo ou curto demais: 404) e o mesmo limite de FALHAS por IP. O segredo
 * NÃO basta para escolher uma organização: cada rota exige também o `x-vfood-tenant-id` (o restaurante) e só
 * age sobre a organização que o provisionamento da integração marcou com ESSE restaurante
 * (`organizacaoDaIntegracao`). Quem tem o segredo não consegue apontar para uma organização qualquer por id.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit, peekRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { extractBearer } from "@/lib/mcp/auth";

export const INTEGRACAO_VFOOD = "vfood";
const TAMANHO_MINIMO_DO_SEGREDO = 32;
const FALHAS_POR_MINUTO = 10;

export type ContextoVfood = { tenantId: string; requestId: string };

export async function autenticarVfood(
  req: NextRequest,
): Promise<{ ok: true; ctx: ContextoVfood } | { ok: false; response: Response }> {
  const requestId = randomUUID();
  const segredo = env.TENANT_PROVISIONING_SECRET.trim();
  if (segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    return { ok: false, response: fail("not_found", "Not found.", 404, { requestId }) };
  }

  // Sem IP não há balde por IP (mesma decisão da rota de provisionamento): o limite conta FALHAS.
  const ip = ipDoCliente(req.headers);
  const balde = ip === null ? null : `integrations_vfood:falha:ip:${ip}`;
  if (balde !== null && (await peekRateLimit(balde, 60)) >= FALHAS_POR_MINUTO) {
    return { ok: false, response: fail("rate_limited", "Too many requests.", 429, { requestId, headers: { "Retry-After": "60" } }) };
  }

  const recebido = Buffer.from(extractBearer(req.headers.get("authorization")) ?? "");
  const esperado = Buffer.from(segredo);
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    if (balde !== null) await checkRateLimit(balde, FALHAS_POR_MINUTO, 60);
    return { ok: false, response: fail("unauthenticated", "Credencial inválida.", 401, { requestId }) };
  }

  const tenantId = z.string().uuid().safeParse(req.headers.get("x-vfood-tenant-id") ?? "");
  if (!tenantId.success) {
    return { ok: false, response: fail("validation_failed", "x-vfood-tenant-id inválido.", 422, { requestId }) };
  }
  return { ok: true, ctx: { tenantId: tenantId.data.toLowerCase(), requestId } };
}
