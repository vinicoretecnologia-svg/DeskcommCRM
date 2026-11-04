import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), erro: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("sonner", () => ({ toast: { error: api.erro, success: vi.fn() } }));

import { CanalVozClient } from "@/components/connections/CanalVozClient";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

class Eventos {
  static abertos: Eventos[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((evento: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    Eventos.abertos.push(this);
  }
}

function respostas(sessions: unknown[]) {
  api.get.mockImplementation(async (url: string) => {
    if (url.endsWith("opt-in")) return { data: { ligada: true } };
    if (url.endsWith("/channel-sessions")) {
      return {
        data: [
          { id: A, display_name: "Vendas", phone_number: null, waha_session_name: null },
          { id: B, display_name: "Suporte", phone_number: null, waha_session_name: null },
        ],
      };
    }
    return { data: { configured: sessions.length > 0, paired: false, status: null, jid: null, sessions } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Eventos.abertos = [];
  vi.stubGlobal("EventSource", Eventos);
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("Conexões › Chamada de voz com dois números", () => {
  it("cada número tem o seu cartão", async () => {
    respostas([]);
    render(<CanalVozClient wacallsConfigured />);
    expect(await screen.findByText("Vendas")).toBeVisible();
    expect(screen.getByText("Suporte")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Parear chamada de voz" })).toHaveLength(2);
  });

  it("parear UM número abre o QR e a rota COM o número dele — e só dele", async () => {
    respostas([]);
    render(<CanalVozClient wacallsConfigured />);
    await screen.findByText("Suporte");
    // Os cartões seguem a ordem da lista (Vendas, Suporte): o segundo botão é o do Suporte.
    fireEvent.click(screen.getAllByRole("button", { name: "Parear chamada de voz" })[1]!);

    await waitFor(() => expect(Eventos.abertos).toHaveLength(1));
    // O QR de um número nunca pode chegar ao cartão de outro: a stream é filtrada pelo número.
    expect(Eventos.abertos[0]!.url).toBe(`/api/v1/voice/events?channelSessionId=${B}`);
    await act(async () => Eventos.abertos[0]!.onopen?.());
    expect(api.post).toHaveBeenCalledExactlyOnceWith("/api/v1/voice/sessions/pair", { channelSessionId: B });
  });

  it("o estado de cada cartão é o do SEU número", async () => {
    respostas([{ id: "v-a", numeroDeMensagem: A, status: "WORKING", paired: true, jid: "5511999990001:1@s.whatsapp.net" }]);
    render(<CanalVozClient wacallsConfigured />);
    await screen.findByText("Vendas");
    // Vendas pareado, Suporte não: um "Conectado" e um "Não pareado".
    await waitFor(() => expect(screen.getAllByText("Conectado")).toHaveLength(1));
    expect(screen.getAllByText("Não pareado")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Parear chamada de voz" })).toHaveLength(1);
  });

  it("um número só: a tela de sempre, sem cartão por número", async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.endsWith("opt-in")) return { data: { ligada: true } };
      if (url.endsWith("/channel-sessions")) return { data: [{ id: A, display_name: "Vendas" }] };
      return { data: { configured: false, paired: false, status: null, jid: null } };
    });
    render(<CanalVozClient wacallsConfigured />);
    expect(await screen.findByText("Chamada de voz por WhatsApp")).toBeVisible();
    expect(screen.queryByText("Vendas")).toBeNull();
  });
});
