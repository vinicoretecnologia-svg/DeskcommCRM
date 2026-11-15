import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O NOME DE QUEM ESCREVE — para a conversa não nascer como "Sem nome".
 *
 * O que este arquivo vigia:
 *   1. Messenger lê first_name/last_name/name; Instagram lê name/username;
 *   2. o token da Página vai no cabeçalho, nunca na URL;
 *   3. falha da Graph NUNCA lança (o nome é enfeite; a mensagem é o que importa);
 *   4. a mesma pessoa não é perguntada de novo a cada mensagem (memo).
 */

const chamadas: string[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };

beforeEach(() => {
  chamadas.length = 0;
  globalThis.__memoDoPerfilSocial = undefined;
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    chamadas.push(String(url));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-PAGINA");
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const { perfilDoParticipante } = await import("@/lib/channels/social/direta/perfil");

describe("perfil do participante", () => {
  it("Messenger: monta o nome e pede os campos do Messenger, sem token na URL", async () => {
    resposta = { status: 200, corpo: { first_name: "Maria", last_name: "Silva" } };
    const p = await perfilDoParticipante({ token: "TOKEN-PAGINA", plataforma: "facebook", contaId: "pag", participantId: "psid-1" });
    expect(p).toEqual({ nome: "Maria Silva", usuario: null });
    expect(chamadas[0]).toMatch(/\/psid-1\?fields=first_name%2Clast_name%2Cname$/);
    expect(chamadas[0]).not.toContain("TOKEN-PAGINA");
  });

  it("Instagram: nome e @", async () => {
    resposta = { status: 200, corpo: { name: "João", username: "joao.loja" } };
    const p = await perfilDoParticipante({ token: "TOKEN-PAGINA", plataforma: "instagram", contaId: "ig", participantId: "igsid-1" });
    expect(p).toEqual({ nome: "João", usuario: "joao.loja" });
    expect(chamadas[0]).toMatch(/fields=name%2Cusername$/);
  });

  it("Graph recusando (sem o recurso aprovado) devolve sem nome e NÃO lança", async () => {
    resposta = { status: 400, corpo: { error: { code: 10, message: "permission" } } };
    await expect(
      perfilDoParticipante({ token: "TOKEN-PAGINA", plataforma: "facebook", contaId: "pag", participantId: "psid-2" }),
    ).resolves.toEqual({ nome: null, usuario: null });
  });

  it("a mesma pessoa não é perguntada de novo dentro do prazo", async () => {
    resposta = { status: 200, corpo: { name: "Ana" } };
    const alvo = { token: "TOKEN-PAGINA", plataforma: "facebook" as const, contaId: "pag", participantId: "psid-3" };
    await perfilDoParticipante(alvo, 1_000);
    await perfilDoParticipante(alvo, 2_000);
    expect(chamadas).toHaveLength(1);
  });
});
