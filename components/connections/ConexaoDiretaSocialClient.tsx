"use client";
/**
 * Conexões › Redes sociais › "Instagram e Messenger" — a CONEXÃO DIRETA.
 *
 * Um botão só ("Entrar com Facebook"): a pessoa escolhe as Páginas na própria
 * tela da plataforma e volta com elas ligadas — a do Facebook (Messenger) e o
 * Instagram profissional ligado a cada Página. Nada de chave para colar.
 *
 * A tela não nomeia fornecedor nem variável de ambiente: quando a instalação
 * não tem o app configurado, ela diz só que a conexão ainda não está
 * disponível e quem resolve.
 */
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { canalDesativado } from "@/lib/channels/desativado";

import { ChannelAiAccess } from "./ChannelAiAccess";
import { RenomearConexao } from "./RenomearConexao";

type Conta = {
  id: string;
  plataforma: string;
  nome: string | null;
  status: string;
  metadata: Record<string, unknown>;
};
type Estado = { disponivel: boolean; contas: Conta[] };

/** O motivo da volta sem sucesso, dito para quem opera. */
const FRASE_DO_ERRO: Record<string, string> = {
  cancelado: "A entrada com o Facebook foi cancelada. Nenhuma conta foi alterada.",
  sem_paginas: "Nenhuma Página foi autorizada. Entre de novo e marque a Página que atende os clientes.",
  conta_em_outra_organizacao: "Esta Página ou conta do Instagram já está ligada a outra empresa neste sistema.",
  limite_do_plano: "O plano chegou ao limite de canais. Remova um canal ou mude de plano para ligar esta conta.",
  indisponivel: "A conexão direta ainda não está disponível nesta instalação. Fale com quem administra o sistema.",
};
const FRASE_PADRAO = "Não foi possível concluir a conexão. Tente entrar com o Facebook de novo.";

export function ConexaoDiretaSocialClient() {
  const t = useT();
  const params = useSearchParams();
  const query = useQuery({
    queryKey: ["social-direta"],
    queryFn: async () => (await apiClient.get<{ data: Estado }>("/api/v1/channels/social/direta")).data,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [saude, setSaude] = useState<Record<string, string>>({});
  const estado = query.data;
  const erro = params.get("direta_erro");
  const ligadas = params.get("direta");

  async function verificar(conta: Conta) {
    setBusy(conta.id);
    try {
      const r = await apiClient.post<{ data: { status: string } }>("/api/v1/channels/social/direta", {
        action: "health",
        channel_id: conta.id,
      });
      setSaude((s) => ({
        ...s,
        [conta.id]: r.data.status === "healthy" ? "Conexão verificada" : "A conexão precisa de atenção",
      }));
    } catch (e) {
      toast.error(t(e instanceof Error ? e.message : FRASE_PADRAO));
    } finally {
      setBusy(null);
    }
  }

  async function remover(conta: Conta) {
    setBusy(conta.id);
    try {
      await apiClient.post("/api/v1/channels/social/direta", { action: "remove", channel_id: conta.id });
      toast.success(t("Conta removida do atendimento. As conversas continuam no CRM."));
      await query.refetch();
    } catch (e) {
      toast.error(t(e instanceof Error ? e.message : FRASE_PADRAO));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="conexao-direta-social">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("Instagram e Messenger")}</h3>
          <p className="text-sm text-muted-foreground">
            {t(
              "Entre com o Facebook e escolha a Página da empresa. As mensagens do Messenger e do Direct do Instagram ligado a ela entram no atendimento.",
            )}
          </p>
        </div>
        {estado?.disponivel && (
          <Button asChild disabled={!!busy}>
            <a href="/api/v1/channels/social/direta/entrar">{t("Entrar com Facebook")}</a>
          </Button>
        )}
      </div>

      {ligadas && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {t("Contas ligadas:")} {ligadas}. {t("As novas mensagens já entram no atendimento.")}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {t(FRASE_DO_ERRO[erro] ?? FRASE_PADRAO)}
        </p>
      )}
      {query.isLoading && <p role="status">{t("Carregando…")}</p>}
      {estado && !estado.disponivel && (
        <p className="text-sm text-muted-foreground">
          {t("A conexão direta ainda não está disponível nesta instalação. Fale com quem administra o sistema.")}
        </p>
      )}

      {estado && estado.contas.length > 0 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {estado.contas.map((conta) => (
            <div key={conta.id} className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {conta.plataforma === "instagram" ? "Instagram" : "Messenger"}
                  </p>
                  <p className="font-semibold">{conta.nome}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant={conta.status === "WORKING" ? "secondary" : "outline"}>
                    {conta.status === "WORKING" ? t("Recebendo") : t("Reconectar")}
                  </Badge>
                  {canalDesativado(conta.metadata) && <Badge variant="neutral">{t("Pausado")}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <RenomearConexao channelId={conta.id} currentName={conta.nome} onSaved={() => void query.refetch()} />
                <Button variant="outline" disabled={!!busy} onClick={() => void verificar(conta)}>
                  {t("Verificar conexão")}
                </Button>
                <Button asChild variant="outline">
                  <Link href="/app/inbox">{t("Abrir atendimento")}</Link>
                </Button>
                <Button variant="outline" disabled={!!busy} onClick={() => void remover(conta)}>
                  {t("Remover do atendimento")}
                </Button>
              </div>
              {saude[conta.id] && (
                <p role="status" className="text-sm">
                  {t(saude[conta.id] ?? "")}
                </p>
              )}
              <ChannelAiAccess channelId={conta.id} phoneTesting={false} />
            </div>
          ))}
        </div>
      )}
      {estado?.disponivel && estado.contas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("A IA começa pausada em cada conta nova, para não responder junto com outra automação.")}
        </p>
      )}
    </Card>
  );
}
