/**
 * O QUADRO DO DIA MOSTRA QUEM VEM, também no compromisso curto.
 *
 * O card só exibia `quemSeraAtendido` na segunda linha, que existe a partir de
 * 45 minutos. Numa academia em que toda avaliação dura 30, o quadro do dia era
 * uma coluna de "Avaliação física" sem nenhum nome.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GradeDaAgenda } from "@/components/agenda/GradeDaAgenda";
import type { Agendamento, Pessoa } from "@/components/agenda/tipos";

afterEach(cleanup);

const FUSO = "America/Sao_Paulo";
const PESSOAS: Pessoa[] = [{ id: "p1", nome: "Ana", trilha: 1 }];

function card(parcial: Partial<Agendamento>, minutos: number): string {
  const comeca = new Date("2026-10-29T14:00:00Z");
  const agendamento: Agendamento = {
    id: "a1",
    titulo: "Avaliação física",
    responsavelId: "p1",
    comeca: comeca.toISOString(),
    termina: new Date(comeca.getTime() + minutos * 60_000).toISOString(),
    origem: "ui",
    situacao: "confirmed",
    ...parcial,
  };
  render(
    <GradeDaAgenda
      visao="dia"
      ancora={new Date(2026, 9, 29, 12)}
      agora={new Date("2026-10-29T12:00:00Z")}
      fuso={FUSO}
      pessoas={PESSOAS}
      agendamentos={[agendamento]}
    />,
  );
  return screen.getByTestId("agendamento-a1").textContent ?? "";
}

describe("card do quadro do dia", () => {
  it("compromisso de 30 minutos mostra o nome do cliente", () => {
    expect(card({ quemSeraAtendido: "Tiago Vinicius" }, 30)).toContain(
      "Avaliação física · Tiago Vinicius",
    );
  });

  it("não repete o nome quando o título já o traz", () => {
    const texto = card(
      { titulo: "Avaliação física — Tiago Vinicius", quemSeraAtendido: "Tiago Vinicius" },
      30,
    );
    expect(texto.match(/Tiago Vinicius/g)).toHaveLength(1);
  });

  it("compromisso longo segue com o nome na segunda linha, uma vez só", () => {
    const texto = card({ quemSeraAtendido: "Tiago Vinicius" }, 60);
    expect(texto.match(/Tiago Vinicius/g)).toHaveLength(1);
    expect(texto).toContain("11:00 · Tiago Vinicius");
  });

  it("sem cliente (ocupação do Google, compromisso interno) fica só o título", () => {
    expect(card({}, 30)).toBe("Avaliação física");
  });
});
