/**
 * "Entender áudios e fotos" tem chave de IA para trabalhar?
 *
 * A leitura de mídia usa o provedor PADRÃO da empresa (`settings.llm.provider`).
 * Foi exatamente aqui que ela nunca funcionou numa instalação real: o padrão
 * estava em Anthropic e só existia chave da OpenAI — cada áudio e cada foto
 * terminava "não lida" sem ninguém ver. Este auxiliar existe para a tela dizer
 * isso em uma etiqueta, em vez de esperar o cliente reclamar.
 *
 * Devolve `null` quando NÃO dá para saber (erro de leitura): a tela não mostra
 * etiqueta nenhuma, em vez de mentir com "Funcionando".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const CHAVE_DA_INSTALACAO: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function provedorPadrao(settings: unknown): string {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const llm = s.llm && typeof s.llm === "object" ? (s.llm as Record<string, unknown>) : {};
  return typeof llm.provider === "string" && llm.provider.length > 0 ? llm.provider : "anthropic";
}

export async function iaDeMidiaDisponivel(
  db: SupabaseClient,
  organizationId: string,
  settings: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean | null> {
  const provedor = provedorPadrao(settings);
  const nomeDaChave = CHAVE_DA_INSTALACAO[provedor];
  if (nomeDaChave && (env[nomeDaChave] ?? "").trim() !== "") return true;

  try {
    const { data, error } = await db
      .from("ai_provider_credentials")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", provedor)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .limit(1);
    if (error) return null;
    return (data ?? []).length > 0;
  } catch {
    return null;
  }
}
