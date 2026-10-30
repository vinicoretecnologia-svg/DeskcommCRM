import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedGov } from "./gov-helpers";

// Migration 0687: recursos (canal e agente) criados por uma integração externa (VFood).
// Prova no banco real do baseline: criação atômica e idempotente sob concorrência, canal fechado para a IA,
// agente inativo, unicidade entre organizações e portas fechadas para anon/authenticated.
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
});
beforeAll(() => seedGov());
afterAll(() => pool.end());

async function novaOrg(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Integração','Integração')",
    [id],
  );
  return id;
}
const canal = (org: string, tenant = "t1") =>
  pool.query("select * from public.fn_integration_ensure_channel($1,'vfood',$2,'WhatsApp com IA')", [org, tenant]);
const agente = (org: string, tenant = "t1") =>
  pool.query("select * from public.fn_integration_ensure_agent($1,'vfood',$2,'Atendente','Instruções de teste')", [org, tenant]);

describe("canal da integração", () => {
  it("cinco chamadas simultâneas recuperam o MESMO canal, com um único vínculo", async () => {
    const org = await novaOrg();
    const respostas = await Promise.all([1, 2, 3, 4, 5].map(() => canal(org)));
    const ids = new Set(respostas.map((r) => r.rows[0].id));
    expect(ids.size).toBe(1);
    const { rows } = await pool.query(
      "select count(*)::int as n from integration_resources where organization_id=$1 and kind='channel_session'",
      [org],
    );
    expect(rows[0].n).toBe(1);
    const ch = await pool.query("select count(*)::int as n from channel_sessions where organization_id=$1", [org]);
    expect(ch.rows[0].n).toBe(1);
  });

  it("nasce FECHADO para a IA (pré-go-live), sem número, com nome de sessão dentro do teto do WAHA", async () => {
    const org = await novaOrg();
    const { rows } = await canal(org);
    expect(rows[0].metadata).toMatchObject({ ai_gate: "allowlist", ai_gate_mode: "pre_go_live" });
    expect(rows[0].phone_number).toBeNull();
    expect(rows[0].status).toBe("STARTING");
    expect(String(rows[0].waha_session_name).length).toBeLessThanOrEqual(54);
  });

  it("não toca num canal manual da mesma organização", async () => {
    const org = await novaOrg();
    const manual = randomUUID();
    await pool.query(
      "insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,status) values($1,$2,$3,'\\x00','WORKING')",
      [manual, org, `manual_${manual.replace(/-/g, "").slice(0, 20)}`],
    );
    const { rows } = await canal(org);
    expect(rows[0].id).not.toBe(manual);
    const antes = await pool.query("select status from channel_sessions where id=$1", [manual]);
    expect(antes.rows[0].status).toBe("WORKING");
  });

  it("o mesmo canal não pode ser vinculado a outra organização ou integração", async () => {
    const orgA = await novaOrg();
    const orgB = await novaOrg();
    const { rows } = await canal(orgA);
    await expect(
      pool.query(
        "insert into integration_resources(organization_id,integration,external_id,kind,resource_id) values($1,'vfood','x','channel_session',$2)",
        [orgB, rows[0].id],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("agente da integração", () => {
  it("cinco chamadas simultâneas recuperam o MESMO agente, nascido INATIVO e sem versão publicada", async () => {
    const org = await novaOrg();
    const respostas = await Promise.all([1, 2, 3, 4, 5].map(() => agente(org)));
    expect(new Set(respostas.map((r) => r.rows[0].id)).size).toBe(1);
    const a = respostas[0]!.rows[0];
    expect(a.is_active).toBe(false);
    expect(a.is_default).toBe(false);
    expect(a.kind).toBe("mcp_agent");
    expect(a.published_version_id).toBeNull();
    expect(a.config).toMatchObject({ mcp_externo_no_atendimento: true, managed_by: "vfood" });
  });

  it("não toca num agente manual da organização", async () => {
    const org = await novaOrg();
    const manual = randomUUID();
    await pool.query("insert into ai_agents(id,organization_id,name,system_prompt,is_active) values($1,$2,'Manual','x',true)", [manual, org]);
    const { rows } = await agente(org);
    expect(rows[0].id).not.toBe(manual);
    expect((await pool.query("select is_active from ai_agents where id=$1", [manual])).rows[0].is_active).toBe(true);
  });
});

describe("portas fechadas", () => {
  it("anon e authenticated não executam as funções nem leem/escrevem a tabela; o service_role sim", async () => {
    for (const fn of [
      "public.fn_integration_ensure_channel(uuid,text,text,text)",
      "public.fn_integration_ensure_agent(uuid,text,text,text,text)",
    ]) {
      for (const role of ["anon", "authenticated", "public"]) {
        const { rows } = await pool.query(
          role === "public"
            ? "select (select bool_or(has_function_privilege(r.oid,$1,'execute')) from pg_roles r where r.rolname in ('anon','authenticated')) as ok"
            : "select has_function_privilege($2::text,$1,'execute') as ok",
          role === "public" ? [fn] : [fn, role],
        );
        expect(rows[0].ok, `${role} em ${fn}`).toBe(false);
      }
      expect((await pool.query("select has_function_privilege('service_role',$1,'execute') as ok", [fn])).rows[0].ok).toBe(true);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["select", "insert", "update", "delete"]) {
        const { rows } = await pool.query("select has_table_privilege($1,'public.integration_resources',$2) as ok", [role, priv]);
        expect(rows[0].ok, `${role} ${priv}`).toBe(false);
      }
    }
    expect((await pool.query("select relrowsecurity from pg_class where oid='public.integration_resources'::regclass")).rows[0].relrowsecurity).toBe(true);
  });
});
