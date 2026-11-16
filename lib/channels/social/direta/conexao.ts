/**
 * A CONEXÃO da porta direta das redes sociais — do "Entrar com Facebook" até as
 * sessões gravadas e o app assinado em cada Página.
 *
 * ─── O caminho, em quatro passos ───────────────────────────────────────────
 *
 *   1. `urlDoLogin` — o diálogo do Login do Facebook para Empresas, aberto
 *      pela CONFIGURAÇÃO do app (`config_id`), que é onde as permissões
 *      (`pages_messaging`, `instagram_manage_messages`, …) foram escolhidas.
 *      A pessoa escolhe lá as Páginas que autoriza: não há segunda tela aqui.
 *   2. `trocarCodigoPorToken` — código → token do usuário → token de longa
 *      duração. O segredo do app vai no CORPO do POST, nunca na URL.
 *   3. `paginasAutorizadas` — `me/accounts`: cada Página com o token DELA e o
 *      Instagram profissional ligado, quando há.
 *   4. `conectarPaginas` — para cada Página: assina o app nela
 *      (`subscribed_apps`, sem isso nenhuma mensagem chega) e grava UMA sessão
 *      por conta — a da Página (Messenger) e, se houver, a do Instagram, as
 *      duas falando pela Página.
 *
 * ─── Isolamento ────────────────────────────────────────────────────────────
 *
 * A organização vem do `state` assinado (quem chama confere). Uma conta ATIVA
 * em OUTRA organização não é tomada: o índice único da 9390 recusaria o insert
 * de qualquer jeito, e aqui a recusa vira um desfecho legível
 * (`conta_em_outra_organizacao`) em vez de um 23505 cru.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { lerLimiteEstourado } from "@/lib/cobranca/limites";
import { fecharAvisoDePausaDoCanalArquivado } from "@/lib/channels/central-de-pausa";
import { resolverSaudeDaConexaoRemovida } from "@/lib/channels/health";
import { graphVersion } from "@/lib/graph-version";
import { logger } from "@/lib/logger";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_SOCIAL_DIRETA } from "../../capabilities";
import type { AppDaPortaDireta } from "./app";
import { chamarGraph, GraphSocialError } from "./graph";

/** Os campos de webhook que a Página assina para o app — os que `./webhook.ts` lê. */
export const CAMPOS_ASSINADOS = [
  "messages",
  "messaging_postbacks",
  "message_echoes",
  "message_deliveries",
  "message_reads",
] as const;

/** O caminho do retorno — registrado no app como URI de redirecionamento válida. */
export const CAMINHO_DO_RETORNO = "/api/v1/channels/social/direta/retorno";

export function urlDoRetorno(base: string): string {
  return `${base.replace(/\/+$/, "")}${CAMINHO_DO_RETORNO}`;
}

/** O diálogo do login. Host fixo da plataforma: é a tela dela, não uma API. */
export function urlDoLogin(app: AppDaPortaDireta, opcoes: { redirectUri: string; state: string }): string {
  if (!app.appId || !app.configId) throw new Error("app_da_porta_direta_incompleto");
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("config_id", app.configId);
  url.searchParams.set("redirect_uri", opcoes.redirectUri);
  url.searchParams.set("state", opcoes.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  return url.toString();
}

const tokenDaTroca = z.object({ access_token: z.string().min(1) });

export async function trocarCodigoPorToken(
  app: AppDaPortaDireta,
  opcoes: { code: string; redirectUri: string },
): Promise<string> {
  if (!app.appId || !app.appSecret) throw new Error("app_da_porta_direta_incompleto");
  const curto = tokenDaTroca.parse(
    await chamarGraph("oauth/access_token", {
      metodo: "POST",
      formulario: {
        client_id: app.appId,
        client_secret: app.appSecret,
        redirect_uri: opcoes.redirectUri,
        code: opcoes.code,
      },
    }),
  ).access_token;
  // Token de longa duração: é dele que saem os tokens de Página sem validade.
  // Se a troca falhar, o curto ainda serve para esta conexão — os tokens de
  // Página derivados dele valem horas, e a tela mandará reconectar.
  try {
    return tokenDaTroca.parse(
      await chamarGraph("oauth/access_token", {
        metodo: "POST",
        formulario: {
          grant_type: "fb_exchange_token",
          client_id: app.appId,
          client_secret: app.appSecret,
          fb_exchange_token: curto,
        },
      }),
    ).access_token;
  } catch (erro) {
    logger.warn("[redes-sociais.direta] token de longa duração indisponível; segue o curto", {
      detalhe: erro instanceof Error ? erro.message.slice(0, 160) : String(erro),
    });
    return curto;
  }
}

const paginasSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().default(""),
        access_token: z.string().min(1).optional(),
        instagram_business_account: z
          .object({ id: z.string().min(1), username: z.string().optional(), name: z.string().optional() })
          .optional(),
      })
      .passthrough(),
  ),
});

export interface PaginaAutorizada {
  id: string;
  nome: string;
  token: string;
  instagram: { id: string; usuario: string | null } | null;
}

export async function paginasAutorizadas(tokenDoUsuario: string): Promise<PaginaAutorizada[]> {
  const lidas = paginasSchema.parse(
    await chamarGraph("me/accounts", {
      token: tokenDoUsuario,
      consulta: {
        fields: "id,name,access_token,instagram_business_account{id,username,name}",
        limit: "100",
      },
    }),
  );
  return lidas.data.flatMap((p) =>
    p.access_token
      ? [
          {
            id: p.id,
            nome: p.name || p.id,
            token: p.access_token,
            instagram: p.instagram_business_account
              ? {
                  id: p.instagram_business_account.id,
                  usuario: p.instagram_business_account.username ?? p.instagram_business_account.name ?? null,
                }
              : null,
          },
        ]
      : [],
  );
}

export type DesfechoDaConta =
  | { conta: string; plataforma: "facebook" | "instagram"; resultado: "conectada" | "atualizada"; channelId: string }
  | {
      conta: string;
      plataforma: "facebook" | "instagram";
      resultado: "conta_em_outra_organizacao" | "limite_do_plano" | "falhou";
    };

interface ContaParaGravar {
  plataforma: "facebook" | "instagram";
  accountId: string;
  pageId: string;
  nome: string;
  token: string;
}

/** Quem tem esta conta ATIVA, em qualquer organização — a pergunta de "já é de outra?". */
async function sessoesAtivasDaConta(db: SupabaseClient, accountId: string) {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, organization_id, metadata")
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .eq("meta_social_account_id", accountId)
    .is("archived_at", null);
  if (error) return null;
  return (data ?? []) as { id: string; organization_id: string; metadata: Record<string, unknown> | null }[];
}

async function gravarConta(
  db: SupabaseClient,
  org: string,
  conta: ContaParaGravar,
): Promise<DesfechoDaConta> {
  const base = { conta: conta.accountId, plataforma: conta.plataforma } as const;
  const linhas = await sessoesAtivasDaConta(db, conta.accountId);
  if (!linhas) return { ...base, resultado: "falhou" };
  if (linhas.some((l) => l.organization_id !== org)) return { ...base, resultado: "conta_em_outra_organizacao" };

  const tokenCifrado = await encryptWebhookSecret(db, conta.token);
  if (!tokenCifrado) return { ...base, resultado: "falhou" };
  const rotulo = `${conta.plataforma === "instagram" ? "Instagram" : "Facebook"} · ${conta.nome}`;

  const existente = linhas[0];
  if (existente) {
    const { error } = await db
      .from("channel_sessions")
      .update({
        meta_social_page_id: conta.pageId,
        meta_social_token_encrypted: tokenCifrado,
        status: "WORKING",
        last_status_change_at: new Date().toISOString(),
        metadata: { ...(existente.metadata ?? {}), social_platform: conta.plataforma },
      })
      .eq("organization_id", org)
      .eq("id", existente.id);
    return error ? { ...base, resultado: "falhou" } : { ...base, resultado: "atualizada", channelId: existente.id };
  }

  // A coluna é NOT NULL desde o dump; esta porta não usa segredo por sessão
  // (quem assina a entrega é o app), então o valor é aleatório e nunca lido.
  const segredoCifrado = await encryptWebhookSecret(db, randomBytes(32).toString("hex"));
  if (!segredoCifrado) return { ...base, resultado: "falhou" };
  const { data, error } = await db
    .from("channel_sessions")
    .insert({
      organization_id: org,
      provider: CHANNEL_PROVIDER_SOCIAL_DIRETA,
      meta_social_account_id: conta.accountId,
      meta_social_page_id: conta.pageId,
      meta_social_token_encrypted: tokenCifrado,
      webhook_secret_encrypted: segredoCifrado,
      display_name: rotulo,
      status: "WORKING",
      // A IA nasce desligada: o mesmo contrato do canal social intermediado.
      metadata: { ...metadataInicialDoCanal(), social_platform: conta.plataforma },
    })
    .select("id")
    .single();
  if (lerLimiteEstourado(error)) return { ...base, resultado: "limite_do_plano" };
  if (error?.code === "23505") return { ...base, resultado: "conta_em_outra_organizacao" };
  if (error || !data) return { ...base, resultado: "falhou" };
  return { ...base, resultado: "conectada", channelId: (data as { id: string }).id };
}

/** Assina o app na Página — sem isto o token é bom e nenhuma mensagem chega. */
async function assinarAppNaPagina(pagina: PaginaAutorizada): Promise<void> {
  await chamarGraph(`${encodeURIComponent(pagina.id)}/subscribed_apps`, {
    metodo: "POST",
    token: pagina.token,
    formulario: { subscribed_fields: CAMPOS_ASSINADOS.join(",") },
  });
}

export async function conectarPaginas(
  db: SupabaseClient,
  org: string,
  paginas: PaginaAutorizada[],
): Promise<DesfechoDaConta[]> {
  const desfechos: DesfechoDaConta[] = [];
  for (const pagina of paginas) {
    try {
      await assinarAppNaPagina(pagina);
    } catch (erro) {
      logger.warn("[redes-sociais.direta] assinatura do app na Página falhou", {
        organization_id: org,
        detalhe: erro instanceof GraphSocialError ? `${erro.code}/${erro.subcode}` : "desconhecido",
      });
      desfechos.push({ conta: pagina.id, plataforma: "facebook", resultado: "falhou" });
      if (pagina.instagram) desfechos.push({ conta: pagina.instagram.id, plataforma: "instagram", resultado: "falhou" });
      continue;
    }
    desfechos.push(
      await gravarConta(db, org, {
        plataforma: "facebook",
        accountId: pagina.id,
        pageId: pagina.id,
        nome: pagina.nome,
        token: pagina.token,
      }),
    );
    if (pagina.instagram) {
      desfechos.push(
        await gravarConta(db, org, {
          plataforma: "instagram",
          accountId: pagina.instagram.id,
          pageId: pagina.id,
          nome: pagina.instagram.usuario ? `@${pagina.instagram.usuario}` : pagina.nome,
          token: pagina.token,
        }),
      );
    }
  }
  return desfechos;
}

export interface ContaDiretaNaTela {
  id: string;
  plataforma: string;
  nome: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

/** As contas ativas da porta direta DESTA organização, sem credencial nenhuma. */
export async function contasDiretas(db: SupabaseClient, org: string): Promise<ContaDiretaNaTela[]> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, display_name, status, metadata")
    .eq("organization_id", org)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("contas_diretas_ilegiveis");
  return ((data ?? []) as { id: string; display_name: string | null; status: string; metadata: Record<string, unknown> | null }[]).map(
    (l) => ({
      id: l.id,
      plataforma: typeof l.metadata?.social_platform === "string" ? l.metadata.social_platform : "facebook",
      nome: l.display_name,
      status: l.status,
      metadata: l.metadata ?? {},
    }),
  );
}

/** A conta (sessionRef) de uma sessão direta desta organização, ou `null`. */
export async function contaDaSessaoDireta(db: SupabaseClient, org: string, channelId: string): Promise<string | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("meta_social_account_id")
    .eq("organization_id", org)
    .eq("id", channelId)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error("conta_direta_ilegivel");
  return (data as { meta_social_account_id: string | null } | null)?.meta_social_account_id ?? null;
}

/**
 * O que o arquivamento de uma sessão direta apaga junto — para a rota genérica
 * de exclusão (`app/api/v1/channel-sessions/[id]`), que não pode nomear a coluna.
 */
export function credencialApagadaAoArquivar(): Record<string, null> {
  return { meta_social_token_encrypted: null };
}

/**
 * Tira a conta do atendimento: ARQUIVA a sessão (nunca apaga — as conversas
 * ficam) e apaga o token. NÃO desassina o app da Página: a mesma Página pode
 * estar servindo a outra sessão (Messenger e Instagram falam pela mesma), e
 * a entrega de uma conta sem sessão ativa já é descartada na entrada.
 */
export async function removerContaDireta(
  db: SupabaseClient,
  org: string,
  channelId: string,
): Promise<{ removida: boolean; avisos_fechados: "resolvido" | "sem_mudanca" | "falhou" }> {
  const agora = new Date().toISOString();
  const { data, error } = await db
    .from("channel_sessions")
    .update({
      archived_at: agora,
      status: "STOPPED",
      last_status_change_at: agora,
      meta_social_token_encrypted: null,
    })
    .eq("organization_id", org)
    .eq("id", channelId)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .is("archived_at", null)
    .select("id");
  if (error) throw new Error("remocao_da_conta_direta_falhou");
  if ((data ?? []).length === 0) return { removida: false, avisos_fechados: "sem_mudanca" };
  let avisos: "resolvido" | "sem_mudanca" | "falhou";
  try {
    avisos = await resolverSaudeDaConexaoRemovida(db, { id: channelId, organization_id: org, status: "STOPPED" });
  } catch {
    avisos = "falhou";
  }
  await fecharAvisoDePausaDoCanalArquivado(db, { id: channelId, organization_id: org });
  return { removida: true, avisos_fechados: avisos };
}
