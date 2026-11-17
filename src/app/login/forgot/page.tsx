import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { authPanelClass } from "../auth-panel";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-dvh">
      <section className={authPanelClass}>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col sm:flex-none">
          <div className="max-sm:my-auto">
            <Logo className="mb-8 sm:mb-12" />
            <h1 className="font-display text-[1.75rem] leading-tight font-bold tracking-tight text-brand-900 sm:text-3xl">
              Forgot password?
            </h1>
            <p className="mt-2 text-muted">
              Enter your e-mail address. You get a link to choose a new password, and you are signed in right after.
            </p>
            <div className="mt-8">
              <ForgotForm />
            </div>
          </div>
          <p className="mt-8 text-sm text-muted max-sm:pt-2 max-sm:text-center">
            Not working? Mail{" "}
            <a href="mailto:info@nordavo.nl" className="font-medium text-brand-600 underline-offset-4 hover:underline">
              info@nordavo.nl
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
