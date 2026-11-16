import { describe, expect, it } from "vitest";

import { corpoSoDaConta, eventosPorConta } from "@/lib/channels/social/direta/webhook";

/**
 * O WEBHOOK DA CONEXÃO DIRETA — a leitura pura do que a plataforma entrega.
 *
 * O que este arquivo vigia:
 *
 *   1. a mensagem da pessoa vira `inbound` com a thread = id da pessoa (é o
 *      endereço do envio depois) e o `external_id` canônico `social:<conta>:<mid>`;
 *   2. o eco do PRÓPRIO app nunca vira linha (a IA nunca responde a eco);
 *   3. o eco de uma pessoa respondendo pelo app da rede vira SAÍDA — nunca
 *      entrada, nunca acorda o agente;
 *   4. cada conta é lida à parte, e o corpo arquivado de uma não carrega a
 *      outra (um POST pode trazer contas de organizações diferentes).
 */

const APP = "1678504623751730";
const PAGINA = "1562567190266066";
const IG = "17841422923797235";

function corpo(object: string, entry: unknown[]): string {
  return JSON.stringify({ object, entry });
}

describe("mensagem recebida", () => {
  it("Messenger: vira entrada, com a pessoa como thread e o mid como chave", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          time: 1,
          messaging: [
            {
              sender: { id: "psid-1" },
              recipient: { id: PAGINA },
              timestamp: 1_763_200_000_000,
              message: { mid: "m_1", text: "Oi, quanto custa?" },
            },
          ],
        },
      ]),
      APP,
    );
    expect(grupo).toMatchObject({ accountId: PAGINA, plataforma: "facebook" });
    expect(grupo!.mensagens).toHaveLength(1);
    expect(grupo!.mensagens[0]).toMatchObject({
      direction: "inbound",
      kind: "message",
      platform: "facebook",
      participantId: "psid-1",
      conversationId: "psid-1",
      accountId: PAGINA,
      externalId: `social:${PAGINA}:m_1`,
      text: "Oi, quanto custa?",
    });
  });

  it("Instagram: o objeto `instagram` vira a rede instagram, com a mídia de imagem", () => {
    const [grupo] = eventosPorConta(
      corpo("instagram", [
        {
          id: IG,
          messaging: [
            {
              sender: { id: "igsid-9" },
              recipient: { id: IG },
              timestamp: 1_763_200_000_000,
              message: {
                mid: "ig_m_1",
                attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }],
              },
            },
          ],
        },
      ]),
      APP,
    );
    expect(grupo!.plataforma).toBe("instagram");
    expect(grupo!.mensagens[0]).toMatchObject({
      direction: "inbound",
      platform: "instagram",
      attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }],
    });
  });

  it("botão tocado (postback) entra como o texto do botão", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          messaging: [
            { sender: { id: "psid-1" }, recipient: { id: PAGINA }, postback: { mid: "pb_1", title: "Quero orçamento" } },
          ],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens[0]).toMatchObject({ direction: "inbound", text: "Quero orçamento" });
  });

  it("evento endereçado a OUTRA conta dentro da entrada da conta é descartado", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          messaging: [{ sender: { id: "psid-1" }, recipient: { id: "outra-pagina" }, message: { mid: "m_x", text: "?" } }],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens).toEqual([]);
  });
});

describe("o eco — a IA nunca responde a eco", () => {
  it("eco do PRÓPRIO app (app_id desta instalação) não vira linha nenhuma", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          messaging: [
            {
              sender: { id: PAGINA },
              recipient: { id: "psid-1" },
              message: { mid: "m_eco", text: "resposta do CRM", is_echo: true, app_id: Number(APP) },
            },
          ],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens).toEqual([]);
  });

  it("eco de uma pessoa pelo app da rede vira SAÍDA, com a pessoa (recipient) como thread", () => {
    const [grupo] = eventosPorConta(
      corpo("instagram", [
        {
          id: IG,
          messaging: [
            {
              sender: { id: IG },
              recipient: { id: "igsid-9" },
              message: { mid: "ig_eco", text: "respondi pelo celular", is_echo: true },
            },
          ],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens).toHaveLength(1);
    expect(grupo!.mensagens[0]).toMatchObject({
      direction: "outbound",
      participantId: "igsid-9",
      conversationId: "igsid-9",
      externalId: `social:${IG}:ig_eco`,
    });
  });

  it("eco de OUTRO app na mesma Página também é saída — nunca entrada", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          messaging: [
            {
              sender: { id: PAGINA },
              recipient: { id: "psid-1" },
              message: { mid: "m_outro", text: "chatbot de terceiros", is_echo: true, app_id: 123 },
            },
          ],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens.map((m) => m.direction)).toEqual(["outbound"]);
  });
});

describe("desfechos de entrega", () => {
  it("delivery com mids vira status delivered de cada mensagem nossa", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [
        {
          id: PAGINA,
          messaging: [{ sender: { id: "psid-1" }, recipient: { id: PAGINA }, delivery: { mids: ["m_a", "m_b"], watermark: 1 } }],
        },
      ]),
      APP,
    );
    expect(grupo!.mensagens.map((m) => [m.kind, m.status, m.externalId])).toEqual([
      ["status", "delivered", `social:${PAGINA}:m_a`],
      ["status", "delivered", `social:${PAGINA}:m_b`],
    ]);
  });

  it("read do Messenger (só marca d'água, sem mid) não vira evento", () => {
    const [grupo] = eventosPorConta(
      corpo("page", [{ id: PAGINA, messaging: [{ sender: { id: "psid-1" }, recipient: { id: PAGINA }, read: { watermark: 1 } }] }]),
      APP,
    );
    expect(grupo!.mensagens).toEqual([]);
  });
});

describe("o que não é desta porta", () => {
  it("objeto de outro produto (whatsapp_business_account) devolve vazio, sem lançar", () => {
    expect(eventosPorConta(corpo("whatsapp_business_account", [{ id: "waba", changes: [] }]), APP)).toEqual([]);
  });

  it("corpo que não é JSON devolve vazio, sem lançar", () => {
    expect(eventosPorConta("isto não é json", APP)).toEqual([]);
  });
});

describe("isolamento: um POST com contas de duas organizações", () => {
  const misto = corpo("page", [
    { id: "pagina-org-a", messaging: [{ sender: { id: "p-a" }, recipient: { id: "pagina-org-a" }, message: { mid: "a1", text: "cliente da A" } }] },
    { id: "pagina-org-b", messaging: [{ sender: { id: "p-b" }, recipient: { id: "pagina-org-b" }, message: { mid: "b1", text: "cliente da B" } }] },
  ]);

  it("cada conta sai num grupo próprio", () => {
    const grupos = eventosPorConta(misto, APP);
    expect(grupos.map((g) => [g.accountId, g.mensagens.map((m) => m.text)])).toEqual([
      ["pagina-org-a", ["cliente da A"]],
      ["pagina-org-b", ["cliente da B"]],
    ]);
  });

  it("o corpo arquivado de uma conta não carrega a mensagem da outra", () => {
    const daA = corpoSoDaConta(misto, "pagina-org-a")!;
    expect(daA).toContain("cliente da A");
    expect(daA).not.toContain("cliente da B");
    expect(daA).not.toContain("pagina-org-b");
  });
});
