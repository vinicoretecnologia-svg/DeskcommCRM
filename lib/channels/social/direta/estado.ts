/**
 * O `state` do "Entrar com Facebook" da porta direta — assinado, com prazo,
 * carregando de qual ORGANIZAÇÃO é a conexão e quem a pediu.
 *
 * Mesma construção de `lib/plataformas-de-anuncio/google/estado.ts`
 * (HMAC-SHA256 com `INTERNAL_SECRET`, prazo curto, comparação em tempo
 * constante), duplicada em vez de importada pela mesma razão que aquele
 * arquivo dá: eixos sem relação não se acoplam por um helper.
 *
 * O cookie de sessão é `SameSite=Strict` e NÃO viaja na volta do Facebook: a
 * organização do retorno sai deste `state`, nunca do corpo nem da sessão. O
 * vínculo com o navegador que saiu é o cookie de `lib/agenda/google/vinculo.ts`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const VALIDADE_DO_ESTADO_MS = 10 * 60 * 1000;
const TAMANHO_MINIMO_DO_SEGREDO = 16;

export interface EstadoDoLoginSocial {
  organizationId: string;
  userId: string;
  nonce: string;
  expiraEmMs: number;
  authSessionId?: string;
}

function conferirSegredo(segredo: string): string {
  const s = segredo?.trim() ?? "";
  if (s.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new Error("INTERNAL_SECRET ausente ou curto demais: o retorno do login não tem como ser verificado");
  }
  return s;
}

const assinar = (carga: string, segredo: string): Buffer =>
  createHmac("sha256", segredo).update(carga, "utf8").digest();

export function emitirEstadoDoLogin(
  dados: { organizationId: string; userId: string; authSessionId?: string },
  opcoes: { segredo: string; agora: Date; nonce?: string },
): string {
  const segredo = conferirSegredo(opcoes.segredo);
  const campos = [dados.organizationId, dados.userId, dados.authSessionId ?? ""];
  if (!dados.organizationId || !dados.userId || campos.some((c) => c.includes("."))) {
    throw new Error("state precisa de organizationId e userId sem ponto");
  }
  const nonce = opcoes.nonce?.trim() || randomBytes(16).toString("hex");
  const expira = opcoes.agora.getTime() + VALIDADE_DO_ESTADO_MS;
  const sessao = dados.authSessionId ? `.${dados.authSessionId}` : "";
  const carga = `${dados.organizationId}.${dados.userId}.${nonce}.${expira}${sessao}`;
  return `${Buffer.from(carga, "utf8").toString("base64url")}.${assinar(carga, segredo).toString("hex")}`;
}

/** O conteúdo quando o `state` é nosso e ainda vale; `null` em qualquer outro caso. */
export function verificarEstadoDoLogin(
  token: string | null | undefined,
  opcoes: { segredo: string; agora: Date },
): EstadoDoLoginSocial | null {
  if (!token) return null;
  const segredo = conferirSegredo(opcoes.segredo);
  const [cargaCodificada, assinaturaHex, ...resto] = token.split(".");
  if (!cargaCodificada || !assinaturaHex || resto.length > 0) return null;
  const carga = Buffer.from(cargaCodificada, "base64url").toString("utf8");
  const esperada = assinar(carga, segredo);
  const recebida = Buffer.from(assinaturaHex, "hex");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;

  const [organizationId, userId, nonce, expiraTexto, authSessionId, ...sobra] = carga.split(".");
  if (sobra.length > 0) return null;
  const expiraEmMs = Number(expiraTexto);
  if (!organizationId || !userId || !nonce || !Number.isFinite(expiraEmMs)) return null;
  if (opcoes.agora.getTime() > expiraEmMs) return null;
  return { organizationId, userId, nonce, expiraEmMs, ...(authSessionId ? { authSessionId } : {}) };
}
