import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LifeBuoy, Smartphone } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { authPanelClass } from "@/app/login/auth-panel";
import { checkSecondStep, verifiedTotpFactors } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { pathAfterSignIn } from "./redirect";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Verificatie",
};

type SearchParams = Promise<{ next?: string | string[] }>;

export default function VerificationPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel, same look as the login page */}
      <section className="relative hidden overflow-hidden bg-brand-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -right-32 size-[520px] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="absolute -bottom-48 -left-24 size-[420px] rounded-full bg-accent-500/15 blur-3xl" />
        </div>

        <Logo tone="light" className="relative" />

        <div className="relative max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-brand-100">
            <span className="size-1.5 rounded-full bg-accent-500" />
            Tweestapsverificatie
          </p>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-tight xl:text-5xl">
            Nog één stap: laat zien dat jij het bent.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-brand-100/80">
            Je wachtwoord klopt. Vul nu de code in uit de authenticator app op je telefoon.
          </p>
        </div>

        <ul className="relative grid gap-5 xl:grid-cols-2">
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <Smartphone className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">Open je app</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              Bijvoorbeeld Google Authenticator, Microsoft Authenticator, 1Password of Authy.
            </p>
          </li>
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <LifeBuoy className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">Telefoon kwijt?</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              Vraag een beheerder om je tweestapsverificatie te resetten.
            </p>
          </li>
        </ul>
      </section>

      {/* Form panel */}
      <section className={authPanelClass}>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col sm:flex-none">
          <div className="max-sm:my-auto">
            <Logo className="mb-8 sm:mb-12 lg:hidden" />

            <h2 className="font-display text-[1.75rem] leading-tight font-bold tracking-tight text-brand-900 sm:text-3xl">
              Code invullen
            </h2>
            <p className="mt-2 text-muted">
              Vul de code van 6 cijfers in uit je authenticator app.
            </p>

            <div className="mt-8">
              <Suspense fallback={<FormSkeleton />}>
                <Verification searchParams={searchParams} />
              </Suspense>
            </div>

            <form action="/auth/signout" method="post" className="mt-6">
              <button
                type="submit"
                className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline active:text-brand-800 max-sm:flex max-sm:min-h-11 max-sm:w-full max-sm:items-center max-sm:justify-center focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                Uitloggen
              </button>
            </form>
          </div>

          <p className="mt-8 text-sm text-muted max-sm:pt-2 max-sm:text-center">
            Telefoon kwijt of lukt het niet? Mail naar{" "}
            <a
              href="mailto:info@nordavo.nl"
              className="font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              info@nordavo.nl
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * /login/* is public in the proxy, so check the session here. Never calls
 * getCurrentUser(): that sends unverified sessions to this very page.
 */
async function Verification({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const step = await checkSecondStep(supabase, data.claims, (name) => cookieStore.get(name)?.value);
  if (!step.required) {
    redirect(await pathAfterSignIn(data.claims.sub, nextPath));
  }

  const { data: factorData } = await supabase.auth.mfa.listFactors();
  const factors = verifiedTotpFactors(factorData?.all).map((factor, index) => ({
    id: factor.id,
    name: factor.friendly_name || `Authenticator app ${index + 1}`,
  }));

  if (factors.length === 0) {
    // Only when Supabase Auth could not be reached or the session ended elsewhere.
    return (
      <p
        role="alert"
        className="rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
      >
        Je sessie kon niet worden gecontroleerd. Log uit en log opnieuw in.
      </p>
    );
  }

  return <VerifyForm factors={factors} next={nextPath} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Laden">
      <span className="block h-4 w-40 animate-pulse rounded bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
    </div>
  );
}
