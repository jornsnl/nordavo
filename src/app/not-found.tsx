import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <Logo className="mb-10" />
      <p className="font-display text-sm font-semibold tracking-wider text-accent-600 uppercase">
        404
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-brand-900">
        Deze pagina bestaat niet
      </h1>
      <p className="mt-3 max-w-md text-muted">
        Misschien is het record verwijderd, of heb je geen toegang. Ga terug en probeer het opnieuw.
      </p>
      <Link href="/" className={buttonClasses({ className: "mt-8" })}>
        <ArrowLeft aria-hidden="true" />
        Terug naar het portaal
      </Link>
    </main>
  );
}
