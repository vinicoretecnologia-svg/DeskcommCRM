import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A ENTRADA DO WEBHOOK DA CONEXÃO DIRETA — de quem é o evento.
 *
 * O webhook do app é UM só para a instalação, então a organização sai de duas
 * provas: a assinatura do app e a conta do evento casada com a sessão ATIVA.
 * O que este arquivo vigia:
 *
 *   1. sem segredo do app, a entrada não existe (404); assinatura errada, 401
 *      — e NADA é lido nem gravado antes disso;
 *   2. ISOLAMENTO: um POST com contas de duas organizações grava cada mensagem
 *      na organização dona da conta, e o arquivo de cada uma guarda só o
 *      recorte dela;
 *   3. conta sem sessão ativa, ou de outra rede, é descartada com 200 (a
 *      plataforma reentregaria para sempre o que não recebe 200);
 *   4. falha de escrita responde 500 (a reentrega é segura: `23505`).
 */

const SEGREDO = "segredo-do-app-com-tamanho-suficiente";
const APP_ID = "1678504623751730";

const app = vi.hoisted(() => ({ appSecret: null as string | null }));
vi.mock("@/lib/channels/social/direta/app", () => ({
  appDaPortaDireta: async () => ({ appId: APP_ID, configId: "cfg", appSecret: app.appSecret, verifyToken: "vt" }),
}));

const arquivados = vi.hoisted(() => [] as { organizationId: string; channelSessionId: string; rawBody: string }[]);
const fechados = vi.hoisted(() => [] as { status: string }[]);
vi.mock("@/lib/channels/arquivo-de-webhook", () => ({
  abrirArquivoDoWebhook: async (_db: unknown, e: { organizationId: string; channelSessionId: string; rawBody: string }) => {
    arquivados.push(e);
    return `arq-${arquivados.length}`;
  },
  fecharArquivoDoWebhook: async (_db: unknown, _id: string, d: { status: string }) => {
    fechados.push(d);
  },
}));

const ingeridas = vi.hoisted(() => [] as { organizationId: string; channelSessionId: string; texto: string | null }[]);
const ingestao = vi.hoisted(() => ({ falha: false }));
vi.mock("@/lib/channels/zernio/ingest", () => ({
  ingestZernioInbound: async (
    _db: unknown,
    i: { organizationId: string; channelSessionId: string; socialMessage: { text: string | null } },
  ) => {
    if (ingestao.falha) throw new Error("insert_failed");
    ingeridas.push({ organizationId: i.organizationId, channelSessionId: i.channelSessionId, texto: i.socialMessage.text });
    return { status: "ingested" };
  },
}));

const { receberEntregaDaPortaDireta, desafioDaPortaDireta } = await import("@/lib/channels/social/direta/entrada");

type Sessao = { id: string; organization_id: string; provider: string; meta_social_account_id: string; archived_at: string | null; metadata: Record<string, unknown> };

/** Dublê do PostgREST que APLICA os filtros `eq`/`is` — um filtro esquecido muda o resultado. */
function bancoCom(sessoes: Sessao[]) {
  return {
    from(tabela: string) {
      expect(tabela).toBe("channel_sessions");
      const filtros: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filtros.push([col, v]), q),
        is: (col: string, v: unknown) => (filtros.push([col, v]), q),
        limit: async () => ({
          data: sessoes.filter((s) => filtros.every(([c, v]) => (s as unknown as Record<string, unknown>)[c] === v)),
          error: null,
        }),
      };
      return q;
    },
  } as never;
}

const SESSOES: Sessao[] = [
  { id: "sess-a", organization_id: "org-a", provider: "meta_social", meta_social_account_id: "pag-a", archived_at: null, metadata: { social_platform: "facebook" } },
  { id: "sess-b", organization_id: "org-b", provider: "meta_social", meta_social_account_id: "pag-b", archived_at: null, metadata: { social_platform: "facebook" } },
  // A mesma conta já foi da org-c, mas a linha está ARQUIVADA: não pode receber.
  { id: "sess-c", organization_id: "org-c", provider: "meta_social", meta_social_account_id: "pag-x", archived_at: "2026-11-01", metadata: { social_platform: "facebook" } },
];

function entrega(entry: unknown[], segredo = SEGREDO) {
  const rawBody = JSON.stringify({ object: "page", entry });
  const assinatura = `sha256=${createHmac("sha256", segredo).update(rawBody).digest("hex")}`;
  return { rawBody, headers: new Headers({ "x-hub-signature-256": assinatura }), requestId: "req-1" };
}

const msg = (conta: string, pessoa: string, mid: string, text: string) => ({
  id: conta,
  messaging: [{ sender: { id: pessoa }, recipient: { id: conta }, message: { mid, text } }],
});

beforeEach(() => {
  app.appSecret = SEGREDO;
  arquivados.length = 0;
  fechados.length = 0;
  ingeridas.length = 0;
  ingestao.falha = false;
});

describe("autenticação antes de qualquer leitura", () => {
  it("sem o segredo do app, a entrada não existe (404)", async () => {
    app.appSecret = null;
    const r = await receberEntregaDaPortaDireta(bancoCom(SESSOES), entrega([msg("pag-a", "p1", "m1", "oi")]));
    expect(r.status).toBe(404);
    expect(arquivados).toEqual([]);
  });

  it("assinatura com outro segredo: 401, nada arquivado, nada ingerido", async () => {
    const r = await receberEntregaDaPortaDireta(bancoCom(SESSOES), entrega([msg("pag-a", "p1", "m1", "oi")], "outro-segredo-qualquer-longo"));
    expect(r.status).toBe(401);
    expect(arquivados).toEqual([]);
    expect(ingeridas).toEqual([]);
  });
});

describe("isolamento entre organizações", () => {
  it("um POST com as contas de duas organizações grava cada mensagem na dona da conta", async () => {
    const r = await receberEntregaDaPortaDireta(
      bancoCom(SESSOES),
      entrega([msg("pag-a", "p1", "m1", "cliente da A"), msg("pag-b", "p2", "m2", "cliente da B")]),
    );
    expect(r.status).toBe(200);
    expect(ingeridas).toEqual([
      { organizationId: "org-a", channelSessionId: "sess-a", texto: "cliente da A" },
      { organizationId: "org-b", channelSessionId: "sess-b", texto: "cliente da B" },
    ]);
    // O arquivo de cada organização guarda só o recorte dela.
    const daA = arquivados.find((a) => a.organizationId === "org-a")!;
    expect(daA.rawBody).toContain("cliente da A");
    expect(daA.rawBody).not.toContain("cliente da B");
  });

  it("conta cuja sessão está ARQUIVADA não entrega a ninguém", async () => {
    const r = await receberEntregaDaPortaDireta(bancoCom(SESSOES), entrega([msg("pag-x", "p9", "m9", "para quem?")]));
    expect(r).toMatchObject({ status: 200, resumo: { gravadas: 0, ignoradas: 1 } });
    expect(ingeridas).toEqual([]);
    expect(arquivados).toEqual([]);
  });

  it("conta desconhecida responde 200 e não grava", async () => {
    const r = await receberEntregaDaPortaDireta(bancoCom(SESSOES), entrega([msg("pag-nova", "p1", "m1", "oi")]));
    expect(r.status).toBe(200);
    expect(ingeridas).toEqual([]);
  });

  it("evento de Página não entra numa sessão de Instagram com o mesmo id", async () => {
    const soInstagram: Sessao[] = [{ ...SESSOES[0]!, metadata: { social_platform: "instagram" } }];
    await receberEntregaDaPortaDireta(bancoCom(soInstagram), entrega([msg("pag-a", "p1", "m1", "oi")]));
    expect(ingeridas).toEqual([]);
  });
});

describe("falha de escrita", () => {
  it("responde 500 para a plataforma reentregar, e fecha o arquivo como erro", async () => {
    ingestao.falha = true;
    const r = await receberEntregaDaPortaDireta(bancoCom(SESSOES), entrega([msg("pag-a", "p1", "m1", "oi")]));
    expect(r.status).toBe(500);
    expect(fechados.map((f) => f.status)).toEqual(["error"]);
  });
});

describe("handshake (GET)", () => {
  it("devolve o desafio com o verify token certo e recusa o errado", async () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "123" });
    const errado = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "123" });
    expect(await desafioDaPortaDireta(ok)).toBe("123");
    expect(await desafioDaPortaDireta(errado)).toBeNull();
  });
});
