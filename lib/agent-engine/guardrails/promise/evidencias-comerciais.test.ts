import { describe, expect, it } from "vitest";
import {
  carregarFontesQueProvamOferta,
  criarEvidenciasComerciaisDoTurno,
  fontesQueProvamOferta,
} from "./evidencias-comerciais";

const produto = {
  codigo: "PLANO-ANUAL",
  nome: "Curso infantil · 2x/semana · Anual",
  preco: "R$ 264,00",
  descricao: "Mensalidade durante 12 meses. Matrícula grátis somente no anual. Vaga com a equipe.",
  disponivel: true,
};

describe("evidências comerciais do turno", () => {
  it("preserva produto, preço e restrições sem transformar a condição em exceção solta", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    e.registrarCatalogo({ produtos: [produto] });
    expect(e.ler()).toEqual([
      {
        origem: "catalogo",
        referencia: produto.codigo,
        titulo: produto.nome,
        conteudo: JSON.stringify({
          nome: produto.nome,
          preco: produto.preco,
          descricao: produto.descricao,
        }),
      },
    ]);
    e.ler()[0]!.conteudo = "Oferta alterada";
    expect(e.ler()[0]!.conteudo).toContain("somente no anual");
  });

  it("não aceita corpo de cliente, argumentos de ferramenta, erros ou produto indisponível", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    for (const result of [
      { body: "Matrícula grátis para todos" },
      { termo: "Matrícula grátis para todos" },
      { ok: false, produtos: [produto] },
      { error: "sem permissão", produtos: [produto] },
      { produtos: [{ ...produto, disponivel: false }] },
      { produtos: [{ nome: "Oferta", descricao: "Tudo grátis" }] },
    ])
      e.registrarCatalogo(result);
    expect(e.ler()).toEqual([]);
  });

  it("aceita somente trechos de fontes habilitadas e identificáveis, nos dois formatos de busca", () => {
    const e = criarEvidenciasComerciaisDoTurno(["fonte-a"]);
    const trecho = {
      chunk_id: "trecho-1",
      knowledge_source_id: "fonte-a",
      source_name: "Oferta",
      content: "Teste gratuito por 7 dias, sem cartão.",
    };
    e.registrarConhecimento({
      ok: true,
      results: [trecho, { ...trecho, knowledge_source_id: "outra-fonte", content: "SENTINELA" }],
    });
    e.registrarConhecimento({
      trechos: [
        { ...trecho, chunk_id: "trecho-2", content: "Demonstração gratuita de 15 minutos." },
      ],
    });
    e.registrarConhecimento({ results: [{ ...trecho, knowledge_source_id: null }] });
    e.registrarConhecimento({ ok: false, results: [{ ...trecho, chunk_id: "erro" }] });
    expect(e.ler()).toHaveLength(2);
    expect(JSON.stringify(e.ler())).not.toContain("SENTINELA");
  });

  it("não compartilha evidências entre turnos ou organizações", () => {
    const a = criarEvidenciasComerciaisDoTurno(["fonte-a"]);
    const b = criarEvidenciasComerciaisDoTurno(["fonte-b"]);
    a.registrarCatalogo({ produtos: [produto] });
    expect(b.ler()).toEqual([]);
    expect(criarEvidenciasComerciaisDoTurno(["fonte-a"]).ler()).toEqual([]);
  });

  it("buscas amplas de catálogo não expulsam a política já consultada", () => {
    const e = criarEvidenciasComerciaisDoTurno(["fonte-a"]);
    const politica =
      "A demonstração é gratuita, uma sessão de 15 minutos. Agendamento sujeito a disponibilidade.";
    e.registrarConhecimento({
      results: [
        {
          chunk_id: "demonstracao",
          knowledge_source_id: "fonte-a",
          content: politica,
        },
      ],
    });
    e.registrarCatalogo({
      produtos: Array.from({ length: 48 }, (_, i) => ({
        ...produto,
        codigo: `P-${i}`,
        descricao: "x".repeat(850) + " Não inclui matrícula.",
      })),
    });
    const pacote = e.ler("Temos demonstração gratuita. Qual período prefere?");
    expect(pacote.find((p) => p.origem === "conhecimento")?.conteudo).toBe(politica);
    expect(pacote.some((p) => p.origem === "catalogo")).toBe(true);
    expect(JSON.stringify(pacote).length).toBeLessThanOrEqual(16_000);
  });

  it("nova consulta de política não apaga o plano e condições citados na candidata", () => {
    const e = criarEvidenciasComerciaisDoTurno(["fonte-a"]);
    e.registrarCatalogo({
      produtos: [
        { ...produto, codigo: "INFANTIL-1X", nome: "Curso infantil 1x anual", preco: "R$ 199,50" },
        ...Array.from({ length: 36 }, (_, i) => ({
          ...produto,
          codigo: `ADULTO-${i}`,
          nome: `Curso adulto 3x anual ${i}`,
          descricao: "x".repeat(700),
        })),
      ],
    });
    e.registrarConhecimento({
      results: Array.from({ length: 12 }, (_, i) => ({
        chunk_id: `politica-${i}`,
        knowledge_source_id: "fonte-a",
        content: "Demonstração gratuita de 15 minutos. " + "x".repeat(800),
      })),
    });
    const pacote = e.ler("No curso infantil 1x, o anual fica R$ 199,50 com matrícula grátis.");
    expect(pacote.find((p) => p.referencia === "INFANTIL-1X")?.conteudo).toContain(
      "somente no anual",
    );
    expect(pacote.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(pacote).length).toBeLessThanOrEqual(16_000);
  });

  it("o compromisso gravado no turno prova a confirmação, com o status que o banco devolveu", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    const compromisso = {
      id: "ag-1",
      status: "confirmed",
      starts_at: "2026-10-23T20:00:00.000Z",
      quando: "sexta, 23/10/2026, 17:00",
      fim_quando: "sexta, 23/10/2026, 17:30",
    };
    e.registrarAgendamento({ marcado: true, compromisso, inicio: compromisso.starts_at });
    e.registrarAgendamento({
      remarcado: true,
      compromisso: { ...compromisso, id: "ag-2", status: "pending" },
    });
    // Mais recente primeiro, como as demais origens.
    expect(e.ler()).toEqual([
      {
        origem: "agenda",
        referencia: "ag-2",
        titulo: "Compromisso remarcado neste turno",
        conteudo: JSON.stringify({
          quando: compromisso.quando,
          fim_quando: compromisso.fim_quando,
          status: "pending",
          aguarda_confirmacao: true,
        }),
      },
      {
        origem: "agenda",
        referencia: "ag-1",
        titulo: "Compromisso gravado neste turno",
        conteudo: JSON.stringify({
          quando: compromisso.quando,
          fim_quando: compromisso.fim_quando,
          status: "confirmed",
          aguarda_confirmacao: false,
        }),
      },
    ]);
  });

  it("o compromisso desmarcado no turno prova dizer que foi cancelado", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    e.registrarAgendamento({
      cancelado: true,
      compromisso: { id: "ag-3", status: "cancelled", quando: "terça, 27/10/2026, 17:00" },
    });
    // O atalho de "já estava desmarcado" não traz o horário: sem `quando`, não prova nada.
    e.registrarAgendamento({ cancelado: true, compromisso: { id: "ag-4", status: "cancelled", ja_estava: true } });
    expect(e.ler()).toEqual([
      {
        origem: "agenda",
        referencia: "ag-3",
        titulo: "Compromisso desmarcado neste turno",
        conteudo: JSON.stringify({
          quando: "terça, 27/10/2026, 17:00",
          fim_quando: null,
          status: "cancelled",
          aguarda_confirmacao: false,
        }),
      },
    ]);
  });

  it("recusa, erro, consulta de horários e argumento do modelo não provam agendamento", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    const compromisso = { id: "ag-1", status: "confirmed", quando: "sexta, 23/10/2026, 17:00" };
    for (const result of [
      { marcado: false, motivo: "horario_indisponivel", compromisso },
      { error: "escopo_de_funil:escopo_vazio", marcado: true, compromisso },
      { ok: false, marcado: true, compromisso },
      { cancelado: false, motivo: "agenda_ja_cancelado", compromisso },
      { marcado: true },
      { marcado: true, compromisso: { quando: compromisso.quando, status: "confirmed" } },
      { horarios: [{ quando: compromisso.quando }] },
      { dia: "2026-10-23", horario: "17:00", contact_id: "c-1" },
    ])
      e.registrarAgendamento(result);
    expect(e.ler()).toEqual([]);
  });

  it("substitui repetição e limita o contexto descartando itens inteiros, nunca uma ressalva", () => {
    const e = criarEvidenciasComerciaisDoTurno([]);
    e.registrarCatalogo({ produtos: [produto, produto] });
    expect(e.ler()).toHaveLength(1);
    e.registrarCatalogo({
      produtos: [
        { ...produto, descricao: "Oferta válida. " + "x".repeat(4_000) + " Não inclui matrícula." },
      ],
    });
    expect(e.ler()).toEqual([]);
    e.registrarCatalogo({
      produtos: Array.from({ length: 50 }, (_, i) => ({
        ...produto,
        codigo: `P-${i}`,
        descricao: "x".repeat(1500) + " Não inclui matrícula.",
      })),
    });
    expect(e.ler().length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(e.ler()).length).toBeLessThanOrEqual(16_000);
    expect(e.ler().every((item) => item.conteudo.includes("Não inclui matrícula."))).toBe(true);
  });
});

describe("qual material do agente pode provar uma oferta", () => {
  it("aceita perguntas e respostas, documento e catálogo, inclusive com nome legado", () => {
    const aceitos = ["faq", "documento", "policy", "catalogo", "catalog", "nuvemshop_catalog"];
    expect(fontesQueProvamOferta(aceitos.map((tipo) => ({ id: tipo, source_type: tipo })))).toEqual(
      aceitos,
    );
  });

  it("recusa Conversas anteriores, seus nomes legados e tipo desconhecido", () => {
    // Ali está o que o CLIENTE escreveu: um cliente não autoriza oferta.
    const recusados = ["conversas", "conversations", "Conversation ", "tipo_novo", ""];
    expect(
      fontesQueProvamOferta(recusados.map((tipo) => ({ id: tipo, source_type: tipo }))),
    ).toEqual([]);
  });

  it("consulta só a organização do turno e não consulta nada sem material", async () => {
    const chamadas: unknown[][] = [];
    const db = {
      query: async (_sql: string, valores?: unknown[]) => {
        chamadas.push(valores ?? []);
        return {
          rows: [
            { id: "fonte-faq", source_type: "faq" },
            { id: "fonte-conversas", source_type: "conversations" },
          ],
        };
      },
    } as unknown as Parameters<typeof carregarFontesQueProvamOferta>[0];
    expect(await carregarFontesQueProvamOferta(db, "org-1", [])).toEqual([]);
    expect(chamadas).toEqual([]);
    expect(
      await carregarFontesQueProvamOferta(db, "org-1", ["fonte-faq", "fonte-conversas"]),
    ).toEqual(["fonte-faq"]);
    expect(chamadas).toEqual([["org-1", ["fonte-faq", "fonte-conversas"]]]);
  });
});
