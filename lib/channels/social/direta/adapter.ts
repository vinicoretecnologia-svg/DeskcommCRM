/**
 * O ADAPTER DA PORTA DIRETA das redes sociais — Instagram Direct e Messenger
 * da Página pela Graph API, sem intermediário (#965/#1320).
 *
 * Tradutor de formato, como a doutrina exige (`docs/doctrine/restricao-de-canal.md`):
 * NÃO decide se pode enviar. A janela de 24h é da cadeia `before_send`, que lê
 * `freeformOutsideWindow: false` em `../../capabilities.ts`; aqui só se traduz
 * a recusa da plataforma, quando ela vier, numa frase que diga o que fazer.
 *
 * ─── O endereço ────────────────────────────────────────────────────────────
 *
 * A pessoa é o `recipient.id` que a plataforma deu a ela NESTA conta (PSID no
 * Messenger, IGSID no Instagram) — e é exatamente o que a entrada grava como
 * `provider_conversation_id` (`./webhook.ts`). O envio sai sempre pela PÁGINA
 * (`POST /{página}/messages`), inclusive para o Instagram, que fala pela
 * Página a que está ligado.
 *
 * `messaging_type: "RESPONSE"`: é resposta a quem escreveu. As outras
 * (`UPDATE`, `MESSAGE_TAG`) são o que a política da plataforma restringe, e
 * este canal não as usa.
 *
 * ─── A credencial ──────────────────────────────────────────────────────────
 *
 * Lida por (organização, conta) a cada envio — o mesmo desenho do adapter da
 * porta intermediada (`../adapter.ts`). `isConfigured()` é `true` pelo motivo
 * que `../adaptador-da-porta.ts` documenta: `false` deixaria a mensagem parada
 * em `queued` sem rastro; quem desiste é `send`, com o motivo.
 */
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { CHANNEL_PROVIDER_SOCIAL_DIRETA } from "../../capabilities";
import type { ChannelAdapter, ChannelHealth } from "../../types";
import { baixarMidiaComTeto } from "../baixar-midia";
import { socialMessageId } from "../catalog";
import { credencialDaContaDireta } from "./credenciais";
import { chamarGraph, GraphSocialError } from "./graph";

/** O tipo de anexo da plataforma para cada tipo de mensagem que o CRM manda. */
const ANEXO_DO_TIPO: Record<string, "image" | "video" | "audio" | "file"> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
};

const respostaDoEnvio = z.object({ message_id: z.string().min(1) });

/** A recusa da plataforma dita para o operador — sem nome de fornecedor, sem código cru. */
function fraseDaRecusa(erro: GraphSocialError): string {
  if (erro.foraDaJanela) {
    return "Passaram mais de 24 horas desde a última mensagem do cliente. Aguarde ele escrever de novo para responder por esta rede.";
  }
  if (erro.credencialInvalida) {
    return "A autorização da conta expirou ou foi removida. Entre com o Facebook de novo em Conexões › Redes sociais.";
  }
  if (erro.code === 10 || erro.code === 200) {
    return "A conta não deu permissão para enviar mensagens. Entre com o Facebook de novo e aceite as permissões pedidas.";
  }
  return "A rede recusou o envio. Confira a conta em Conexões › Redes sociais.";
}

export const socialDiretaAdapter: ChannelAdapter = {
  provider: CHANNEL_PROVIDER_SOCIAL_DIRETA,

  codes: {
    notConfigured: "porta_sem_credencial",
    sendFailed: "porta_falhou",
    unknownError: "porta_desconhecida",

  },

  // O endereço é a thread que a entrada gravou; nunca um telefone.
  resolveRecipient: (input) => (input.isGroup ? null : "provider-thread"),

  isConfigured: () => true,

  async send(envelope) {
    if (!envelope.providerConversationId) {
      throw new Error("Aguarde uma mensagem do cliente para responder nesta rede.");
    }
    const anexo = ANEXO_DO_TIPO[envelope.kind];
    if (envelope.kind !== "text" && !anexo) {
      throw new Error("Este tipo de mensagem ainda não é suportado nesta rede.");
    }
    const cred = await credencialDaContaDireta(createAdminClient(), {
      organizationId: envelope.organizationId,
      accountId: envelope.sessionRef,
    });
    if (!cred) {
      throw new Error("A conta não tem autorização gravada. Entre com o Facebook de novo em Conexões › Redes sociais.");
    }
    await envelope.beforeSend?.();

    const recipient = { id: envelope.providerConversationId };
    const mensagens: unknown[] = [];
    if (anexo && envelope.media) {
      mensagens.push({ attachment: { type: anexo, payload: { url: envelope.media.url, is_reusable: false } } });
      // A plataforma não tem legenda em anexo: a legenda sai como texto logo depois.
      if (envelope.media.caption) mensagens.push({ text: envelope.media.caption });
    } else {
      const corpo = envelope.body?.trim();
      if (!corpo) throw new Error("A mensagem está vazia.");
      mensagens.push({ text: corpo });
    }

    let primeiroId: string | null = null;
    for (const message of mensagens) {
      let resposta: unknown;
      try {
        resposta = await chamarGraph(`${encodeURIComponent(cred.pageId)}/messages`, {
          token: cred.token,
          json: { recipient, messaging_type: "RESPONSE", message },
        });
      } catch (erro) {
        if (erro instanceof GraphSocialError) {
          // O handler de envio reconhece "desacelere" pelo PREFIXO da mensagem
          // (`codes.throttled`) e reagenda em vez de falhar.
          if (erro.desacelerar) throw new Error("porta_desacelerar: a rede pediu para ir mais devagar.");
          throw new Error(fraseDaRecusa(erro));
        }
        throw erro;
      }
      const lida = respostaDoEnvio.safeParse(resposta);
      if (!lida.success) {
        throw new Error("Envio sem confirmação da rede. Confira a conversa antes de tentar novamente.");
      }
      primeiroId ??= lida.data.message_id;
    }
    // A mesma grafia que a entrada usa para o eco: o eco vira `duplicate`.
    return { externalId: primeiroId ? socialMessageId(cred.accountId, primeiroId) : null };
  },

  async sendTemplate() {
    throw new Error("Esta rede não usa modelos de WhatsApp.");
  },

  async checkHealth(input): Promise<ChannelHealth> {
    const cred = await credencialDaContaDireta(createAdminClient(), {
      organizationId: input.organizationId,
      accountId: input.sessionRef,
    });
    if (!cred) return { reachable: true, status: "FAILED", detail: "credencial_indisponivel" };
    try {
      const assinaturas = z
        .object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
        .parse(await chamarGraph(`${encodeURIComponent(cred.pageId)}/subscribed_apps`, { token: cred.token }));
      // Página sem o app assinado não entrega mensagem nenhuma — com o token bom.
      if (assinaturas.data.length === 0) {
        return { reachable: true, status: "FAILED", detail: "recebimento_nao_configurado" };
      }
      return { reachable: true, status: "WORKING", detail: null };
    } catch (erro) {
      if (erro instanceof GraphSocialError && erro.credencialInvalida) {
        return { reachable: true, status: "FAILED", detail: "credencial_expirada" };
      }
      if (erro instanceof GraphSocialError && erro.status < 500) {
        return { reachable: true, status: "FAILED", detail: "conta_requer_atencao" };
      }
      return { reachable: false, status: null, detail: "provedor_indisponivel" };
    }
  },

  async fetchInboundMedia(input) {
    // A URL do anexo é da CDN da plataforma, assinada e temporária: vai SEM o
    // token. Mandar a credencial para um host de CDN é entregá-la a terceiros.
    return baixarMidiaComTeto(new URL(input.url), { hintMime: input.hintMime });
  },
};
