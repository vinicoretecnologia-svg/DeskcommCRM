-- manifest: a porta DIRETA das redes sociais (Instagram Direct e Messenger da Página, pela Graph API sem intermediário) entra no seam como provedor `meta_social` — a sessão guarda a conta (Página ou Instagram), a Página que fala por ela e o token da Página cifrado; uma conta, uma conexão ativa. Issues #965 / #1320.
--
-- ─── O que entra ───────────────────────────────────────────────────────────
--
--   1. Três colunas em `channel_sessions`:
--        - `meta_social_account_id`: a CONTA nesta porta — o id da Página
--          (Messenger) ou da conta profissional do Instagram. É o `sessionRef`
--          do canal e é o `entry[].id` que o webhook da plataforma traz, por
--          isso é por ela que a entrada acha a sessão;
--        - `meta_social_page_id`: a Página que FALA pela conta. No Messenger é a
--          própria conta; no Instagram é a Página a que a conta está ligada —
--          o envio sai por `POST /{página}/messages` nos dois casos;
--        - `meta_social_token_encrypted`: o token da PÁGINA, cifrado pelas
--          mesmas RPCs do resto do repo (`fn_encrypt_oauth`, via
--          `lib/webhooks/secrets.ts`). Nunca volta para a tela nem para o log.
--   2. `'meta_social'` no vocabulário de `channel_sessions.provider` e no ramo
--      do `channel_sessions_provider_ref_check` (exige `meta_social_account_id`).
--   3. `'meta_social'` em `webhook_events_log_provider_check`: sem o valor, o
--      corpo cru de toda entrega deixava de ser guardado — o mesmo defeito
--      medido no robô do Telegram (9342).
--   4. Índice único da conta ATIVA, no molde da 0165 e da 9342: duas sessões
--      ativas não podem apontar para a MESMA conta. O webhook da plataforma é
--      um só para a instalação inteira e acha a sessão pela conta do evento;
--      duas organizações com a mesma conta fariam a caixa de entrada de uma
--      receber as conversas da outra.
--
-- `conversations_channel_check` NÃO muda: ele já aceita 'instagram' e
-- 'facebook' desde a 0368, e é a rede (não a porta) que vai para a conversa.
--
-- ─── Reaplicação ───────────────────────────────────────────────────────────
--
-- `add column if not exists`; cada constraint trocada dentro de um bloco `do`
-- (com o `update.sh` sem `ON_ERROR_STOP`, `drop` e `add` soltos deixariam a
-- tabela SEM guarda se o `add` falhasse); `create index if not exists`.
-- Alargamento puro: nenhuma linha que passava pelas listas antigas falha nas
-- novas, então não há backfill antes das constraints.

alter table public.channel_sessions
  add column if not exists meta_social_account_id text,
  add column if not exists meta_social_page_id text,
  add column if not exists meta_social_token_encrypted bytea;

do $$
begin
  if to_regclass('public.channel_sessions') is not null then
    comment on column public.channel_sessions.meta_social_account_id is
      'Conta na porta direta das redes sociais: id da Página (Messenger) ou da conta do Instagram. É o sessionRef e o entry.id do webhook.';
    comment on column public.channel_sessions.meta_social_page_id is
      'Página que fala pela conta da porta direta (no Messenger, a própria conta). O envio sai por POST /{página}/messages.';
    comment on column public.channel_sessions.meta_social_token_encrypted is
      'Token da Página cifrado por fn_encrypt_oauth. Nunca volta para a tela nem para o log.';
  end if;
end
$$;

-- ─── Vocabulário do provider ───────────────────────────────────────────────
do $$
begin
  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_check
    check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text,
                                 'wacalls'::text, 'zernio_social'::text, 'datafy'::text,
                                 'telegram'::text, 'meta_social'::text]));

  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls'    and wacalls_session_id    is not null) or
    (provider = 'datafy'     and datafy_phone_number_id is not null) or
    (provider = 'telegram'   and telegram_bot_id      is not null) or
    (provider = 'meta_social' and meta_social_account_id is not null)
  );
end
$$;

-- ─── O arquivo do webhook aceita a porta direta ────────────────────────────
do $$
begin
  alter table public.webhook_events_log drop constraint if exists webhook_events_log_provider_check;
  alter table public.webhook_events_log add constraint webhook_events_log_provider_check
    check (provider in (
      'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy',
      'stripe', 'asaas', 'telegram', 'meta_social'
    ));
end
$$;

-- ─── Uma conta, uma conexão ativa ──────────────────────────────────────────
create unique index if not exists channel_sessions_meta_social_account_ativa_unique
  on public.channel_sessions (meta_social_account_id)
  where archived_at is null and meta_social_account_id is not null;

notify pgrst, 'reload schema';
