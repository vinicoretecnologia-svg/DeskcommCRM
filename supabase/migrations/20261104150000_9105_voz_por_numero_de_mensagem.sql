-- manifest: **Chamada de voz por número.** `channel_sessions.voice_for_channel_session_id` diz a qual número de mensagem da MESMA organização um aparelho de voz (`provider = 'wacalls'`) atende, e um índice único parcial garante um pareamento de voz por número. Linhas antigas ficam nulas de propósito (voz da organização, como era).
--
-- 9105 — a voz deixa de ser "uma por organização".
--
-- ═══ Por quê ═══
--
-- A voz (WaCalls) buscava "a" linha `provider = 'wacalls'` da organização com
-- `maybeSingle()`. Empresa com dois números (o caso da VPlay) só ligava por um,
-- e o atendente não escolhia qual. O vínculo explícito resolve: cada aparelho de
-- voz aponta para o número de mensagem que ele atende, e a ligação sai por aquele.
--
-- ═══ O que NÃO muda ═══
--
-- - Linha de voz sem vínculo (a coluna nula) segue valendo como a voz da
--   organização inteira: o resolvedor cai nela quando o número não tem voz própria
--   e nada exige migração de dado. O `update.sh` de um clone com voz já pareada
--   não tem o que corrigir.
-- - A cobrança continua ignorando `provider = 'wacalls'`: voz não ocupa número pago.
--
-- ═══ Tenancy ═══
--
-- A chave estrangeira é COMPOSTA `(organization_id, voice_for_channel_session_id)
-- → channel_sessions (organization_id, id)`, usando o índice único que a tabela já
-- tem (`channel_sessions_org_id_unique`). Um admin que escrevesse esta coluna
-- direto pela API do banco não consegue apontar para o número de OUTRA
-- organização. `on delete set null (coluna)` zera só o vínculo, nunca o
-- `organization_id` (que é `not null`); exige Postgres 15, o piso do produto.
--
-- Idempotente: `add column if not exists`, constraint guardada por catálogo,
-- `create unique index if not exists`.

alter table public.channel_sessions
  add column if not exists voice_for_channel_session_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.channel_sessions'::regclass
       and conname = 'channel_sessions_voice_for_fk'
  ) then
    alter table public.channel_sessions
      add constraint channel_sessions_voice_for_fk
      foreign key (organization_id, voice_for_channel_session_id)
      references public.channel_sessions (organization_id, id)
      on delete set null (voice_for_channel_session_id);
  end if;
end $$;

-- Um aparelho de voz VIVO por número de mensagem. Parcial: linha arquivada
-- (voz desconectada) libera o número para um novo pareamento, e a linha de voz
-- legada (coluna nula) não entra.
create unique index if not exists channel_sessions_voz_por_numero_unique
  on public.channel_sessions (organization_id, voice_for_channel_session_id)
  where provider = 'wacalls'
    and archived_at is null
    and voice_for_channel_session_id is not null;

comment on column public.channel_sessions.voice_for_channel_session_id is
  'So em linhas provider=wacalls: o numero de mensagem (outra linha de channel_sessions, da MESMA organizacao) que este aparelho de voz atende. Nulo = voz da organizacao inteira (pareamento antigo). Migration 9105.';
