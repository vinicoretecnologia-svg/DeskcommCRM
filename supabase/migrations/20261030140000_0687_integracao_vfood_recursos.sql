-- manifest: recursos (canal e agente) que uma integração externa (VFood) criou numa organização, com unicidade e criação atômica, só pelo service_role
--
-- A integração administra SOMENTE o que está nesta tabela. Canal ou agente da mesma organização que ela não criou
-- (configuração manual, outro número) nunca é lido como seu, alterado, desconectado nem transferido.
-- Aditiva: nenhuma tabela existente muda. Sem RLS permissiva de propósito: ninguém além do service_role enxerga ou escreve aqui.

create table if not exists public.integration_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration text not null check (integration ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  external_id text not null check (length(external_id) between 1 and 200),
  kind text not null check (kind in ('channel_session', 'ai_agent')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  -- um recurso de cada tipo por organização e integração: dois cliques simultâneos recuperam o mesmo
  unique (organization_id, integration, kind),
  -- e o mesmo recurso nunca pertence a duas integrações/organizações
  unique (integration, kind, resource_id)
);

alter table public.integration_resources enable row level security;
revoke all on table public.integration_resources from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_resources to service_role;

-- Canal WhatsApp da integração: cria (uma vez) ou devolve o já vinculado. Nasce FECHADO para a IA (pré-go-live),
-- como todo canal do produto; a abertura é um passo explícito da ativação. Não passa pelo fluxo de reserva do painel
-- (que exige um membro logado com MFA) e não cria nada no WAHA: isso é feito pelo servidor, de forma idempotente.
create or replace function public.fn_integration_ensure_channel(
  p_org uuid, p_integration text, p_external_id text, p_display_name text default null
) returns public.channel_sessions
language plpgsql security definer set search_path = public as $$
declare ch public.channel_sessions; link public.integration_resources;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_integration || ':channel_session', 2687));
  select * into link from public.integration_resources
    where organization_id = p_org and integration = p_integration and kind = 'channel_session';
  if found then
    select * into ch from public.channel_sessions where id = link.resource_id and organization_id = p_org;
    if not found then raise exception 'integration_resource_missing' using errcode = 'P0002'; end if;
    return ch;
  end if;
  insert into public.channel_sessions(organization_id, waha_session_name, display_name, engine, webhook_path_token,
    webhook_secret_encrypted, status, last_status_change_at, consecutive_health_fails, daily_message_limit, metadata)
  values (p_org, 'org_' || left(replace(p_org::text, '-', ''), 8) || '_' || replace(gen_random_uuid()::text, '-', ''),
    p_display_name, 'NOWEB', replace(gen_random_uuid()::text, '-', ''), '\x00'::bytea, 'STARTING', now(), 0, 250,
    '{"ai_gate":"allowlist","ai_gate_mode":"pre_go_live","ai_test_phone_numbers":[]}'::jsonb)
  returning * into ch;
  insert into public.integration_resources(organization_id, integration, external_id, kind, resource_id)
    values (p_org, p_integration, p_external_id, 'channel_session', ch.id);
  return ch;
end;
$$;
revoke all on function public.fn_integration_ensure_channel(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_integration_ensure_channel(uuid, text, text, text) to service_role;

-- Agente da integração: cria (uma vez) a linha de `ai_agents`, INATIVA, ou devolve a já vinculada.
-- A versão de prompt e a publicação são feitas pelo servidor sobre este agente.
create or replace function public.fn_integration_ensure_agent(
  p_org uuid, p_integration text, p_external_id text, p_name text, p_system_prompt text
) returns public.ai_agents
language plpgsql security definer set search_path = public as $$
declare ag public.ai_agents; link public.integration_resources;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_integration || ':ai_agent', 2687));
  select * into link from public.integration_resources
    where organization_id = p_org and integration = p_integration and kind = 'ai_agent';
  if found then
    select * into ag from public.ai_agents where id = link.resource_id and organization_id = p_org;
    if not found then raise exception 'integration_resource_missing' using errcode = 'P0002'; end if;
    return ag;
  end if;
  insert into public.ai_agents(organization_id, name, is_active, is_default, system_prompt, kind,
    config)
  values (p_org, p_name, false, false, p_system_prompt, 'mcp_agent',
    jsonb_build_object('temperature', 0.3, 'max_tokens', 1024, 'context_message_window', 20, 'zero_data_retention', false,
      'mcp_externo_no_atendimento', true, 'managed_by', p_integration))
  returning * into ag;
  insert into public.integration_resources(organization_id, integration, external_id, kind, resource_id)
    values (p_org, p_integration, p_external_id, 'ai_agent', ag.id);
  return ag;
end;
$$;
revoke all on function public.fn_integration_ensure_agent(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_integration_ensure_agent(uuid, text, text, text, text) to service_role;
