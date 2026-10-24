import type { Metadata } from "next";
import { Suspense } from "react";
import { Clock, Handshake, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";
import { PasskeySignIn } from "./passkey-sign-in";

export const metadata: Metadata = {
  title: "Inloggen",
};

const highlights = [
  {
    icon: Users,
    title: "3 kandidaten in 3 weken",
    text: "Gescreend, technisch getest en klaar voor jouw eindgesprek.",
  },
  {
    icon: Clock,
    title: "4 tot 5 uur overlap",
    text: "Bangalore loopt 3,5 tot 4,5 uur voor. Genoeg tijd om samen te bouwen.",
  },
  {
    icon: Handshake,
    title: "Eén aanspreekpunt",
    text: "Groningen voor jouw vraag, Bangalore voor selectie en begeleiding.",
  },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <BridgeBackdrop />

        <Logo tone="light" className="relative" />

        <div className="relative max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-brand-100">
            <span className="size-1.5 rounded-full bg-accent-500" />
            Groningen ↔ Bangalore
          </p>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-tight xl:text-5xl">
            De brug tussen Nederlandse groeibedrijven en Indiaas tech talent.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-brand-100/80">
            Alles rond klanten, vacatures en kandidaten op één plek. Helder,
            snel en zonder gedoe.
          </p>
        </div>

        <ul className="relative grid gap-5 xl:grid-cols-3">
          {highlights.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm"
            >
              <Icon className="mb-3 size-5 text-accent-500" aria-hidden="true" />
              <p className="font-display text-sm font-semibold">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-brand-100/70">
                {text}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Form panel */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-12 lg:hidden" />

          <h2 className="font-display text-3xl font-bold tracking-tight text-brand-900">
            Welkom terug
          </h2>
          <p className="mt-2 text-muted">
            Log in om verder te gaan in het Nordavo portaal.
          </p>

          <div className="mt-8">
            <Suspense>
              <LoginForm />
            </Suspense>
            <Suspense>
              <PasskeySignIn />
            </Suspense>
          </div>

          <p className="mt-8 text-sm text-muted">
            Nog geen account of wachtwoord kwijt? Mail naar{" "}
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

function BridgeBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -top-40 -right-32 size-[520px] rounded-full bg-brand-600/30 blur-3xl" />
      <div className="absolute -bottom-48 -left-24 size-[420px] rounded-full bg-accent-500/15 blur-3xl" />
      <svg
        className="absolute inset-x-0 bottom-0 h-2/3 w-full text-white/[0.07]"
        viewBox="0 0 800 400"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* An arc spanning two shores: the bridge Nordavo builds */}
        <path d="M-20 380 Q400 40 820 380" stroke="currentColor" strokeWidth="2" />
        <path d="M-20 380 Q400 110 820 380" stroke="currentColor" strokeWidth="1.5" />
        <path d="M-20 380 Q400 180 820 380" stroke="currentColor" strokeWidth="1" />
        {Array.from({ length: 15 }, (_, i) => {
          const x = 60 + i * 48;
          const t = (x + 20) / 840;
          const y = (1 - t) * (1 - t) * 380 + 2 * (1 - t) * t * 40 + t * t * 380;
          return (
            <line key={x} x1={x} y1={y} x2={x} y2={380} stroke="currentColor" strokeWidth="1" />
          );
        })}
      </svg>
    </div>
  );
}
