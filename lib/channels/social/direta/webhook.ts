/**
 * O webhook da PORTA DIRETA das redes sociais — leitura PURA do que a
 * plataforma entrega para os objetos `page` (Messenger) e `instagram`
 * (Instagram Direct). Nada aqui toca banco nem rede.
 *
 * ─── O formato, e por que ele é um só ───────────────────────────────────────
 *
 * As duas redes entregam o MESMO envelope da plataforma de mensagens:
 *
 *   { object: "page" | "instagram",
 *     entry: [{ id: <conta>, time, messaging: [{ sender, recipient, timestamp,
 *                                                message | postback | delivery | read }] }] }
 *
 * `entry[].id` é a CONTA (a Página, ou a conta profissional do Instagram) — é
 * por ele que a entrada acha a sessão, porque o webhook é um só para a
 * instalação inteira. Um POST pode trazer entradas de várias contas, de várias
 * organizações: quem agrupa por conta é `eventosPorConta`.
 *
 * ─── O eco ─────────────────────────────────────────────────────────────────
 *
 * Toda mensagem que a CONTA manda volta como `message.is_echo = true`, com
 * `sender` = a conta e `recipient` = a pessoa. Duas origens:
 *
 *   - o próprio CRM (o envio pela API). No Messenger o eco traz `app_id`, e o
 *     eco com o `app_id` DESTA instalação é descartado aqui — nunca vira linha,
 *     nunca pausa a IA. Sem `app_id` (o Instagram não o manda), o eco chega como
 *     saída e a ingestão o casa pelo `external_id` que o envio gravou
 *     (`social:<conta>:<mid>`): vira `duplicate`;
 *   - uma PESSOA respondendo pelo app da rede. Esse eco entra como saída — é o
 *     sinal de atendimento manual que pausa a IA naquela conversa, o mesmo
 *     contrato da porta intermediada.
 *
 * Em NENHUM caso um eco é lido como mensagem do cliente: `direction` é
 * `outbound`, e só `inbound` acorda o agente (`ingestZernioInbound`).
 *
 * ─── O que fica de fora, de propósito ──────────────────────────────────────
 *
 * Reação, mensagem apagada, `standby`/troca de dono da conversa e
 * `read` sem `mid` (o do Messenger só traz a marca d'água) não viram evento:
 * a plataforma reentrega o que não recebe 200, e recusar um evento que não nos
 * interessa seria reentrega para sempre.
 */
import { z } from "zod";

import { socialMessageId } from "../catalog";
import type { SocialMessage } from "../parser";

const texto = z.string().min(1);

const anexo = z.object({
  type: z.string(),
  payload: z.object({ url: z.string().optional() }).passthrough().nullish(),
});

const evento = z
  .object({
    sender: z.object({ id: texto }),
    recipient: z.object({ id: texto }),
    timestamp: z.number().optional(),
    message: z
      .object({
        mid: texto,
        text: z.string().optional(),
        is_echo: z.boolean().optional(),
        app_id: z.union([z.number(), z.string()]).optional(),
        is_deleted: z.boolean().optional(),
        attachments: z.array(anexo).optional(),
      })
      .passthrough()
      .optional(),
    postback: z.object({ mid: z.string().optional(), title: z.string().optional() }).passthrough().optional(),
    delivery: z.object({ mids: z.array(texto).optional() }).passthrough().optional(),
    read: z.object({ mid: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const envelope = z.object({
  object: z.string(),
  entry: z
    .array(
      z
        .object({
          id: texto,
          time: z.number().optional(),
          messaging: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    )
    .default([]),
});

/** Objeto do webhook → rede do catálogo. Fora destes dois, o evento não é desta porta. */
const REDE_DO_OBJETO: Record<string, "facebook" | "instagram"> = {
  page: "facebook",
  instagram: "instagram",
};

export interface EventosDaConta {
  /** `entry[].id` — a Página ou a conta do Instagram. */
  accountId: string;
  plataforma: "facebook" | "instagram";
  mensagens: SocialMessage[];
}

/** Os anexos que viram mídia; o resto (compartilhamento, story, modelo) vira só texto. */
const TIPOS_DE_MIDIA: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "file",
};

function quando(ms: number | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Lê UM evento de `messaging[]`. `null` = nada a gravar (evento de outro tipo,
 * eco do próprio app, payload capenga).
 */
function lerEvento(
  bruto: unknown,
  conta: string,
  plataforma: "facebook" | "instagram",
  appIdDaInstalacao: string | null,
): SocialMessage[] {
  const lido = evento.safeParse(bruto);
  if (!lido.success) return [];
  const e = lido.data;

  // Desfecho de entrega: só o que traz o id da mensagem. Atualiza o que existe.
  const desfechos: { mid: string; status: "delivered" | "read" }[] = [
    ...(e.delivery?.mids ?? []).map((mid) => ({ mid, status: "delivered" as const })),
    ...(e.read?.mid ? [{ mid: e.read.mid, status: "read" as const }] : []),
  ];
  if (desfechos.length > 0) {
    return desfechos.map(({ mid, status }) => ({
      platform: plataforma,
      participantId: e.sender.id === conta ? e.recipient.id : e.sender.id,
      accountId: conta,
      conversationId: e.sender.id === conta ? e.recipient.id : e.sender.id,
      externalId: socialMessageId(conta, mid),
      direction: "outbound",
      kind: "status",
      status,
      statusAt: quando(e.timestamp),
      text: null,
      sentAt: quando(e.timestamp),
      attachments: [],
      referral: null,
      identity: { phone: null, bsuid: null, anchor: null, username: null, displayName: null },
    }));
  }

  const mid = e.message?.mid ?? e.postback?.mid;
  if (!mid) return [];
  if (e.message?.is_deleted) return [];

  const eco = e.message?.is_echo === true;
  // O eco do PRÓPRIO app: o CRM já gravou esta mensagem ao enviá-la.
  if (eco && appIdDaInstalacao && e.message?.app_id !== undefined && String(e.message.app_id) === appIdDaInstalacao) {
    return [];
  }
  // Coerência do envelope: no eco, quem manda é a conta; fora dele, quem recebe é ela.
  if (eco ? e.sender.id !== conta : e.recipient.id !== conta) return [];
  const participantId = eco ? e.recipient.id : e.sender.id;

  const attachments = (e.message?.attachments ?? []).flatMap((a) => {
    const tipo = TIPOS_DE_MIDIA[a.type];
    const url = a.payload?.url;
    if (!tipo || !url) return [];
    try {
      return [{ type: tipo, url: new URL(url).toString() }];
    } catch {
      return [];
    }
  });
  // Botão tocado (postback) entra como o texto do botão — é o que a pessoa disse.
  const corpo = e.message?.text ?? e.postback?.title ?? null;
  if (!corpo && attachments.length === 0) return [];

  return [
    {
      platform: plataforma,
      participantId,
      accountId: conta,
      // A thread nesta porta É a pessoa: o envio endereça `recipient.id` por ela.
      conversationId: participantId,
      externalId: socialMessageId(conta, mid),
      direction: eco ? "outbound" : "inbound",
      kind: "message",
      text: corpo,
      sentAt: quando(e.timestamp),
      attachments,
      referral: null,
      identity: { phone: null, bsuid: null, anchor: null, username: null, displayName: null },
    },
  ];
}

/**
 * O corpo cru REDUZIDO às entradas de uma conta — o que pode ser guardado no
 * arquivo do webhook de UMA organização.
 *
 * Um POST da plataforma pode trazer contas de organizações diferentes (o
 * webhook é um só para a instalação). Arquivar o corpo inteiro sob a sessão de
 * uma delas guardaria, numa linha que o tenant LÊ, a mensagem do cliente de
 * outro. `null` quando o corpo nem é deste formato.
 */
export function corpoSoDaConta(rawBody: string, accountId: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const lido = envelope.safeParse(json);
  if (!lido.success) return null;
  return JSON.stringify({
    object: lido.data.object,
    entry: lido.data.entry.filter((e) => e.id === accountId),
  });
}

/**
 * O corpo cru, agrupado por CONTA. Corpo que não é deste formato devolve `[]`
 * — nunca lança: quem chama responde 200 e a plataforma não reentrega lixo.
 */
export function eventosPorConta(rawBody: string, appIdDaInstalacao: string | null): EventosDaConta[] {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const lido = envelope.safeParse(json);
  if (!lido.success) return [];
  const plataforma = REDE_DO_OBJETO[lido.data.object];
  if (!plataforma) return [];

  const porConta = new Map<string, SocialMessage[]>();
  for (const entrada of lido.data.entry) {
    const lista = porConta.get(entrada.id) ?? [];
    for (const bruto of entrada.messaging ?? []) {
      lista.push(...lerEvento(bruto, entrada.id, plataforma, appIdDaInstalacao));
    }
    porConta.set(entrada.id, lista);
  }
  return [...porConta.entries()].map(([accountId, mensagens]) => ({ accountId, plataforma, mensagens }));
}
