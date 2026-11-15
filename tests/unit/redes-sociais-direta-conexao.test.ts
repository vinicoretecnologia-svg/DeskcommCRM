import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A CONEXÃO DIRETA — do "Entrar com Facebook" às sessões gravadas.
 *
 * O que este arquivo vigia:
 *
 *   1. o `state` do login é nosso, tem prazo e não aceita adulteração — é dele
 *      que sai a organização na volta (o cookie de sessão é Strict e não viaja);
 *   2. o diálogo abre pela CONFIGURAÇÃO do app e volta para o retorno certo;
 *   3. cada Página autorizada ganha o app assinado e UMA sessão por conta —
 *      Messenger e, se houver, o Instagram ligado, ambos falando pela Página;
 *   4. conta ATIVA em outra organização não é tomada;
 *   5. o token da Página é gravado CIFRADO, nunca em claro.
 */

vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: async (_db: unknown, v: string) => `cifrado(${v})`,
  decryptWebhookSecret: async () => null,
}));
vi.mock("@/lib/channels/health", () => ({ resolverSaudeDaConexaoRemovida: async () => "sem_mudanca" }));
vi.mock("@/lib/channels/central-de-pausa", () => ({ fecharAvisoDePausaDoCanalArquivado: async () => undefined }));

const { emitirEstadoDoLogin, verificarEstadoDoLogin } = await import("@/lib/channels/social/direta/estado");
const { conectarPaginas, urlDoLogin, urlDoRetorno } = await import("@/lib/channels/social/direta/conexao");

const SEGREDO = "segredo-interno-com-tamanho-suficiente";

describe("o state do login", () => {
  const agora = new Date("2026-11-15T12:00:00Z");

  it("volta com a organização e quem pediu", () => {
    const s = emitirEstadoDoLogin({ organizationId: "org-1", userId: "user-1" }, { segredo: SEGREDO, agora, nonce: "n1" });
    expect(verificarEstadoDoLogin(s, { segredo: SEGREDO, agora })).toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      nonce: "n1",
    });
  });

  it("adulterado (outra organização na carga) é recusado", () => {
    const s = emitirEstadoDoLogin({ organizationId: "org-1", userId: "user-1" }, { segredo: SEGREDO, agora });
    const [carga, assinatura] = s.split(".");
    const outra = Buffer.from(Buffer.from(carga!, "base64url").toString().replace("org-1", "org-2")).toString("base64url");
    expect(verificarEstadoDoLogin(`${outra}.${assinatura}`, { segredo: SEGREDO, agora })).toBeNull();
  });

  it("vencido é recusado", () => {
    const s = emitirEstadoDoLogin({ organizationId: "org-1", userId: "user-1" }, { segredo: SEGREDO, agora });
    expect(verificarEstadoDoLogin(s, { segredo: SEGREDO, agora: new Date(agora.getTime() + 11 * 60_000) })).toBeNull();
  });
});

describe("o diálogo do login", () => {
  it("abre pela configuração do app e volta para o retorno da instalação", () => {
    const url = new URL(
      urlDoLogin(
        { appId: "1678504623751730", configId: "cfg-9", appSecret: "s", verifyToken: "v" },
        { redirectUri: urlDoRetorno("https://crm.exemplo.com.br/"), state: "st" },
      ),
    );
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("cfg-9");
    expect(url.searchParams.get("client_id")).toBe("1678504623751730");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.exemplo.com.br/api/v1/channels/social/direta/retorno");
    expect(url.searchParams.get("state")).toBe("st");
    // O segredo do app nunca vai para o navegador.
    expect(url.toString()).not.toContain("client_secret");
  });
});

type Linha = Record<string, unknown>;

/** Dublê do PostgREST com as operações que `conectarPaginas` usa, aplicando os filtros. */
function bancoCom(linhas: Linha[]) {
  const inseridas: Linha[] = [];
  const db = {
    from() {
      const filtros: [string, unknown][] = [];
      let insercao: Linha | null = null;
      let alteracao: Linha | null = null;
      const casa = (l: Linha) => filtros.every(([c, v]) => l[c] === v);
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
        is: (c: string, v: unknown) => (filtros.push([c, v]), q),
        insert: (l: Linha) => ((insercao = l), q),
        update: (l: Linha) => ((alteracao = l), q),
        single: async () => {
          const l = { id: `nova-${inseridas.length + 1}`, archived_at: null, ...insercao! };
          inseridas.push(l);
          linhas.push(l);
          return { data: { id: l.id }, error: null };
        },
        then: (ok: (v: unknown) => unknown) => {
          if (alteracao) {
            for (const l of linhas.filter(casa)) Object.assign(l, alteracao);
            return Promise.resolve({ error: null }).then(ok);
          }
          return Promise.resolve({ data: linhas.filter(casa), error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return { db: db as never, inseridas };
}

const chamadasGraph: { url: string; body: string }[] = [];
beforeEach(() => {
  chamadasGraph.length = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    chamadasGraph.push({ url: String(url), body: String(init.body ?? "") });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const PAGINA = {
  id: "1562567190266066",
  nome: "ViniCore Tecnologia",
  token: "TOKEN-DA-PAGINA",
  instagram: { id: "17841422923797235", usuario: "vinicore_tecnologia" },
};

describe("conectar as Páginas autorizadas", () => {
  it("assina o app na Página e grava a sessão do Messenger e a do Instagram", async () => {
    const { db, inseridas } = bancoCom([]);
    const desfechos = await conectarPaginas(db, "org-1", [PAGINA]);

    expect(chamadasGraph[0]!.url).toMatch(/\/1562567190266066\/subscribed_apps$/);
    expect(decodeURIComponent(chamadasGraph[0]!.body)).toContain("subscribed_fields=messages,messaging_postbacks,message_echoes");
    expect(desfechos.map((d) => [d.plataforma, d.resultado])).toEqual([
      ["facebook", "conectada"],
      ["instagram", "conectada"],
    ]);
    expect(inseridas.map((l) => [l.meta_social_account_id, l.meta_social_page_id, (l.metadata as Linha).social_platform])).toEqual([
      ["1562567190266066", "1562567190266066", "facebook"],
      ["17841422923797235", "1562567190266066", "instagram"],
    ]);
    for (const l of inseridas) {
      expect(l.organization_id).toBe("org-1");
      expect(l.meta_social_token_encrypted).toBe("cifrado(TOKEN-DA-PAGINA)");
      expect(JSON.stringify(l)).not.toMatch(/"TOKEN-DA-PAGINA"/);
    }
    expect(inseridas[1]!.display_name).toBe("Instagram · @vinicore_tecnologia");
  });

  it("conta ATIVA em outra organização não é tomada", async () => {
    const { db, inseridas } = bancoCom([
      { id: "dela", organization_id: "org-2", provider: "meta_social", meta_social_account_id: "1562567190266066", archived_at: null, metadata: {} },
    ]);
    const desfechos = await conectarPaginas(db, "org-1", [{ ...PAGINA, instagram: null }]);
    expect(desfechos).toEqual([{ conta: "1562567190266066", plataforma: "facebook", resultado: "conta_em_outra_organizacao" }]);
    expect(inseridas).toEqual([]);
  });

  it("reconectar a mesma conta na mesma organização atualiza o token, sem segunda linha", async () => {
    const linhas: Linha[] = [
      { id: "minha", organization_id: "org-1", provider: "meta_social", meta_social_account_id: "1562567190266066", archived_at: null, metadata: { social_platform: "facebook", ai: "x" } },
    ];
    const { db, inseridas } = bancoCom(linhas);
    const desfechos = await conectarPaginas(db, "org-1", [{ ...PAGINA, instagram: null, token: "TOKEN-NOVO" }]);
    expect(desfechos).toEqual([{ conta: "1562567190266066", plataforma: "facebook", resultado: "atualizada", channelId: "minha" }]);
    expect(inseridas).toEqual([]);
    expect(linhas[0]).toMatchObject({ meta_social_token_encrypted: "cifrado(TOKEN-NOVO)", status: "WORKING" });
    // O que a organização já configurou no canal (a IA, por exemplo) fica.
    expect((linhas[0]!.metadata as Linha).ai).toBe("x");
  });
});
