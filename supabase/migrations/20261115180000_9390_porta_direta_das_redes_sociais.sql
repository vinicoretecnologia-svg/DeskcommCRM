-- manifest: [backport VPS] a porta DIRETA das redes sociais (Instagram Direct e Messenger da Página, pela Graph API sem intermediário) entra como provedor `meta_social` — conta, Página e token da Página cifrado; uma conta, uma conexão ativa. Issues #965 / #1320.
--
-- Versão para a base da VPS (ad4351d0d + backports): as listas dos CHECKs são
-- as MEDIDAS no banco de produção em 15/11/2026 mais 'meta_social' — sem o
-- Telegram, que esta base não tem (a coluna `telegram_bot_id` nem existe aqui).
-- Alargamento puro e idempotente: reaplicar não muda nada.

alter table public.channel_sessions
  add column if not exists meta_social_account_id text,
  add column if not exists meta_social_page_id text,
  add column if not exists meta_social_token_encrypted bytea;

do $$
begin
  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_check
    check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text,
                                 'wacalls'::text, 'zernio_social'::text, 'datafy'::text,
                                 'meta_social'::text]));

  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls'    and wacalls_session_id    is not null) or
    (provider = 'datafy'     and datafy_phone_number_id is not null) or
    (provider = 'meta_social' and meta_social_account_id is not null)
  );
end
$$;

do $$
begin
  alter table public.webhook_events_log drop constraint if exists webhook_events_log_provider_check;
  alter table public.webhook_events_log add constraint webhook_events_log_provider_check
    check (provider in (
      'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy',
      'stripe', 'asaas', 'meta_social'
    ));
end
$$;

comment on column public.channel_sessions.meta_social_account_id is
  'Conta na porta direta das redes sociais: id da Página (Messenger) ou da conta do Instagram. É o sessionRef e o entry.id do webhook.';
comment on column public.channel_sessions.meta_social_page_id is
  'Página que fala pela conta da porta direta (no Messenger, a própria conta). O envio sai por POST /{página}/messages.';
comment on column public.channel_sessions.meta_social_token_encrypted is
  'Token da Página cifrado por fn_encrypt_oauth. Nunca volta para a tela nem para o log.';

create unique index if not exists channel_sessions_meta_social_account_ativa_unique
  on public.channel_sessions (meta_social_account_id)
  where archived_at is null and meta_social_account_id is not null;

notify pgrst, 'reload schema';
