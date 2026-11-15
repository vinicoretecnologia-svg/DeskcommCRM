/**
 * A ENTRADA do webhook da porta direta das redes sociais — o que a rota
 * `app/api/v1/webhooks/redes-sociais` faz com o que a plataforma entrega.
 *
 * ─── De quem é o evento ────────────────────────────────────────────────────
 *
 * O webhook do app é UM só para a instalação (é configuração do app na
 * plataforma, não da conta), então não há token no caminho. A organização sai
 * de duas provas, nesta ordem:
 *
 *   1. a ASSINATURA (`X-Hub-Signature-256`, HMAC SHA-256 do corpo com o
 *      segredo do app) — sem ela, o corpo não escolhe nada;
 *   2. a CONTA do evento (`entry[].id`) casada com a sessão ATIVA que a tem.
 *      O índice único da migration 9390 garante no máximo uma; se o banco
 *      ainda assim devolver duas, o evento é descartado (escolher seria
 *      entregar a conversa de um cliente a outro).
 *
 * É o desenho de `../../entrada-da-instalacao.ts`, com uma diferença que a
 * plataforma impõe: um POST pode trazer contas de VÁRIAS organizações. Cada
 * conta é processada à parte, e o arquivo do corpo cru de cada organização
 * guarda só o recorte dela (`corpoSoDaConta`).
 *
 * ─── As respostas ──────────────────────────────────────────────────────────
 *
 *   - 404 quando a instalação não tem o segredo do app (a entrada não existe);
 *   - 401 assinatura que não confere, com rastro no log;
 *   - 200 para tudo que foi lido — inclusive conta desconhecida: a plataforma
 *     reentrega o que não recebe 200, e um evento que nunca vai servir
 *     reentregaria para sempre;
 *   - 500 só quando uma ESCRITA falhou: aí a reentrega é o que se quer, e ela é
 *     segura (a mensagem repetida vira `23505` → `duplicate`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { abrirArquivoDoWebhook, fecharArquivoDoWebhook } from "../../arquivo-de-webhook";
import { CHANNEL_PROVIDER_SOCIAL_DIRETA } from "../../capabilities";
import { verificationChallenge, verifyMetaSignature } from "../../meta/webhook";
import { ingestZernioInbound } from "../../zernio/ingest";
import { appDaPortaDireta } from "./app";
import { corpoSoDaConta, eventosPorConta } from "./webhook";

export type DesfechoDaEntrada =
  | { status: 401 | 404; motivo: string }
  | { status: 200 | 500; resumo: { contas: number; gravadas: number; ignoradas: number; falhas: number } };

interface SessaoDaConta {
  id: string;
  organization_id: string;
  metadata: Record<string, unknown> | null;
}

async function sessaoDaConta(admin: SupabaseClient, accountId: string): Promise<SessaoDaConta | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, organization_id, metadata")
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .eq("meta_social_account_id", accountId)
    .is("archived_at", null)
    .limit(2);
  if (error) throw new Error(`sessão da conta não lida: ${error.message}`);
  const sessoes = (data ?? []) as SessaoDaConta[];
  if (sessoes.length > 1) {
    logger.warn("[redes-sociais.direta] conta em mais de uma sessão ativa; evento descartado", {
      sessoes: sessoes.map((s) => s.id),
    });
    return null;
  }
  return sessoes[0] ?? null;
}

export async function receberEntregaDaPortaDireta(
  admin: SupabaseClient,
  entrada: { rawBody: string; headers: Headers; requestId: string },
): Promise<DesfechoDaEntrada> {
  const app = await appDaPortaDireta();
  if (!app.appSecret) return { status: 404, motivo: "sem_app_configurado" };
  if (!verifyMetaSignature(entrada.rawBody, entrada.headers.get("x-hub-signature-256"), app.appSecret)) {
    logger.warn("[redes-sociais.direta] assinatura recusada", { request_id: entrada.requestId });
    return { status: 401, motivo: "bad_signature" };
  }

  const resumo = { contas: 0, gravadas: 0, ignoradas: 0, falhas: 0 };
  for (const grupo of eventosPorConta(entrada.rawBody, app.appId)) {
    resumo.contas += 1;
    const sessao = await sessaoDaConta(admin, grupo.accountId);
    // A rede da sessão e a do objeto do webhook têm de bater: o evento de
    // Página nunca entra numa sessão de Instagram, nem o contrário.
    if (!sessao || sessao.metadata?.social_platform !== grupo.plataforma) {
      resumo.ignoradas += grupo.mensagens.length;
      continue;
    }

    const corpo = corpoSoDaConta(entrada.rawBody, grupo.accountId) ?? "{}";
    const arquivo = await abrirArquivoDoWebhook(admin, {
      organizationId: sessao.organization_id,
      channelSessionId: sessao.id,
      provider: CHANNEL_PROVIDER_SOCIAL_DIRETA,
      rawBody: corpo,
      headers: entrada.headers,
    });

    let falhou: string | null = null;
    const payload = JSON.parse(corpo) as unknown;
    for (const mensagem of grupo.mensagens) {
      try {
        const r = await ingestZernioInbound(admin, {
          organizationId: sessao.organization_id,
          channelSessionId: sessao.id,
          payload,
          socialMessage: mensagem,
        });
        if (r.status === "ingested") resumo.gravadas += 1;
        else resumo.ignoradas += 1;
      } catch (erro) {
        resumo.falhas += 1;
        falhou = erro instanceof Error ? erro.message.slice(0, 160) : "ingest_failed";
        logger.error("[redes-sociais.direta] ingestão falhou", {
          organization_id: sessao.organization_id,
          channel_session_id: sessao.id,
          request_id: entrada.requestId,
          detalhe: falhou,
        });
      }
    }
    await fecharArquivoDoWebhook(admin, arquivo, {
      status: falhou ? "error" : "processed",
      validSignature: true,
      erro: falhou,
    });
  }
  return { status: resumo.falhas > 0 ? 500 : 200, resumo };
}

/** O handshake do webhook (GET). `null` = recusar com 403. */
export async function desafioDaPortaDireta(params: URLSearchParams): Promise<string | null> {
  const { verifyToken } = await appDaPortaDireta();
  // O mesmo protocolo do canal oficial — o app e o verify token são os mesmos.
  return verifyToken ? verificationChallenge(params, verifyToken) : null;
}
