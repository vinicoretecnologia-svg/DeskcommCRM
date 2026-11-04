/* eslint-disable @next/next/no-img-element -- runtime brand URLs are supplied by this installation. */
import Link from "next/link";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await marcaDaSaida(null);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const locale = (user?.user_metadata?.locale as string | undefined) ?? null;
  return (
    <IdiomaProvider locale={locale}>
      <main className="vinicore-access min-h-dvh">
        <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col lg:flex-row">
          <section className="relative hidden overflow-hidden bg-[#07172d] px-12 py-12 text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between xl:px-20" aria-label="VChat da ViniCore">
            <Link href="/" className="relative inline-flex w-fit items-center gap-2 text-sm font-bold tracking-tight text-white">ViniCore<span className="text-cyan-300">Tecnologia</span></Link>
            <div className="relative max-w-xl py-16">
              {marca.logoUrl ? <img src={marca.logoUrl} alt={marca.nome} className="mb-10 h-auto max-h-36 w-56 object-contain object-left" /> : <p className="vinicore-wordmark mb-10 text-4xl">{marca.nome}</p>}
              <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Conversas que movem negócios</p>
              <h2 className="text-4xl font-bold leading-[1.12] tracking-tight xl:text-5xl">Seu atendimento.<br />Uma operação<br /><span className="text-cyan-300">mais conectada.</span></h2>
              <p className="mt-6 max-w-md text-base leading-7 text-slate-300">Conversas, equipe, agenda e vendas reunidas no VChat, com a tecnologia da ViniCore.</p>
              <div className="mt-10 flex flex-wrap gap-2 text-xs text-slate-200"><span className="rounded-full border border-white/20 px-3 py-2">Atendimento</span><span className="rounded-full border border-white/20 px-3 py-2">Agenda</span><span className="rounded-full border border-white/20 px-3 py-2">Automação</span></div>
            </div>
            <p className="relative text-xs text-slate-400">Tecnologia para aproximar pessoas e negócios.</p>
          </section>
          <section className="flex min-h-dvh flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
            <div className="w-full max-w-md">
              <Link href="/" className="mb-8 flex flex-col items-center gap-2 text-center lg:hidden">
                {marca.logoUrl ? <img data-testid="logo-da-fachada" src={marca.logoUrl} alt={marca.nome} className="h-auto max-h-32 w-52 object-contain" /> : <span className="vinicore-wordmark text-3xl">{marca.nome}</span>}
                <span className="text-xs font-semibold tracking-wide text-text-muted">por ViniCore Tecnologia</span>
              </Link>
              <div className="rounded-2xl border border-border bg-surface p-7 shadow-lg sm:p-9">
                <p className="mb-5 text-[11px] font-extrabold uppercase tracking-[0.18em] text-accent-600 dark:text-cyan-300">Acesso à sua operação</p>
                {children}
              </div>
              <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-text-muted"><Link href="/">VChat · ViniCore</Link><Link href="/legal/privacy" className="hover:underline">Privacidade</Link><Link href="/legal/terms" className="hover:underline">Termos de uso</Link></div>
            </div>
          </section>
        </div>
      </main>
    </IdiomaProvider>
  );
}
