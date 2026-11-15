/**
 * GET /api/v1/channels/social/direta/entrar — começa o "Entrar com Facebook"
 * da conexão direta das redes sociais.
 *
 * Manda a pessoa ao diálogo da plataforma com um `state` assinado (organização
 * + quem pediu) e grava o cookie de vínculo, restrito ao caminho do retorno:
 * na volta ele prova que o navegador que retorna é o que saiu. O cookie de
 * sessão é `SameSite=Strict` e não viaja nessa volta — o molde inteiro é o do
 * Google Ads (`app/api/v1/plataformas-de-anuncio/google/connect/route.ts`).
 *
 * Todo desfecho é redirecionamento para Conexões › Redes sociais, nunca JSON:
 * este endereço é aberto pelo navegador num clique.
 */
import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { assinarVinculo, NOME_DO_VINCULO, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";

import { requireRole } from "@/lib/auth/require-role";
import { appDaPortaDireta, faltaParaEntrar } from "@/lib/channels/social/direta/app";
import { CAMINHO_DO_RETORNO, urlDoLogin, urlDoRetorno } from "@/lib/channels/social/direta/conexao";
import { emitirEstadoDoLogin } from "@/lib/channels/social/direta/estado";
import { env } from "@/lib/env";
import { authenticatedSessionId, requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";

function voltarComErro(codigo: string): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(`/app/connections?aba=sociais&direta_erro=${codigo}`, base));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied as NextResponse;
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const autorizado = await requireRole("admin", { requestId, resource: "social_connections" });
  if (!autorizado.ok) return autorizado.response as NextResponse;
  const { user, org } = autorizado;

  const app = await appDaPortaDireta();
  const falta = faltaParaEntrar(app);
  if (falta.length > 0) {
    // A tela não nomeia variável; o log sim, para quem administra a instalação.
    logger.warn("[redes-sociais.direta] login indisponível nesta instalação", { falta });
    return voltarComErro("indisponivel");
  }

  const nonce = randomBytes(16).toString("base64url");
  let state: string;
  try {
    state = emitirEstadoDoLogin(
      { organizationId: org.orgId, userId: user.id, authSessionId: await authenticatedSessionId() },
      { segredo: env.INTERNAL_SECRET, agora: new Date(), nonce },
    );
  } catch {
    return voltarComErro("estado_invalido");
  }

  const destino = urlDoLogin(app, { redirectUri: urlDoRetorno(env.NEXT_PUBLIC_APP_URL), state });
  const resposta = NextResponse.redirect(destino);
  // `lax`: strict não viaja na volta da plataforma. `cookieSecure()`: `secure`
  // literal perderia o cookie em instalação servida por http.
  resposta.cookies.set(NOME_DO_VINCULO, assinarVinculo(nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_RETORNO,
    maxAge: VALIDADE_DO_VINCULO_S,
  });
  return resposta;
}
