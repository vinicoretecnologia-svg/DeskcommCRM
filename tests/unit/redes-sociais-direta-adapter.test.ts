import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboundEnvelope } from "@/lib/channels/types";

/**
 * O ADAPTER DA CONEXÃO DIRETA — envio pela Graph API.
 *
 * O que este arquivo vigia:
 *
 *   1. o envio sai pela PÁGINA (`POST /{página}/messages`) para o id da pessoa
 *      que a entrada gravou como thread, com `messaging_type: RESPONSE`;
 *   2. o token vai no CABEÇALHO, nunca na URL (URL vai para log);
 *   3. a credencial é buscada pela organização DO ENVELOPE — nunca só pela conta;
 *   4. a recusa da plataforma vira frase de quem opera: fora da janela de 24h,
 *      autorização expirada, e "desacelere" com o prefixo que o handler lê;
 *   5. a resposta sem `message_id` LANÇA — nunca grava `sent` sem prova.
 */

const chamadas: { url: string; init: RequestInit }[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: { recipient_id: "psid-1", message_id: "m_99" } };

const busca = vi.hoisted(() => ({ ultima: null as null | { organizationId: string; accountId: string }, valor: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/social/direta/credenciais", () => ({
  credencialDaContaDireta: async (_db: unknown, alvo: { organizationId: string; accountId: string }) => {
    busca.ultima = alvo;
    return busca.valor;
  },
}));

const { socialDiretaAdapter } = await import("@/lib/channels/social/direta/adapter");

const ENVELOPE: OutboundEnvelope = {
  organizationId: "org-1",
  sessionRef: "17841422923797235",
  to: "provider-thread",
  providerConversationId: "igsid-9",
  kind: "text",
  body: "Olá! Posso ajudar?",
};

beforeEach(() => {
  chamadas.length = 0;
  resposta = { status: 200, corpo: { recipient_id: "igsid-9", message_id: "m_99" } };
  busca.ultima = null;
  busca.valor = {
    channelSessionId: "sess-1",
    accountId: "17841422923797235",
    pageId: "1562567190266066",
    token: "TOKEN-DA-PAGINA-SECRETO",
    plataforma: "instagram",
  };
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("envio de texto", () => {
  it("sai pela Página, para a thread, como RESPONSE, com o token no cabeçalho", async () => {
    const r = await socialDiretaAdapter.send(ENVELOPE);
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0]!;
    expect(url).toMatch(/\/1562567190266066\/messages$/);
    expect(url).not.toContain("TOKEN-DA-PAGINA-SECRETO");
    expect(url).not.toContain("access_token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-DA-PAGINA-SECRETO");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: "igsid-9" },
      messaging_type: "RESPONSE",
      message: { text: "Olá! Posso ajudar?" },
    });
    // A mesma grafia que a entrada usa para o eco: o eco vira `duplicate`.
    expect(r.externalId).toBe("social:17841422923797235:m_99");
  });

  it("a credencial é procurada pela organização do envelope", async () => {
    await socialDiretaAdapter.send(ENVELOPE);
    expect(busca.ultima).toEqual({ organizationId: "org-1", accountId: "17841422923797235" });
  });

  it("sem credencial gravada, recusa sem tocar a rede", async () => {
    busca.valor = null;
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/Entre com o Facebook de novo/);
    expect(chamadas).toEqual([]);
  });

  it("sem thread (ninguém escreveu ainda), recusa sem tocar a rede", async () => {
    await expect(socialDiretaAdapter.send({ ...ENVELOPE, providerConversationId: null })).rejects.toThrow(
      /Aguarde uma mensagem do cliente/,
    );
    expect(chamadas).toEqual([]);
  });

  it("resposta sem message_id LANÇA — nunca grava enviado sem prova", async () => {
    resposta = { status: 200, corpo: { recipient_id: "igsid-9" } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/sem confirmação/);
  });
});

describe("mídia", () => {
  it("imagem vai como anexo por URL e a legenda sai como texto logo depois", async () => {
    await socialDiretaAdapter.send({
      ...ENVELOPE,
      kind: "image",
      body: undefined,
      media: { url: "https://cdn.exemplo.com/foto.jpg", mime: "image/jpeg", caption: "Nosso cardápio" } as never,
    });
    expect(chamadas.map((c) => (JSON.parse(String(c.init.body)) as { message: unknown }).message)).toEqual([
      { attachment: { type: "image", payload: { url: "https://cdn.exemplo.com/foto.jpg", is_reusable: false } } },
      { text: "Nosso cardápio" },
    ]);
  });
});

describe("recusas da plataforma, ditas para quem opera", () => {
  it("fora da janela de 24h (subcódigo do Messenger)", async () => {
    resposta = { status: 400, corpo: { error: { message: "outside window", code: 10, error_subcode: 2018278 } } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/mais de 24 horas/);
  });

  it("fora da janela de 24h (subcódigo do Instagram)", async () => {
    resposta = { status: 400, corpo: { error: { message: "outside window", code: 10, error_subcode: 2534022 } } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/mais de 24 horas/);
  });

  it("código 10 sem o subcódigo da janela é PERMISSÃO, não janela", async () => {
    resposta = { status: 400, corpo: { error: { message: "permission", code: 10 } } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/permissão/);
  });

  it("token expirado manda entrar com o Facebook de novo", async () => {
    resposta = { status: 401, corpo: { error: { message: "expired", code: 190 } } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(/expirou/);
  });

  it("limite de chamadas sai com o prefixo que o handler reagenda", async () => {
    resposta = { status: 400, corpo: { error: { message: "too many", code: 613 } } };
    await expect(socialDiretaAdapter.send(ENVELOPE)).rejects.toThrow(
      new RegExp(`^${socialDiretaAdapter.codes.throttled}`),
    );
  });
});

describe("saúde", () => {
  it("Página sem o app assinado não está recebendo", async () => {
    resposta = { status: 200, corpo: { data: [] } };
    const s = await socialDiretaAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "17841422923797235" });
    expect(s).toEqual({ reachable: true, status: "FAILED", detail: "recebimento_nao_configurado" });
  });

  it("app assinado e token bom: WORKING", async () => {
    resposta = { status: 200, corpo: { data: [{ id: "1678504623751730", name: "App" }] } };
    const s = await socialDiretaAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "17841422923797235" });
    expect(s.status).toBe("WORKING");
  });

  it("token revogado: FAILED com o motivo", async () => {
    resposta = { status: 401, corpo: { error: { code: 190 } } };
    const s = await socialDiretaAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "17841422923797235" });
    expect(s).toEqual({ reachable: true, status: "FAILED", detail: "credencial_expirada" });
  });
});
