import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { authPanelClass } from "@/app/login/auth-panel";
import { setPassword } from "./actions";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Set password",
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
            Almost done
          </p>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-tight xl:text-5xl">
            One more step and you are ready to go.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-brand-100/80">
            Choose a password. From then on you sign in with your e-mail address and this password.
          </p>
        </div>

        <ul className="relative grid gap-5 xl:grid-cols-2">
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <KeyRound className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">At least 8 characters</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              A sentence of a few words is strong and easy to remember.
            </p>
          </li>
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <ShieldCheck className="mb-3 size-5 text-accent-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold">Just for you</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
              Do not use it anywhere else and share it with no one, not even us.
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
              Set password
            </h2>

            <Suspense fallback={<FormSkeleton />}>
              <SetPassword />
            </Suspense>
          </div>

          <p className="mt-8 text-sm text-muted max-sm:pt-2 max-sm:text-center">
            Not working? Mail{" "}
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
        Hi {user.name.split(" ")[0]}, choose a password for{" "}
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
    <div className="mt-8 space-y-5" aria-busy="true" aria-label="Loading">
      <span className="block h-4 w-64 animate-pulse rounded bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
      <span className="block h-12 w-full animate-pulse rounded-xl bg-brand-100" />
    </div>
  );
}
