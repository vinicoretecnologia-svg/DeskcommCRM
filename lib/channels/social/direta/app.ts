/**
 * O que a INSTALAÇÃO precisa ter para a porta direta das redes sociais existir.
 *
 * São quatro peças do mesmo app da plataforma, e nenhuma é da organização:
 *
 *   - `appId` (`META_APP_ID`) e `configId` (`META_SOCIAL_LOGIN_CONFIG_ID`):
 *     abrem o "Entrar com Facebook" (Login do Facebook para Empresas, que pede
 *     a configuração pelo id e não pela lista de permissões);
 *   - `appSecret`: troca o código do login pelo token e assina cada entrega do
 *     webhook (`X-Hub-Signature-256`);
 *   - `verifyToken`: responde o handshake do webhook (`hub.verify_token`).
 *
 * O segredo e o verify token são os MESMOS do canal oficial (`../../meta/app.ts`,
 * banco primeiro e `.env` como piso): um app da plataforma tem um segredo só, e
 * pedir um segundo par para o mesmo app seria a meia-configuração que a issue
 * #850 mediu — o handshake passa e toda entrega morre em 401.
 *
 * Nunca lança: quem chama decide (a tela mostra "indisponível", a rota do
 * webhook responde 403/401).
 */
import { appDaMeta } from "../../meta/app";

export interface AppDaPortaDireta {
  appId: string | null;
  configId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
}

function texto(v: string | undefined): string | null {
  const t = v?.trim() ?? "";
  return t ? t : null;
}

export async function appDaPortaDireta(
  source: Record<string, string | undefined> = process.env,
): Promise<AppDaPortaDireta> {
  const { appSecret, verifyToken } = await appDaMeta();
  return {
    appId: texto(source.META_APP_ID),
    configId: texto(source.META_SOCIAL_LOGIN_CONFIG_ID),
    appSecret,
    verifyToken,
  };
}

/** As variáveis que faltam para o login abrir — a tela não as nomeia, o log sim. */
export function faltaParaEntrar(app: AppDaPortaDireta): string[] {
  const falta: string[] = [];
  if (!app.appId) falta.push("META_APP_ID");
  if (!app.configId) falta.push("META_SOCIAL_LOGIN_CONFIG_ID");
  if (!app.appSecret) falta.push("META_APP_SECRET");
  return falta;
}

/** A conexão direta pode ser feita nesta instalação? */
export function portaDiretaDisponivel(app: AppDaPortaDireta): boolean {
  return faltaParaEntrar(app).length === 0;
}
