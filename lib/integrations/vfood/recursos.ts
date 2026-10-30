/**
 * Operações da integração VFood sobre UMA organização — o miolo das rotas `/api/v1/integrations/vfood/*`.
 *
 * Regras que valem para tudo daqui:
 *  1. A organização só é alcançada se o provisionamento da integração a marcou com o restaurante do cabeçalho
 *     (`organizacaoDaIntegracao`); qualquer outra, existente ou não, responde 404 igual.
 *  2. Canal e agente só são tocados quando estão em `integration_resources`. O que a integração não criou
 *     (canal manual, agente manual, outro número) nunca é lido como dela, alterado, desconectado nem transferido.
 *  3. A chave de IA é a da INSTALAÇÃO (`credential_id = null`); nada aqui lê, grava ou devolve chave de IA.
 *  4. Credenciais (chave do MCP) entram cifradas e nunca saem em resposta, log ou auditoria.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { escolherModeloDoProvedor } from "@/lib/ai/agents/escolher-modelo";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { audit } from "@/lib/audit";
import { EmailJaTemContaError, ProvisionConflictError, provisionExternalTenant } from "@/lib/auth/provision";
import { lerLimiteEstourado } from "@/lib/cobranca/limites";
import { sincronizarRecebimentoDeGrupos } from "@/lib/grupos/sincronizar-filtro";
import { toolIdRemoto } from "@/lib/mcp/servidor-externo/ids";
import { BOLSO_MCP_EXTERNO, conferirEndpointSeguro, hostDoEndpoint, lerEndpointMcpExterno, mesclarServidorMcpExterno } from "@/lib/mcp/servidor-externo/registro";
import { cifrarChaveMcpExterno } from "@/lib/mcp/servidor-externo/segredo";
import { createAdminClient } from "@/lib/supabase/admin";
import { WahaSessionError, getWahaClient } from "@/lib/waha/client";
import { INTEGRACAO_VFOOD } from "./auth";

export class ErroDaIntegracao extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Exatamente as ferramentas do agente de delivery. O servidor decide o conjunto; o chamador só confirma. */
export const FERRAMENTAS_LEITURA = ["consultar_loja", "consultar_cardapio", "buscar_cliente", "cotar_entrega", "simular_pedido", "consultar_pedido"] as const;
export const FERRAMENTA_ESCRITA = "criar_pedido" as const;
export const TOOL_IDS_DO_AGENTE: string[] = [
  ...FERRAMENTAS_LEITURA.map((nome) => toolIdRemoto(nome, "leitura")),
  toolIdRemoto(FERRAMENTA_ESCRITA, "escrita_do_contato"),
];
const NOME_DO_AGENTE = "Atendente de delivery (VFood)";

type Admin = SupabaseClient;
export interface OrgDaIntegracao { id: string; settings: Record<string, unknown> }

const uuid = z.string().uuid();

// ---- posse -------------------------------------------------------------------------------------------------

/** A organização que ESTA integração criou para ESTE restaurante, ou 404. Nunca revela por que recusou. */
export async function organizacaoDaIntegracao(admin: Admin, organizationId: string, tenantId: string): Promise<OrgDaIntegracao> {
  const naoEncontrada = new ErroDaIntegracao(404, "not_found", "Organização não encontrada.");
  if (!uuid.safeParse(organizationId).success) throw naoEncontrada;
  const { data, error } = await admin.from("organizations").select("id, settings").eq("id", organizationId).maybeSingle();
  if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Banco indisponível.");
  const marcador = (data?.settings as { provisioning?: { integration?: unknown; external_id?: unknown } } | null)?.provisioning;
  if (!data || marcador?.integration !== INTEGRACAO_VFOOD || marcador.external_id !== tenantId) throw naoEncontrada;
  return { id: data.id as string, settings: (data.settings ?? {}) as Record<string, unknown> };
}

// ---- organização -------------------------------------------------------------------------------------------

export const organizacaoSchema = z
  .object({ name: z.string().trim().min(1).max(200), ownerEmail: z.string().trim().email(), ownerName: z.string().trim().min(1).max(200) })
  .strict();

/** Cria ou recupera a organização (idempotente por restaurante). NÃO emite chave de API: a integração não usa a API do atendente. */
export async function garantirOrganizacao(tenantId: string, input: z.infer<typeof organizacaoSchema>, requestId: string) {
  try {
    const r = await provisionExternalTenant({
      integration: INTEGRACAO_VFOOD, externalId: tenantId, organizationName: input.name,
      ownerEmail: input.ownerEmail, ownerName: input.ownerName, requestId,
    });
    return { organizationId: r.organizationId, replay: r.replay };
  } catch (erro) {
    if (erro instanceof ProvisionConflictError) {
      throw new ErroDaIntegracao(409, "provisioning_conflict", "Já existe uma organização com este identificador que não nasceu desta integração.");
    }
    if (erro instanceof EmailJaTemContaError) {
      throw new ErroDaIntegracao(409, "owner_email_ja_tem_conta", "O e-mail do dono da organização já tem conta nesta instalação.");
    }
    if (erro instanceof Error && erro.message.includes("plano_obrigatorio")) {
      throw new ErroDaIntegracao(422, "plano_obrigatorio", "A instalação cobra por plano e não tem plano padrão para empresas novas.");
    }
    throw erro;
  }
}

/**
 * Adoção administrativa de uma organização existente. Recusa (409) quando a organização já pertence a outra integração
 * ou a outro restaurante, e quando este restaurante já tem organização própria. Idempotente para o mesmo par.
 */
export async function adotarOrganizacao(tenantId: string, organizationId: string, requestId: string) {
  const admin = createAdminClient();
  const marcador = { integration: INTEGRACAO_VFOOD, external_id: tenantId };
  const { data: org, error } = await admin.from("organizations").select("id, settings").eq("id", organizationId).maybeSingle();
  if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Banco indisponível.");
  if (!org) throw new ErroDaIntegracao(404, "not_found", "Organização não encontrada.");
  const atual = (org.settings as { provisioning?: { integration?: unknown; external_id?: unknown } } | null)?.provisioning;
  if (atual) {
    if (atual.integration === marcador.integration && atual.external_id === marcador.external_id) return { organizationId, replay: true };
    throw new ErroDaIntegracao(409, "already_managed", "A organização já está vinculada a outra integração ou restaurante.");
  }
  const { data: outra } = await admin.from("organizations").select("id")
    .eq("settings->provisioning->>integration", marcador.integration).eq("settings->provisioning->>external_id", tenantId).neq("id", organizationId).limit(1);
  if (outra && outra.length > 0) throw new ErroDaIntegracao(409, "tenant_already_has_organization", "Este restaurante já tem uma organização vinculada.");
  const settings = { ...((org.settings ?? {}) as Record<string, unknown>), provisioning: marcador };
  const { error: erroGravar } = await admin.from("organizations").update({ settings }).eq("id", organizationId);
  if (erroGravar) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível vincular a organização.");
  void audit({
    action: "tenant.provisioning_completed", actorUserId: null, organizationId, resourceType: "organization", resourceId: organizationId,
    requestId, bypassedRls: true, metadata: { integration: INTEGRACAO_VFOOD, external_id: tenantId, completou: "adocao_administrativa" },
  });
  return { organizationId, replay: false };
}

// ---- MCP ---------------------------------------------------------------------------------------------------

export const mcpSchema = z.object({ endpoint: z.string().trim().min(1).max(500), key: z.string().trim().min(32).max(500) }).strict();

export async function registrarMcp(admin: Admin, org: OrgDaIntegracao, input: z.infer<typeof mcpSchema>, requestId: string) {
  try {
    conferirEndpointSeguro(input.endpoint);
  } catch {
    throw new ErroDaIntegracao(422, "endpoint_inseguro", "Endereço do servidor MCP recusado.");
  }
  // Um servidor MCP que alguém cadastrou à mão na organização, apontando para outro lugar, não é sobrescrito.
  const atual = lerEndpointMcpExterno(org.settings);
  if (atual && hostDoEndpoint(atual) !== hostDoEndpoint(input.endpoint)) {
    throw new ErroDaIntegracao(409, "mcp_manual_existente", "A organização já tem um servidor MCP externo próprio.");
  }
  const settings = mesclarServidorMcpExterno(org.settings, { endpoint: input.endpoint, chave: input.key });
  const { error } = await admin.from("organizations").update({ settings, ...cifrarChaveMcpExterno(input.key) }).eq("id", org.id);
  if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível gravar o servidor MCP.");
  void audit({
    action: "org.mcp_externo_registrado", actorUserId: null, organizationId: org.id, resourceType: "organization",
    resourceId: org.id, requestId, bypassedRls: true,
    // Forma, nunca credencial: só o host.
    metadata: { endpoint: hostDoEndpoint(input.endpoint), registrado: true, chave_presente: true, integration: INTEGRACAO_VFOOD },
  });
  return { ok: true as const };
}

export function mcpRegistrado(org: OrgDaIntegracao): boolean {
  return org.settings[BOLSO_MCP_EXTERNO] !== undefined && lerEndpointMcpExterno(org.settings) !== null;
}

// ---- sessão WhatsApp ---------------------------------------------------------------------------------------

interface Canal { id: string; waha_session_name: string; status: string; phone_number: string | null; archived_at: string | null; metadata: unknown }

async function canalDaIntegracao(admin: Admin, org: OrgDaIntegracao): Promise<Canal | null> {
  const { data: vinculo, error } = await admin.from("integration_resources").select("resource_id")
    .eq("organization_id", org.id).eq("integration", INTEGRACAO_VFOOD).eq("kind", "channel_session").maybeSingle();
  if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Banco indisponível.");
  if (!vinculo) return null;
  const { data: canal } = await admin.from("channel_sessions")
    .select("id, waha_session_name, status, phone_number, archived_at, metadata")
    .eq("organization_id", org.id).eq("id", vinculo.resource_id).maybeSingle();
  return (canal as Canal | null) ?? null;
}

function wahaOuErro() {
  const waha = getWahaClient();
  if (!waha) throw new ErroDaIntegracao(503, "waha_not_configured", "O WhatsApp (WAHA) não está configurado neste ambiente.");
  return waha;
}

function traduzirWaha(erro: unknown): never {
  if (erro instanceof ErroDaIntegracao) throw erro;
  if (erro instanceof WahaSessionError) throw new ErroDaIntegracao(502, "waha_unavailable", "O serviço de WhatsApp não respondeu.");
  throw erro;
}

/** Cria (uma vez) ou recupera o canal da integração e garante que a sessão esteja de pé no WAHA. Nunca apaga sessão. */
export async function garantirSessao(admin: Admin, org: OrgDaIntegracao, tenantId: string) {
  const waha = wahaOuErro();
  const { data, error } = await admin.rpc("fn_integration_ensure_channel", {
    p_org: org.id, p_integration: INTEGRACAO_VFOOD, p_external_id: tenantId, p_display_name: "WhatsApp com IA",
  });
  if (error) {
    if (lerLimiteEstourado(error)) throw new ErroDaIntegracao(422, "plan_limit", "O plano da organização não comporta mais um número de WhatsApp.");
    throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível preparar o canal.");
  }
  const canal = data as Canal;
  if (canal.archived_at) throw new ErroDaIntegracao(409, "canal_arquivado", "O canal desta integração foi excluído no VChat. É preciso regularizar.");
  try {
    const remota = await waha.getVerifiedSession(canal.waha_session_name);
    let status: string = remota?.status ?? "STARTING";
    if (!remota) await waha.createSession(canal.waha_session_name);
    if (!remota || !["WORKING", "STARTING", "SCAN_QR_CODE"].includes(remota.status)) {
      status = (await waha.startExistingSession(canal.waha_session_name)).status;
    }
    await admin.from("channel_sessions").update({ status, status_reason: null, last_status_change_at: new Date().toISOString() })
      .eq("organization_id", org.id).eq("id", canal.id);
    await sincronizarRecebimentoDeGrupos(admin, waha.definirRecebimentoDeGrupos ? (ref, receber) => waha.definirRecebimentoDeGrupos(ref, receber) : undefined,
      { organizationId: org.id, channelSessionId: canal.id, sessionRef: canal.waha_session_name });
    return { channelSessionId: canal.id, status };
  } catch (erro) {
    return traduzirWaha(erro);
  }
}

export async function lerSessao(admin: Admin, org: OrgDaIntegracao) {
  const canal = await canalDaIntegracao(admin, org);
  if (!canal) return { channelSessionId: null, status: null, phone: null, phoneConflict: false };
  let status = canal.status;
  const waha = getWahaClient();
  if (waha && !canal.archived_at) {
    // Fonte real de status: o WAHA. Se ele não responde, vale o último estado gravado (nunca afirmamos "conectado" sem ele).
    try { status = (await waha.getVerifiedSession(canal.waha_session_name))?.status ?? canal.status; } catch { /* mantém o gravado */ }
  }
  // Número já usado em OUTRO canal vivo: não transferimos nem desconectamos nada — só sinalizamos para regularização.
  let phoneConflict = false;
  if (canal.phone_number) {
    const { count } = await admin.from("channel_sessions").select("id", { count: "exact", head: true })
      .eq("phone_number", canal.phone_number).neq("id", canal.id).is("archived_at", null);
    phoneConflict = (count ?? 0) > 0;
  }
  return { channelSessionId: canal.id, status: canal.archived_at ? "STOPPED" : status, phone: canal.phone_number, phoneConflict };
}

/** O QR passa direto para a resposta: não é gravado, auditado nem logado. */
export async function qrDaSessao(admin: Admin, org: OrgDaIntegracao) {
  const canal = await canalDaIntegracao(admin, org);
  if (!canal || canal.archived_at) throw new ErroDaIntegracao(404, "not_found", "Sessão não encontrada.");
  const waha = wahaOuErro();
  try {
    const r = await waha.getSessionQr(canal.waha_session_name);
    return { qr: r.qr ?? null, expiresInSeconds: null as number | null, status: r.status };
  } catch (erro) {
    return traduzirWaha(erro);
  }
}

/** Desconecta SÓ o número da integração (stop + logout) e mantém o vínculo para reconectar por QR. */
export async function desconectarSessao(admin: Admin, org: OrgDaIntegracao, requestId: string) {
  const canal = await canalDaIntegracao(admin, org);
  if (!canal || canal.archived_at) return { ok: true as const };
  const waha = wahaOuErro();
  try {
    await waha.stopSession(canal.waha_session_name);
    try { await waha.logoutSession(canal.waha_session_name); } catch { /* já deslogada */ }
  } catch (erro) {
    return traduzirWaha(erro);
  }
  await admin.from("channel_sessions").update({ status: "STOPPED", status_reason: "disconnected_by_integration", last_status_change_at: new Date().toISOString() })
    .eq("organization_id", org.id).eq("id", canal.id);
  void audit({ action: "channel.disabled", actorUserId: null, organizationId: org.id, resourceType: "channel_session", resourceId: canal.id, requestId, bypassedRls: true, metadata: { integration: INTEGRACAO_VFOOD } });
  return { ok: true as const };
}

// ---- agente ------------------------------------------------------------------------------------------------

export const agenteSchema = z
  .object({ promptVersion: z.number().int().min(1).max(10_000), instructions: z.string().trim().min(50).max(8_000), tools: z.array(z.string()).max(20) })
  .strict();

function aMesmaLista(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

function modeloConfigurado() {
  const provider = (process.env.VFOOD_AGENT_PROVIDER ?? "").trim() || null;
  const model = (process.env.VFOOD_AGENT_MODEL ?? "").trim() || null;
  const inteiro = (nome: string) => { const n = Number(process.env[nome]); return Number.isInteger(n) && n > 0 ? n : null; };
  return { provider, model, costBudgetCents: inteiro("VFOOD_AGENT_COST_BUDGET_CENTS"), tokenBudget: inteiro("VFOOD_AGENT_TOKEN_BUDGET") };
}

/** Cria ou atualiza o agente da integração SEM ativá-lo (a pausa/atividade atual é preservada). */
export async function garantirAgente(admin: Admin, org: OrgDaIntegracao, tenantId: string, input: z.infer<typeof agenteSchema>, requestId: string) {
  // O conjunto é do servidor: pedir qualquer outra ferramenta é recusado, nunca ampliado.
  const esperado = [...FERRAMENTAS_LEITURA, FERRAMENTA_ESCRITA];
  if (!aMesmaLista(input.tools, esperado)) throw new ErroDaIntegracao(422, "tools_not_allowed", "O agente de delivery só admite as sete ferramentas do VFood.");
  if (!mcpRegistrado(org)) throw new ErroDaIntegracao(422, "mcp_required", "Cadastre o servidor MCP antes do agente.");
  const canal = await canalDaIntegracao(admin, org);
  if (!canal || canal.archived_at) throw new ErroDaIntegracao(422, "session_required", "Crie a sessão do WhatsApp antes do agente.");

  const cfg = modeloConfigurado();
  const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", org.id).maybeSingle();
  const provider = cfg.provider ?? ((orgRow?.settings as { llm?: { provider?: unknown } } | null)?.llm?.provider as string | undefined) ?? "anthropic";
  // Chave da instalação: sem ela o agente morreria em toda mensagem. Falha cedo, com causa de configuração.
  if (!chaveDePlataforma(provider)) throw new ErroDaIntegracao(422, "ai_key_missing", "A instalação não tem chave de IA para este provedor.");
  let model = cfg.model;
  if (!model) {
    const { data: modelos } = await admin.from("ai_models")
      .select("model_id, is_default_for_provider, supports_tools, input_price_per_million_cents, output_price_per_million_cents")
      .eq("provider", provider).is("deprecated_at", null);
    const escolha = escolherModeloDoProvedor((modelos ?? []) as Parameters<typeof escolherModeloDoProvedor>[0]);
    if (!escolha.escolhido) throw new ErroDaIntegracao(422, "ai_model_missing", "Nenhum modelo de IA com ferramentas está disponível.");
    model = escolha.modelId;
  }

  const { data: agenteRow, error: erroAgente } = await admin.rpc("fn_integration_ensure_agent", {
    p_org: org.id, p_integration: INTEGRACAO_VFOOD, p_external_id: tenantId, p_name: NOME_DO_AGENTE, p_system_prompt: input.instructions,
  });
  if (erroAgente) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível preparar o agente.");
  const agente = agenteRow as { id: string; published_version_id: string | null };

  if (agente.published_version_id) {
    const { data: atual } = await admin.from("ai_agent_versions").select("system_prompt, tool_ids, provider, model, channel_session_id")
      .eq("organization_id", org.id).eq("id", agente.published_version_id).maybeSingle();
    if (atual && atual.system_prompt === input.instructions && aMesmaLista(atual.tool_ids ?? [], TOOL_IDS_DO_AGENTE)
      && atual.provider === provider && atual.model === model && atual.channel_session_id === canal.id) {
      return { agentId: agente.id };
    }
  }

  const { data: ultima } = await admin.from("ai_agent_versions").select("version_number").eq("organization_id", org.id)
    .eq("agent_id", agente.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { data: versao, error: erroVersao } = await admin.from("ai_agent_versions").insert({
    organization_id: org.id, agent_id: agente.id, version_number: (ultima?.version_number ?? 0) + 1,
    system_prompt: input.instructions, provider, model, credential_id: null, tool_ids: TOOL_IDS_DO_AGENTE,
    pipeline_ids: [], channel_session_id: canal.id, status: "draft",
    ...(cfg.costBudgetCents ? { cost_budget_cents: cfg.costBudgetCents } : {}),
    ...(cfg.tokenBudget ? { token_budget: cfg.tokenBudget } : {}),
  }).select("id").single();
  if (erroVersao || !versao) {
    // 23505: duas atualizações concorrentes disputaram o número; a outra venceu e a próxima tentativa reconcilia.
    throw new ErroDaIntegracao(erroVersao?.code === "23505" ? 409 : 503, erroVersao?.code === "23505" ? "version_conflict" : "database_unavailable", "Não foi possível gravar a versão do agente.");
  }
  const publicada = await publishAgentVersion(admin, { orgId: org.id, agentId: agente.id, versionId: versao.id as string });
  if (!publicada.ok) throw new ErroDaIntegracao(422, `publish_failed`, `Publicação do agente recusada (${publicada.code}).`);
  void audit({ action: "ai_agent.published", actorUserId: null, organizationId: org.id, resourceType: "ai_agent", resourceId: agente.id, requestId, bypassedRls: true, metadata: { integration: INTEGRACAO_VFOOD, prompt_version: input.promptVersion } });
  return { agentId: agente.id };
}

async function agenteDaIntegracao(admin: Admin, org: OrgDaIntegracao) {
  const { data: vinculo } = await admin.from("integration_resources").select("resource_id")
    .eq("organization_id", org.id).eq("integration", INTEGRACAO_VFOOD).eq("kind", "ai_agent").maybeSingle();
  if (!vinculo) return null;
  const { data } = await admin.from("ai_agents").select("id, is_active, published_version_id")
    .eq("organization_id", org.id).eq("id", vinculo.resource_id).maybeSingle();
  return (data as { id: string; is_active: boolean; published_version_id: string | null } | null) ?? null;
}

export async function estadoDoAgente(admin: Admin, org: OrgDaIntegracao) {
  const agente = await agenteDaIntegracao(admin, org);
  const canal = await canalDaIntegracao(admin, org);
  const missing: string[] = [];
  if (!mcpRegistrado(org)) missing.push("mcp");
  if (!canal || canal.archived_at) missing.push("session");
  if (!agente?.published_version_id) missing.push("published_version");
  return { agentId: agente?.id ?? null, active: Boolean(agente?.is_active), ready: missing.length === 0, missing };
}

/** Ativa ou pausa SÓ o agente da integração. Ativar exige tudo pronto e o número conectado (conferido no WAHA). */
export async function definirAgenteAtivo(admin: Admin, org: OrgDaIntegracao, active: boolean, requestId: string) {
  const agente = await agenteDaIntegracao(admin, org);
  if (!agente) {
    if (!active) return { active: false };
    throw new ErroDaIntegracao(422, "agent_required", "O agente da integração ainda não foi criado.");
  }
  if (!active) {
    const { error } = await admin.from("ai_agents").update({ is_active: false }).eq("organization_id", org.id).eq("id", agente.id);
    if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível pausar o agente.");
    void audit({ action: "ai_agent.paused", actorUserId: null, organizationId: org.id, resourceType: "ai_agent", resourceId: agente.id, requestId, bypassedRls: true, metadata: { integration: INTEGRACAO_VFOOD } });
    return { active: false };
  }
  const estado = await estadoDoAgente(admin, org);
  if (!estado.ready) throw new ErroDaIntegracao(422, "not_ready", `Configuração incompleta: ${estado.missing.join(", ")}.`);
  const sessao = await lerSessao(admin, org);
  if (sessao.status !== "WORKING") throw new ErroDaIntegracao(409, "session_not_connected", "O WhatsApp ainda não está conectado.");
  if (sessao.phoneConflict) throw new ErroDaIntegracao(409, "phone_in_use", "Este número já está em uso em outro canal. É preciso regularizar.");
  // Abre o canal da integração ao público (o pré-go-live é a trava de todo canal novo). Só o canal DELA.
  const { data: aberto, error: erroGate } = await admin.rpc("fn_configurar_pre_go_live_canal", {
    p_org: org.id, p_canal: sessao.channelSessionId, p_modo: "open", p_numeros: [],
  });
  if (erroGate || aberto !== 1) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível abrir o canal para a IA.");
  const { error } = await admin.from("ai_agents").update({ is_active: true }).eq("organization_id", org.id).eq("id", agente.id);
  if (error) throw new ErroDaIntegracao(503, "database_unavailable", "Não foi possível ativar o agente.");
  void audit({ action: "ai_agent.updated", actorUserId: null, organizationId: org.id, resourceType: "ai_agent", resourceId: agente.id, requestId, bypassedRls: true, metadata: { integration: INTEGRACAO_VFOOD, ativado: true } });
  return { active: true };
}

