"use client";

/**
 * Cartão "Atendimento automático": as chaves simples da empresa, uma por linha,
 * cada uma com uma frase só. Cada chave salva SOZINHA ao ser mexida — não há
 * botão "Salvar tudo" para esquecer de clicar. O texto livre (a mensagem a quem
 * ligou) é a única exceção, e salva no próprio botão.
 *
 * Os campos de detalhe (segundos, mensagem) só aparecem com a chave ligada: a
 * tela fica curta para quem não usa e completa para quem usa.
 */
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Mic, PhoneCall, PhoneOff, Timer } from "lucide-react";
import { toast } from "sonner";

import { definirAtendimentoAutomatico } from "@/app/actions/settings/definirAtendimentoAutomatico";
import { definirBloqueioDeChamadas } from "@/app/actions/settings/definirBloqueioDeChamadas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { ESPERA_MAX_S, PAUSA_MAX_S, type ChaveComTempo } from "@/lib/organizacao/atendimento-automatico";
import { MENSAGEM_DE_RECUSA_MAX } from "@/lib/organizacao/bloqueio-de-chamadas";

const ERRO: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta opção.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  validation_failed: "Esse valor não é permitido.",
};

export interface AtendimentoAutomaticoInicial {
  bloqueio: boolean;
  mensagem: string;
  espera: ChaveComTempo;
  pausa: ChaveComTempo;
  midia: boolean;
  /** `null` = não deu para saber: a tela não mostra etiqueta. */
  midiaComChave: boolean | null;
  vozInstalada: boolean;
}

function Linha({
  icone,
  titulo,
  etiqueta,
  descricao,
  chave,
  detalhe,
}: {
  icone: ReactNode;
  titulo: string;
  etiqueta?: ReactNode;
  descricao: string;
  chave: ReactNode;
  detalhe?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-t px-5 py-4 first:border-t-0">
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icone}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {titulo}
          {etiqueta}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>
        {detalhe}
      </div>
      <div className="pt-0.5">{chave}</div>
    </div>
  );
}

function Etiqueta({ tom, children }: { tom: "ok" | "aviso"; children: ReactNode }) {
  const cor = tom === "ok" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return <span className={`ml-2 rounded-md px-2 py-0.5 align-middle text-xs font-normal ${cor}`}>{children}</span>;
}

export function AtendimentoAutomatico({ inicial }: { inicial: AtendimentoAutomaticoInicial }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [bloqueio, setBloqueio] = useState(inicial.bloqueio);
  const [mensagem, setMensagem] = useState(inicial.mensagem);
  const [mensagemSalva, setMensagemSalva] = useState(inicial.mensagem.trim());
  const [espera, setEspera] = useState(inicial.espera);
  const [esperaSalva, setEsperaSalva] = useState(inicial.espera.segundos);
  const [pausa, setPausa] = useState(inicial.pausa);
  const [pausaSalva, setPausaSalva] = useState(inicial.pausa.segundos);
  const [midia, setMidia] = useState(inicial.midia);

  /** Roda a gravação; erro desfaz o que a tela mostrava e avisa por quê. */
  function gravar(acao: () => Promise<{ ok: true } | { ok: false; error: string }>, aoDar: () => void, desfazer: () => void) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        aoDar();
        toast.success(t("Opção salva."));
        router.refresh();
        return;
      }
      desfazer();
      toast.error(t(ERRO[r.error] ?? "Não consegui salvar agora."));
    });
  }

  function mudarBloqueio(novo: boolean) {
    setBloqueio(novo);
    // Ligar a chave grava o texto JÁ SALVO, não o rascunho que ainda está sendo digitado.
    gravar(() => definirBloqueioDeChamadas(novo, mensagemSalva), () => undefined, () => setBloqueio(!novo));
  }

  function salvarMensagem() {
    const texto = mensagem.trim();
    gravar(() => definirBloqueioDeChamadas(bloqueio, texto), () => setMensagemSalva(texto), () => undefined);
  }

  function mudarEspera(novo: ChaveComTempo) {
    const anterior = espera;
    setEspera(novo);
    gravar(
      () => definirAtendimentoAutomatico({ espera: novo }),
      () => setEsperaSalva(novo.segundos),
      () => setEspera(anterior),
    );
  }

  function mudarPausa(novo: ChaveComTempo) {
    const anterior = pausa;
    setPausa(novo);
    gravar(
      () => definirAtendimentoAutomatico({ pausa: novo }),
      () => setPausaSalva(novo.segundos),
      () => setPausa(anterior),
    );
  }

  function mudarMidia(novo: boolean) {
    setMidia(novo);
    gravar(() => definirAtendimentoAutomatico({ midia: novo }), () => undefined, () => setMidia(!novo));
  }

  /** Lê o número digitado; vazio ou inválido volta ao último valor salvo. */
  function segundosDigitados(valor: string, max: number, salvo: number): number {
    const n = Number(valor);
    if (valor.trim() === "" || !Number.isFinite(n)) return salvo;
    return Math.min(Math.max(Math.round(n), 1), max);
  }

  return (
    <Card className="overflow-hidden p-0" data-testid="atendimento-automatico">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-base font-semibold">{t("Atendimento automático")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Ligue só o que você precisa. Cada chave salva sozinha e pode ser desligada a qualquer momento.")}
        </p>
      </div>

      <Linha
        icone={<PhoneOff className="size-4" aria-hidden />}
        titulo={t("Recusar ligações de voz")}
        descricao={t("Quem ligar por voz no WhatsApp tem a chamada recusada na hora. As mensagens continuam chegando.")}
        chave={
          <Switch
            checked={bloqueio}
            disabled={isPending}
            onCheckedChange={mudarBloqueio}
            aria-label={t("Recusar ligações de voz")}
          />
        }
        detalhe={
          bloqueio ? (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor="mensagem-da-recusa" className="text-xs font-medium">
                {t("Mensagem para quem ligou (opcional)")}
              </label>
              <Textarea
                id="mensagem-da-recusa"
                value={mensagem}
                maxLength={MENSAGEM_DE_RECUSA_MAX}
                rows={3}
                disabled={isPending}
                placeholder={t("Ex.: Oi! Não atendemos ligações por aqui, mas pode escrever que respondemos já.")}
                onChange={(e) => setMensagem(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("Vai para quem ligou, no máximo uma vez a cada 10 minutos. Deixe vazio para não enviar.")}
              </p>
              <div>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || mensagem.trim() === mensagemSalva}
                  onClick={salvarMensagem}
                >
                  {t("Salvar mensagem")}
                </Button>
              </div>
            </div>
          ) : null
        }
      />

      <Linha
        icone={<Timer className="size-4" aria-hidden />}
        titulo={t("Esperar antes de responder")}
        descricao={t("A IA espera um pouco e junta as mensagens seguidas do cliente numa resposta só.")}
        chave={
          <Switch
            checked={espera.ligada}
            disabled={isPending}
            onCheckedChange={(ligada) => mudarEspera({ ligada, segundos: espera.segundos > 0 ? espera.segundos : 8 })}
            aria-label={t("Esperar antes de responder")}
          />
        }
        detalhe={
          espera.ligada ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {t("Esperar")}
              <Input
                type="number"
                className="h-8 w-20"
                min={1}
                max={ESPERA_MAX_S}
                step={1}
                defaultValue={esperaSalva}
                disabled={isPending}
                aria-label={t("Segundos de espera")}
                onBlur={(e) => {
                  const s = segundosDigitados(e.target.value, ESPERA_MAX_S, esperaSalva);
                  e.target.value = String(s);
                  if (s !== esperaSalva) mudarEspera({ ligada: true, segundos: s });
                }}
              />
              {t("segundos")}
            </div>
          ) : null
        }
      />

      <Linha
        icone={<Hourglass className="size-4" aria-hidden />}
        titulo={t("Pausa entre uma resposta e a próxima")}
        descricao={t("Depois de responder, a IA só responde de novo nesta conversa depois desse tempo.")}
        chave={
          <Switch
            checked={pausa.ligada}
            disabled={isPending}
            onCheckedChange={(ligada) => mudarPausa({ ligada, segundos: pausa.segundos > 0 ? pausa.segundos : 10 })}
            aria-label={t("Pausa entre uma resposta e a próxima")}
          />
        }
        detalhe={
          pausa.ligada ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {t("Pausar")}
              <Input
                type="number"
                className="h-8 w-20"
                min={1}
                max={PAUSA_MAX_S}
                step={1}
                defaultValue={pausaSalva}
                disabled={isPending}
                aria-label={t("Segundos de pausa")}
                onBlur={(e) => {
                  const s = segundosDigitados(e.target.value, PAUSA_MAX_S, pausaSalva);
                  e.target.value = String(s);
                  if (s !== pausaSalva) mudarPausa({ ligada: true, segundos: s });
                }}
              />
              {t("segundos")}
            </div>
          ) : null
        }
      />

      <Linha
        icone={<Mic className="size-4" aria-hidden />}
        titulo={t("Entender áudios e fotos")}
        etiqueta={
          midia && inicial.midiaComChave === true ? (
            <Etiqueta tom="ok">{t("Funcionando")}</Etiqueta>
          ) : midia && inicial.midiaComChave === false ? (
            <Etiqueta tom="aviso">{t("Falta chave de IA")}</Etiqueta>
          ) : null
        }
        descricao={t("A IA ouve os áudios e descreve as imagens que o cliente manda, para responder sobre o que ele enviou.")}
        chave={
          <Switch
            checked={midia}
            disabled={isPending}
            onCheckedChange={mudarMidia}
            aria-label={t("Entender áudios e fotos")}
          />
        }
      />

      <Linha
        icone={<PhoneCall className="size-4" aria-hidden />}
        titulo={t("Atendente ligar pelo WhatsApp")}
        etiqueta={
          inicial.vozInstalada ? null : <Etiqueta tom="aviso">{t("Exige instalação")}</Etiqueta>
        }
        descricao={t(
          "Mostra o botão Ligar na conversa. Conecta um segundo aparelho ao seu número e o WhatsApp pode bloquear a conta.",
        )}
        chave={
          <Button asChild variant="outline" size="sm">
            <Link href="/app/settings/security">{t("Ver em Segurança")}</Link>
          </Button>
        }
      />
    </Card>
  );
}
