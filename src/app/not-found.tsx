import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(4rem,env(safe-area-inset-bottom))] text-center sm:px-6">
      <Logo className="mb-10" />
      <p className="font-display text-sm font-semibold tracking-wider text-accent-600 uppercase">
        404
      </p>
      <h1 className="mt-2 font-display text-[1.75rem] leading-tight font-bold tracking-tight text-brand-900 sm:text-3xl">
        This page does not exist
      </h1>
      <p className="mt-3 max-w-md text-muted">
        The record may have been deleted, or you have no access. Go back and try again.
      </p>
      <Link href="/" className={buttonClasses({ className: "mt-8 max-sm:w-full max-sm:max-w-sm" })}>
        <ArrowLeft aria-hidden="true" />
        Back to the portal
      </Link>
    </main>
  );
}
