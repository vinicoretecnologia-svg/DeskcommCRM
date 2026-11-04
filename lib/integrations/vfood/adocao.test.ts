import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "2814a8b2-c64f-4ef2-b761-7476331cb4b7";
const ORG = "7a16ec1d-a061-4d24-add6-43251d9bb8ce";

// Banco falso: `organizations` devolve a linha configurada; outras organizações do restaurante vêm de `outras`.
const estado = vi.hoisted(() => ({ linha: null as null | { id: string; settings: unknown }, outras: [] as unknown[], gravou: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let modo: "leitura" | "busca-outras" | "gravar" = "leitura";
      const q: Record<string, unknown> = {
        select: () => q,
        update: (valor: unknown) => { modo = "gravar"; estado.gravou = valor; return q; },
        eq: (coluna: string) => { if (coluna.startsWith("settings->")) modo = "busca-outras"; return q; },
        neq: () => q,
        limit: async () => ({ data: estado.outras, error: null }),
        maybeSingle: async () => ({ data: estado.linha, error: null }),
        then: (ok: (v: unknown) => unknown) => ok({ error: null, data: null }),
      };
      void modo;
      return q;
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { adotarOrganizacao } from "./recursos";

beforeEach(() => { estado.linha = null; estado.outras = []; estado.gravou = null; });

describe("adoção administrativa de organização", () => {
  it("vincula uma organização manual (sem marcador) e grava só o marcador, preservando o resto", async () => {
    estado.linha = { id: ORG, settings: { llm: { provider: "openai" } } };
    await expect(adotarOrganizacao(TENANT, ORG, "r")).resolves.toEqual({ organizationId: ORG, replay: false });
    expect(estado.gravou).toEqual({ settings: { llm: { provider: "openai" }, provisioning: { integration: "vfood", external_id: TENANT } } });
  });
  it("é idempotente para o mesmo restaurante", async () => {
    estado.linha = { id: ORG, settings: { provisioning: { integration: "vfood", external_id: TENANT } } };
    await expect(adotarOrganizacao(TENANT, ORG, "r")).resolves.toMatchObject({ replay: true });
    expect(estado.gravou).toBeNull();
  });
  it("recusa organização de outra integração ou de outro restaurante, sem gravar", async () => {
    for (const marcador of [{ integration: "clinicfx", external_id: TENANT }, { integration: "vfood", external_id: "outro" }]) {
      estado.linha = { id: ORG, settings: { provisioning: marcador } };
      await expect(adotarOrganizacao(TENANT, ORG, "r")).rejects.toMatchObject({ status: 409, code: "already_managed" });
    }
    expect(estado.gravou).toBeNull();
  });
  it("recusa quando o restaurante já tem outra organização, e 404 para organização inexistente", async () => {
    estado.linha = { id: ORG, settings: {} };
    estado.outras = [{ id: "outra" }];
    await expect(adotarOrganizacao(TENANT, ORG, "r")).rejects.toMatchObject({ status: 409, code: "tenant_already_has_organization" });
    estado.linha = null; estado.outras = [];
    await expect(adotarOrganizacao(TENANT, ORG, "r")).rejects.toMatchObject({ status: 404 });
  });
});
