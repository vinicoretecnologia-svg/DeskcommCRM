import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  status: { data: undefined as unknown },
  startCall: vi.fn(),
}));

vi.mock("@/hooks/voice/useVoiceSessionStatus", () => ({ useVoiceSessionStatus: () => deps.status }));
vi.mock("@/components/voice/VoiceCallContext", () => ({
  useVoiceCall: () => ({ call: null, startCall: deps.startCall }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { DialButton } from "./DialButton";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const voz = (numeroDeMensagem: string | null, paired = true) => ({
  id: `v-${numeroDeMensagem ?? "org"}`,
  numeroDeMensagem,
  status: "WORKING",
  paired,
  jid: null,
});

beforeEach(() => {
  deps.startCall.mockReset();
});
afterEach(cleanup);

describe("DialButton — a ligação sai pelo número da conversa", () => {
  it("número com voz própria: o botão liga e passa o número", () => {
    deps.status.data = { configured: true, paired: true, sessions: [voz(A), voz(B)] };
    render(<DialButton contactId="c1" hasPhone channelSessionId={A} />);
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    expect(deps.startCall).toHaveBeenCalledWith("c1", A);
  });

  it("número SEM voz: botão desabilitado, com o motivo, e nenhuma ligação sai", () => {
    deps.status.data = { configured: true, paired: true, sessions: [voz(A)] };
    render(<DialButton contactId="c1" hasPhone channelSessionId={B} />);
    const botao = screen.getByRole("button", { name: "Chamar" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.title).toBe("Pareie a chamada de voz deste número em Conexões.");
    fireEvent.click(botao);
    expect(deps.startCall).not.toHaveBeenCalled();
  });

  it("pareamento antigo (sem vínculo) serve a qualquer número", () => {
    deps.status.data = { configured: true, paired: true, sessions: [voz(null)] };
    render(<DialButton contactId="c1" hasPhone channelSessionId={B} />);
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    expect(deps.startCall).toHaveBeenCalledWith("c1", B);
  });

  it("fora de uma conversa (ficha do contato): liga sem número", () => {
    deps.status.data = { configured: true, paired: true, sessions: [voz(A)] };
    render(<DialButton contactId="c1" hasPhone />);
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    expect(deps.startCall).toHaveBeenCalledWith("c1");
  });

  it("voz que nunca foi usada na empresa: o botão nem aparece", () => {
    deps.status.data = { configured: false, paired: false, sessions: [] };
    render(<DialButton contactId="c1" hasPhone channelSessionId={A} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("contato sem telefone: não há para onde ligar", () => {
    deps.status.data = { configured: true, paired: true, sessions: [voz(A)] };
    render(<DialButton contactId="c1" hasPhone={false} channelSessionId={A} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("servidor antigo (sem lista por número): vale o 'alguma voz pareada' de sempre", () => {
    deps.status.data = { configured: true, paired: true };
    render(<DialButton contactId="c1" hasPhone channelSessionId={A} />);
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    expect(deps.startCall).toHaveBeenCalledWith("c1", A);
  });
});
