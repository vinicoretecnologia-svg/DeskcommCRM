import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";

// O proxy de sessão devolve 401 a todo /api/v1/* que não esteja em PUBLIC_PATHS ANTES de a rota rodar. As rotas da
// integração VFood são servidor a servidor (Bearer), então cada uma precisa estar na lista — e só elas.
const RAIZ = join(__dirname, "..", "..", "..", "app", "api", "v1", "integrations", "vfood");
const ORG = "7a16ec1d-a061-4d24-add6-43251d9bb8ce";

function rotasDoDisco(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return rotasDoDisco(caminho);
    return nome === "route.ts" ? [caminho] : [];
  });
}

describe("rotas da integração VFood no proxy de sessão", () => {
  it("toda rota existente no disco é pública para o proxy (senão o VFood leva 401 antes do Bearer)", () => {
    const rotas = rotasDoDisco(RAIZ).map((arquivo) =>
      "/api/v1/integrations/vfood/" + relative(RAIZ, arquivo).split(sep).slice(0, -1).join("/").replace("[orgId]", ORG),
    );
    expect(rotas.length).toBeGreaterThanOrEqual(8);
    for (const rota of rotas) expect(isPublicPath(rota), rota).toBe(true);
  });

  it("não abre prefixo: caminhos vizinhos continuam exigindo sessão", () => {
    for (const rota of [
      "/api/v1/integrations/vfood",
      "/api/v1/integrations/vfood/",
      "/api/v1/integrations/vfood/organizations/not-a-uuid/mcp",
      `/api/v1/integrations/vfood/organizations/${ORG}`,
      `/api/v1/integrations/vfood/organizations/${ORG}/outra`,
      `/api/v1/integrations/vfood/organizations/${ORG}/session/qr/extra`,
      "/api/v1/integrations/vfood/qualquer-coisa",
      "/api/v1/integrations/nuvemshop/callback-falso",
    ]) {
      expect(isPublicPath(rota), rota).toBe(false);
    }
  });
});
