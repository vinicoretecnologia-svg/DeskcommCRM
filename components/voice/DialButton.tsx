"use client";
import { Button } from "@/components/ui/button";
import { Phone } from "@/lib/ui/icons";
import { useVoiceCall } from "@/components/voice/VoiceCallContext";
import { useVoiceSessionStatus } from "@/hooks/voice/useVoiceSessionStatus";
import { useT } from "@/hooks/i18n/useT";
import { vozDoNumero } from "@/lib/voice/voz-do-numero";

interface Props {
  contactId: string;
  /** Contato sem telefone não tem pra onde ligar — o chamador já sabe disso. */
  hasPhone: boolean;
  /**
   * O número de mensagem da conversa em que o botão está. A ligação sai pela voz
   * DESTE número (migration 9105). Fora de uma conversa (ficha do contato) fica
   * vazio, e vale a voz da organização.
   */
  channelSessionId?: string | null;
}

/**
 * Botão "Ligar" do Customer 360 (spec §5.1). Só aparece quando a org pareou
 * chamada de voz — feature opt-in (§1.2), nunca ligada por padrão.
 *
 * Numa empresa com vários números, o botão fica DESABILITADO (e diz por quê) no
 * número que ainda não tem voz pareada, em vez de sumir: sumir escondia o motivo
 * e fazia o atendente achar que a função tinha quebrado.
 */
export function DialButton({ contactId, hasPhone, channelSessionId }: Props) {
  const { data: sessionStatus } = useVoiceSessionStatus();
  const { call, startCall } = useVoiceCall();
  const t = useT();

  if (!sessionStatus?.configured || !hasPhone) return null;

  // Servidor antigo (sem `sessions`): vale o "alguma voz pareada" de sempre.
  const voz = sessionStatus.sessions
    ? vozDoNumero(sessionStatus.sessions, channelSessionId)
    : { serve: sessionStatus.paired, pareada: sessionStatus.paired };

  if (!voz.pareada) {
    // Nada pareado em lugar nenhum: a função nem foi usada, não há o que explicar.
    if (!sessionStatus.paired) return null;
    return (
      <Button
        variant="outline"
        className="shrink-0"
        disabled
        title={t("Pareie a chamada de voz deste número em Conexões.")}
      >
        <Phone size={16} weight="bold" aria-hidden />
        <span>{t("Chamar")}</span>
      </Button>
    );
  }

  const jaEmLigacao = !!call && call.status !== "ended";

  return (
    <Button
      variant="outline"
      className="shrink-0"
      disabled={jaEmLigacao}
      onClick={() => void (channelSessionId ? startCall(contactId, channelSessionId) : startCall(contactId))}
    >
      <Phone size={16} weight="bold" aria-hidden />
      <span>{jaEmLigacao ? t("Em ligação") : t("Chamar")}</span>
    </Button>
  );
}
