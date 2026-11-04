import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { autenticarVfood, type ContextoVfood } from "./auth";
import { ErroDaIntegracao, organizacaoDaIntegracao, type OrgDaIntegracao } from "./recursos";

const SEM_CACHE = { "Cache-Control": "no-store" };

function respostaDeErro(erro: unknown, requestId: string): Response {
  if (erro instanceof ErroDaIntegracao) return fail(erro.code, erro.message, erro.status, { requestId, headers: SEM_CACHE });
  // Só a classe do erro vai para o log: mensagens de banco e de transporte podem carregar dados.
  logger.error("[integrations.vfood] falhou", { requestId, erro: erro instanceof Error ? erro.name : "desconhecido" });
  return fail("internal_error", "Não foi possível concluir a operação.", 500, { requestId, headers: SEM_CACHE });
}

async function lerCorpo<B>(req: NextRequest, schema: z.ZodType<B> | undefined, requestId: string): Promise<{ ok: true; body: B } | { ok: false; response: Response }> {
  if (!schema) return { ok: true, body: undefined as B };
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: fail("validation_failed", "Corpo inválido.", 422, { requestId, headers: SEM_CACHE }) };
  return { ok: true, body: parsed.data };
}

export interface Chamada<B> { ctx: ContextoVfood; admin: SupabaseClient; org: OrgDaIntegracao; body: B }

/** Rota sobre uma organização existente: autentica, confere a posse pelo restaurante do cabeçalho e só então age. */
export async function rotaDaOrganizacao<B = undefined>(
  req: NextRequest,
  params: Promise<{ orgId: string }>,
  opts: { schema?: z.ZodType<B>; status?: 200 | 201 },
  fn: (c: Chamada<B>) => Promise<unknown>,
): Promise<Response> {
  const auth = await autenticarVfood(req);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  try {
    const corpo = await lerCorpo(req, opts.schema, ctx.requestId);
    if (!corpo.ok) return corpo.response;
    const admin = createAdminClient();
    const org = await organizacaoDaIntegracao(admin, (await params).orgId, ctx.tenantId);
    return ok(await fn({ ctx, admin, org, body: corpo.body }), { requestId: ctx.requestId, status: opts.status ?? 200, headers: SEM_CACHE });
  } catch (erro) {
    return respostaDeErro(erro, ctx.requestId);
  }
}

/** Rota sem organização prévia (criação/recuperação). */
export async function rotaSemOrganizacao<B>(
  req: NextRequest,
  opts: { schema: z.ZodType<B> },
  fn: (c: { ctx: ContextoVfood; body: B }) => Promise<{ data: unknown; status: 200 | 201 }>,
): Promise<Response> {
  const auth = await autenticarVfood(req);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  try {
    const corpo = await lerCorpo(req, opts.schema, ctx.requestId);
    if (!corpo.ok) return corpo.response;
    const r = await fn({ ctx, body: corpo.body });
    return ok(r.data, { requestId: ctx.requestId, status: r.status, headers: SEM_CACHE });
  } catch (erro) {
    return respostaDeErro(erro, ctx.requestId);
  }
}

