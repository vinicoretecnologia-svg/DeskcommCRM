/**
 * A voz que serve a um número de mensagem — a regra de `escolherSessaoDeVoz`
 * (`lib/wacalls/session.ts`), vista pela TELA.
 *
 * O servidor decide de verdade (rota de ligação relê o banco); isto só existe
 * para o botão "Chamar" dizer a verdade antes do clique: pronto, ou "este número
 * ainda não tem voz". As duas pontas seguem a mesma regra e a divergência é
 * sempre para o lado seguro: se a tela achar que dá e o servidor negar, a pessoa
 * lê o 409; o contrário (tela esconder o que existe) não acontece porque o
 * fallback é o mesmo.
 */
export interface VozPareada {
  /** `id` da linha de voz em `channel_sessions`. */
  id: string;
  /** Número de mensagem que esta voz atende; `null` = pareamento antigo, da organização inteira. */
  numeroDeMensagem: string | null;
  status: string;
  paired: boolean;
  jid: string | null;
}

export interface VozDoNumero {
  /** Existe alguma voz capaz de servir a este número (própria ou a antiga da organização). */
  serve: boolean;
  /** …e ela está pareada. */
  pareada: boolean;
}

export function vozDoNumero(
  sessoes: readonly VozPareada[] | undefined,
  numeroDeMensagem: string | null | undefined,
): VozDoNumero {
  if (!sessoes) return { serve: false, pareada: false };
  const propria = numeroDeMensagem ? sessoes.find((s) => s.numeroDeMensagem === numeroDeMensagem) : undefined;
  const antiga = sessoes.find((s) => s.numeroDeMensagem === null);
  // Sem número (contato sem conversa): a antiga, ou a única que existir. Com
  // várias vinculadas e nenhuma antiga a pergunta é ambígua — o servidor
  // responde 409 em vez de adivinhar, e a tela não afirma o que ele não afirma.
  const escolhida =
    propria ?? antiga ?? (!numeroDeMensagem && sessoes.length === 1 ? sessoes[0] : undefined);
  return { serve: !!escolhida, pareada: !!escolhida?.paired };
}
