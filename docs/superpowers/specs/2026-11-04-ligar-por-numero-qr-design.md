# Ligar pelo número da conversa (WhatsApp por QR) — desenho

Data: 2026-11-04 · Estado: **desenho** · Escopo: voz pelo WaCalls, **um pareamento por número**.
Vídeo e API Oficial ficam fora (ver `2026-11-04-ligar-pela-api-oficial-design.md`).

## O problema

O botão **Chamar** existe (`components/voice/DialButton.tsx`), mas a voz é **uma por empresa**:
`resolveWacallsSession`, o `POST /voice/sessions/pair`, o `GET /voice/sessions/status`,
`despareaVoz` e o relay de QR (`/voice/events`) buscam "a" linha `provider = 'wacalls'` da
organização com `.maybeSingle()`, e o nome da sessão no WaCalls é `org_<orgId>`. Uma empresa com
dois números (caso real: VPlay) só consegue ligar por um — e o atendente não escolhe qual.

O que o produto precisa: o atendente abre a conversa de um número e a ligação **sai por aquele
número**.

## O que o código já tem a nosso favor

- `lib/wacalls/events-bridge.ts` resolve por `wacalls_session_id` → serve a N sessões sem mudar.
- `voice_calls` guarda `channel_session_id` da sessão de voz; o histórico não perde nada.
- A cobrança ignora `provider = 'wacalls'` (`lib/cobranca/uso.ts`): voz não ocupa número pago.

## Desenho

**Vínculo explícito.** Coluna nova em `channel_sessions`: `voice_for_channel_session_id uuid`
(nullable, FK para a própria tabela, `on delete set null`). Só é preenchida em linhas
`provider = 'wacalls'` e diz **qual conversa-de-mensagem aquele aparelho de voz atende**. Índice
único parcial `(organization_id, voice_for_channel_session_id)` onde `provider = 'wacalls'`,
`archived_at is null` e a coluna não é nula: **um pareamento de voz por número de mensagem**.

**Linhas antigas (coluna nula) seguem valendo.** Uma empresa que já pareou antes continua com a
sessão `org_<orgId>`: o resolvedor tenta primeiro o vínculo exato e cai na linha sem vínculo. Nada
é migrado, nada quebra no `update.sh`.

**Nome no WaCalls:** `org_<orgId>` (legado) ou `org_<orgId>_ch_<channelSessionId>` (novo). Inteiro,
sem prefixo cortado — mesma razão do comentário em `nome-da-sessao.ts`.

**Resolvedor.** `resolveWacallsSession(supabase, orgId, channelSessionId?)`:
1. com `channelSessionId`: linha de voz vinculada a ele; senão a linha legado sem vínculo;
2. sem `channelSessionId`: mantém o comportamento de hoje (legado), para chamadas recebidas e
   o que ainda não conhece o número.
O `channelSessionId` vem **da conversa lida do banco, nunca do body cru**: a rota recebe o
`contactId`/`conversationId`, lê a conversa escopada pela organização e extrai o canal dela.

**Rotas (todas `admin` ou `agent` como já são, `requireSupportWrite` antes do efeito):**
- `POST /voice/sessions/pair` aceita `{ channelSessionId }` (número de mensagem a vozear;
  validado `organization_id` + `provider in (waha, meta_cloud…)` não arquivado). Cria a sessão
  com o nome novo e grava o vínculo. Sem corpo = legado.
- `GET /voice/sessions/status` devolve a **lista** `[{ channelSessionId, voiceSessionId,
  status, paired, jid }]`; o formato antigo (um objeto) continua nos campos de topo para a tela
  velha, até o hook novo entrar.
- `DELETE /voice/sessions?channelSessionId=…` despareia **só aquele** número; sem o parâmetro,
  todos (é o que o PUT do opt-in precisa: desligar a feature despareia tudo).
- `POST /voice/calls` aceita `{ contactId, conversationId? }`; com a conversa, a ligação sai
  pelo número dela. Se aquele número **não tem voz pareada**, responde 409 com texto claro
  ("este número ainda não tem chamada de voz") — **nunca** cai em outro número em silêncio, porque
  ligar do número errado é pior que não ligar.
- `GET /voice/events?channelSessionId=…` filtra o QR pelo nome daquela sessão.

**Telas.**
- Conexões › Chamada de voz: uma linha por número de mensagem, cada uma com o próprio estado e o
  botão **Parear** (QR) / **Desconectar**. O aviso de risco continua um só, por empresa.
- Cabeçalho da conversa: o botão **Chamar** passa a receber `channelSessionId` da conversa. Sem voz
  pareada **naquele número**, o botão não some: fica desabilitado com a dica "Pareie a voz deste
  número em Conexões" (sumir escondia o porquê).

**Config por empresa.** A chave "Atendente ligar pelo WhatsApp" que já existe continua sendo o
interruptor geral (e o aceite do risco); o pareamento por número vem depois dela.

## Migration

`add column if not exists voice_for_channel_session_id uuid references channel_sessions(id) on
delete set null` + índice único parcial `if not exists` + `-- manifest:` + apêndice idempotente
no `baseline.sql` acima da "VARREDURA anon". Sem backfill: linhas antigas ficam nulas de
propósito.

## O que não dá para provar sem aparelho

Que **duas** sessões WaCalls convivem no mesmo processo e que cada ligação sai pelo número certo
só se prova com os dois celulares pareados e uma ligação real em cada um. Os testes unit provam o
roteamento (qual sessão é escolhida); a prova de ponta a ponta é manual, na VPlay.

Risco que continua: o WhatsApp pode bloquear o número com aparelho vinculado de voz. O aviso e o
aceite por empresa ficam como estão; eu **não** pareio números em nome do cliente.

## Ordem de entrega

1. Migration + baseline + resolvedor com testes unit (escolha de sessão).
2. Rotas `pair`/`status`/`DELETE`/`events` com o parâmetro novo + testes.
3. `POST /voice/calls` pela conversa + teste das recusas (sem voz naquele número → 409).
4. Hook e tela de Conexões por número; `DialButton` com o número da conversa.
5. Prova pela tela (ambiente fresco) e fragmento `.changes/`; só então backport para a VPS.

## Fora de escopo

Vídeo; API Oficial; IA atendendo voz; deploy na VPS (backport à parte, sob autorização).
