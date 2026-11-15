/**
 * O NOME de quem escreve para a Página ou para o Instagram — para a conversa
 * não nascer como "Sem nome".
 *
 * O webhook da plataforma traz só o id da pessoa nesta conta (PSID no
 * Messenger, IGSID no Instagram); o nome é lido à parte, com o token da
 * Página, pelo recurso "Business Asset User Profile Access":
 *
 *   Messenger: GET /{psid}?fields=first_name,last_name,name
 *   Instagram: GET /{igsid}?fields=name,username
 *
 * ─── Nunca bloqueia a mensagem ─────────────────────────────────────────────
 *
 * Nome é enfeite da conversa; a mensagem é o que importa. Qualquer falha (sem
 * o recurso aprovado, pessoa que restringiu o perfil, Graph fora do ar) devolve
 * `null` e a ingestão segue sem nome — nunca lança.
 *
 * ─── Memória curta por processo ────────────────────────────────────────────
 *
 * Uma conversa ativa manda várias mensagens em minutos; perguntar o nome a
 * cada uma gastaria cota da Graph à toa. O memo é por (conta, pessoa), dura 6h
 * e mora no `globalThis` pelo mesmo motivo de `../../meta/app.ts` (o Turbopack
 * instancia o módulo mais de uma vez no mesmo processo). Falha também é
 * memorizada, por menos tempo, para não martelar a Graph quando o recurso
 * ainda não foi aprovado.
 */
import { z } from "zod";

import { logger } from "@/lib/logger";

import { chamarGraph } from "./graph";

export interface PerfilDoParticipante {
  nome: string | null;
  usuario: string | null;
}

const TTL_OK_MS = 6 * 60 * 60 * 1000;
const TTL_FALHA_MS = 10 * 60 * 1000;
const LIMITE_DO_MEMO = 5_000;

declare global {
  var __memoDoPerfilSocial: Map<string, { valor: PerfilDoParticipante; expiraEm: number }> | undefined;
}

function memo(): Map<string, { valor: PerfilDoParticipante; expiraEm: number }> {
  globalThis.__memoDoPerfilSocial ??= new Map();
  return globalThis.__memoDoPerfilSocial;
}

const perfil = z
  .object({
    name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  })
  .passthrough();

function limpo(v: string | undefined): string | null {
  const t = v?.trim() ?? "";
  return t ? t.slice(0, 120) : null;
}

/** O nome (e o @ no Instagram) de quem escreveu. Nunca lança. */
export async function perfilDoParticipante(
  alvo: { token: string; plataforma: "facebook" | "instagram"; contaId: string; participantId: string },
  agora: number = Date.now(),
): Promise<PerfilDoParticipante> {
  const chave = `${alvo.contaId}:${alvo.participantId}`;
  const guardado = memo().get(chave);
  if (guardado && guardado.expiraEm > agora) return guardado.valor;

  let valor: PerfilDoParticipante = { nome: null, usuario: null };
  let ttl = TTL_FALHA_MS;
  try {
    const campos = alvo.plataforma === "instagram" ? "name,username" : "first_name,last_name,name";
    const lido = perfil.parse(
      await chamarGraph(encodeURIComponent(alvo.participantId), {
        token: alvo.token,
        consulta: { fields: campos },
      }),
    );
    const composto = [limpo(lido.first_name), limpo(lido.last_name)].filter(Boolean).join(" ");
    valor = { nome: limpo(lido.name) ?? (composto || null), usuario: limpo(lido.username) };
    ttl = TTL_OK_MS;
  } catch (erro) {
    logger.info("[redes-sociais.direta] nome do contato indisponível; segue sem nome", {
      plataforma: alvo.plataforma,
      detalhe: erro instanceof Error ? erro.message.slice(0, 120) : "desconhecido",
    });
  }
  if (memo().size >= LIMITE_DO_MEMO) memo().clear();
  memo().set(chave, { valor, expiraEm: agora + ttl });
  return valor;
}
