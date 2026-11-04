/* eslint-disable @next/next/no-img-element -- runtime brand URLs are supplied by this installation. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const recursos = [
  { numero: "01", titulo: "Conversas com contexto", texto: "Centralize o atendimento pelo WhatsApp e mantenha o histórico disponível para quem atende." },
  { numero: "02", titulo: "Agenda em sintonia", texto: "Organize os atendimentos da equipe e conecte o Google Agenda para acompanhar compromissos." },
  { numero: "03", titulo: "Vendas em movimento", texto: "Acompanhe cada oportunidade no funil e organize os próximos passos do relacionamento." },
];

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/app");
  const marca = await marcaDaSaida(null);
  return (
    <div className="vinicore-landing min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <nav aria-label="Navegação principal" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 lg:px-8">
          <Link href="/" aria-label="VChat, página inicial" className="flex items-center gap-3"><span className="vinicore-wordmark text-2xl text-text">VChat<span className="text-accent-600">.</span></span><span className="hidden border-l border-border pl-3 text-[11px] font-semibold text-text-muted sm:block">por ViniCore<br />Tecnologia</span></Link>
          <div className="flex items-center gap-5 text-sm"><a href="#recursos" className="hidden font-semibold text-text-muted sm:inline">Conheça o VChat</a><Link href="/login" className="rounded-lg bg-[#086bd6] px-5 py-2.5 font-bold text-white hover:bg-[#0756b0]">Entrar no sistema</Link></div>
        </nav>
      </header>
      <main>
        <section className="overflow-hidden bg-[#07172d] text-white">
          <div className="mx-auto grid max-w-6xl gap-14 px-6 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:px-8 lg:py-28">
            <div>
              <p className="mb-6 text-[11px] font-extrabold uppercase tracking-[0.22em] text-cyan-300">ViniCore Tecnologia · VChat</p>
              <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.1] tracking-[-0.045em] sm:text-5xl lg:text-6xl">Cada conversa abre uma <span className="text-cyan-300">oportunidade.</span></h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">Atendimento, agenda e vendas conectados. Dê à sua equipe o contexto que ela precisa para cuidar de cada cliente.</p>
              <div className="mt-9 flex flex-wrap items-center gap-4"><Link href="/login" className="rounded-lg bg-cyan-300 px-6 py-3.5 text-sm font-extrabold text-[#07172d] hover:bg-cyan-200">Acessar o VChat <span aria-hidden="true">↗</span></Link><a href="#recursos" className="px-1 py-3 text-sm font-semibold text-white underline decoration-white/40 underline-offset-8">Explorar os recursos</a></div>
              <p className="mt-7 text-xs text-slate-400">Inteligência artificial e equipe humana na mesma operação.</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-[#0d2340] p-5 shadow-2xl sm:p-7">
              <div className="flex items-center justify-between border-b border-white/10 pb-5"><div><p className="text-xs font-semibold text-cyan-300">VISÃO DA OPERAÇÃO</p><p className="mt-1 text-lg font-bold tracking-tight">Tudo começa com uma conversa.</p></div><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300" aria-hidden="true" /></div>
              {marca.logoUrl ? <img src={marca.logoUrl} alt={marca.nome} className="mx-auto my-7 h-auto max-h-40 w-60 object-contain" /> : null}
              <div className="space-y-3">{[{ letra: "A", nome: "Atendimento", texto: "Histórico e equipe no mesmo lugar" }, { letra: "G", nome: "Agenda", texto: "Compromissos e disponibilidade" }, { letra: "V", nome: "Vendas", texto: "O próximo passo de cada oportunidade" }].map((item) => <div key={item.nome} className="flex items-center gap-4 rounded-xl border border-white/10 bg-[#102d50] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-300/10 text-sm font-extrabold text-cyan-300" aria-hidden="true">{item.letra}</span><div><p className="text-sm font-bold">{item.nome}</p><p className="mt-1 text-xs leading-5 text-slate-300">{item.texto}</p></div></div>)}</div>
              <p className="mt-4 text-center text-[10px] text-slate-400">Representação ilustrativa dos recursos do VChat.</p>
            </div>
          </div>
        </section>
        <section id="recursos" className="mx-auto max-w-6xl px-6 py-16 lg:px-8 lg:py-24">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-accent-600 dark:text-cyan-300">Mais clareza para operar</p>
          <h2 className="mt-4 max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Menos informação espalhada.<br />Mais espaço para atender bem.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">{recursos.map((recurso) => <article key={recurso.numero} className="rounded-2xl border border-border bg-surface p-7"><p className="font-mono text-xs text-accent-600 dark:text-cyan-300">{recurso.numero}</p><h3 className="mt-6 text-xl font-bold tracking-tight">{recurso.titulo}</h3><p className="mt-3 text-sm leading-7 text-text-muted">{recurso.texto}</p></article>)}</div>
        </section>
        <section className="border-y border-border bg-surface"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-7 px-6 py-12 sm:flex-row sm:items-center lg:px-8"><div><p className="text-xs font-bold uppercase tracking-widest text-text-muted">Sua equipe. Seus clientes. Sua operação.</p><h2 className="mt-3 text-2xl font-bold tracking-tight">Conecte o próximo passo.</h2></div><Link href="/login" className="w-fit rounded-lg bg-[#086bd6] px-6 py-3 text-sm font-bold text-white hover:bg-[#0756b0]">Entrar no VChat</Link></div></section>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-6 py-8 text-xs text-text-muted sm:flex-row lg:px-8"><p><strong className="text-text">VChat</strong> · ViniCore Tecnologia</p><nav aria-label="Informações legais" className="flex flex-wrap gap-5"><Link href="/legal/privacy" className="hover:underline">Política de Privacidade</Link><Link href="/legal/terms" className="hover:underline">Termos de Uso</Link><Link href="/legal/privacy#dados-do-google" className="hover:underline">Uso dos dados Google</Link></nav></footer>
    </div>
  );
}
