import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { lerToolIdRemoto } from "@/lib/mcp/servidor-externo/ids";
import {
  TOOL_IDS_DO_AGENTE, agenteSchema, garantirAgente, mcpSchema, organizacaoDaIntegracao, registrarMcp,
  type ErroDaIntegracao,
} from "./recursos";

const TENANT = "2814a8b2-c64f-4ef2-b761-7476331cb4b7";
const OUTRO = "11111111-1111-4111-8111-111111111111";
const ORG = "7a16ec1d-a061-4d24-add6-43251d9bb8ce";

/** Banco falso mínimo: uma única linha de `organizations`; qualquer outra tabela explode, provando que não foi tocada. */
function bancoComOrganizacao(settings: unknown, achada = true): SupabaseClient {
  return {
    from(tabela: string) {
      if (tabela !== "organizations") throw new Error(`tabela inesperada: ${tabela}`);
      const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: async () => ({ data: achada ? { id: ORG, settings } : null, error: null }) };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const marcadoPara = (tenantId: string) => ({ provisioning: { integration: "vfood", external_id: tenantId } });
const falha = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ErroDaIntegracao; } throw new Error("não falhou"); };

describe("posse da organização pela integração", () => {
  it("aceita só a organização marcada para ESTE restaurante", async () => {
    await expect(organizacaoDaIntegracao(bancoComOrganizacao(marcadoPara(TENANT)), ORG, TENANT)).resolves.toMatchObject({ id: ORG });
  });
  it("outro restaurante, organização manual, outra integração e id inválido dão o mesmo 404", async () => {
    const casos: Array<[unknown, string, string]> = [
      [marcadoPara(TENANT), ORG, OUTRO],
      [{}, ORG, TENANT],
      [{ provisioning: { integration: "clinicfx", external_id: TENANT } }, ORG, TENANT],
      [marcadoPara(TENANT), "nao-e-uuid", TENANT],
    ];
    for (const [settings, org, tenant] of casos) {
      const erro = await falha(organizacaoDaIntegracao(bancoComOrganizacao(settings), org, tenant));
      expect(erro).toMatchObject({ status: 404, code: "not_found" });
    }
    expect(await falha(organizacaoDaIntegracao(bancoComOrganizacao(null, false), ORG, TENANT))).toMatchObject({ status: 404 });
  });
});

describe("ferramentas do agente de delivery", () => {
  it("são exatamente as sete, e só criar_pedido escreve (restrita ao contato)", () => {
    expect(TOOL_IDS_DO_AGENTE).toHaveLength(7);
    const lidas = TOOL_IDS_DO_AGENTE.map((id) => lerToolIdRemoto(id));
    expect(lidas.every((l) => l !== null)).toBe(true);
    expect(lidas.filter((l) => l!.escritaDoContato).map((l) => l!.nome)).toEqual(["criar_pedido"]);
    expect(lidas.filter((l) => l!.leitura)).toHaveLength(6);
  });
  it("recusa ferramenta fora do conjunto antes de tocar no banco", async () => {
    const banco = { from: () => { throw new Error("não devia tocar no banco"); } } as unknown as SupabaseClient;
    const org = { id: ORG, settings: {} };
    const entrada = agenteSchema.parse({ promptVersion: 1, instructions: "x".repeat(60), tools: ["consultar_loja", "apagar_tudo"] });
    expect(await falha(garantirAgente(banco, org, TENANT, entrada, "r"))).toMatchObject({ status: 422, code: "tools_not_allowed" });
  });
});

describe("servidor MCP da integração", () => {
  const chave = "k".repeat(64);
  it("não sobrescreve um servidor MCP manual apontando para outro host", async () => {
    const org = { id: ORG, settings: { mcp_externo: { endpoint: "https://erp.exemplo.com.br/mcp" } } };
    const banco = { from: () => { throw new Error("não devia gravar"); } } as unknown as SupabaseClient;
    const entrada = mcpSchema.parse({ endpoint: "https://vfood.vinicoretecnologia.com/mcp/vchat/" + TENANT, key: chave });
    expect(await falha(registrarMcp(banco, org, entrada, "r"))).toMatchObject({ status: 409, code: "mcp_manual_existente" });
  });
  it("exige chave longa e recusa endereço com segredo na query", async () => {
    expect(mcpSchema.safeParse({ endpoint: "https://x.com/mcp", key: "curta" }).success).toBe(false);
    const org = { id: ORG, settings: {} };
    const banco = { from: () => { throw new Error("não devia gravar"); } } as unknown as SupabaseClient;
    const entrada = mcpSchema.parse({ endpoint: "https://vfood.vinicoretecnologia.com/mcp?token=abc", key: chave });
    expect(await falha(registrarMcp(banco, org, entrada, "r"))).toMatchObject({ status: 422, code: "endpoint_inseguro" });
  });
});
