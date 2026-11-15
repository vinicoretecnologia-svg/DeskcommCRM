/**
 * /api/v1/webhooks/redes-sociais — o webhook da CONEXÃO DIRETA das redes
 * sociais (Instagram Direct e Messenger da Página).
 *
 *   GET  — o handshake da plataforma: devolve `hub.challenge` em TEXTO PURO
 *          (não JSON) quando `hub.verify_token` confere; senão 403.
 *   POST — a entrega: assinatura conferida, conta resolvida, ingestão. O que
 *          cada status significa está em `lib/channels/social/direta/entrada.ts`.
 *
 * A rota não sabe qual canal é (invariante 1 da doutrina de canal): ela entrega
 * o corpo cru e os cabeçalhos e devolve o desfecho. O caminho é público no
 * `proxy.ts` pelo prefixo `/api/v1/webhooks/` (`lib/auth/public-paths.ts`):
 * quem autentica é a assinatura.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { comIdDaRequisicao, fail, ok } from "@/lib/api/wrappers";
import { desafioDaPortaDireta, receberEntregaDaPortaDireta } from "@/lib/channels/social/direta/entrada";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const desafio = await desafioDaPortaDireta(new URL(req.url).searchParams);
  if (desafio === null) return comIdDaRequisicao(new Response("forbidden", { status: 403 }), req);
  return comIdDaRequisicao(
    new Response(desafio, { status: 200, headers: { "Content-Type": "text/plain" } }),
    req,
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const rawBody = await req.text();
  try {
    const r = await receberEntregaDaPortaDireta(createAdminClient(), {
      rawBody,
      headers: req.headers,
      requestId,
    });
    if ("motivo" in r) {
      return r.status === 404
        ? fail("not_found", r.motivo, 404, { requestId })
        : fail("unauthorized", r.motivo, 401, { requestId });
    }
    if (r.status === 500) return fail("internal_error", "ingest_failed", 500, { requestId });
    return ok(r.resumo, { requestId });
  } catch (err) {
    // Rota pública: o detalhe fica no log, quem chamou recebe só que falhou.
    logger.error("[webhook.redes-sociais] entrega falhou", {
      request_id: requestId,
      detail: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return fail("internal_error", "lookup_failed", 500, { requestId });
  }
}
