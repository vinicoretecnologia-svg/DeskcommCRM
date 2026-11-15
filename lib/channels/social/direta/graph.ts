/**
 * O cliente da Graph API para a PORTA DIRETA das redes sociais.
 *
 * Três regras, e todas três já custaram em outro canal deste repositório:
 *
 *   1. **O token vai no cabeçalho, nunca na URL.** A Graph aceita
 *      `?access_token=`, e é o exemplo de toda documentação — mas URL vai para
 *      log de proxy, de CDN e de erro. `Authorization: Bearer` é aceito pela
 *      mesma API e não vaza (CLAUDE.md, "API key NUNCA em query string").
 *   2. **Toda chamada tem prazo.** Sem `AbortSignal.timeout`, uma Graph lenta
 *      prende o envio e o webhook do cliente esperando.
 *   3. **O erro da plataforma vira erro TIPADO**, com `code` e `subcode`: é o
 *      que permite ao adapter dizer "a janela de 24h fechou" em vez de "falhou".
 *
 * O host e a versão vêm de `../../meta/graph-base.ts` — o mesmo knob
 * (`META_GRAPH_BASE_URL`) que aponta o canal oficial para um receptor local na
 * prova em tela também aponta esta porta.
 */
import { z } from "zod";

import { graphBaseUrl } from "../../meta/graph-base";

const PRAZO_MS = 15_000;

const erroDaGraph = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    type: z.string().optional(),
  }),
});

/** Erro devolvido pela Graph API, com os códigos que a plataforma documenta. */
export class GraphSocialError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;

  constructor(status: number, code: number | null, subcode: number | null, mensagem: string) {
    super(mensagem);
    this.name = "GraphSocialError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }

  /** Token expirado, revogado ou de outra conta (OAuthException 190 / 102). */
  get credencialInvalida(): boolean {
    return this.code === 190 || this.code === 102;
  }

  /**
   * Fora da janela de resposta: a pessoa não escreveu nas últimas 24h.
   * Messenger devolve o subcódigo 2018278; o Instagram, 2534022. O `code` sozinho
   * (10) NÃO serve: é o mesmo de "o app não tem esta permissão", e confundir os
   * dois mandaria o operador esperar o cliente quando o problema é a revisão.
   */
  get foraDaJanela(): boolean {
    return this.subcode === 2018278 || this.subcode === 2534022;
  }

  /** A plataforma pediu para desacelerar (limite de chamadas). */
  get desacelerar(): boolean {
    return this.status === 429 || this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613;
  }
}

export interface ChamadaGraph {
  metodo?: "GET" | "POST" | "DELETE";
  /** Parâmetros de consulta que NÃO são segredo (campos, filtros). */
  consulta?: Record<string, string>;
  /** Corpo JSON (POST). */
  json?: unknown;
  /** Corpo de formulário (POST) — usado na troca do código do login. */
  formulario?: Record<string, string>;
  /** Token de acesso. Ausente = chamada sem token (só a troca do código). */
  token?: string | null;
}

/**
 * Chama a Graph API e devolve o JSON da resposta. Lança `GraphSocialError`
 * quando a plataforma recusa, e `Error` simples quando a resposta nem é JSON.
 */
export async function chamarGraph(caminho: string, chamada: ChamadaGraph = {}): Promise<unknown> {
  const url = new URL(`${graphBaseUrl()}/${caminho.replace(/^\/+/, "")}`);
  for (const [chave, valor] of Object.entries(chamada.consulta ?? {})) url.searchParams.set(chave, valor);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (chamada.token) headers.Authorization = `Bearer ${chamada.token}`;
  let body: string | undefined;
  if (chamada.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(chamada.json);
  } else if (chamada.formulario) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(chamada.formulario).toString();
  }

  const resposta = await fetch(url, {
    method: chamada.metodo ?? (body ? "POST" : "GET"),
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  const texto = await resposta.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    throw new GraphSocialError(resposta.status, null, null, `Resposta da plataforma ilegível (HTTP ${resposta.status}).`);
  }
  if (!resposta.ok) {
    const erro = erroDaGraph.safeParse(dados);
    const e = erro.success ? erro.data.error : null;
    throw new GraphSocialError(
      resposta.status,
      e?.code ?? null,
      e?.error_subcode ?? null,
      // A mensagem da plataforma não carrega o token; carrega o motivo.
      e?.message?.slice(0, 300) ?? `A plataforma recusou a chamada (HTTP ${resposta.status}).`,
    );
  }
  return dados;
}
