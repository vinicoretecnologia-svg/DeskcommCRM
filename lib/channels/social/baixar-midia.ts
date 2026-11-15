/**
 * Baixa a mídia de uma mensagem de rede social com as guardas de saída do repo
 * — uma regra só para as duas portas (intermediada e direta).
 *
 *   - destino conferido antes de abrir a conexão: esquema/host
 *     (`assertSafeOutboundUrl`) e IP resolvido (`assertDestinoResolvidoSeguro`),
 *     porque a URL vem do webhook, que é dado externo;
 *   - `redirect: "error"`: um redirecionamento levaria a chamada a um destino
 *     que ninguém conferiu;
 *   - teto de tamanho medido NO FLUXO, não só no `content-length`, que o
 *     servidor pode omitir ou mentir.
 *
 * Quem chama decide QUAIS cabeçalhos vão: credencial só para o endpoint do
 * próprio provedor, nunca para uma CDN.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { MAX_MEDIA_BYTES, MediaTooLargeError } from "@/lib/messaging/media/types";

export async function baixarMidiaComTeto(
  url: URL,
  opcoes: { headers?: Record<string, string>; hintMime?: string | null } = {},
): Promise<{ buffer: Buffer; mime: string }> {
  assertSafeOutboundUrl(url.toString());
  await assertDestinoResolvidoSeguro(url.hostname);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: opcoes.headers ?? {},
  });
  if (!response.ok) throw new Error(`Falha ao baixar mídia (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES) {
    await response.body?.cancel();
    throw new MediaTooLargeError();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("A mídia retornou um corpo vazio.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw new MediaTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    buffer: Buffer.concat(chunks),
    mime:
      response.headers.get("content-type")?.split(";")[0] ?? opcoes.hintMime ?? "application/octet-stream",
  };
}
