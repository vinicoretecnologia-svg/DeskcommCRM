"use server";

/**
 * Grava as chaves simples do "Atendimento automático": esperar antes de
 * responder, pausa entre respostas e entender áudios e fotos. O que cada uma
 * decide e por que moram em `organizations.settings` está em
 * `lib/organizacao/atendimento-automatico.ts`.
 *
 * ⚠️ SERVICE ROLE COM `organization_id` DE FONTE CONFIÁVEL, como
 * `definirBloqueioDeChamadas`: pelo client de sessão, o UPDATE de um admin de
 * tenant em `organizations` casa ZERO linhas e devolve sucesso. O id vem de
 * `resolveActiveOrg`, nunca de argumento.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { supportWriteError } from "@/lib/impersonate/support";
import {
  comAtendimentoAutomatico,
  ESPERA_MAX_S,
  PAUSA_MAX_S,
  type AtendimentoAutomaticoPatch,
} from "@/lib/organizacao/atendimento-automatico";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResultadoAtendimentoAutomatico =
  | { ok: true }
  | {
      ok: false;
      error:
        | "validation_failed"
        | "unauthenticated"
        | "forbidden_tenant"
        | "forbidden_role"
        | "mfa_required"
        | "erro_ao_gravar";
    };

const ChaveComTempo = (max: number) =>
  z.object({ ligada: z.boolean(), segundos: z.number().int().min(0).max(max) }).strict();

const Entrada = z
  .object({
    espera: ChaveComTempo(ESPERA_MAX_S).optional(),
    pausa: ChaveComTempo(PAUSA_MAX_S).optional(),
    midia: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.espera !== undefined || v.pausa !== undefined || v.midia !== undefined);

/** Cada chave salva sozinha: o patch traz só o que o administrador mexeu. */
export async function definirAtendimentoAutomatico(
  patch: AtendimentoAutomaticoPatch,
): Promise<ResultadoAtendimentoAutomatico> {
  // Server Action é endpoint público: o tipo do parâmetro não chega ao servidor.
  const entrada = Entrada.safeParse(patch);
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden_role" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(user, org)) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };

  // `settings` é jsonb compartilhado: ler, mesclar e gravar preserva o que não é nosso.
  const novo = comAtendimentoAutomatico(atual?.settings, entrada.data);
  const { error } = await admin.from("organizations").update({ settings: novo }).eq("id", org.orgId);
  if (error) return { ok: false, error: "erro_ao_gravar" };

  await audit({
    action: "atendimento.automatico_updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization",
    resourceId: org.orgId,
    metadata: entrada.data,
  });

  revalidatePath("/app/settings/atendimento");
  return { ok: true };
}
