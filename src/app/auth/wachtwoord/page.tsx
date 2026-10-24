import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { setPassword } from "./actions";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Wachtwoord instellen",
};

export default function SetPasswordPage() {
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
            Bijna klaar
          </p>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-tight xl:text-5xl">
            Nog één stap en je kunt aan de slag.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-brand-100/80">
            Kies een wachtwoord. Daarna log je voortaan in met je e-mailadres en dit wachtwoord.
          </p>
        </div>

        <ul className="relative grid gap-5 xl:grid-cols-2">
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <KeyRound className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">Minimaal 8 tekens</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              Een zin van een paar woorden is sterk en makkelijk te onthouden.
            </p>
          </li>
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <ShieldCheck className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">Alleen voor jou</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              Gebruik het nergens anders en deel het met niemand, ook niet met ons.
            </p>
          </li>
        </ul>
      </section>

      {/* Form panel */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-12 lg:hidden" />

          <h2 className="font-display text-3xl font-bold tracking-tight text-brand-900">
            Wachtwoord instellen
          </h2>

          <Suspense fallback={<FormSkeleton />}>
            <SetPassword />
          </Suspense>

          <p className="mt-8 text-sm text-muted">
            Lukt het niet? Mail naar{" "}
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

/** /auth/* is public in the proxy, so check for the invite or recovery session here. */
async function SetPassword() {
  const user = await getCurrentUser();
  return (
    <>
      <p className="mt-2 text-muted">
        Hoi {user.name.split(" ")[0]}, kies een wachtwoord voor{" "}
        <span className="font-medium text-ink">{user.email}</span>.
      </p>
      <div className="mt-8">
        <SetPasswordForm action={setPassword} />
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="mt-8 space-y-5" aria-busy="true" aria-label="Laden">
      <span className="block h-4 w-64 animate-pulse rounded bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
    </div>
  );
}
