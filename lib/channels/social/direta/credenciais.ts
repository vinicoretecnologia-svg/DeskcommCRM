/**
 * A credencial de UMA conta da porta direta — lida sempre por (organização,
 * conta), nunca só pela conta.
 *
 * O índice único da migration 9390 já impede duas sessões ATIVAS com a mesma
 * conta, mas a arquivada fica: sem o filtro de organização, um `maybeSingle()`
 * com service role podia achar a linha de outro tenant (a issue #236 inteira).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_SOCIAL_DIRETA } from "../../capabilities";

export interface CredencialDaContaDireta {
  channelSessionId: string;
  accountId: string;
  pageId: string;
  token: string;
  plataforma: string | null;
}

export async function credencialDaContaDireta(
  db: SupabaseClient,
  alvo: { organizationId: string; accountId: string },
): Promise<CredencialDaContaDireta | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, meta_social_account_id, meta_social_page_id, meta_social_token_encrypted, metadata")
    .eq("organization_id", alvo.organizationId)
    .eq("provider", CHANNEL_PROVIDER_SOCIAL_DIRETA)
    .eq("meta_social_account_id", alvo.accountId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error("credencial_da_conta_direta_ilegivel");
  if (!data) return null;
  const linha = data as {
    id: string;
    meta_social_account_id: string;
    meta_social_page_id: string | null;
    meta_social_token_encrypted: string | null;
    metadata: Record<string, unknown> | null;
  };
  if (!linha.meta_social_page_id || !linha.meta_social_token_encrypted) return null;
  const token = await decryptWebhookSecret(db, linha.meta_social_token_encrypted);
  if (!token) return null;
  const plataforma = linha.metadata?.social_platform;
  return {
    channelSessionId: linha.id,
    accountId: linha.meta_social_account_id,
    pageId: linha.meta_social_page_id,
    token,
    plataforma: typeof plataforma === "string" ? plataforma : null,
  };
}
