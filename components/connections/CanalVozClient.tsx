"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { channelLabel, type ChannelSession } from "@/hooks/channels/useChannelSessions";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { VozPareada } from "@/lib/voice/voz-do-numero";
import { CheckCircle, CircleNotch, Phone } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * Parear a chamada de voz WhatsApp (WaCalls) — spec §5.1/§4.2 de
 * docs/specs/18-spec-voice-calls-wacalls.md.
 *
 * ─── Por que o QR chega por SSE e não por polling de imagem ─────────────────
 * O canal por QR (`ConnectionsClient`) recarrega uma tag `<img>` a cada 15s
 * porque o transporte de mensagens serve o QR do momento em uma rota própria. O WaCalls não tem
 * essa rota: ele EMPURRA o QR pela stream de eventos, uma vez, quando muda.
 * Por isso esta tela abre um `EventSource` só durante o pareamento — nunca em
 * repouso — e fecha assim que "pareado" chega ou o operador sai da tela.
 *
 * ─── Segundo dispositivo, risco aceito ───────────────────────────────────────
 * Este QR pareia um SEGUNDO aparelho vinculado ao MESMO WhatsApp Business já
 * conectado (decisão de produto §1.2 da spec — risco de banimento aceito,
 * opt-in por org). O aviso fica na tela porque quem escaneia precisa saber
 * disso antes de decidir.
 *
 * ─── Um cartão por número (migration 9105) ───────────────────────────────────
 * Empresa com UM número vê o cartão de sempre (o pareamento é da organização).
 * Empresa com DOIS ou mais vê um cartão por número, cada um com o seu QR: a
 * ligação sai pelo número da conversa, e o QR de um número nunca aparece no
 * cartão de outro (o relay filtra pelo nome da sessão do número).
 */
interface Estado {
  configured: boolean;
  paired: boolean;
  status: string | null;
  jid: string | null;
  sessions?: VozPareada[];
}

/** Um número de mensagem da empresa, como o cartão o mostra. */
interface NumeroDaEmpresa {
  id: string;
  rotulo: string;
}

function errMsg(err: unknown, fallback: string, t: (texto: string) => string): string {
  return err instanceof ApiError && err.message ? t(err.message) : t(fallback);
}

/**
 * Os números de MENSAGEM da empresa — nunca a linha de voz, que mora na mesma
 * tabela. Resposta fora do formato (servidor antigo, erro) = nenhum número: a
 * tela cai no cartão único de sempre em vez de quebrar.
 */
function numerosDaResposta(dados: unknown, t: (texto: string) => string): NumeroDaEmpresa[] {
  // A rota só lista canais de MENSAGEM (`PROVIDERS_DE_MENSAGEM`): a linha de voz
  // nunca vem aqui, então a tela não precisa — nem deve — nomear provedor.
  if (!Array.isArray(dados)) return [];
  return (dados as ChannelSession[])
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({ id: c.id, rotulo: channelLabel(c, t) }));
}

function CartaoDaVoz({
  numero,
  estado,
  recarregar,
}: {
  /** `null` = o cartão único da organização (um número só, ou pareamento antigo). */
  numero: NumeroDaEmpresa | null;
  estado: Estado | null;
  recarregar: () => Promise<void>;
}) {
  const t = useT();
  const [pareando, setPareando] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const parear = async () => {
    setPareando(true);
    setQrDataUrl(null);
    try {
      // A stream tem que estar ABERTA antes de disparar o pareamento: o
      // WaCalls emite o QR no INSTANTE em que a sessão é criada (whatsmeow
      // gera na hora), não em resposta a quem está ouvindo. O relay não exige
      // sessão para abrir — ele reconhece a nossa pelo nome quando ela nasce
      // (`lib/wacalls/nome-da-sessao.ts`), então não há mais passo de
      // "preparar" antes: o POST único cria a sessão e o QR chega por aqui.
      let pareamentoDisparado = false;
      const es = new EventSource(
        numero ? `/api/v1/voice/events?channelSessionId=${numero.id}` : "/api/v1/voice/events",
      );
      esRef.current = es;
      es.onopen = () => {
        if (pareamentoDisparado) return;
        pareamentoDisparado = true;
        apiClient
          .post("/api/v1/voice/sessions/pair", numero ? { channelSessionId: numero.id } : {})
          .catch((err) => {
            es.close();
            esRef.current = null;
            setPareando(false);
            // O QR que talvez já tenha chegado é de uma sessão que a rota desfez.
            setQrDataUrl(null);
            toast.error(errMsg(err, "Não foi possível iniciar o pareamento.", t));
            // Recarrega SEMPRE: o 409 `voice_already_paired` é justamente o caso
            // em que a rota acabou de corrigir o banco (o WaCalls já estava
            // pareado), e sem reler a tela seguia "Não pareado" com o botão.
            void recarregar();
          });
      };
      es.onmessage = (ev) => {
        const payload = JSON.parse(ev.data) as { type: string; dataUrl?: string };
        if (payload.type === "qr" && payload.dataUrl) {
          setQrDataUrl(payload.dataUrl);
        } else if (payload.type === "expired") {
          es.close();
          esRef.current = null;
          setPareando(false);
          setQrDataUrl(null);
          toast.error(t("O código de pareamento venceu. Clique em parear para gerar outro."));
        } else if (payload.type === "paired") {
          es.close();
          esRef.current = null;
          setPareando(false);
          setQrDataUrl(null);
          toast.success(t("Chamada de voz pareada!"));
          void recarregar();
        }
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setPareando(false);
        // Sem a stream não chega "venceu" nem "pareado": um QR que ficasse na
        // tela seria um código morto, e o botão de tentar de novo não voltaria.
        setQrDataUrl(null);
        toast.error(t("Não foi possível receber o código de pareamento. Tente novamente."));
        // A pessoa pode ter escaneado antes de a conexão cair.
        void recarregar();
      };
    } catch (err) {
      toast.error(errMsg(err, "Não foi possível iniciar o pareamento.", t));
      setPareando(false);
    }
  };

  const conectado = estado?.paired ?? false;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{numero ? numero.rotulo : t("Chamada de voz por WhatsApp")}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "Um segundo aparelho vinculado ao mesmo número já conectado, só para ligar e atender chamadas. Escaneie uma vez para ativar.",
            )}
          </p>
        </div>
        {conectado ? (
          <Badge variant="secondary">{t("Conectado")}</Badge>
        ) : (
          <Badge variant="outline">{t("Não pareado")}</Badge>
        )}
      </div>

      {conectado && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{estado?.jid ?? t("Aparelho pareado")}</p>
        </div>
      )}

      {qrDataUrl ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t(
              "No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie o código.",
            )}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={t("QR Code para parear chamada de voz")}
            className="h-64 w-64 rounded-md border bg-white p-2"
          />
        </div>
      ) : pareando ? (
        <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
          <CircleNotch size={28} className="animate-spin" aria-hidden />
          {t("Preparando o código…")}
        </div>
      ) : !conectado ? (
        <div>
          <Button size="sm" onClick={parear} disabled={pareando}>
            <Phone size={14} aria-hidden />
            {t("Parear chamada de voz")}
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t(
              "Risco aceito: um segundo aparelho vinculado ao mesmo número pode ser sinalizado pelo WhatsApp.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm font-medium text-success-fg">
          <CheckCircle size={18} weight="fill" aria-hidden />
          {t("Pronto para ligar — o botão de chamar aparece nos contatos com telefone.")}
        </div>
      )}
    </Card>
  );
}

export function CanalVozClient({ wacallsConfigured }: { wacallsConfigured: boolean }) {
  const t = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  // A escolha da ORGANIZAÇÃO, que é outra pergunta que `paired`. Ler aqui é o
  // que evita o pior desfecho: a tela oferecer "Conectar", a pessoa escanear o
  // QR com o celular na mão, e só então descobrir que faltava ligar noutra
  // tela. Fazer alguém agir para descobrir que não podia é pior que dizer antes.
  const [vozLigada, setVozLigada] = useState<boolean | null>(null);
  const [numeros, setNumeros] = useState<NumeroDaEmpresa[]>([]);

  const carregar = async () => {
    try {
      const r = await apiClient.get<{ data: Estado }>("/api/v1/voice/sessions/status");
      setEstado(r.data);
    } catch {
      setEstado(null);
    }
    try {
      const o = await apiClient.get<{ data: { ligada: boolean } }>("/api/v1/voice/opt-in");
      setVozLigada(o.data.ligada);
    } catch {
      // `null` = não deu para saber. O aviso abaixo só aparece com `false`
      // EXPLÍCITO: esconder o botão porque uma leitura falhou tiraria o caminho
      // de quem está com tudo certo. Falha ABERTA na informação; quem fecha a
      // ação é a rota, que checa de novo no servidor.
      setVozLigada(null);
    }
    try {
      const c = await apiClient.get<{ data: unknown }>("/api/v1/channel-sessions");
      setNumeros(numerosDaResposta(c.data, t));
    } catch {
      // Sem a lista, o cartão único de sempre: pior caso = a tela de antes.
      setNumeros([]);
    }
  };

  useEffect(() => {
    void carregar();
    // `carregar` lê o `t` do render atual e não muda o que ele busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!wacallsConfigured) {
    return (
      <div className="rounded-md border border-warning bg-warning-bg p-4 text-sm text-warning-fg">
        <p className="font-medium">{t("A chamada de voz não está configurada.")}</p>
        <p className="mt-1">
          {t("Falta o endereço do serviço (")}
          <code>WACALLS_API_BASE_URL</code>
          {t(") nas variáveis de ambiente desta instalação.")}
        </p>
      </div>
    );
  }

  if (vozLigada === false) {
    return (
      <div className="rounded-md border border-border bg-surface p-4 text-sm">
        <p className="font-medium">{t("A chamada de voz está desligada nesta empresa.")}</p>
        <p className="mt-1 text-muted-foreground">
          {t(
            "Conectar o aparelho exige ligá-la antes, em Configurações › Segurança — é lá que está o aviso sobre o risco de o WhatsApp bloquear a conta, e quem liga precisa ter lido.",
          )}
        </p>
      </div>
    );
  }

  // Um número só (ou a lista não veio): o cartão da organização, como sempre foi.
  if (numeros.length < 2) {
    return <CartaoDaVoz numero={null} estado={estado} recarregar={carregar} />;
  }

  const antigo = estado?.sessions?.find((s) => s.numeroDeMensagem === null) ?? null;
  return (
    <div className="flex flex-col gap-4">
      {numeros.map((n) => {
        const propria = estado?.sessions?.find((s) => s.numeroDeMensagem === n.id) ?? null;
        return (
          <CartaoDaVoz
            key={n.id}
            numero={n}
            estado={
              propria
                ? {
                    configured: true,
                    paired: propria.paired,
                    status: propria.status,
                    jid: propria.jid,
                  }
                : null
            }
            recarregar={carregar}
          />
        );
      })}
      {antigo?.paired && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">{t("Todos os números (pareamento antigo)")}</h3>
            <p className="text-xs text-muted-foreground">{antigo.jid ?? t("Aparelho pareado")}</p>
          </div>
          <Badge variant="secondary">{t("Conectado")}</Badge>
        </Card>
      )}
    </div>
  );
}
