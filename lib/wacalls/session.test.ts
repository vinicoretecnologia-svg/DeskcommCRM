import { describe, expect, it } from "vitest";

import { escolherSessaoDeVoz } from "./session";

const A = "11111111-1111-4111-8111-111111111111"; // número de mensagem A
const B = "22222222-2222-4222-8222-222222222222"; // número de mensagem B

const vozDeA = { id: "voz-a", wacalls_session_id: "w-a", voice_for_channel_session_id: A };
const vozDeB = { id: "voz-b", wacalls_session_id: "w-b", voice_for_channel_session_id: B };
const legado = { id: "voz-org", wacalls_session_id: "w-org", voice_for_channel_session_id: null };

describe("escolherSessaoDeVoz — a ligação sai pelo número da conversa", () => {
  it("cada número usa o aparelho de voz que é dele", () => {
    expect(escolherSessaoDeVoz([vozDeA, vozDeB], A)?.wacallsSessionId).toBe("w-a");
    expect(escolherSessaoDeVoz([vozDeA, vozDeB], B)?.wacallsSessionId).toBe("w-b");
  });

  it("número sem voz própria cai no legado da organização", () => {
    expect(escolherSessaoDeVoz([vozDeA, legado], B)?.wacallsSessionId).toBe("w-org");
  });

  it("número sem voz própria e sem legado NÃO usa o aparelho de outro número", () => {
    expect(escolherSessaoDeVoz([vozDeA], B)).toBeNull();
  });

  it("o vínculo exato vence o legado", () => {
    expect(escolherSessaoDeVoz([legado, vozDeA], A)?.wacallsSessionId).toBe("w-a");
  });

  it("sem número (chamada recebida): legado primeiro", () => {
    expect(escolherSessaoDeVoz([vozDeA, legado])?.wacallsSessionId).toBe("w-org");
  });

  it("sem número: a única sessão existente serve", () => {
    expect(escolherSessaoDeVoz([vozDeA])?.wacallsSessionId).toBe("w-a");
  });

  it("sem número e com várias vinculadas: ambíguo, não adivinha", () => {
    expect(escolherSessaoDeVoz([vozDeA, vozDeB])).toBeNull();
  });

  it("linha sem sessão no WaCalls (nunca pareou) não conta", () => {
    const morta = { id: "x", wacalls_session_id: null, voice_for_channel_session_id: A };
    expect(escolherSessaoDeVoz([morta], A)).toBeNull();
    expect(escolherSessaoDeVoz([morta, legado], A)?.wacallsSessionId).toBe("w-org");
  });

  it("lista vazia: nada", () => {
    expect(escolherSessaoDeVoz([], A)).toBeNull();
    expect(escolherSessaoDeVoz([])).toBeNull();
  });
});
