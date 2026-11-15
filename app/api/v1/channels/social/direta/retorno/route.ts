/**
 * GET /api/v1/channels/social/direta/retorno — a volta do "Entrar com
 * Facebook" da conexão direta das redes sociais.
 *
 * ─── A ORDEM DOS PASSOS É CONTRATO (a mesma do retorno do Google Ads) ──────
 *
 *   1. `error` na query antes de tudo: "Cancelar" não é falha.
 *   2. `state` antes do `code`: sem organização não há o que gravar nem
 *      auditar. Depois dele, o cookie de vínculo (o navegador que volta é o que
 *      saiu), a régua de suporte e a queima do nonce — uso único.
 *   3. a troca do código só depois do `state` confirmado e queimado: o `code` é
 *      de uso único e não pode ser gasto num retorno ilegítimo.
 *   4. as Páginas autorizadas viram sessões; o token de cada Página é cifrado
 *      ANTES de gravar (`lib/channels/social/direta/conexao.ts`).
 *
 * A organização sai do `state` assinado — o cookie de sessão é
 * `SameSite=Strict` e não chega aqui. O caminho é público no `proxy.ts`
 * (`lib/auth/public-paths.ts`) por isso mesmo: quem autentica é o `state` +
 * vínculo, não a sessão.
 */
import { NextResponse, type NextRequest } from "next/server";

import { NOME_DO_VINCULO, vinculoConfere } from "@/lib/agenda/google/vinculo";
import { comIdDaRequisicao } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { appDaPortaDireta } from "@/lib/channels/social/direta/app";
import {
  CAMINHO_DO_RETORNO,
  conectarPaginas,
  paginasAutorizadas,
  trocarCodigoPorToken,
  urlDoRetorno,
} from "@/lib/channels/social/direta/conexao";
import { verificarEstadoDoLogin } from "@/lib/channels/social/direta/estado";
import { env } from "@/lib/env";
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";

/**
 * A volta é uma PONTE (200 + `location.replace` no nosso origin), nunca um 302.
 *
 * Esta requisição é a ponta de uma navegação iniciada no site da plataforma. O
 * cookie de sessão é `SameSite=Strict`, e um 302 daqui para a tela autenticada
 * continuaria a mesma cadeia cross-site: o cookie não viajaria e o `proxy.ts`
 * mandaria a pessoa para o `/login`, com a conta já ligada (o defeito do #1579 /
 * #1646). A ponte troca quem inicia a navegação seguinte — `lib/auth/ponte-de-volta.ts`.
 */
function voltar(params: Record<string, string>, req: NextRequest): NextResponse {
  const destino = new URLSearchParams({ aba: "sociais", ...params });
  const ponte = respostaDePonte(
    `/app/connections?${destino.toString()}`,
    marcaDaSaida(null).nome,
    "Voltando para as conexões…",
  );
  const resposta = comIdDaRequisicao(
    new NextResponse(ponte.body, { status: 200, headers: ponte.headers }),
    req,
  );
  // O vínculo morre com o fluxo, sucesso ou erro.
  resposta.cookies.set(NOME_DO_VINCULO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_RETORNO,
    maxAge: 0,
  });
  return resposta;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);

  // 1. Cancelar não é erro.
  if (url.searchParams.get("error")) return voltar({ direta_erro: "cancelado" }, req);

  // 2. `state` antes do `code`.
  let estado: ReturnType<typeof verificarEstadoDoLogin>;
  try {
    estado = verificarEstadoDoLogin(url.searchParams.get("state"), {
      segredo: env.INTERNAL_SECRET,
      agora: new Date(),
    });
  } catch {
    return voltar({ direta_erro: "estado_invalido" }, req);
  }
  if (!estado) return voltar({ direta_erro: "estado_invalido" }, req);
  if (!vinculoConfere(req.cookies.get(NOME_DO_VINCULO)?.value, estado.nonce, env.INTERNAL_SECRET)) {
    logger.warn("[redes-sociais.direta] vínculo do navegador não confere", {
      organizationId: estado.organizationId,
    });
    return voltar({ direta_erro: "estado_invalido" }, req);
  }
  const code = url.searchParams.get("code");
  if (!code) return voltar({ direta_erro: "sem_codigo" }, req);
  if (!(await supportCallbackWriteAllowed(estado.organizationId, estado.userId, estado.authSessionId))) {
    return voltar({ direta_erro: "estado_invalido" }, req);
  }

  const admin = createAdminClient();
  // Uso único: o nonce é queimado ANTES da troca, na mesma tabela dos outros
  // retornos de consentimento. Qualquer erro recusa — sem gravar, não há uso
  // único a garantir.
  const { error: erroDoNonce } = await admin.from("calendar_oauth_nonces").insert({
    nonce: estado.nonce,
    organization_id: estado.organizationId,
    user_id: estado.userId,
    expira_em: new Date(estado.expiraEmMs).toISOString(),
  });
  if (erroDoNonce) return voltar({ direta_erro: "estado_invalido" }, req);

  // 3 e 4.
  const app = await appDaPortaDireta();
  let desfechos: Awaited<ReturnType<typeof conectarPaginas>>;
  try {
    const tokenDoUsuario = await trocarCodigoPorToken(app, {
      code,
      redirectUri: urlDoRetorno(env.NEXT_PUBLIC_APP_URL),
    });
    const paginas = await paginasAutorizadas(tokenDoUsuario);
    if (paginas.length === 0) return voltar({ direta_erro: "sem_paginas" }, req);
    desfechos = await conectarPaginas(admin, estado.organizationId, paginas);
  } catch (erro) {
    logger.error("[redes-sociais.direta] conexão pelo login falhou", {
      organizationId: estado.organizationId,
      detalhe: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
    });
    return voltar({ direta_erro: "conexao_falhou" }, req);
  }

  const ligadas = desfechos.filter((d) => d.resultado === "conectada" || d.resultado === "atualizada");
  void audit({
    action: "channel.social_configured",
    organizationId: estado.organizationId,
    actorUserId: estado.userId,
    resourceType: "social_connections",
    resourceId: null,
    metadata: {
      operation: "connect",
      porta: "direta",
      contas: desfechos.map((d) => ({ conta: d.conta, plataforma: d.plataforma, resultado: d.resultado })),
    },
  });

  if (ligadas.length === 0) {
    const motivo = desfechos.find((d) => d.resultado !== "falhou")?.resultado ?? "conexao_falhou";
    return voltar({ direta_erro: motivo }, req);
  }
  const recusadas = desfechos.length - ligadas.length;
  return voltar({ direta: String(ligadas.length), ...(recusadas > 0 ? { direta_recusadas: String(recusadas) } : {}) }, req);
}
