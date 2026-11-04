import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  definirAuto: vi.fn(),
  definirBloqueio: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/app/actions/settings/definirAtendimentoAutomatico", () => ({
  definirAtendimentoAutomatico: deps.definirAuto,
}));
vi.mock("@/app/actions/settings/definirBloqueioDeChamadas", () => ({
  definirBloqueioDeChamadas: deps.definirBloqueio,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: deps.success, error: deps.error } }));

import { AtendimentoAutomatico, type AtendimentoAutomaticoInicial } from "./_atendimentoAutomatico";

const BASE: AtendimentoAutomaticoInicial = {
  bloqueio: false,
  mensagem: "",
  espera: { ligada: true, segundos: 8 },
  pausa: { ligada: false, segundos: 10 },
  midia: true,
  midiaComChave: true,
  vozInstalada: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.definirAuto.mockResolvedValue({ ok: true });
  deps.definirBloqueio.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

const chave = (nome: string) => screen.getByRole("switch", { name: nome });

describe("cartão Atendimento automático", () => {
  it("mostra as cinco opções, cada uma com a sua chave ou ação", () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    for (const n of ["Recusar ligações de voz", "Esperar antes de responder", "Pausa entre uma resposta e a próxima", "Entender áudios e fotos"]) {
      expect(chave(n)).toBeTruthy();
    }
    expect(screen.getByText("Atendente ligar pelo WhatsApp")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver em Segurança" }).getAttribute("href")).toBe("/app/settings/security");
  });

  it("os campos de detalhe só aparecem com a chave ligada", () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    expect(screen.queryByLabelText("Mensagem para quem ligou (opcional)")).toBeNull();
    expect(screen.getByLabelText("Segundos de espera")).toBeTruthy();
    expect(screen.queryByLabelText("Segundos de pausa")).toBeNull();
  });

  it("ligar a recusa de chamadas envia a chave e o texto já salvo, e abre a mensagem", async () => {
    render(<AtendimentoAutomatico inicial={{ ...BASE, mensagem: "Escreva, por favor." }} />);
    fireEvent.click(chave("Recusar ligações de voz"));
    await waitFor(() => expect(deps.definirBloqueio).toHaveBeenCalledWith(true, "Escreva, por favor."));
    expect((await screen.findByLabelText("Mensagem para quem ligou (opcional)") as HTMLTextAreaElement).value).toBe("Escreva, por favor.");
  });

  it("salvar a mensagem manda o texto digitado e o botão só habilita com mudança", async () => {
    render(<AtendimentoAutomatico inicial={{ ...BASE, bloqueio: true }} />);
    const botao = screen.getByRole("button", { name: "Salvar mensagem" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Mensagem para quem ligou (opcional)"), { target: { value: "  Oi!  " } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(deps.definirBloqueio).toHaveBeenCalledWith(true, "Oi!"));
    await waitFor(() => expect(botao.disabled).toBe(true));
  });

  it("desligar a espera grava a chave desligada e some com os segundos", async () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    fireEvent.click(chave("Esperar antes de responder"));
    await waitFor(() => expect(deps.definirAuto).toHaveBeenCalledWith({ espera: { ligada: false, segundos: 8 } }));
    await waitFor(() => expect(screen.queryByLabelText("Segundos de espera")).toBeNull());
  });

  it("mudar os segundos grava ao sair do campo, limitando ao teto", async () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    const campo = screen.getByLabelText("Segundos de espera") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "999" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(deps.definirAuto).toHaveBeenCalledWith({ espera: { ligada: true, segundos: 60 } }));
    expect(campo.value).toBe("60");
  });

  it("campo vazio ou igual ao salvo não grava nada", () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    const campo = screen.getByLabelText("Segundos de espera") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);
    expect(deps.definirAuto).not.toHaveBeenCalled();
    expect(campo.value).toBe("8");
  });

  it("ligar a pausa começa em 10 segundos", async () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    fireEvent.click(chave("Pausa entre uma resposta e a próxima"));
    await waitFor(() => expect(deps.definirAuto).toHaveBeenCalledWith({ pausa: { ligada: true, segundos: 10 } }));
    expect(await screen.findByLabelText("Segundos de pausa")).toBeTruthy();
  });

  it("desligar áudios e fotos grava midia=false e a etiqueta some", async () => {
    render(<AtendimentoAutomatico inicial={BASE} />);
    expect(screen.getByText("Funcionando")).toBeTruthy();
    fireEvent.click(chave("Entender áudios e fotos"));
    await waitFor(() => expect(deps.definirAuto).toHaveBeenCalledWith({ midia: false }));
    await waitFor(() => expect(screen.queryByText("Funcionando")).toBeNull());
  });

  it("avisa quando falta chave de IA, e não mente quando não dá para saber", () => {
    const a = render(<AtendimentoAutomatico inicial={{ ...BASE, midiaComChave: false }} />);
    expect(screen.getByText("Falta chave de IA")).toBeTruthy();
    a.unmount();
    render(<AtendimentoAutomatico inicial={{ ...BASE, midiaComChave: null }} />);
    expect(screen.queryByText("Funcionando")).toBeNull();
    expect(screen.queryByText("Falta chave de IA")).toBeNull();
  });

  it("a ligação de voz diz quando exige instalação", () => {
    const a = render(<AtendimentoAutomatico inicial={BASE} />);
    expect(screen.getByText("Exige instalação")).toBeTruthy();
    a.unmount();
    render(<AtendimentoAutomatico inicial={{ ...BASE, vozInstalada: true }} />);
    expect(screen.queryByText("Exige instalação")).toBeNull();
  });

  it("erro ao gravar desfaz a chave e avisa o motivo", async () => {
    deps.definirAuto.mockResolvedValue({ ok: false, error: "forbidden_role" });
    render(<AtendimentoAutomatico inicial={BASE} />);
    const c = chave("Entender áudios e fotos");
    fireEvent.click(c);
    await waitFor(() => expect(deps.error).toHaveBeenCalledOnce());
    expect(c.getAttribute("aria-checked")).toBe("true");
    expect(deps.success).not.toHaveBeenCalled();
  });
});
