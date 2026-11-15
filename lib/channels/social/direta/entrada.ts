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
import type { SocialMessage } from "../parser";
import { appDaPortaDireta } from "./app";
import { credencialDaContaDireta } from "./credenciais";
import { perfilDoParticipante } from "./perfil";
import { corpoSoDaConta, eventosPorConta, type EventosDaConta } from "./webhook";

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
    const comNome = await comNomeDoParticipante(admin, sessao.organization_id, grupo);
    for (const mensagem of comNome) {
      try {
        const r = await ingestZernioInbound(admin, {
          organizationId: sessao.organization_id,
          channelSessionId: sessao.id,
          payload,
          socialMessage: mensagem,
        });
        if (r.status === "ingested") resumo.gravadas += 1;
        else resumo.ignoradas += 1;
        await nomearContatoSemNome(admin, sessao.organization_id, mensagem);
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

/**
 * As mensagens de ENTRADA do grupo com o nome de quem escreveu.
 *
 * O webhook não traz nome; ele é lido na Graph com o token da Página
 * (`./perfil.ts`). Só para mensagem de entrada (na saída quem fala é a conta),
 * uma pergunta por pessoa (o memo de `perfil.ts` evita repetir) e nunca lança:
 * sem credencial ou sem nome, a mensagem segue como veio.
 */
async function comNomeDoParticipante(
  admin: SupabaseClient,
  org: string,
  grupo: EventosDaConta,
): Promise<SocialMessage[]> {
  const entradas = grupo.mensagens.filter(
    (m) => m.direction === "inbound" && m.kind === "message" && !m.identity.displayName,
  );
  if (entradas.length === 0) return grupo.mensagens;
  let token: string | null = null;
  try {
    token = (await credencialDaContaDireta(admin, { organizationId: org, accountId: grupo.accountId }))?.token ?? null;
  } catch {
    token = null;
  }
  if (!token) return grupo.mensagens;
  const saida: SocialMessage[] = [];
  for (const m of grupo.mensagens) {
    if (!entradas.includes(m)) {
      saida.push(m);
      continue;
    }
    const perfil = await perfilDoParticipante({
      token,
      plataforma: grupo.plataforma,
      contaId: grupo.accountId,
      participantId: m.participantId,
    });
    saida.push({
      ...m,
      identity: { ...m.identity, displayName: perfil.nome, username: perfil.usuario ?? m.identity.username },
    });
  }
  return saida;
}

/**
 * O contato que nasceu SEM nome (antes desta leitura existir, ou quando a Graph
 * falhou) ganha o nome assim que ele aparece. Só preenche o que está vazio —
 * nome que alguém digitou no CRM nunca é sobrescrito. Nunca lança.
 */
async function nomearContatoSemNome(admin: SupabaseClient, org: string, m: SocialMessage): Promise<void> {
  const nome = m.identity.displayName;
  if (!nome || m.direction !== "inbound") return;
  try {
    await admin
      .from("contacts")
      .update({ name: nome, display_name: nome })
      .eq("organization_id", org)
      .eq("social_identity", `${m.platform}:${m.accountId}:${m.participantId}`)
      .is("is_merged_into", null)
      .is("display_name", null);
  } catch {
    // Enfeite: a mensagem já foi gravada.
  }
}

/** O handshake do webhook (GET). `null` = recusar com 403. */
export async function desafioDaPortaDireta(params: URLSearchParams): Promise<string | null> {
  const { verifyToken } = await appDaPortaDireta();
  // O mesmo protocolo do canal oficial — o app e o verify token são os mesmos.
  return verifyToken ? verificationChallenge(params, verifyToken) : null;
}
