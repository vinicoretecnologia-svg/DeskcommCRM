import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { test, expect } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

/**
 * CONEXÃO DIRETA DAS REDES SOCIAIS — o cartão "Instagram e Messenger" (#965).
 *
 * Duas provas pela tela, no estado de uma instalação FRESCA (sem as variáveis
 * opcionais do app da plataforma, que é o que o CI tem):
 *
 *   1. o cartão existe em Conexões › Redes sociais e diz, sem nomear
 *      fornecedor nem variável, que a conexão ainda não está disponível — e o
 *      botão "Entrar com Facebook" NÃO aparece (um botão que só falharia);
 *   2. a VOLTA do Facebook — uma navegação iniciada FORA do nosso site, aqui o
 *      cancelamento (`?error=access_denied`) — não manda a pessoa para o
 *      `/login`: o retorno responde com a ponte (`lib/auth/ponte-de-volta.ts`)
 *      e não com um 302, porque o cookie `SameSite=Strict` não viaja no salto
 *      iniciado de fora (o defeito do #1579 / #1646). E a tela diz o desfecho.
 *
 * O "site de fora" sobe em `127.0.0.1` enquanto o app roda em `localhost`: para
 * o navegador são sites diferentes (host conta para SameSite; porta não).
 */
function subirSiteDeFora(destino: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const servidor = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><body>
        <a id="voltar" href="${destino}">voltar</a>
        <script>document.getElementById("voltar").click()</script>
      </body>`);
    });
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

test("o cartão de Instagram e Messenger aparece e, sem o app configurado, não oferece um botão que falharia", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginComoAdmin(page, lerCreds());
  await page.goto("/app/connections?aba=sociais");

  const cartao = page.getByTestId("conexao-direta-social");
  await expect(cartao.getByText("Instagram e Messenger")).toBeVisible({ timeout: 20_000 });
  await expect(cartao.getByText(/ainda não está disponível nesta instalação/)).toBeVisible();
  await expect(cartao.getByRole("link", { name: "Entrar com Facebook" })).toHaveCount(0);
  // A tela não nomeia fornecedor nem variável de ambiente.
  await expect(cartao).not.toContainText(/META_|Zernio|Graph API/i);
});

test("voltar do Facebook cancelado não desloga e mostra o desfecho", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());

  // Controle positivo: logado ANTES do salto.
  await page.goto("/app/connections?aba=sociais");
  await expect(page, "não cheguei logado em Conexões — o cenário não está montado").toHaveURL(
    /\/app\/connections/,
    { timeout: 20_000 },
  );

  const base = (baseURL ?? "http://localhost:3001").replace(/\/$/, "");
  const servidor = await subirSiteDeFora(
    `${base}/api/v1/channels/social/direta/retorno?error=access_denied&error_reason=user_denied`,
  );
  const porta = (servidor.address() as AddressInfo).port;
  try {
    await page.goto(`http://127.0.0.1:${porta}/`);
    await page.waitForURL(/\/(app\/connections|login)/, { timeout: 30_000 });
    const url = page.url();
    expect(
      url,
      `depois de voltar do Facebook a pessoa parou em ${url}. Ela ESTAVA logada (o controle acima ` +
        "provou): o retorno respondeu com redirecionamento em vez da ponte, e o cookie Strict não viajou.",
    ).not.toContain("/login");
    expect(url).toContain("aba=sociais");
    expect(url).toContain("direta_erro=cancelado");
    await expect(page.getByText(/A entrada com o Facebook foi cancelada/)).toBeVisible({ timeout: 20_000 });
  } finally {
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});
